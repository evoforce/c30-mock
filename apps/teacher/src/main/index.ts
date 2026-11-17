import { app, shell, BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';
import { networkInterfaces } from 'os';
import { mdsd } from '@c30/mdsd';
import { createLocalSessionServer, type LocalSessionServer } from './localSessionServer';

let mainWindow: BrowserWindow | null = null;
let localServer: LocalSessionServer | null = null;

// 获取本机局域网 IPv4 地址
function getLanIP(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return '127.0.0.1';
}

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

  // 临时:转发 renderer 的 console 到终端,便于排查白屏
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const levels = ['LOG', 'WARN', 'ERROR', 'INFO', 'DEBUG', 'VERBOSE'];
    console.log(`[renderer:${levels[level] ?? level}] ${message} (${sourceId}:${line})`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer] process gone:', JSON.stringify(details));
  });

  // 最大化状态变化时通知渲染层,用于切换"最大化/还原"按钮图标
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

// 窗口控制 IPC
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

// 教师端内嵌课堂服务器 + mDNS 广播(局域网直连方案)
function registerLocalSessionServer(): void {
  localServer = createLocalSessionServer();
  localServer
    .start()
    .then((port) => {
      const host = getLanIP();
      console.log(`[local-session] 内嵌课堂服务器已启动: ${host}:${port}`);
      // 向 renderer 暴露端口(供连接提示)
      ipcMain.handle('session:local-endpoint', () => ({ host, port }));
    })
    .catch((err) => {
      console.warn('[local-session] 内嵌服务器启动失败(将仅依赖中心服务器):', (err as Error)?.message ?? String(err));
    });
}

// 广播当前课堂信息到局域网(在教师创建课堂后由 renderer 触发)
ipcMain.handle('session:publish', async (_e, info: { roomCode: string; teacherName: string; host: string; port: number }) => {
  try {
    await mdsd.publish(info);
    return { ok: true };
  } catch (err) {
    console.warn('[local-session] mDNS 广播失败:', (err as Error)?.message ?? String(err));
    return { ok: false };
  }
});

app.whenReady().then(() => {
  registerWindowControls();
  registerLocalSessionServer();
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

app.on('will-quit', () => {
  void localServer?.stop();
});
