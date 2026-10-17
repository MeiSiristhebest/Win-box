---
name: winbox-plugin
description: Author, validate, and package Win-Box .winbox plugins. Use when the user asks to build a Win-Box plugin (插件), or about plugin.json, contributes, permissions, mpv.shaders. Do not use for TVBox source rules.
---

# Win-Box 插件开发

为 Win-Box 制作 / 校验 / 打包 `.winbox` 插件。

## 冷启动（先读这两页）
1. `references/host-overview.md` —— **宿主速览**（Win-Box 是什么 / 双内核与 GLSL 只作用 MPV / M1 白名单 / 插件在 UI 何处出现）。**冷启动必读**，补齐项目背景常识。
2. `docs/design/插件制作规范.md` —— **规范**：字段 / 白名单 / 校验的唯一权威（设计背景见 `docs/design/插件系统_设计方案.md`，该文件只在本机工作区、未开源）。

> 你的产出**不得与规范冲突**；若发现冲突，**以规范为准**，并提醒用户更新规范。
> 需要核对白名单 / 宿主实现时才**定向**看主仓（`github.com/yagami-hue/Win-box`；M1 后看 `src/shared/plugin.ts`）——**不要通读整个仓库**。

## 铁律
1. **`permissions` 只属 L4**（`kind:"code"`）；L1/L2/L3（`kind:"asset"`）**必须** `permissions: []`。
2. 第三方代码**绝不进主进程**：L4 只在宿主**沙箱 worker** 里跑。
3. UI 不做任意 React 组件注入（受限词汇表 / `iframe`）。
4. **不触碰引擎解析行为**（`code.spider` 等贡献一律禁用）。
5. `runtimeDeps` **只能引用宿主内置许可清单的 dep id**，**不得自报 url/sha256**。

## 工作流
1. **定位级别** → 决定 `kind`：
   - 只是"给宿主一批文件 / 占个槽位" → `asset`（L1/L2/L3），`permissions` 留空；
   - 要"自己跑逻辑"（出网 / 存数据 / 控制播放）→ `code`（L4），且**必须**有 `main` + `permissions`。
2. **写 `plugin.json`**：骨架见 `assets/plugin.asset.json` / `assets/plugin.code.json`；字段与约束见 `references/manifest-reference.md`。
3. **放资源**：资源进 `files/`；要 mpv 档位 → `contributes:[{type:"mpv.shaders", modes:[…]}]`（**顺序即生效顺序**）。
   - `modes[].shaders` 里的名字必须与 `files/` 里**实际文件同名**（`.glsl` / `.hook` 都行，mpv 不看扩展名）；**别照抄占位名**。
   - 着色器资源多为**第三方上游项目**：随包了第三方资源就要在 `licenses/` 归档其许可原文（copyleft 必做，见规范 §3）。
   - 要**皮肤** → `contributes:[{type:"theme", id, label, base, tokens, layout}]`：
     皮肤 = **令牌字典 + 布局声明**，**绝对不写任何 CSS / 选择器 / `.css` 文件**（v1 硬约束）。
     词表（39 项）/ 布局枚举 / `base` 口径 / 自检清单 / **可安装的发布产物示例** → `references/theme-reference.md`；
     骨架 → `assets/plugin.theme.json`；示例 `.winbox` → `assets/theme-sakura.winbox`。
4. **打包**：zip → 改名 `<id>.winbox`（`plugin.json` 必须在**根级**，不得多套目录层）。
5. **自检**：逐条走 `references/checks.md`；对照规范 §10 的拒装原因码。

## 速查
| 级别 | kind | contributes | permissions | 例子 |
|---|---|---|---|---|
| L1 声明式资源 | `asset` | 必填 | 空 | `mpv.shaders`、`theme` |
| L2 声明式数据源 | `asset` | 必填 | 空 | 弹幕 / 字幕 / 元数据源 |
| L3 UI 槽位 | `asset` | 必填 | 空 | `ui.slot`、`ui.command` |
| L4 沙箱代码 | `code` | 可组合 | 必填（白名单） | 需出网 / 存数据 / 控制播放 |

## 参考
- 宿主速览（冷启动必读）：`references/host-overview.md`
- 字段与白名单速查：`references/manifest-reference.md`
- **皮肤（theme）参考**：`references/theme-reference.md`（令牌词表 + 布局枚举 + 自检 + **发布产物示例与自测三步**）
- 发布前校验清单：`references/checks.md`
- 骨架与示例产物：`assets/`（`plugin.asset.json` / `plugin.code.json` / `plugin.theme.json` / `example-super-resolution.plugin.json` / **`theme-sakura.winbox`（可直接装的示例皮肤包）**）
