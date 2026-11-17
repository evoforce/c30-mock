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
};

contextBridge.exposeInMainWorld('api', api);
