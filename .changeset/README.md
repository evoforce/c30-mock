# Changesets

本仓库使用 [Changesets](https://github.com/changesets/changesets) 管理版本号与发布。

## 提交变更

修改代码后,运行:

```bash
pnpm changeset
```

选择受影响的工作区包,填写语义化版本变更类型(patch/minor/major)与变更说明。

## 生成版本

```bash
pnpm version-packages
```

该命令会消费 `.changeset/*.md` 中的变更记录,更新各包 `package.json` 的版本号并生成 CHANGELOG。

## 发布

```bash
pnpm release
```
