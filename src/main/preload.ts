import { contextBridge, ipcRenderer } from 'electron';
import type { ScanOptions, ScanResult, IpcResult } from '../shared/types';

const api = {
  scanDirectory: (options: ScanOptions): Promise<IpcResult<ScanResult>> =>
    ipcRenderer.invoke('scan-directory', options),
  openFolder: (folderPath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('open-folder', folderPath),
  chooseDirectory: (): Promise<{ canceled: boolean; filePaths: string[] }> =>
    ipcRenderer.invoke('choose-directory'),
};

contextBridge.exposeInMainWorld('api', api);

export type PreloadApi = typeof api;
