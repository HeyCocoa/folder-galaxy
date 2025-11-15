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

export type IpcOk<T> = { ok: true; result: T };
export type IpcErr = { ok: false; error: string };
export type IpcResult<T> = IpcOk<T> | IpcErr;

