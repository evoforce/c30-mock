import { app, shell, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { mdsd, type DiscoveryInfo } from '@c30/mdsd';

let mainWindow: BrowserWindow | null = null;

// 局域网发现的教师端房间列表(去重,供渲染层展示供选择)
const discoveredRooms = new Map<string, DiscoveryInfo>();

function createWindow(): void {
  // 学生端主窗口 = 全屏透明悬浮层,覆盖桌面,桌面壁纸/图标透出
  const { width, height } = screen.getPrimaryDisplay().bounds;
  mainWindow = new BrowserWindow({
    x: 0,
    y: 0,
    width,
    height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    resizable: false,
    movable: false,
    hasShadow: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
    },
  });

  // 默认穿透到桌面(可操作桌面),仅当渲染层判定鼠标悬停在可交互组件上时关闭穿透
  mainWindow.setIgnoreMouseEvents(true, { forward: true });

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
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

// 鼠标穿透控制:悬浮层默认穿透到桌面,仅可交互区域关闭穿透
function registerPointerControl(): void {
  ipcMain.handle('pointer:set-interactive', (_e, interactive: boolean) => {
    if (!mainWindow) return { ok: false };
    mainWindow.setIgnoreMouseEvents(!interactive, { forward: true });
    return { ok: true };
  });
}

// 局域网发现:订阅教师端 mDNS 广播,收集房间列表供接收端选择进入
function registerDiscovery(): void {
  ipcMain.handle('discovery:get-rooms', () => {
    return Array.from(discoveredRooms.values());
  });

  mdsd
    .subscribe((info) => {
      discoveredRooms.set(info.roomCode, info);
      console.log(`[discovery] 发现课堂: ${info.teacherName} @ ${info.host}:${info.port} (${info.roomCode})`);
      mainWindow?.webContents.send('discovery:found', info);
    })
    .catch((err) => {
      console.warn('[discovery] mDNS 订阅失败:', (err as Error)?.message ?? String(err));
    });
}

app.whenReady().then(() => {
  registerWindowControls();
  registerPointerControl();
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
