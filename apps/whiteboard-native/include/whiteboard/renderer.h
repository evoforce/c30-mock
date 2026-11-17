#pragma once

#include "whiteboard/types.h"
#include <string>
#include <vector>

namespace wb {

// 渲染层抽象接口(与前端 Renderer 对应,后续由 C++ 实现高性能渲染)
class Renderer {
public:
  virtual ~Renderer() = default;

  // 全量渲染
  virtual void render(const std::vector<Stroke>& strokes) = 0;
  // 增量渲染(仅新笔画)
  virtual void renderIncremental(const Stroke& stroke) = 0;
  // 删除整笔
  virtual void remove(const std::vector<std::string>& strokeIds) = 0;
  // 清空
  virtual void clear() = 0;
};

} // namespace wb
