import { app, BrowserWindow, ipcMain, dialog, shell, Menu } from 'electron';
import path from 'path';
import { scanDirectory } from './scan/scanDirectory';
import type { ScanOptions, ScanResult, IpcResult } from '../shared/types';

let mainWindow: BrowserWindow | null = null;

function getPreloadPath() {
  // In build, preload.js is placed in dist/main
  return path.join(__dirname, 'preload.js');
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: getPreloadPath(),
    },
    // Hide native menu bar on Windows/Linux; macOS menu bar is OS-level
    autoHideMenuBar: true,
    show: false,
  });

  // Ensure the menu bar stays hidden (Win/Linux); still allows Alt to toggle when autoHideMenuBar is true
  mainWindow.setMenuBarVisibility(false);

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  const isDev = !app.isPackaged;
  if (isDev) {
    await mainWindow.loadURL('http://localhost:5176');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    const indexPath = path.join(__dirname, '../renderer/index.html');
    await mainWindow.loadFile(indexPath);
  }
}

// IPC handlers
ipcMain.handle('scan-directory', async (_e: any, options: ScanOptions): Promise<IpcResult<ScanResult>> => {
  try {
    const result = await scanDirectory(options);
    return { ok: true, result };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});

ipcMain.handle('open-folder', async (_e: any, folderPath: string) => {
  const res = await shell.openPath(folderPath);
  return { ok: res === '', error: res || undefined };
});

ipcMain.handle('choose-directory', async () => {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return res;
});

app.whenReady().then(async () => {
  // Remove default menus. On macOS keep a minimal menu so common shortcuts work.
  if (process.platform === 'darwin') {
    const menu = Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'windowMenu' },
    ]);
    Menu.setApplicationMenu(menu);
  } else {
    Menu.setApplicationMenu(null);
  }

  await createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
