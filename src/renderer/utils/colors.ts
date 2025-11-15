import type { FileTypeGroup, FolderStats } from '../../shared/types';

export const GROUP_COLORS: Record<FileTypeGroup, string> = {
  video: '#7c9cff',
  image: '#ffc65c',
  audio: '#7ee787',
  document: '#ff9ecd',
  code: '#6ae3ff',
  archive: '#f78c6c',
  other: '#b3b8c3',
};

export function getPrimaryType(stats: FolderStats): FileTypeGroup {
  let best: { k: FileTypeGroup; size: number } | null = null;
  for (const [k, v] of Object.entries(stats.typeBreakdown) as [FileTypeGroup, { size: number; count: number }][]) {
    if (!best || v.size > best.size) best = { k, size: v.size };
  }
  return best?.k ?? 'other';
}
