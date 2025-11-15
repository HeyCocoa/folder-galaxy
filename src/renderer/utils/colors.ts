import type { FileTypeGroup, FolderStats } from '../../shared/types';

// Neo‑Brutalism pure color palette (high saturation, no gradients)
export const GROUP_COLORS: Record<FileTypeGroup, string> = {
  video: '#FF6B3B',
  image: '#0BACFF',
  audio: '#9C27B0', // 未单独指定，沿用“其他/杂项”紫色系
  document: '#FFD600',
  code: '#4ADE80',
  archive: '#9C27B0', // 未单独指定，归入杂项色
  other: '#9C27B0',
};

export function getPrimaryType(stats: FolderStats): FileTypeGroup {
  let best: { k: FileTypeGroup; size: number } | null = null;
  for (const [k, v] of Object.entries(stats.typeBreakdown) as [FileTypeGroup, { size: number; count: number }][]) {
    if (!best || v.size > best.size) best = { k, size: v.size };
  }
  return best?.k ?? 'other';
}
