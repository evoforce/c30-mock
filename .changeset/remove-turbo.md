---
---

移除 turbo:多包任务改用 pnpm 原生命令(构建/开发/校验不再经过 turbo)

- **动机**:本仓库只有 7 个工作区,实测全量构建约 13 秒(teacher 9.4s / student 2.6s /
  三个 tsc 包 1.0s),turbo 的并行与拓扑排序与 `pnpm -r` 完全重合,而缓存对最贵的任务
  实际不生效——`turbo.json` 的 `outputs` 配的是 `dist/**`、`.next/**`,electron-vite 的
  产物却在 `out/`,whiteboard-native 在 `build/Release/`,能命中的只有 1 秒的 tsc 包;
  远端缓存与 CI 增量均未使用(CI 走 `pnpm --filter` 直接构建)
- **风险成本**:turbo 是原生二进制 + 常驻 daemon,且其「turbo → pnpm」调用链在本机
  Volta/corepack 环境下会退化成无限递归进程炸弹(2026-11-18 内存 100% 事故);
  缓存还会绕过 `postinstall` 重编的原生产物与 `NO_*` 等行为开关,有拿到过期产物的隐患
- **改动**:
  - 根 `package.json`:`build` → `pnpm -r --filter=!@c30/whiteboard-native run build`
    (该 C++ addon 需 `cmake`,本机未装,且当前无任何包依赖它;原来经 turbo 跑根 `build`
    必在它这里失败),新增 `build:native` 单独构建原生 addon;`build:win` → `pnpm -r run build:win`;
    `dev` → `pnpm -r --parallel run dev`;移除 `turbo` 依赖;移除空转的 `test`
    (根为 `turbo run test`,但没有任何包定义 `test` 脚本,跑起来什么都不会做)
  - 删除 `turbo.json`、`.turbo/` 缓存目录及 `.gitignore` 中对应条目
  - `README.md`、`docs/CONTRIBUTING.md` 同步更新(多包命令、事故说明保留在应急脚本头部)
- **行为等价性**:`pnpm -r` 默认按工作区拓扑序执行,`^build` 的依赖顺序等价成立;
  保留 `scripts/kill-runaway-lint.ps1` 作为复发时的应急清理
