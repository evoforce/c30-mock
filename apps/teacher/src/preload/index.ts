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
    // 切换鼠标穿透:interactive=true 捕获鼠标(悬浮组件可交互),false 穿透桌面
    setInteractive: (interactive: boolean) => ipcRenderer.invoke('pointer:set-interactive', interactive),
  },
  batch: {
    // 开启/关闭「桌面批注」全局鼠标钩子转发(切到画笔/板擦等工具时开启)
    setActive: (active: boolean) => ipcRenderer.send('batch:set-active', active),
    // 订阅主进程转发的全局鼠标事件(批注轨迹)
    onMouseDown: (cb: (p: { x: number; y: number; button: unknown }) => void) => {
      const listener = (_e: unknown, p: { x: number; y: number; button: unknown }) => cb(p);
      ipcRenderer.on('batch:mousedown', listener);
      return () => ipcRenderer.removeListener('batch:mousedown', listener);
    },
    onMouseMove: (cb: (p: { x: number; y: number }) => void) => {
      const listener = (_e: unknown, p: { x: number; y: number }) => cb(p);
      ipcRenderer.on('batch:mousemove', listener);
      return () => ipcRenderer.removeListener('batch:mousemove', listener);
    },
    onMouseUp: (cb: (p: { x: number; y: number; button: unknown }) => void) => {
      const listener = (_e: unknown, p: { x: number; y: number; button: unknown }) => cb(p);
      ipcRenderer.on('batch:mouseup', listener);
      return () => ipcRenderer.removeListener('batch:mouseup', listener);
    },
  },
  whiteboard: {
    // 白板全屏:true 提升层级盖住任务栏(全白),false 降回普通悬浮层级
    setFullscreen: (fullscreen: boolean) => ipcRenderer.send('whiteboard:set-fullscreen', fullscreen),
  },
  spotlight: {
    // 截取屏幕指定区域(逻辑坐标)→ 返回 PNG dataURL
    // opts.hideWindow=false 时保持窗口显示(放大镜用,避免窗口闪烁)
    capture: (rect: { x: number; y: number; w: number; h: number }, opts?: { hideWindow?: boolean }) =>
      ipcRenderer.invoke('spotlight:capture', rect, opts),
    // 保存聚焦内容到文件(弹出保存对话框)
    save: (rect: { x: number; y: number; w: number; h: number }) =>
      ipcRenderer.invoke('spotlight:save', rect),
  },
  windows: {
    // 枚举系统当前打开的窗口(标题 + 缩略图 + 窗口句柄)
    list: (): Promise<
      { id: string; hwnd: number; title: string; thumbnail: string }[]
    > => ipcRenderer.invoke('windows:list'),
    // 把指定窗口提到前台
    activate: (hwnd: number): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('windows:activate', hwnd),
    // 聚焦单窗口:最小化其他窗口,只保留目标窗口
    focus: (hwnd: number): Promise<{ ok: boolean; minimized: number }> =>
      ipcRenderer.invoke('windows:focus', hwnd),
    // 回到桌面:最小化所有窗口
    showDesktop: (): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke('windows:showDesktop'),
  },
  settings: {
    // 读取教师端本地设置(开机自启/展示教室信息/允许互动)
    get: (): Promise<{
      autoLaunch: boolean;
      showClassInfo: boolean;
      allowInteraction: boolean;
    }> => ipcRenderer.invoke('settings:get'),
    // 更新设置(局部 patch,主进程持久化并应用副作用)
    set: (
      patch: Partial<{
        autoLaunch: boolean;
        showClassInfo: boolean;
        allowInteraction: boolean;
      }>,
    ): Promise<{
      autoLaunch: boolean;
      showClassInfo: boolean;
      allowInteraction: boolean;
    }> => ipcRenderer.invoke('settings:set', patch),
  },
};

contextBridge.exposeInMainWorld('api', api);
