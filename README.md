# Win-Box

把安卓 TVBox（CatVod 引擎）移植为 **Windows 桌面应用** —— Electron + React + TypeScript + Vite。

纯 Vibe coding 项目：本人 0 代码基础，包括开源与发布流程均由 AI 协助完成。

> 本项目是**个人学习 / 研究性质的开源实现**，与安卓版及任何第三方站点、平台无隶属关系。
> 仓库仅包含**核心源码**，不含任何第三方私有蜘蛛 jar、JVM 运行时、逆向壳或专有产物。

**链接**：[GitHub 主页](https://github.com/MeiSiristhebest/Win-box)



---

## ⚠️ 免责声明（请务必阅读）

1. **软件性质**：Win-Box 是开源学习项目，本质上只是一个**通用影片播放工具**（播放器外壳）；不含任何盈利行为，不提供服务、**不存储、不推送任何影视资源与内容**。
2. **不提供内容**：本项目**不内置任何资源索引、不运营任何内容服务器**。你在使用中自行配置 / 导入的播放源、直播源、弹幕与字幕接口、网盘凭据与内容，全部来自**第三方**，与本软件及作者无关；软件内的本地代理（`127.0.0.1`）仅用于你自己设备上的本机播放转发。
3. **无隶属关系**：与任何影视平台、内容站点、网盘服务、TVBox / CatVod 及其发行方**均无隶属、合作、代理或授权关系**；相关名称与商标归各自权利人所有。
4. **使用者责任**：请确保你导入的第三方源与使用行为**符合所在地法律法规**，且不得用于传播、观看任何违法或侵权内容；因使用第三方来源引发的一切后果（含版权、侵权、内容合法性）由用户与第三方自行承担，作者免责。
5. **权利通知**：本软件不对任何第三方内容主张权利，也未从第三方内容中获利。若权利人认为本项目某项行为可能侵权，请通过 [Issues](https://github.com/MeiSiristhebest/Win-box/issues) 联系，项目维护者将核实并配合处理（移除相关内容 / 停止分发）。
6. **无担保**：软件按**「现状」**提供，不附带任何明示或默示担保；作者不对使用或无法使用本软件造成的任何直接或间接损失负责。不接受上述约定请立即停止使用并删除本软件。

> 应用内「说明」页（侧栏最后一项）提供同一份声明的完整版。


## 快速开始

```bash
pnpm install --frozen-lockfile # 依赖（node_modules 不入库）
pnpm test                 # Vitest 引擎单测
pnpm run typecheck        # 双 tsc 类型检查
pnpm run dev              # 开发（vite + esbuild watch + electron）
pnpm run build            # 构建（主进程 + 渲染层）
```

开发环境使用仓库固定的 Node.js 26.12.0 和 pnpm 12.14.0。

运行时依赖不随源码仓库分发。`pnpm run build` 构建主进程和渲染层，不要求准备完整的 Java 运行时。运行 `pnpm run pack` 或 `pnpm run dist` 前，必须按 `scripts/runtime-assets.json` 准备所需资源，包括 `resources/jvm/jre/bin/java.exe`、`resources/jvm/d2j/*.jar`、`resources/jvm/stubs/stubs.jar` 和清单要求的库 JAR。

`resources/jvm/stubs/stubs.jar` 不入库，也不会由普通构建生成。重建脚本 `resources/jvm/stubs-src/build-stubs.ps1` 使用现有的 `stubs.jar` 作为基线，因此运行脚本前必须先提供该文件。Windows 上还需传入 JDK 的 `javac.exe` 与 `jar.exe` 路径。发布前必须在 `scripts/runtime-assets.json` 中填写 JRE 和 dex2jar 的版本、来源与 SHA-256。`pnpm run dist` 会在编译前检查资源；`pnpm run pack` 先完成普通构建，再在创建打包暂存目录前运行完整预检。两者都会拒绝缺失的必需文件或来源信息。嵌入式 CPython、shell-shim 和 unidbg 运行时等仍按使用场景自行准备。

## 目录结构

```
tvbox-win/
├── src/            # 四层：shared / engine / main / renderer
├── tests/          # 引擎单测（Vitest）
├── scripts/        # 构建与打包脚本
├── resources/      # js-lib + jvm 宿主源码（*.java，含 native-bridge 原生桥）
```

## 说明
Fork二改麻烦注明Github此项目，参考源码重新开发不必注明。

## 特别感谢
特别感谢Deepseek，GLM，GPT，哈哈。

## 许可

代码采用 MIT 许可证（见 [LICENSE](LICENSE)）。请遵守第三方软件（蜘蛛 jar、运行时、壳等）各自的版权与许可。
