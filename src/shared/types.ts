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
  maxDepth?: number; // default 2
  followSymlinks?: boolean; // default false
  includeHidden?: boolean; // default false
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

export interface ScanResult {
  rootPath: string;
  generatedAt: string; // ISO string
  folders: FolderStats[];
  totalSize: number;
  totalFileCount: number;
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
