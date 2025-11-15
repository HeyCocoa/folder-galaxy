import type { PreloadApi } from '../main/preload';
import type { ScanOptions, ScanResult, IpcResult } from '../shared/types';

declare global {
  interface Window {
    api: PreloadApi & {
      scanDirectory(options: ScanOptions): Promise<IpcResult<ScanResult>>;
    };
  }
}

export {};
