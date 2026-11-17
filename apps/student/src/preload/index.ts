import { contextBridge, ipcRenderer } from 'electron';

// 暴露给渲染层的安全窗口控制 + 局域网发现 API
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
  discovery: {
    // 获取已发现的教师端(可能为 null)
    getTeacher: () => ipcRenderer.invoke('discovery:get-teacher'),
    // 订阅发现事件
    onFound: (cb: (info: { roomCode: string; teacherName: string; host: string; port: number }) => void) => {
      const listener = (_e: unknown, info: unknown) => cb(info as { roomCode: string; teacherName: string; host: string; port: number });
      ipcRenderer.on('discovery:found', listener);
      return () => ipcRenderer.removeListener('discovery:found', listener);
    },
  },
};

contextBridge.exposeInMainWorld('api', api);
