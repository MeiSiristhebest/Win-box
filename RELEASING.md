# 发布与版本约定

本文规定 Win-Box 正式版本的版本号、GitHub Release 命名、发布检查项和说明格式。

## 版本号

正式版本使用 `MAJOR.MINOR.PATCH` 格式，并遵循 [Semantic Versioning 2.0.0](https://semver.org/)：

- **MAJOR**：存在不向后兼容的变更，例如用户数据、配置格式或升级路径不再兼容。
- **MINOR**：增加向后兼容的功能。
- **PATCH**：修复缺陷或安全问题，且不破坏现有兼容性。

例行缺陷修复、性能优化和内部整理不单独发布 PATCH；先积累到下一次计划中的正式版本。只有用户明确要求紧急热修复时，才单独发布 PATCH。预发布版本使用 `-alpha.N`、`-beta.N` 或 `-rc.N` 后缀，并在 GitHub 上标记为预发布版本。

`package.json` 的 `version` 是应用版本的唯一来源。发布前先对照当前最新的正式版判断变更类型，再只增加对应的版本段。截至 2026-10-20，最新正式版为 `1.27.0`；未合并、未发布的 `1.27.1` 不算正式版本。下一次包含兼容功能的计划版本可用 `1.28.0`，不兼容版本可用 `2.0.0`。已公开使用过的版本号不重新分配给另一份安装包。

## Release 命名

- Tag 使用 `release<版本号>`，例如 `release1.27.0`。创建 Tag 与 GitHub Release 后，`scripts/upload-release.mjs` 从 `package.json` 读取对应 tag，并把安装包上传到已存在的 Release；它不会创建 Tag 或 Release，也不会修改发布说明。
- GitHub Release 标题使用 `Win-Box <版本号>`，例如 `Win-Box 1.27.0`。
- Windows 安装包统一命名为 `Win-Box.Setup.<版本号>.exe`，与更新器识别规则一致。
- Release 正文使用中文。更新项按用户能感知的新增、改进和修复分组；删除空分组，避免空标题。
- 正文中的安装包名必须逐字复制 GitHub Release 附件列表中显示的名称。本地构建文件名可能与上传后显示的名称不同。
- 正文必须记录附件大小、SHA-256、源提交，以及未打包的可选运行时组件。SHA-256 应从最终上传的安装包计算。

## 发布检查

1. 确认本次属于计划中的正式发布；日常修复不单独发布 PATCH。再按 SemVer 在 `package.json` 中设置新版本号。
2. 运行项目规定的类型检查、测试和发布资源预检；构建 Windows 安装包。
3. 核对安装包内的应用版本、文件名和大小；计算最终安装包的 SHA-256。
4. 推送 `release<版本号>` Tag，并创建或更新对应的 GitHub Release；确认标题、正文、tag 和源提交一致。稳定版标记为 Latest；预发布版标记为 Pre-release。随后运行 `pnpm run release:upload` 上传安装包；该命令要求 Release 已存在。
5. 发布后再次核对 GitHub 页面上的附件名、大小、SHA-256、tag 指向的提交和 Latest 状态。

## Release 正文模板

复制模板后，填写实际内容并删除不适用或空白的分组。附件名、大小和 SHA-256 应以最终上传的安装包为准。

```markdown
Win-Box X.Y.Z Windows x64 安装包。

## 更新内容

### 新增
- <用户可见的新功能>

### 改进
- <用户可见的改进>

### 修复
- <用户可见的问题修复>

## 安装包

- 文件：`<GitHub Release 附件显示的准确文件名>`
- 大小：<字节数> bytes
- SHA-256：`<64 位十六进制摘要>`
- 源提交：`<完整 Git commit SHA>`
- 可选组件：<说明是否包含 MPV、FFmpeg 等可选组件>
```
