import { app, BrowserWindow, Menu, session, shell } from 'electron';
import dotenv from 'dotenv';
import fs from 'node:fs';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// High-performance GPU, WebGL (Three.js), and Web Audio / Tone.js flags
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

let mainWindow: BrowserWindow | null = null;
let httpServer: Server | null = null;
let activeUrl = '';

function loadOptionalUserEnv(): void {
  const candidates = [
    path.join(app.getPath('userData'), '.env'),
    path.join(path.dirname(app.getPath('exe')), '.env'),
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      dotenv.config({ path: envPath, override: false });
    }
  }
}

function buildAppMenu(): void {
  if (process.platform === 'darwin') {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: app.name,
        submenu: [
          { role: 'about' },
          { type: 'separator' },
          { role: 'hide' },
          { role: 'hideOthers' },
          { role: 'unhide' },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      {
        label: 'Window',
        submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
      },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  } else {
    Menu.setApplicationMenu(null);
  }
}

function createMainWindow(targetUrl: string): BrowserWindow {
  const preloadPath = path.join(__dirname, 'preload.cjs');
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.png');

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    show: false,
    backgroundColor: '#07090E',
    title: 'Helios Sonics',
    autoHideMenuBar: true,
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  // Open NASA SVS / external links in the user's default system browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  void win.loadURL(targetUrl);
  return win;
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    loadOptionalUserEnv();
    buildAppMenu();

    // Grant microphone & clipboard permissions for Observatory live audio input & link sharing
    session.defaultSession.setPermissionRequestHandler(
      (_webContents, permission, callback) => {
        const allowed = permission === 'media' || permission === 'clipboard-sanitized-write';
        callback(allowed);
      }
    );

    const distPath = path.join(app.getAppPath(), 'dist');
    const started = await startServer({
      port: 0,
      host: '127.0.0.1',
      distPath,
      forceStatic: true,
    });

    httpServer = started.server;
    activeUrl = started.url;
    mainWindow = createMainWindow(activeUrl);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && activeUrl) {
        mainWindow = createMainWindow(activeUrl);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  app.on('before-quit', () => {
    if (httpServer) {
      httpServer.close();
      httpServer = null;
    }
  });
}
