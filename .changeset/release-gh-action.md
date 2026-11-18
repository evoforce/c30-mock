---
---

构建产物直接发布到 GitHub Release，版本由 Changesets 驱动

- **动机**：原来安装包只上传到 Actions Artifacts（zip 包、需登录、有保留期），没法直接给
  老师/学生一个下载链接；而且 tag 与 `package.json` 版本没有约束，构建出来的版本号和
  changeset 对不上
- **发布流程**（`.github/workflows/build-windows.yml`）：
  - 手动运行（推荐）：CI 先 `pnpm version-packages` 消费 `.changeset/*.md`，提交
    `chore(release): vX.Y.Z` 并打 tag，再构建双端安装包，用该版本创建 Release；
    构建失败时不会推送版本提交与 tag
  - 推 tag：只做一致性校验 —— tag 必须等于 `package.json` 版本，且不能有未消费的 changeset，
    不一致直接失败并提示先 `pnpm version-packages`
  - 安装包统一改名为 `C30-Teacher-Setup-<version>-x64.exe` /
    `C30-Student-Setup-<version>-x64.exe`，并附 `SHA256SUMS.txt`；Release 说明里的
    「本次变更」取自生成的 CHANGELOG
  - 移除 `upload-artifact`，分发只走 Release；workflow 声明 `contents: write`
- **版本线**（`.changeset/config.json`）：新增 `fixed: [["@c30/teacher", "@c30/student"]]`，
  两端永远同一版本，保证 tag 与两个安装包版本一致
- **下一个版本**：0.2.0（待发布的 changeset 已累计到 minor）
