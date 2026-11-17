#include "whiteboard/types.h"
#include <napi.h>

namespace wb {

// 白板核心 N-API 绑定入口
// Demo 阶段仅暴露类型定义与占位 API,渲染由前端 Canvas 兜底;
// 完整版在此接入 C++ 高性能渲染。

Napi::String GetPenTypes(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::String::New(env, "brush,pen,pencil");
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("getPenTypes", Napi::Function::New(env, GetPenTypes));
  return exports;
}

NODE_API_MODULE(whiteboard_native, Init)

} // namespace wb
