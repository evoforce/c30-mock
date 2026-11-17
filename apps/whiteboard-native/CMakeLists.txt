cmake_minimum_required(VERSION 3.20)
project(whiteboard_native LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# N-API 头文件由 node-addon-api 提供
# 构建时通过 CMAKE_PREFIX_PATH 指向 node_modules
find_package(node-addon-api CONFIG REQUIRED)

add_library(whiteboard_native SHARED
  src/whiteboard.cc
  src/renderer.cc
)

target_include_directories(whiteboard_native PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
)

target_link_libraries(whiteboard_native PRIVATE
  node-addon-api
)

# 输出到 addon 目录供 Node/Electron 加载
set_target_properties(whiteboard_native PROPERTIES
  PREFIX ""
  OUTPUT_NAME "whiteboard_native"
)
