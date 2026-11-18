import { app, shell, BrowserWindow, ipcMain, screen } from 'electron';
import { join } from 'path';
import { mdsd, type DiscoveryInfo } from '@c30/mdsd';

let mainWindow: BrowserWindow | null = null;

// 开发态(electron-vite dev)使用独立 userData:避免与已安装版抢同一个单例锁。
// 必须放在 app.requestSingleInstanceLock() 之前(单例锁按 userData 目录区分)。
if (process.env['ELECTRON_RENDERER_URL']) {
  app.setPath('userData', `${app.getPath('userData')}-dev`);
}

// 局域网发现的教师端房间列表(去重,供渲染层展示供选择)
const discoveredRooms = new Map<string, DiscoveryInfo>();

function createWindow(): void {
  // 学生端 = 普通可调窗口(会议软件形态),不再是全屏透明浮层。
  // 主画面在窗口内跟随老师共享的屏幕/白板,窗口可缩放/最大化/最小化。
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1280, Math.max(960, area.width - 80));
  const height = Math.min(800, Math.max(600, area.height - 80));

  mainWindow = new BrowserWindow({
    width,
    height,
    minWidth: 960,
    minHeight: 600,
    show: false,
    frame: true,
    transparent: false,
    backgroundColor: '#0f1115',
    resizable: true,
    maximizable: true,
    minimizable: true,
    fullscreenable: true,
    autoHideMenuBar: true,
    title: 'C30学生端',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 共享屏幕/互动动画在窗口失焦时不被节流
      backgroundThrottling: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
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

// 局域网发现:订阅教师端 mDNS 广播,收集房间列表供接收端选择进入
function registerDiscovery(): void {
  ipcMain.handle('discovery:get-rooms', () => {
    return Array.from(discoveredRooms.values());
  });

  mdsd
    .subscribe(
      (info) => {
        discoveredRooms.set(info.roomCode, info);
        // 不发 console 日志:mDNS 会周期性重播,每条都打会刷屏(房间列表已通过 IPC 推给渲染层)
        mainWindow?.webContents.send('discovery:found', info);
      },
      (roomCode) => {
        // 教师端停播/记录过期:从列表移除,否则学生端会一直挂着已关闭课堂的卡片
        if (!discoveredRooms.delete(roomCode)) return;
        mainWindow?.webContents.send('discovery:lost', roomCode);
      },
    )
    .catch((err) => {
      console.warn('[discovery] mDNS subscribe failed:', (err as Error)?.message ?? String(err));
    });
}

// 单例锁:整机只允许一个学生端实例。
// 第二次启动直接退出,已有实例收到 second-instance 后把窗口恢复并聚焦。
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    registerWindowControls();
    registerDiscovery();
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
