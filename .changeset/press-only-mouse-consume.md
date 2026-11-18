---
'@c30/teacher': patch
---

修复画笔/板擦一按下鼠标光标就冻结的问题(原生鼠标钩子只吞 PRESSED),并给原生产物加启动自检

- `uiohook-napi` 补丁的 `dispatch_proc` 改为**只吞 `EVENT_MOUSE_PRESSED`**,放行
  `MOVED / DRAGGED / RELEASED`:桌面收不到「按下」就不会误框选,而「按下后的移动」不再被系统丢弃,
  光标可以正常移动、笔迹正常绘制(此前吞掉 DRAGGED 会冻结光标,只能 Ctrl+Alt+Del)
- 原生模块新增 `getConsumeMode()`(返回值 `2` = 只吞 PRESSED);主进程
  `applyConsume()` 启动时自检,版本不符或函数缺失时**拒绝开启**吞事件并打印修复提示,
  宁可放弃「防误框选」也绝不冻结老师的鼠标
- 重新生成 `patches/uiohook-napi.patch` 并同步 `pnpm-lock.yaml` 的补丁哈希
  (`vljo5j4y…` → `qo77bl7s…`),避免重装依赖时又装回旧行为
- 新增 `scripts/verify-uiohook.mjs`(接在 `predev` / `prebuild`)与
  `scripts/rebuild-uiohook.mjs`(`pnpm rebuild:uiohook`),并在根 `postinstall`
  自动按需重编 + 自检,把「记得重编原生模块」变成机器强制
