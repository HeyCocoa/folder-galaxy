import fs from 'fs/promises';
import fssync from 'fs';
import path from 'path';
import crypto from 'crypto';
import { getFileTypeGroup, isHiddenName } from './fileTypes';
import type {
  FolderStats,
  ScanOptions,
  ScanResult,
  FileTypeGroup,
  TypeBreakdownEntry,
  ScanProgress,
  FileStats,
} from '../../shared/types';

const DEFAULT_MAX_DEPTH = 2;
const DEFAULT_CONCURRENCY = 64;
const SOFT_FILE_LIMIT_DEFAULT = 1_000_000; // soft cap; do not abort
const MAX_FILE_THRESHOLD = 10_000; // hard cap for file-level detail in includeFiles mode

type TB = Partial<Record<FileTypeGroup, TypeBreakdownEntry>>;

interface FolderNode {
  id: string;
  path: string;
  name: string;
  depth: number;
  children: FolderNode[];
  // Direct stats within this folder (not including subfolders)
  directSize: number;
  directFileCount: number;
  typeBreakdown: TB; // direct breakdown
}

function makeId(fullPath: string) {
  return crypto.createHash('sha1').update(fullPath).digest('hex').slice(0, 12);
}

function addFileToBreakdown(tb: TB, group: FileTypeGroup, size: number) {
  const entry = tb[group] || { size: 0, count: 0 };
  entry.size += size;
  entry.count += 1;
  tb[group] = entry;
}

function mergeBreakdown(into: TB, from: TB) {
  for (const [k, v] of Object.entries(from) as [FileTypeGroup, TypeBreakdownEntry][]) {
    const entry = into[k] || { size: 0, count: 0 };
    entry.size += v.size;
    entry.count += v.count;
    into[k] = entry;
  }
}

async function statSafe(p: string) {
  try {
    return await fs.lstat(p);
  } catch {
    return null;
  }
}

export async function scanDirectory(
  options: ScanOptions,
  ctx?: { onProgress?: (p: ScanProgress) => void; isCancelled?: () => boolean }
): Promise<ScanResult> {
  const rootPath = path.resolve(options.rootPath);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const followSymlinks = options.followSymlinks ?? false;
  const includeHidden = options.includeHidden ?? false;
  const includeSystem = options.includeSystem ?? false;
  const concurrency = Math.max(1, Math.min(options.concurrency ?? DEFAULT_CONCURRENCY, 256));
  const softFileLimit = options.softFileLimit ?? SOFT_FILE_LIMIT_DEFAULT;
  const scanId = options.scanId || Math.random().toString(36).slice(2);

  const rootStat = await statSafe(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Root path is not a directory: ${rootPath}`);
  }

  const visitedRealPaths = new Set<string>();
  const fileCounter = { count: 0 };
  const dirCounter = { count: 0 };
  const startedAt = Date.now();
  const emit = (phase: ScanProgress['phase'], currentPath?: string) => {
    if (!ctx?.onProgress) return;
    const now = Date.now();
    if ((emit as any)._last && now - (emit as any)._last < 120 && phase === 'enumerating') return; // throttle
    (emit as any)._last = now;
    ctx.onProgress({
      scanId,
      scannedFiles: fileCounter.count,
      scannedDirs: dirCounter.count,
      bytes: 0, // optional: could maintain running bytes if desired
      currentPath,
      elapsedMs: now - startedAt,
      phase,
    });
  };

  function cancelled() {
    return ctx?.isCancelled?.() === true;
  }

  function isWindows() {
    return process.platform === 'win32';
  }

  function normalizeCase(p: string) {
    return isWindows() ? p.toLowerCase() : p;
  }

  const systemExcludes = (() => {
    if (!isWindows() || includeSystem) return [] as string[];
    const root = path.parse(rootPath).root; // e.g., C:\
    const join = (...s: string[]) => normalizeCase(path.join(root, ...s));
    return [
      join('Windows'),
      join('Program Files'),
      join('Program Files (x86)'),
      join('ProgramData'),
      join('$Recycle.Bin'),
      join('System Volume Information'),
      join('Recovery'),
      join('PerfLogs'),
    ];
  })();

  function isExcludedDir(p: string) {
    if (!systemExcludes.length) return false;
    const np = normalizeCase(p);
    if (systemExcludes.some((base) => np === base || np.startsWith(base + path.sep))) return true;
    // Users/*/AppData
    const users = normalizeCase(path.join(path.parse(rootPath).root, 'Users'));
    if (np.startsWith(users + path.sep)) {
      const segs = np.slice(users.length + 1).split(path.sep);
      if (segs.length >= 2 && segs[1] === 'AppData') return true;
    }
    return false;
  }

  async function pMap<T, R>(items: T[], limit: number, fn: (item: T, idx: number) => Promise<R>): Promise<R[]> {
    const ret: R[] = new Array(items.length);
    let i = 0;
    let active = 0;
    return await new Promise<R[]>((resolve, reject) => {
      const next = () => {
        if (cancelled()) return reject(new Error('Scan cancelled'));
        if (i === items.length && active === 0) return resolve(ret);
        while (active < limit && i < items.length) {
          const cur = i++;
          active++;
          Promise.resolve(fn(items[cur], cur))
            .then((v) => {
              ret[cur] = v;
              active--;
              next();
            })
            .catch(reject);
        }
      };
      next();
    });
  }

  async function sumAllBelow(dirPath: string): Promise<{ size: number; count: number; tb: TB }> {
    let size = 0;
    let count = 0;
    const tb: TB = {};
    let real = await fs.realpath(dirPath).catch(() => dirPath);
    if (visitedRealPaths.has(real)) return { size: 0, count: 0, tb };
    visitedRealPaths.add(real);
    let entries: import('fs').Dirent[] = [];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return { size, count, tb };
    }
    emit('enumerating', dirPath);
    await pMap(entries, concurrency, async (e) => {
      if (!includeHidden && isHiddenName(e.name)) return;
      const full = path.join(dirPath, e.name);
      if (e.isDirectory() && isExcludedDir(full)) return;
      if (e.isSymbolicLink()) {
        if (!followSymlinks) return;
        const realp = await fs.realpath(full).catch(() => full);
        const st = await statSafe(realp);
        if (!st) return;
        if (st.isDirectory()) {
          const sub = await sumAllBelow(realp);
          size += sub.size;
          count += sub.count;
          mergeBreakdown(tb, sub.tb);
        } else if (st.isFile()) {
          const s = st.size;
          size += s;
          count += 1;
          fileCounter.count += 1;
          addFileToBreakdown(tb, getFileTypeGroup(full), s);
        }
        return;
      }
      if (e.isDirectory()) {
        const sub = await sumAllBelow(full);
        size += sub.size;
        count += sub.count;
        mergeBreakdown(tb, sub.tb);
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full);
          size += st.size;
          count += 1;
          fileCounter.count += 1;
          addFileToBreakdown(tb, getFileTypeGroup(full), st.size);
        } catch { /* ignore */ }
      }
    });
    return { size, count, tb };
  }

  const collectFiles: FileStats[] = [];

  async function walk(currentPath: string, depth: number): Promise<FolderNode> {
    const name = path.basename(currentPath) || currentPath;
    const node: FolderNode = {
      id: makeId(currentPath),
      path: currentPath,
      name,
      depth,
      children: [],
      directSize: 0,
      directFileCount: 0,
      typeBreakdown: {},
    };

    const currentReal = await fs.realpath(currentPath).catch(() => currentPath);
    if (visitedRealPaths.has(currentReal)) {
      // Avoid symlink loops / duplicates
      return node;
    }
    visitedRealPaths.add(currentReal);

    dirCounter.count += 1;
    emit('enumerating', currentPath);
    const entries = await fs.readdir(currentPath, { withFileTypes: true }).catch(() => [] as import('fs').Dirent[]);

    await pMap(entries, concurrency, async (e) => {
      if (!includeHidden && isHiddenName(e.name)) return;
      const full = path.join(currentPath, e.name);
      // For symlinks, decide whether to follow
      if (e.isSymbolicLink()) {
        if (!followSymlinks) return;
        const real = await fs.realpath(full).catch(() => full);
        const st = await statSafe(real);
        if (!st) return;
        if (st.isDirectory()) {
          if (depth + 1 <= maxDepth) {
            const child = await walk(real, depth + 1);
            node.children.push(child);
          } else {
            const sub = await sumAllBelow(real);
            node.directSize += sub.size;
            node.directFileCount += sub.count;
            mergeBreakdown(node.typeBreakdown, sub.tb);
          }
        } else if (st.isFile()) {
          const size = st.size;
          const group = getFileTypeGroup(full);
          addFileToBreakdown(node.typeBreakdown, group, size);
          node.directSize += size;
          node.directFileCount += 1;
          fileCounter.count += 1;
          if (options.includeFiles) {
            if (collectFiles.length >= MAX_FILE_THRESHOLD) {
              throw new Error(`Too many files to include in file-level view (> ${MAX_FILE_THRESHOLD}). Please scan without file-level details or narrow your scope.`);
            }
            collectFiles.push({
              id: makeId(full),
              path: full,
              name: e.name,
              parentId: node.id,
              depth: depth + 1,
              size,
              type: group,
            });
          }
        }
        return;
      }

      if (e.isDirectory()) {
        if (isExcludedDir(full)) return;
        if (depth + 1 <= maxDepth) {
          const child = await walk(full, depth + 1);
          node.children.push(child);
        } else {
          const sub = await sumAllBelow(full);
          node.directSize += sub.size;
          node.directFileCount += sub.count;
          mergeBreakdown(node.typeBreakdown, sub.tb);
        }
      } else if (e.isFile()) {
        try {
          const st = await fs.stat(full);
          const size = st.size;
          const group = getFileTypeGroup(full);
          addFileToBreakdown(node.typeBreakdown, group, size);
          node.directSize += size;
          node.directFileCount += 1;
          fileCounter.count += 1;
          if (options.includeFiles) {
            if (collectFiles.length >= MAX_FILE_THRESHOLD) {
              throw new Error(`Too many files to include in file-level view (> ${MAX_FILE_THRESHOLD}). Please scan without file-level details or narrow your scope.`);
            }
            collectFiles.push({
              id: makeId(full),
              path: full,
              name: e.name,
              parentId: node.id,
              depth: depth + 1,
              size,
              type: group,
            });
          }
          // Soft limit only for telemetry; do not abort
        } catch {
          // ignore unreadable files
        }
      }
    });

    return node;
  }

  const rootNode = await walk(rootPath, 0);

  // Convert to FolderStats[] with aggregated totals
  const folders: FolderStats[] = [];

  function aggregate(node: FolderNode): { totalSize: number; fileCount: number; typeBreakdown: TB; subfolderCount: number } {
    let totalSize = node.directSize;
    let fileCount = node.directFileCount;
    const tb: TB = { ...node.typeBreakdown };
    let subfolderCount = node.children.length; // immediate children count
    for (const ch of node.children) {
      const agg = aggregate(ch);
      totalSize += agg.totalSize;
      fileCount += agg.fileCount;
      mergeBreakdown(tb, agg.typeBreakdown);
      // subfolderCount remains immediate children only for this node
    }
    const stats: FolderStats = {
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

  const result: ScanResult = {
    rootPath,
    generatedAt: new Date().toISOString(),
    folders,
    totalSize: aggRoot.totalSize,
    totalFileCount: aggRoot.fileCount,
    files: options.includeFiles ? collectFiles : undefined,
  };
  return result;
}
