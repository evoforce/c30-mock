# 研发规范(C30 Mock)

> 适用范围:仓库内所有改动(代码 / 补丁 / 文档 / 配置)。
> 核心原则:**小步提交,完成即提交;一个 feat 或 fix 做完立刻 commit,并附 changeset。**

---

## 一、提交纪律(最重要)

### 1. 完成即提交,不要攒

**一个 feat(功能)或一个 fix(修复)做完,就立刻提交**。不要把多个不相关的改动攒在一起,

- 攒着提交会让 review 变成「读一个巨型 diff」,问题定位和回滚都变成灾难;
- 中间态长时间停留在工作区,一旦并行改动 / 切换任务,极易被覆盖或混入无关内容;
- 出问题时无法用「二分回退」定位是哪一步引入的。

### 2. 一个提交只做一件事

| 允许 | 不允许 |
|---|---|
| 一个功能及其配套测试、changeset、文档 | 「顺手」改另一个 bug、重构无关文件、格式化整个目录 |
| 一个 bug 的根因修复 + 防复发措施 | 把功能开发和构建配置改动塞进同一个 commit |

判断标准:**能用一句话说清这个提交做了什么,并且不需要「以及」**。

### 3. 提交前先跑自检

```bash
pnpm lint          # = pnpm -r run lint(各 workspace 跑 tsc --noEmit)
pnpm build         # electron-vite / turbo 构建
pnpm verify:uiohook   # 原生鼠标钩子产物自检(改了原生模块/补丁时必跑)
```

> **本机不要用 `turbo run lint`**(根 `lint` 脚本已改为 `pnpm -r run lint`,不再经过 turbo)。
> 在 Windows + Volta/corepack 环境下,turbo 逐包调 `pnpm run lint` 会退化成**无限递归**:
> `pnpm.exe run lint` → `cmd.exe /C pnpm run lint` → 下一级,pnpm/cmd 进程每秒涨几十个,
> 几分钟堆到上万个、内存吃满(2026-11-18 事故,见 `scripts/kill-runaway-lint.ps1` 头部说明)。
>
> ```bash
> pnpm lint                         # = pnpm -r run lint,全部工作区(推荐)
> pnpm --filter @c30/teacher lint   # 单个包
> ```
>
> 若发现任务管理器里 cmd.exe / pnpm.exe 数量暴涨、内存被吃满,立即清理:
>
> ```bash
> pwsh -NoProfile -ExecutionPolicy Bypass -File scripts/kill-runaway-lint.ps1
> ```

改了原生模块(`patches/uiohook-napi.patch`)时,还要:

```bash
pnpm install       # 重新应用补丁
pnpm rebuild:uiohook   # 重新编译产物(先退出正在运行的教师端,否则 .node 被占用会 EPERM)
```

### 4. 只提交该提交的东西

- **禁止** `git add -A` / `git add .` 盲加;按路径显式添加,提交前用 `git status` / `git diff --cached` 核对;
- 不提交 `node_modules/`、构建产物(`out/`、`release/`、`build/`)、本地日志;
- 例外:`uiohook-napi` 的原生产物按现有约定由 `postinstall` 就地重编,**不放进 git**(详见 [鼠标卡死复盘](retro-mouse-freeze-2026-11-18.md))。

---

## 二、Changeset(强制)

仓库使用 [Changesets](https://github.com/changesets/changesets) 管理版本与变更日志。
**每一个 `feat` 与 `fix` 提交都必须包含一个 changeset 文件**,否则 CI / 发布流程无法生成
正确的版本号与 changelog。

```bash
pnpm changeset        # 交互式生成 .changeset/<随机名>.md
```

生成的文件形如:

```md
---
'@c30/teacher': minor
'@c30/shared': patch
---

白板擦升级:矩形板擦 + 按住拖动自由擦除 + 高级菜单(清笔迹 / 区域擦除)

- 板擦改为矩形,预览与实际擦除区域一致,且只在按下时出现
- 按住拖动连续擦除,轨迹按细步长细分,手感连续
```

写 changeset 的要点:

1. **包与版本级别要准**:`patch` = 修 bug / 内部改动;`minor` = 新增功能;`major` = 不兼容变更。
   只列**真正受影响**的包(教师端改动不要顺手带上学生端)。
2. **正文写「用户能感知到什么」**,而不是「改了哪个文件」;分条列出要点。
3. **一个 changeset 对应一件事**;同一个提交里有多个不相关变更 → 拆提交,而不是塞进一个 changeset。
4. 纯文档 / 纯 CI / 纯脚本改动不需要 changeset(它们不进入包版本与 changelog)。

> 常见错误:提交了 `feat` 却忘了 changeset —— 发布时才发现该功能没进 changelog。
> 这也是本规范把它与「及时提交」并列的原因:**commit 与 changeset 是一对,不要拆开做。**

---

## 三、提交信息规范

采用 Conventional Commits,并用中文写清「做了什么、为什么」:

```
<type>(<scope>): <一句话说明>

<可选正文:根因 / 取舍 / 影响范围>
```

`type` 取值:

| type | 用途 |
|---|---|
| `feat` | 新功能 |
| `fix` | 缺陷修复 |
| `refactor` | 重构(行为不变) |
| `perf` | 性能优化 |
| `docs` | 文档 |
| `build` | 构建 / 依赖 / 工具链 |
| `ci` | CI 配置 |
| `test` | 测试 |
| `chore` | 杂项 |

`scope` 用包或模块名:`teacher` / `student` / `shared` / `ui` / `mdsd` / `changeset` 等。

示例:

```
fix(teacher): 修复画笔按下后光标冻结(原生钩子只吞 PRESSED)

根因:加载的 uiohook-napi 产物仍吞 DRAGGED/RELEASED,按下后移动被系统丢弃。
修复:C 层只吞 PRESSED,新增 getConsumeMode() 版本标记,主进程启动自检,
版本不符则拒绝开启吞事件(宁可不拦误框选,也不能冻结鼠标)。
```

---

## 四、文档同步

- **设计变更**:改 `docs/*-design.md`(例如板擦语义变更同步 `whiteboard-design.md`);
- **工作记录**:当天进展追加到 `docs/worklog/<YYYY-MM-DD>.md`,重点写清
  「现象 / 根因 / 修复 / 验证 / 踩坑」——事后复盘与排查全靠它;
- **重大问题**:单独写 `docs/retro-*.md` 复盘(如 [retro-mouse-freeze-2026-11-18.md](retro-mouse-freeze-2026-11-18.md)),
  并在规范 / 代码里留下可执行的防复发措施(自检脚本、启动校验、不变量注释)。

文档随对应代码提交,不要「先提交代码,文档等下次」。

---

## 五、风险改动附加要求

涉及以下内容时,提交说明里必须写清**回滚方式**与**验证证据**:

- 原生模块 / 补丁(`patches/`、`scripts/*uiohook*`):按 [复盘文档](retro-mouse-freeze-2026-11-18.md) 的清单验证;
- 主进程:鼠标穿透、窗口层级、截屏、全局钩子;
- 协议 / 共享类型(`packages/shared`):确认教师端与学生端同时升级可用。

---

## 六、自查清单(提交前逐条过)

- [ ] 这个提交只做了一件事,一句话能说清
- [ ] `pnpm lint` 通过
- [ ] 相关构建 / 自检脚本通过(`pnpm build`、`pnpm verify:uiohook`)
- [ ] `feat` / `fix` 已附带 changeset,包与版本级别正确
- [ ] 提交信息符合 `<type>(<scope>): …`
- [ ] 没有误加无关文件(`git diff --cached` 已核对)
- [ ] 文档 / 工作日志已同步
