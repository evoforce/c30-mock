@echo off
rem 重新编译 uiohook-napi 原生模块(含 setMouseConsume 拦截能力)。
rem 关键点:
rem   1. 必须用 Node 20 编译(与 Electron 33 内嵌 Node 20.18 ABI 匹配,避免崩溃);
rem   2. Node 20 原生支持 VS2017,无需绕过 node-gyp 版本检查;
rem   3. 必须编译到「带 _patch_hash 的目录」(pnpm patch-commit 后实际运行用的目录),
rem      否则 Electron 会加载旧 prebuilds 而报 setMouseConsume is not a function。
rem 产物输出到 node_modules/.pnpm/uiohook-napi@1.5.5_patch_hash=*/node_modules/uiohook-napi/build/Release/uiohook_napi.node,
rem 并需删除该目录 prebuilds/win32-x64/ 下的旧 .node。

set "NODE20=C:\Users\25421\scoop\apps\volta\current\appdata\tools\image\node\20.20.2\node.exe"

echo [0/5] 检查 Node 20...
if not exist "%NODE20%" (
  echo [错误] 未找到 Node 20:%NODE20%
  echo        请通过 Volta 安装:volta install node@20
  exit /b 1
)
echo   找到 Node 20

echo [1/5] 定位 node-gyp(优先用 npx 缓存)...
setlocal enabledelayedexpansion
set "NODEGYP_BIN="
for /d %%d in ("%LOCALAPPDATA%\npm-cache\_npx\*") do (
  if exist "%%d\node_modules\node-gyp\bin\node-gyp.js" (
    set "NODEGYP_BIN=%%d\node_modules\node-gyp\bin\node-gyp.js"
  )
)
if not defined NODEGYP_BIN (
  echo [错误] 未找到 node-gyp,请先运行:npx node-gyp --version
  exit /b 1
)
echo   找到:%NODEGYP_BIN%

echo [2/5] 定位 uiohook-napi 目录(优先带 _patch_hash 的实际运行目录)...
set "UIOHOOK_DIR="
for /d %%d in ("%~dp0..\node_modules\.pnpm\uiohook-napi@1.5.5_patch_hash=*\node_modules\uiohook-napi") do (
  set "UIOHOOK_DIR=%%d"
)
if not defined UIOHOOK_DIR (
  for /d %%d in ("%~dp0..\node_modules\.pnpm\uiohook-napi@1.5.5\node_modules\uiohook-napi") do (
    set "UIOHOOK_DIR=%%d"
  )
)
if not defined UIOHOOK_DIR (
  echo [错误] 未找到 uiohook-napi 目录
  exit /b 1
)
echo   编译目录:%UIOHOOK_DIR%

echo [3/5] 进入 VS2017 环境并编译(用 Node 20)...
call "C:\Program Files (x86)\Microsoft Visual Studio\2017\BuildTools\VC\Auxiliary\Build\vcvars64.bat"
cd /d "%UIOHOOK_DIR%"
"%NODE20%" "%NODEGYP_BIN%" rebuild --msvs_version=2017
if errorlevel 1 (
  echo [错误] 编译失败
  exit /b 1
)

echo [4/5] 删除旧 prebuilds,让 build/Release 产物生效...
del /q "prebuilds\win32-x64\uiohook-napi.node" 2>nul

echo [5/5] 完成! setMouseConsume 已就绪。
endlocal
