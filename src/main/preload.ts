import { contextBridge, ipcRenderer } from 'electron';
import type { ScanOptions, ScanResult, IpcResult, ScanProgress } from '../shared/types';

const api = {
  scanDirectory: (options: ScanOptions): Promise<IpcResult<ScanResult>> =>
    ipcRenderer.invoke('scan-directory', options),
  onScanProgress: (listener: (p: ScanProgress) => void): (() => void) => {
    const handler = (_: any, payload: ScanProgress) => listener(payload);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.removeListener('scan-progress', handler);
  },
  cancelScan: (scanId: string): Promise<{ ok: boolean } > =>
    ipcRenderer.invoke('cancel-scan', scanId),
  openFolder: (folderPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('open-folder', folderPath),
  openPath: (targetPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('open-path', targetPath),
  chooseDirectory: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('choose-directory'),
};

contextBridge.exposeInMainWorld('api', api);

export type PreloadApi = typeof api;
