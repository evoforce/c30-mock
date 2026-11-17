# 白板核心 C++ addon

## 构建

```bash
# 需安装 CMake 与 C++ 工具链
pnpm --filter @c30/whiteboard-native build
```

## 说明

- `include/whiteboard/types.h` — 笔类型、笔迹、采样点数据结构
- `include/whiteboard/renderer.h` — 渲染层抽象接口
- `src/whiteboard.cc` — N-API 绑定入口(Demo 阶段仅占位)
- `src/renderer.cc` — C++ 高性能渲染器(完整版实现)

Demo 阶段由前端 Canvas 渲染兜底,本 addon 预留接口以便后续替换。
