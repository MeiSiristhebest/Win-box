# 宿主速览（Win-Box 是什么 / 插件挂在哪）

> 冷启动先读这一页，补齐"项目背景常识"。字段与契约以规范为准（公开仓 `SPEC.md` / 主仓 `docs/design/插件制作规范.md`）。

## Win-Box 是什么
- 基于 **Electron** 的 Windows 桌面影视播放器，可导入第三方源 / 直播源。
- 播放有**双内核**：**HTML5（hls.js / 原生 `<video>`）** 与 **MPV（内置 mpv）**。

## 对插件最重要的几条
- ★ **`mpv.shaders`（MPV 着色器）只在 MPV 内核生效**；HTML5 内核**跑不了 GLSL**。
- 当前里程碑 **M1 只支持一种 contribute：`mpv.shaders`**；其余（`theme` / 各类 provider / `ui.slot` / `player.engine` …）规划在 M2。
- 插件产物 = **`.winbox`**（就是 zip）；官方首个插件是**超分辨率**（Anime4K / RAVU-Lite / FSRCNNX 着色器）。

## 插件在软件里出现在哪
- 管理界面：**配置 → 插件/组件**（安装 / 启用停用 / 移除 / 更新提示）。
- `mpv.shaders` 的档位出现在 **MPV 内核**相关处（如播放器/配置中）。

## 需要更多细节时（**定向**，别通读）
- 宿主开源主仓：https://github.com/yagami-hue/Win-box
- M1 落地后，白名单的**机器可读事实源**是 `src/shared/plugin.ts` —— 只在核对白名单实现时才看它。
- L4 会用到的宿主 API（`winbox.*`）契约见规范 §6。

## 不要做
- 不要通读整个仓库（大部分与插件无关，且内部路径会漂移）。
- 不要把应用内部实现细节写进插件。
