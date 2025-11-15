import path from 'path';
import type { FileTypeGroup } from '../../shared/types';

const EXT_MAP: Record<string, FileTypeGroup> = Object.create(null);

function map(exts: string[], group: FileTypeGroup) {
  for (const e of exts) EXT_MAP[e] = group;
}

map([
  'mp4','mkv','avi','mov','wmv','flv','webm','m4v','ts'
], 'video');
map([
  'jpg','jpeg','png','gif','bmp','svg','webp','tif','tiff','heic','heif','ico','raw','cr2','nef','arw'
], 'image');
map([
  'mp3','wav','flac','aac','ogg','m4a','wma','aiff','alac','opus'
], 'audio');
map([
  'pdf','doc','docx','ppt','pptx','xls','xlsx','csv','md','txt','rtf','odt','ods','odp','epub'
], 'document');
map([
  'js','ts','tsx','jsx','mjs','cjs','json','yml','yaml','xml','html','css','scss','less','vue','svelte','py','java','kt','c','h','cpp','hpp','cs','go','rb','rs','php','sql','swift','r','ipynb','sh','bat','ps1','toml','ini','gradle'
], 'code');
map([
  'zip','rar','7z','tar','gz','bz2','xz','lz','lz4','zst','iso','dmg','cab'
], 'archive');

export function getFileTypeGroup(filePath: string): FileTypeGroup {
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, '');
  return EXT_MAP[ext] || 'other';
}

export function isHiddenName(name: string): boolean {
  // Basic heuristic: dotfiles and common system files
  if (!name) return false;
  if (name.startsWith('.')) return true;
  const lower = name.toLowerCase();
  return lower === 'thumbs.db' || lower === 'desktop.ini' || lower === '$recycle.bin';
}
