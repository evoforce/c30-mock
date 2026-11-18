---
'@c30/teacher': minor
'@c30/student': minor
'@c30/shared': patch
---

修复聚焦「保存」后浮层整体点不动、聚焦「插入白板」图片盖住笔迹的问题，并升级浮层交互

- 聚焦保存：不再使用原生「另存为」对话框（Windows 上该原生模态窗口关闭后会让这个透明、
  `WS_EX_NOACTIVATE` 的浮层窗口丢失鼠标「按下」事件——mousemove 仍能收到，但底栏、收起、
  侧边栏全部点不动，只能重启），改为直接保存到「图片/C30聚焦/聚焦_<时间戳>.png」并在浮层内提示
- 聚焦插入白板：截图改为底图（图片层移到 canvas 之前，canvas 显式 `position: relative`），
  画笔/板擦可正常覆盖在图片上方；教师端本地插入底图（服务端只把事件转发给其他客户端），
  白板快照按 id 合并，避免刚插入的底图被快照覆盖
- 鼠标穿透：穿透状态只保留一份真源，主进程按鼠标位置主动同步 + `elementFromPoint` 判定悬停，
  不再依赖 `forward` 的 mousemove 转发
- 浮层体验：新增 `useOverlayScale` 按屏幕尺寸等比缩放、`EraserPanel` 板擦面板与
  `EraserMode`（清笔迹 / 区域擦除），教师端与学生端白板同步
