# C30 Mock

仿照教培软件 **C30 教师端/学生端** 的局域网互动教学系统。

## 核心功能(当前阶段 · 首期 Demo)

首期 demo 聚焦「**2 个客户端、无后端**」：一个**发送端**(教师端,讲课时操作)、一个**接收端**(学生端,接收课堂画面)。

- **发送端(教师端)**：启动即创建课堂 → mDNS 广播 → 在桌面/白板上书写(画笔/板擦/选择)。
- **接收端(学生端)**：启动即搜索局域网内的课堂 → 选择进入 → 实时跟随接收发送端的画面状态(白板笔迹等)。
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

安装包由 GitHub Actions 构建后**直接发布到 GitHub Release**(不再只留在 Actions Artifacts 里),
用户可在仓库的 Releases 页直接下载教师端/学生端安装包。

```bash
# 打 tag 并推送 → 自动构建,并创建同名 Release 上传安装包
git tag v0.1.0
git push origin v0.1.0
```

也可在 Actions 页手动运行 `Build & Release Windows Installers`:可指定 tag(留空则自动生成
`v<版本号>-build.<运行号>`),可勾选草稿先预览;重跑同一 tag 会覆盖该 Release 的附件。
Release 附件包含两个安装包与 `SHA256SUMS.txt`,配置见
[build-windows.yml](.github/workflows/build-windows.yml)。

## 设计文档

- [白板功能设计](docs/whiteboard-design.md)

## 研发规范

**完成一个 feat 或 fix 后立即可提交并附 changeset**,一个提交只做一件事。详见:

- [研发规范(提交纪律 / changeset / 自查清单)](docs/CONTRIBUTING.md)
- [每日工作记录](docs/worklog/)
- [技术复盘:画笔按下后光标冻结](docs/retro-mouse-freeze-2026-11-18.md)
