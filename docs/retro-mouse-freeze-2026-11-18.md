# 技术复盘:画笔/板擦「一按下鼠标就不能移动」(第三次复发)

> 日期:2026-11-18
> 影响:教师端一按左键(画笔/板擦批注)光标即冻结、整个桌面无响应,只能 Ctrl+Alt+Del。
> 状态:已根治(C 层语义修正 + 启动自检 + 补丁/产物一致性固化 + 一键重编)。

---

## 一、现象(用户原话)

> 「画笔和板擦点下去的那一刻,又不能移动了,这是第三次出现这种问题了。」

拆开看:
- **能移动**:不按鼠标时,光标正常移动;
- **一按下就不能移动**:按下左键(开始书写/擦除)后,光标被冻结,直到松开(或系统级卡死);
- 与「画笔」还是「板擦」无关 —— 因为是同一条「批注按下」链路。

---

## 二、直接原因(一句话)

**当前加载的原生模块 `uiohook-napi` 是「吞掉 DRAGGED/RELEASED」的旧版本产物。**

`setMouseConsume(true)` 会把低层鼠标钩子里的 `event->reserved` 置 `0x01`,
libuiohook 看到 `reserved == 0x01` 就跳过 `CallNextHookEx` —— **该鼠标消息不再被系统投递**。
旧实现吞的是 `PRESSED + RELEASED + DRAGGED` 三种:

| 事件 | 旧实现(错误) | 后果 |
|---|---|---|
| `EVENT_MOUSE_PRESSED` | 吞 | 桌面收不到「按下」→ 不会误框选(这是**想要**的效果) |
| `EVENT_MOUSE_DRAGGED` | **吞** | 「按下后的移动」被系统丢弃 → **光标冻结**(本次现象) |
| `EVENT_MOUSE_RELEASED` | **吞** | 桌面永远收不到抬起 → 按钮状态残留、更难恢复 |

正确实现只吞 `PRESSED`:桌面因为「没收到按下」不会进入框选/拖动状态,
而 `MOVED / DRAGGED / RELEASED` 正常放行 → 光标能动、笔迹正常画。

---

## 三、为什么旧产物会被加载(真正的复发机制)

这是**第三次**,所以重点不是「又写错一行 C」,而是**为什么同一个错误能反复回归**:

1. **能力来自两级手工产物,只有一级在 git 里**
   - `patches/uiohook-napi.patch` —— 源码补丁,跟 git 走;
   - `build/Release/uiohook_napi.node` —— 手工用 Node20 + VS2017 编译,**不在 git 里**。
2. **两级产物会各自漂移**
   - 本次实测到的物证:
     - `src/lib/addon.c`(node_modules 里)**修改时间 10:20:48**,内容是**旧的**三连吞;
     - `patches/uiohook-napi.patch`(仓库里)**修改时间 11:09:03**,内容是**新的**只吞 PRESSED;
     - `build/Release/uiohook_napi.node` 编译于 **10:23:57** → 正是用 10:20 的旧源码编出来的。
   - 也就是说:**代码已经修好了,但机器上跑的还是修好之前编出来的二进制。**
3. **lockfile 的补丁哈希也停在旧值**
   - `pnpm-lock.yaml` 里 `hash: vljo5j4y...`,对应的是**旧补丁内容**;
   - 意味着 `pnpm install` 会从旧补丁重建 → 任何人重装依赖,旧行为就"合法"地回来了。
4. **没有任何启动期校验**
   - 之前所有修复都只改了「源码应该怎样」,但**应用从不检查自己到底加载到了哪一版能力**;
   - 于是错误只会在课堂上被用户用鼠标"试"出来 —— 这就是它总能存活到第三次的原因。

> 一句话总结复发机制:**源码修好了,产物没跟上,而且没人校验产物。**

---

## 四、本次排查过程(可复用的分层定位法)

1. **看行为分层**:不按能动、按下不能动 → 第一时间怀疑「吞事件」,而不是渲染层卡死。
2. **看诊断日志**(`%APPDATA%\@c30\teacher\pointer-diag.log`):
   - 看到 `set-interactive=true`(悬停悬浮栏)→ `consume=false`,
     离开悬浮栏 → `consume=true` —— 状态机本身是对的,**不是状态错乱**;
   - 说明问题在「consume=true 之后 C 层到底吞了什么」。
3. **查实际加载的二进制,而不是查源码**:
   - `node-gyp-build` 的加载优先级是 `build/Release` → `build/Debug` → `prebuilds/...`;
   - `build/Release/uiohook_napi.node` 存在且 154,624 字节(10:23:57)→ **它才是真正被加载的东西**;
   - 打开它的源码 `src/lib/addon.c`:果然还是三连吞。
4. **对齐三条时间线**(源码 / 补丁 / 二进制)→ 立刻看清「产物落后于源码」。
5. **验证修复**:用 Node20 加载模块读 `getConsumeMode()` → `2`;应用启动日志出现 `consume-mode=2`。

---

## 五、本次落地的修复(5 项)

### 1. C 层语义修正(根因)

`src/lib/addon.c` 的 `dispatch_proc` 只吞 `EVENT_MOUSE_PRESSED`,并新增版本标记:

```c
#define UIOHOOK_CONSUME_MODE_VERSION 2   // 2 = 只吞 PRESSED

if (g_consume_mouse) {
  switch (event->type) {
    case EVENT_MOUSE_PRESSED: event->reserved = 0x01; break;
    default: break;                  // MOVED / DRAGGED / RELEASED 一律放行
  }
}
```

### 2. 新增 `getConsumeMode()` 自检能力(C 层 + dist 包装)

- C:导出 `getConsumeMode()` 返回 `2`;
- `dist/index.js` / `dist/index.d.ts`:透传 `getConsumeMode()`。

### 3. 主进程「安全阀」:旧产物永不开启吞事件

`apps/teacher/src/main/index.ts`:

```ts
const CONSUME_MODE_PRESSED_ONLY = 2;

function applyConsume(on: boolean): void {
  if (process.env.NO_CONSUME === '1') on = false;
  if (on && !consumeModeSupported()) on = false;   // ← 安全阀
  ...
}
```

`consumeModeSupported()` 读取 `uIOhook.getConsumeMode()`,不等于 `2`(或函数缺失)时:
- 打印明确错误(`修复:pnpm rebuild:uiohook`);
- **拒绝开启** `setMouseConsume(true)`。

> 设计取舍:**宁可放弃「防止桌面误框选」,也绝不冻结老师的鼠标。**
> 误框选只是体验瑕疵,光标冻结是课堂事故。

### 4. 补丁与产物一致性固化

- 重新生成 `patches/uiohook-napi.patch`(用 `pnpm patch` / `patch-commit` 正规流程,
  包含「只吞 PRESSED + `getConsumeMode`」全部改动);
- `pnpm-lock.yaml` 的补丁哈希更新为 `qo77bl7s3qypagth3afurk63bm`,
  与补丁内容一致 → **`pnpm install` 不会再复原旧行为**;
- 清掉残留的旧 `_patch_hash=vljo5j4y...` 目录,避免再次误加载。

### 5. 把「记得重编」变成机器强制

| 新增 | 作用 |
|---|---|
| `scripts/verify-uiohook.mjs` | 校验原生产物存在 + `consume-mode === 2`;接在 `predev` / `prebuild`,每次启动/打包先自检 |
| `scripts/rebuild-uiohook.mjs` | 一键重编:定位 `_patch_hash` 目录 → Node20 编译 → 删官方 prebuilds → 自动跑自检(`pnpm rebuild:uiohook`) |
| 根 `postinstall` | `pnpm install` 自动跑 `rebuild-uiohook.mjs --if-needed`:产物比源码旧就重编,否则秒过并自检;缺工具链/产物被占用时**只告警不阻断安装** |
| ~~`scripts/rebuild-uiohook.bat`~~ | 已删除(与 `.mjs` 重复,且硬编码路径、依赖 cmd.exe) |

---

## 六、踩坑补充(这次顺手发现的另一个坑)

**UTF-8 中文注释可让 MSVC 静默吞掉下一行代码。**

- 现象:编译报 `error C2059: 语法错误:"if"`、`UIOHOOK_CONSUME_MODE_VERSION 未声明`,
  而源码看起来完全正常;
- 原因:MSVC 在无 `/utf-8` 时按 GBK 解码 UTF-8 注释;若某行注释**最后一个汉字**的
  GBK 尾字节是 `0x5C`(`\`),该字节被当作**续行符**,于是下一行(比如 `#define` 或 `if`)被并入注释;
- 对策:**C 源码文件保持纯 ASCII 注释**(本次已把 addon.c 全文件改为 ASCII,并在文件头注明),
  或编译参数加 `/utf-8`。检查手段:
  ```powershell
  $b=[IO.File]::ReadAllBytes('src\lib\addon.c'); ($b | Where-Object {$_ -gt 127}).Count  # 必须为 0
  ```

另一个操作坑:**教师端在运行时 `build/Release/*.node` 被占用**,`node-gyp rebuild` 会报
`EPERM: unlink ...`。重编前必须先退出教师端(脚本里已给出提示)。

---

## 七、不变量与检查清单(防复发)

### 必须始终成立的不变量

1. **C 层只吞 `PRESSED`**,永不吞 `MOVED / DRAGGED / RELEASED`。
2. **`getConsumeMode() === 2`**,否则 JS 层禁止开启 consume。
3. **补丁内容与 lockfile 哈希一致**:改了 `patches/*.patch` 必须走
   `pnpm patch` → 改 → `pnpm patch-commit`(会同时更新 lockfile),不要手改补丁文件。
4. **改了 C 源码必须重编**:正常情况下 `pnpm install` 的 `postinstall` 会自动重编
   (产物比源码旧才编);也可手动 `pnpm rebuild:uiohook`,并确认产物时间戳更新。
5. **C 源码保持 ASCII**。

### 遇到同类问题的 5 分钟定位流程

1. `cat %APPDATA%\@c30\teacher\pointer-diag.log | tail -20`
   - 看 `consume=true/false` 是否随「悬停悬浮栏 / 空白区」正确切换;
   - 找 `consume-mode=` 是否为 `2`;
2. 看**实际加载的二进制**:`node_modules/.pnpm/uiohook-napi@*/node_modules/uiohook-napi/build/Release/*.node` 的时间戳;
3. 对比三条时间线:`.node` 编译时间 / `src/lib/addon.c` 修改时间 / `patches/*.patch` 修改时间;
4. 若 `.node` 比源码旧 → 直接 `pnpm rebuild:uiohook`;
5. 若 `src/lib/addon.c` 里出现 `EVENT_MOUSE_DRAGGED` 被 `reserved = 0x01` → 补丁或产物错了,
   对照第五节第 1 条修正。

---

## 八、教训

1. **「代码修好了」不等于「机器上跑的是修好的代码」**。
   凡是「补丁源码 + 手工编译产物」的能力,必须有**产物级自检**,否则每次重装/回滚都会复发。
2. **危险开关要有安全阀**。
   `setMouseConsume(true)` 这种能把用户鼠标冻住的调用,不能在"期望环境正确"的前提下直接调用,
   而要先验证能力版本,失败就降级。
3. **复发三次说明缺失的不是修复,而是约束**。
   第一次修 C 语义、第二次修状态机、第三次才发现根因在"产物漂移"——
   如果一开始就把「产物一致性校验」做进启动链路,后面两次都不会发生。
4. **诊断日志要记录"能力版本"而不只是"状态切换"**。
   本次加 `consume-mode=2` 一行,以后一眼就能排除"旧产物"。
5. **排查要落到产物与时间戳**:同样的源码,不同的编译产物,行为可以完全相反。
