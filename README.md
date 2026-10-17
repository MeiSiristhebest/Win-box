# Win-Box

Win-Box 是 Windows 桌面媒体源管理与播放工具。你可以导入多份配置、分别管理播放源，并合并导出配置。应用使用 Electron、React、TypeScript 和 Vite。

应用不附带播放源或媒体内容。启动后可在“配置”页导入或添加自己的来源。

## 开发

开发环境使用 Node.js 26.12.0 和 pnpm 12.14.0。

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run dev
pnpm run build
```

## 打包

`pnpm run build` 构建主进程和界面。打包前按 `scripts/runtime-assets.json` 准备 JRE、dex2jar 和所需的库 JAR。

`resources/jvm/stubs/stubs.jar` 不在仓库中，也不会由普通构建生成。重建脚本使用现有 JAR 作为基线；运行前需提供该文件。发布时还需在 `scripts/runtime-assets.json` 中填写 JRE 和 dex2jar 的版本、来源及 SHA-256。`pnpm run pack` 和 `pnpm run dist` 会检查这些资源。

## 许可证与反馈

代码采用 MIT 许可证，详见 [LICENSE](LICENSE)。第三方组件按各自许可证使用。

[源代码与问题反馈](https://github.com/MeiSiristhebest/Win-box)
