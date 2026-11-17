import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { mdsd, type DiscoveryInfo } from '@c30/mdsd';

let mainWindow: BrowserWindow | null = null;

// 局域网教师端发现结果(供 renderer 双轨连接)
let discoveredTeacher: DiscoveryInfo | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: false, // 无边框窗口,自绘标题栏与控制区
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
  });

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized', true);
  });
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized', false);
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function registerWindowControls(): void {
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize();
  });
  ipcMain.on('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.on('window:close', () => {
    mainWindow?.close();
  });
  ipcMain.handle('window:is-maximized', () => {
    return mainWindow?.isMaximized() ?? false;
  });
}

// 局域网发现:订阅教师端 mDNS 广播,供双轨连接
function registerDiscovery(): void {
  ipcMain.handle('discovery:get-teacher', () => {
    return discoveredTeacher;
  });

  mdsd
    .subscribe((info) => {
      discoveredTeacher = info;
      console.log(`[discovery] 发现教师端: ${info.teacherName} @ ${info.host}:${info.port} (${info.roomCode})`);
      mainWindow?.webContents.send('discovery:found', info);
    })
    .catch((err) => {
      console.warn('[discovery] mDNS 订阅失败(将回退中心服务器):', (err as Error)?.message ?? String(err));
    });
}

app.whenReady().then(() => {
  registerWindowControls();
  registerDiscovery();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
