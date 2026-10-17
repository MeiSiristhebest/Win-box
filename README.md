# Win-Box

Win-Box 是 Windows 桌面媒体源管理与播放工具。你可以导入多份配置、分别管理播放源，并合并导出配置。应用使用 Electron、React、TypeScript 和 Vite。

应用不附带播放源或媒体内容。启动后可在“配置”页导入或添加自己的来源。

## 免责声明（请务必阅读）

1. **软件性质**：Win-Box 是开源学习项目，提供通用影片播放工具（播放器外壳）；不含盈利行为，不提供内容服务，不存储或推送影视资源与内容。
2. **不提供内容**：本项目不内置资源索引，也不运营内容服务器。你自行配置或导入的播放源、直播源、弹幕与字幕接口、网盘凭据和内容来自第三方，与本软件及作者无关。软件内的本地代理（`127.0.0.1`）仅用于在你的设备上转发播放请求。
3. **无隶属关系**：本项目与任何影视平台、内容站点、网盘服务、TVBox / CatVod 及其发行方均无隶属、合作、代理或授权关系。相关名称与商标归各自权利人所有。
4. **使用者责任**：请确保导入的第三方来源和使用行为符合所在地法律法规，不得用于传播或观看违法、侵权内容。因第三方来源引发的一切后果（包括版权、侵权和内容合法性问题）由用户与第三方自行承担，作者免责。
5. **权利通知**：本软件不对第三方内容主张权利，也未从第三方内容中获利。权利人如认为本项目的某项行为可能侵权，可通过 [GitHub Issues](https://github.com/MeiSiristhebest/Win-box/issues) 联系维护者；维护者会核实并配合处理。
6. **无担保**：软件按“现状”提供，不附带任何明示或默示担保。作者不对使用或无法使用本软件造成的直接或间接损失负责。如不同意这些条款，请停止使用并删除本软件。
7. **二次修改与再分发**：基于 GitHub 开源 Win-Box 修改而来的软件，以及其用户产生的侵权行为，均与本项目原作者无关；原作者未参与这些修改版的开发、打包与分发，也不对其内容、功能与安全性负责。

应用内“关于 Win-Box”页提供完整说明。

## 开发

开发环境使用 Node.js 26.12.0 和 pnpm 12.14.0。

```bash
pnpm install --frozen-lockfile
pnpm run typecheck
pnpm test
pnpm run dev
pnpm run build
```

## 目录结构

- `src/`：共享代码、引擎、主进程和界面。
- `tests/`：引擎与功能测试。
- `scripts/`：构建、资源校验和打包脚本。
- `resources/`：应用资源与 JVM 宿主源码。

## 打包

运行时依赖不随源码仓库分发。`pnpm run build` 构建主进程和界面，不要求准备完整的 Java 运行时。运行 `pnpm run pack` 或 `pnpm run dist` 前，须按 `scripts/runtime-assets.json` 准备 `resources/jvm/jre/bin/java.exe`、`resources/jvm/d2j/*.jar`、`resources/jvm/stubs/stubs.jar` 和清单列出的库 JAR。

`resources/jvm/stubs/stubs.jar` 不入库，也不会由普通构建生成。重建脚本使用现有 JAR 作为基线，因此运行前必须提供该文件；Windows 上还需提供 JDK 的 `javac.exe` 和 `jar.exe`。发布前须在 `scripts/runtime-assets.json` 中填写 JRE 和 dex2jar 的版本、来源及 SHA-256。`pnpm run dist` 会在编译前检查资源；`pnpm run pack` 会在创建打包暂存目录前运行完整预检。两者都会拒绝缺失的必需文件或来源信息。嵌入式 CPython、shell-shim 和 unidbg 运行时等资源仍需按使用场景自行准备。

## 许可证与反馈

代码采用 MIT 许可证，详见 [LICENSE](LICENSE)。第三方组件按各自许可证使用。

[源代码与问题反馈](https://github.com/MeiSiristhebest/Win-box)
