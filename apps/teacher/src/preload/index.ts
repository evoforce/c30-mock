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
    // 显示/隐藏桌面批注窗口
    toggle: () => ipcRenderer.invoke('annotate:toggle'),
    // 切换鼠标穿透模式(annotating=true 捕获鼠标可画, false 穿透到桌面)
    setMode: (annotating: boolean) => ipcRenderer.invoke('annotate:set-mode', annotating),
    // 关闭桌面批注窗口
    close: () => ipcRenderer.invoke('annotate:close'),
  },
};

contextBridge.exposeInMainWorld('api', api);
