# C30 Mock

仿照教培软件 **C30 教师端/学生端** 的局域网互动教学系统。

## 核心功能(当前阶段)

1. **登录** — Mock 账号 + JWT
2. **课件** — 上传/列表/渲染/翻页
3. **白板** — 笔(毛笔/钢笔/铅笔)、颜色、白板擦、黑板擦大小、撤回

## 技术栈

| 层 | 技术 |
|---|---|
| 客户端壳 | Electron |
| UI | React 18 + shadcn/ui + Tailwind |
| 后端 | NestJS |
| 白板核心 | C++(N-API)+ Canvas 兜底 |
| 局域网发现 | mDNS + 手动 IP 兜底 |
| 基础设施 | PostgreSQL、MinIO、Redis |
| 仓库 | monorepo + pnpm workspace + turbo |
| 部署 | docker-compose |
| 版本管理 | Changesets |

## 目录结构

```
apps/
  server/             # NestJS 后端
  teacher/            # 教师端 Electron
  student/            # 学生端 Electron
  whiteboard-native/  # C++ 白板核心
packages/
  shared/             # 共享类型 / 协议
  ui/                 # 共享 shadcn 组件
  mdsd/               # mDNS 封装
docs/
  whiteboard-design.md  # 白板设计
```

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动后端
pnpm --filter server dev

# 启动教师端 / 学生端
pnpm --filter teacher dev
pnpm --filter student dev
```

## 设计文档

- [白板功能设计](docs/whiteboard-design.md)
