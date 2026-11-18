---
---

修复 `pnpm lint` 在本机会无限递归成进程炸弹(内存涨到 100%)的问题:根 `lint` 脚本不再经过 turbo

- 现象:Windows 本机执行 `pnpm lint`(根脚本原为 `turbo run lint`)后,pnpm.exe / cmd.exe 进程数持续暴涨,
  几分钟堆到 1.4 万个,内存吃满;实测与托盘点击等应用行为无关,是纯粹的构建工具链递归
- 根因:`turbo run lint` 逐包调用 `pnpm run lint`,本机 Volta + corepack 的 pnpm shim 在这条链上
  退化成自我递归(`pnpm.exe run lint` → `cmd.exe /C pnpm run lint` → 下一级),进程数不受控增长;
  单个包脚本本身(`tsc --noEmit`)没有问题
- 修复:根 `package.json` 的 `lint` 由 `turbo run lint` 改为 `pnpm -r run lint`,效果等价
  (同样是各 workspace 跑 `tsc --noEmit`)但不再经过 turbo → pnpm 的调用链;实测 3 秒跑完、无子 pnpm 进程
- 新增 `scripts/kill-runaway-lint.ps1`:复发时的应急清理脚本(先杀作为传播节点的 cmd,再杀 pnpm,
  循环到清空;支持 `-DryRun` / `-TimeoutSeconds`),文档补充对应说明
