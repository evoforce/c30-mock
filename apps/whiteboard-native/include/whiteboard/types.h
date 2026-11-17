#pragma once

#include <string>
#include <vector>

namespace wb {

// 采样点
struct Point {
  double x;
  double y;
  double t;
};

// 笔类型
enum class PenType {
  Brush,   // 毛笔
  Pen,     // 钢笔
  Pencil,  // 铅笔
};

// 笔迹
struct Stroke {
  std::string id;
  PenType tool;
  std::string color;
  double width;
  double opacity;
  std::vector<Point> points;
  int64_t seq;
};

} // namespace wb
