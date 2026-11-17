import { contextBridge } from 'electron';

// 预加载脚本:暴露安全的 IPC API 给渲染层
const api = {
  platform: process.platform,
};

contextBridge.exposeInMainWorld('api', api);
