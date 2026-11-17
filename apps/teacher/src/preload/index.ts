import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染层的安全窗口控制 API
const api = {
  platform: process.platform,
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (cb: (maximized: boolean) => void) => {
      const listener = (_e: unknown, maximized: boolean) => cb(maximized);
      ipcRenderer.on('window:maximized', listener);
      return () => ipcRenderer.removeListener('window:maximized', listener);
    },
  },
  session: {
    // 获取内嵌课堂服务器端点(host:port)
    getLocalEndpoint: () => ipcRenderer.invoke('session:local-endpoint'),
    // 广播课堂信息到局域网(mDNS)
    publish: (info: { roomCode: string; teacherName: string; host: string; port: number }) =>
      ipcRenderer.invoke('session:publish', info),
  },
  annotate: {
    // 兼容旧调用:显示/隐藏桌面批注(现在整个窗口即悬浮层,此方法仅保留兼容)
    toggle: () => ipcRenderer.invoke('annotate:toggle'),
    // 切换鼠标穿透模式
    setMode: (annotating: boolean) => ipcRenderer.invoke('pointer:set-interactive', annotating),
    close: () => ipcRenderer.invoke('annotate:close'),
  },
  pointer: {
    // 切换鼠标穿透:interactive=true 捕获鼠标(悬浮组件/画笔可交互),false 穿透桌面
    setInteractive: (interactive: boolean) => ipcRenderer.invoke('pointer:set-interactive', interactive),
  },
};

contextBridge.exposeInMainWorld('api', api);
