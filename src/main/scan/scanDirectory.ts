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
} from '../../shared/types';

const DEFAULT_MAX_DEPTH = 2;
const MAX_FILE_THRESHOLD = 10_000; // MVP: bail out for huge trees

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

export async function scanDirectory(options: ScanOptions): Promise<ScanResult> {
  const rootPath = path.resolve(options.rootPath);
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const followSymlinks = options.followSymlinks ?? false;
  const includeHidden = options.includeHidden ?? false;

  const rootStat = await statSafe(rootPath);
  if (!rootStat || !rootStat.isDirectory()) {
    throw new Error(`Root path is not a directory: ${rootPath}`);
  }

  const visitedRealPaths = new Set<string>();
  const fileCounter = { count: 0 };

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
    for (const e of entries) {
      if (!includeHidden && isHiddenName(e.name)) continue;
      const full = path.join(dirPath, e.name);
      if (e.isSymbolicLink()) {
        if (!followSymlinks) continue;
        const realp = await fs.realpath(full).catch(() => full);
        const st = await statSafe(realp);
        if (!st) continue;
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
        continue;
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
    }
    return { size, count, tb };
  }

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

    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const e of entries) {
      if (!includeHidden && isHiddenName(e.name)) continue;
      const full = path.join(currentPath, e.name);
      // For symlinks, decide whether to follow
      if (e.isSymbolicLink()) {
        if (!followSymlinks) continue;
        const real = await fs.realpath(full).catch(() => full);
        const st = await statSafe(real);
        if (!st) continue;
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
        }
        continue;
      }

      if (e.isDirectory()) {
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
          if (fileCounter.count > MAX_FILE_THRESHOLD) {
            throw new Error(`Too many files (> ${MAX_FILE_THRESHOLD}). Please narrow the scope.`);
          }
        } catch {
          // ignore unreadable files
        }
      }
    }

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
  };
  return result;
}
