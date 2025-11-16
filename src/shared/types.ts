export type FileTypeGroup =
  | 'video'
  | 'image'
  | 'audio'
  | 'document'
  | 'code'
  | 'archive'
  | 'other';

export interface ScanOptions {
  rootPath: string;
  maxDepth?: number; // 可选；<=0 或未设置表示不限制深度
  followSymlinks?: boolean; // default false
  includeHidden?: boolean; // default false
  includeFiles?: boolean; // default false: include per-file leaves in result
  // New options (Plan A)
  includeSystem?: boolean; // default false on Windows (exclude system folders by default)
  concurrency?: number; // default 64
  softFileLimit?: number; // soft cap for files counted; no hard abort (default 1_000_000)
  scanId?: string; // used to correlate progress/cancel
}

export interface TypeBreakdownEntry {
  size: number;
  count: number;
}

export interface FolderStats {
  id: string;
  path: string;
  name: string;
  depth: number;
  totalSize: number;
  fileCount: number;
  subfolderCount: number;
  typeBreakdown: Partial<Record<FileTypeGroup, TypeBreakdownEntry>>;
  childrenIds: string[];
}

export interface FileStats {
  id: string;
  path: string;
  name: string;
  parentId: string; // folder id that directly contains this file
  depth: number; // parent folder depth + 1
  size: number;
  type: FileTypeGroup;
}

export interface ScanResult {
  rootPath: string;
  generatedAt: string; // ISO string
  folders: FolderStats[];
  totalSize: number;
  totalFileCount: number;
  files?: FileStats[]; // optional; present only when includeFiles was requested
}

// Progress event payload sent from main to renderer
export interface ScanProgress {
  scanId: string;
  scannedFiles: number;
  scannedDirs: number;
  bytes: number;
  currentPath?: string;
  elapsedMs: number;
  phase: 'enumerating' | 'summing' | 'done' | 'cancelled';
}

export type IpcOk<T> = { ok: true; result: T };
export type IpcErr = { ok: false; error: string };
export type IpcResult<T> = IpcOk<T> | IpcErr;
