# C30 Mock

仿照教培软件 **C30 教师端/学生端** 的局域网互动教学系统。

## 核心功能(当前阶段 · 首期 Demo)

首期 demo 聚焦「**2 个客户端、无后端**」：一个**发送端**(教师端,讲课时操作)、一个**接收端**(学生端,接收课堂画面)。

- **发送端(教师端)**：启动即创建课堂 → mDNS 广播 → 在桌面/白板上书写(画笔/板擦/选择)。
- **接收端(学生端)**：启动即搜索局域网内的课堂 → 选择进入 → 实时跟随接收发送端的画面状态(白板笔迹等)。
- **课堂互动**：随机点名 / 抢答 / 举手 / 投票 / 观点云 / 计时,教师端点「互动」发起,学生端实时参与并回传结果(详见 [互动设计](docs/interact-design.md))。
- **局域网直连**：发送端内嵌 socket.io 服务,接收端通过 mDNS 发现后直连,全程不依赖中心服务器。

## 技术栈

| 层 | 技术 |
|---|---|
| 客户端壳 | Electron |
| UI | React 18 + lucide-react |
| 局域网发现 | mDNS |
| 实时同步 | socket.io(发送端内嵌服务) |
| 白板核心 | C++(N-API)+ Canvas 兜底 |
| 仓库 | monorepo + pnpm workspace |
| 版本管理 | Changesets |

## 目录结构

```
apps/
  teacher/            # 发送端(教师端) Electron
  student/            # 接收端(学生端) Electron
  whiteboard-native/  # C++ 白板核心
packages/
  shared/             # 共享类型 / 协议
  ui/                 # 共享组件
  mdsd/               # mDNS 封装
docs/
  whiteboard-design.md  # 白板设计
  interact-design.md    # 课堂互动设计(协议 / 两端行为 / 验证)
  CONTRIBUTING.md       # 研发规范(提交纪律 / changeset)
  worklog/              # 每日工作记录
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 先启动发送端(教师端),创建课堂并广播
pnpm --filter teacher dev

# 再启动接收端(学生端),自动发现并接入
pnpm --filter student dev
```

> 注意:接收端需与发送端在同一局域网内才能通过 mDNS 自动发现。

## 发布与分发

版本号由 [Changesets](https://github.com/changesets/changesets) 决定:教师端/学生端在
`.changeset/config.json` 的 `fixed` 组中保持同一版本,发布时安装包**直接进 GitHub Release**
(不再只留在 Actions Artifacts 里)。

**一键发布(推荐)**:在 Actions 页运行 `Build & Release Windows Installers`(需在 `main` 触发)。
CI 会执行 `pnpm version-packages` 消费 `.changeset/*.md`(提升版本号 + 生成 CHANGELOG)→ 并行构建
四份安装包(教师端/学生端 × x64/arm64)→ 提交 `chore(release): vX.Y.Z` 并打 tag → 用该版本创建
Release;可勾选草稿先预览。

**本地发版(等价路径)**:本地 version 后提交、打 tag 再推送,CI 只做一致性校验
(tag 必须等于 `package.json` 版本,且不能有未消费的 changeset):

```bash
pnpm changeset          # 写 changeset,随代码提交
pnpm version-packages   # 消费 changeset:提升版本号 + 生成 CHANGELOG
git add -A && git commit -m "chore(release): v0.2.0"
git tag v0.2.0
git push origin main v0.2.0
```

Release 附件包含两个安装包与 `SHA256SUMS.txt`,Release 说明里的「本次变更」直接取自 CHANGELOG。
配置见 [build-windows.yml](.github/workflows/build-windows.yml)。

## 定制安装器

Windows 端不再用 electron-builder 自带的 NSIS 向导,改成 **Inno Setup 自绘界面**
(白底蓝色调、无边框圆角卡片,和应用视觉统一):

| 页面 | 内容 |
|---|---|
| 就绪页 | logo + 名称 + 版本,中间「一键安装」大按钮,右侧「自定义安装」,底部说明文案 |
| 自定义安装 | 安装位置 + 「浏览…」(调系统文件夹选择框) + 「开始安装」/「返回」 |
| 安装中 | 上方软件介绍图轮播(3.2s 自动切换),下方进度条上小火箭跟着真实进度前进 |
| 完成 | 「安装完成」+ 已安装路径 + 「完成安装」/「关闭」 |

相关文件:

- [scripts/installer/installer.iss](scripts/installer/installer.iss) —— 安装器脚本(四个界面状态)
- [scripts/installer/gen-assets.py](scripts/installer/gen-assets.py) —— 界面素材生成(背景/按钮/轮播图/小火箭)
- [scripts/build-installer.mjs](scripts/build-installer.mjs) —— 打包入口:electron-builder 出 `win-*-unpacked` 当 payload,再用 ISCC 编译安装包
- `assets/installer/` —— 生成好的 PNG/BMP 素材(已提交,CI 不需要 Python)

本地打包(需要 [Inno Setup 6](https://jrsoftware.org/isdl.php),`ISCC.exe` 在默认安装路径或 `--iscc` 指定):

```bash
pnpm --filter @c30/teacher build:win          # Windows x64
pnpm --filter @c30/teacher build:win:arm64    # Windows on Arm
```

产物在 `apps/<app>/release/`:`C30-Teacher-Setup-<version>-x64.exe` / `-arm64.exe`。

> macOS 包暂不提供。教师端有多处 `powershell.exe` 调 user32 做窗口枚举/置顶/桌面管控,
> mac 上必然失效,要先抽平台适配层才能真支持,所以先不做。

几点实现上的约束(改界面前建议先读):

- Inno 的 `TBitmapImage` 用 `PngImage` 加载**不做 alpha 混合**,半透明像素会直接按 RGB 画成不透明。
  所以除小火箭外,所有素材都是「预先合成好背景的不透明图」;火箭用 32 位 BMP + `TBitmap.AlphaFormat := afDefined` 才有透明。
- 按钮用 `TBitmapImage + Stretch` 而不是 `TBitmapButton`:后者不缩放位图,高 DPI 下会跟版面错位。
- 翻页没有公开 API,靠给 `NextButton`/`BackButton` 发 `BM_CLICK` 触发;Inno 每次翻页会重新显示它自己的按钮和分隔线(`FBevel`),必须在 `CurPageChanged` 里按名字再藏一次。
- 素材坐标(`PAD`/`BAR_Y`/`BTN_*`)在 `installer.iss` 和 `gen-assets.py` 里各有一份,改一处必须同步另一处。


## 设计文档

- [白板功能设计](docs/whiteboard-design.md)

## 研发规范

**完成一个 feat 或 fix 后立即可提交并附 changeset**,一个提交只做一件事。详见:

- [研发规范(提交纪律 / changeset / 自查清单)](docs/CONTRIBUTING.md)
- [每日工作记录](docs/worklog/)
- [技术复盘:画笔按下后光标冻结](docs/retro-mouse-freeze-2026-11-18.md)
