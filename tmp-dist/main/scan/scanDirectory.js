"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scanDirectory = scanDirectory;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const crypto_1 = __importDefault(require("crypto"));
const fileTypes_1 = require("./fileTypes");
const DEFAULT_MAX_DEPTH = 2;
const MAX_FILE_THRESHOLD = 10000; // MVP: bail out for huge trees
function makeId(fullPath) {
    return crypto_1.default.createHash('sha1').update(fullPath).digest('hex').slice(0, 12);
}
function addToBreakdown(tb, group, size) {
    const entry = tb[group] || { size: 0, count: 0 };
    entry.size += size;
    entry.count += 1;
    tb[group] = entry;
}
function mergeBreakdown(into, from) {
    for (const [k, v] of Object.entries(from)) {
        addToBreakdown(into, k, v.size);
        // Only size merges; count here doesn’t strictly matter for aggregated type, but we’ll keep it
        const e = into[k];
        e.count += v.count - 1; // addToBreakdown already +1
    }
}
async function statSafe(p) {
    try {
        return await promises_1.default.lstat(p);
    }
    catch {
        return null;
    }
}
async function scanDirectory(options) {
    const rootPath = path_1.default.resolve(options.rootPath);
    const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
    const followSymlinks = options.followSymlinks ?? false;
    const includeHidden = options.includeHidden ?? false;
    const rootStat = await statSafe(rootPath);
    if (!rootStat || !rootStat.isDirectory()) {
        throw new Error(`Root path is not a directory: ${rootPath}`);
    }
    const visitedRealPaths = new Set();
    const fileCounter = { count: 0 };
    async function walk(currentPath, depth) {
        const name = path_1.default.basename(currentPath) || currentPath;
        const node = {
            id: makeId(currentPath),
            path: currentPath,
            name,
            depth,
            children: [],
            directSize: 0,
            directFileCount: 0,
            typeBreakdown: {},
        };
        const currentReal = await promises_1.default.realpath(currentPath).catch(() => currentPath);
        if (visitedRealPaths.has(currentReal)) {
            // Avoid symlink loops / duplicates
            return node;
        }
        visitedRealPaths.add(currentReal);
        const entries = await promises_1.default.readdir(currentPath, { withFileTypes: true });
        for (const e of entries) {
            if (!includeHidden && (0, fileTypes_1.isHiddenName)(e.name))
                continue;
            const full = path_1.default.join(currentPath, e.name);
            // For symlinks, decide whether to follow
            if (e.isSymbolicLink()) {
                if (!followSymlinks)
                    continue;
                const real = await promises_1.default.realpath(full).catch(() => full);
                const st = await statSafe(real);
                if (!st)
                    continue;
                if (st.isDirectory()) {
                    if (depth + 1 <= maxDepth) {
                        const child = await walk(real, depth + 1);
                        node.children.push(child);
                    }
                }
                else if (st.isFile()) {
                    const size = st.size;
                    const group = (0, fileTypes_1.getFileTypeGroup)(full);
                    addToBreakdown(node.typeBreakdown, group, size);
                    node.directSize += size;
                    node.directFileCount += 1;
                    fileCounter.count += 1;
                }
                continue;
            }
            if (e.isDirectory()) {
                if (depth + 1 <= maxDepth) {
                    const child = await walk(full, depth + 1);
                    node.children.push(child);
                }
            }
            else if (e.isFile()) {
                try {
                    const st = await promises_1.default.stat(full);
                    const size = st.size;
                    const group = (0, fileTypes_1.getFileTypeGroup)(full);
                    addToBreakdown(node.typeBreakdown, group, size);
                    node.directSize += size;
                    node.directFileCount += 1;
                    fileCounter.count += 1;
                    if (fileCounter.count > MAX_FILE_THRESHOLD) {
                        throw new Error(`Too many files (> ${MAX_FILE_THRESHOLD}). Please narrow the scope.`);
                    }
                }
                catch {
                    // ignore unreadable files
                }
            }
        }
        return node;
    }
    const rootNode = await walk(rootPath, 0);
    // Convert to FolderStats[] with aggregated totals
    const folders = [];
    function aggregate(node) {
        let totalSize = node.directSize;
        let fileCount = node.directFileCount;
        const tb = { ...node.typeBreakdown };
        let subfolderCount = node.children.length; // immediate children count
        for (const ch of node.children) {
            const agg = aggregate(ch);
            totalSize += agg.totalSize;
            fileCount += agg.fileCount;
            mergeBreakdown(tb, agg.typeBreakdown);
            // subfolderCount remains immediate children only for this node
        }
        const stats = {
            id: node.id,
            path: node.path,
            name: node.name,
            depth: node.depth,
            totalSize,
            fileCount,
            subfolderCount,
            typeBreakdown: tb,
            childrenIds: node.children.map((c) => c.id),
        };
        folders.push(stats);
        return { totalSize, fileCount, typeBreakdown: tb, subfolderCount };
    }
    const aggRoot = aggregate(rootNode);
    const result = {
        rootPath,
        generatedAt: new Date().toISOString(),
        folders,
        totalSize: aggRoot.totalSize,
        totalFileCount: aggRoot.fileCount,
    };
    return result;
}
