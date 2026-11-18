---
---

构建产物直接发布到 GitHub Release(不再只留在 Actions Artifacts)

- **动机**:原来安装包只上传到 Actions Artifacts(zip 包、需登录、有保留期),没法直接给
  老师/学生一个下载链接,分发成本高
- **改动**(`.github/workflows/build-windows.yml`):
  - 推 `v*` tag 时,构建完成后创建同名 Release 并上传教师端/学生端安装包;
    同名 Release 已存在则覆盖上传,重跑幂等
  - 安装包统一改名为 `C30-Teacher-Setup-<version>-x64.exe` /
    `C30-Student-Setup-<version>-x64.exe`(electron-builder 默认中文名+空格),
    并附 `SHA256SUMS.txt` 便于下载后校验
  - 手动触发(workflow_dispatch)可指定 tag,留空自动生成 `v<版本号>-build.<运行号>`;
    可勾选草稿先预览;`-alpha/-beta/-rc` 等 tag 自动标 Pre-release
  - 移除 `upload-artifact`,分发只走 Release
- **权限**:workflow 声明 `contents: write`,用于创建 Release 与上传附件
