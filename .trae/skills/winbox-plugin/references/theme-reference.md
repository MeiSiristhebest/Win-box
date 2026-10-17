# 皮肤（`contributes[].type = "theme"`）参考

> **唯一权威**：`docs/design/皮肤与主题规范.md`（本项目根目录）。
> 本页是给**插件作者**的操作口径；与规范冲突时**以规范为准**。

## 1. 一句话

皮肤 = **一份令牌字典 + 一份布局声明**。插件**不写任何 CSS / 选择器 / 样式表**（v1 硬约束）：
换肤效果全部由宿主渲染层用令牌驱动，声明式布局则复用宿主既有的外壳与排版。

```jsonc
{ "type": "theme",
  "id": "sakura",                 // [a-z0-9-]{3,40}；生效值 = data-theme='plugin:sakura'
  "label": "🌸 樱花",              // 设置页显示名（建议带一个 emoji，与内置皮肤一致）
  "base": "dark",                 // dark | light：决定「未覆盖令牌」回落到哪一份基线
  "tokens": { "--accent": "#e879a6", "--surface-0": "#120d12" },
  "layout": { "shell": "topbar", "detailStyle": "cinema" } }
```
骨架（含全部 39 个令牌的合法示例）：`assets/plugin.theme.json`。

**生效链路**：安装 → 设置页「外观主题」出现该皮肤（名字取自 `label`）→ 选中**即时生效** →
停用/卸载 → 自动回落默认皮肤（用户选择不会被写坏）。

## 2. 令牌词表 v1（**39 项，只有这些名字合法**）

自造名字（`--nf-*` / `--b-*` / `--ap-*` / `--db-*` / 自定义前缀）一律**拒装**。

| 分组 | 令牌 | 取值要求 |
|---|---|---|
| 表面 | `--surface-0` `--surface-1` `--surface-2` `--surface-3` | 颜色 |
| 玻璃 | `--surface-glass` | 颜色，**必须含 alpha（<1）** |
| 品牌 | `--accent` `--accent-strong` `--accent-container` `--on-accent` `--accent-2` | 颜色 |
| 品牌淡底 | `--accent-soft` | 颜色，**必须含 alpha** |
| 文本 | `--text` `--text-dim` `--text-faint` | 颜色 |
| 分隔 | `--border` | 颜色 |
| 弱分隔 | `--border-soft` `--hairline` | 颜色，**必须含 alpha** |
| 语义 | `--danger` `--warn` `--success` `--info` | 颜色 |
| 圆角 | `--radius`（0–24px） `--radius-sm`（0–16px） `--radius-lg`（0–32px） | 长度，**必须带 `px`**（仅 `0` 可省） |
| 光影 | `--shadow` `--shadow-lg` | `[inset] 2~4 个长度 + 可选颜色`，逗号分层 |
| 动效 | `--ease-standard` `--ease-enter` `--ease-exit` `--ease-spring` | 仅 `cubic-bezier(a, b, c, d)` |
| 时长 | `--dur-instant`（40–200ms） `--dur-quick`（40–300ms） `--dur-state`（80–400ms） `--dur-panel`（120–600ms） `--dur-page`（120–800ms） | **必须带 `ms`/`s`**（写 `200ms`，别写 `.2s`） |
| 字级 | `--fs-xs` `--fs-sm` `--fs-md` `--fs-lg` `--fs-xl` `--fs-2xl`（均 9–34px） | 长度，带 `px` |

其它硬规则：
- 值里**不得出现** `;` `{` `}` `<` `url(` `expression(` `@import` `/*`（注入护栏）。
- 值可以是 `var(--词表内的令牌)`（引用别名，如 `--accent-strong": "var(--accent)"`）——词表外的引用同样拒。
- 颜色支持 `#rgb` / `#rrggbb` / `#rrggbbaa` / `rgb()` / `rgba()` / `hsl()` / `hsla()`。

## 3. `layout` 声明（决定「长什么样」，取代写 CSS）

| 字段 | 取值 | 效果 |
|---|---|---|
| `shell` | `topbar` / `dualbar` / `sidebar` / `pillbar` | 外壳：单行顶栏 / 双行头 / 玻璃侧边栏 / 胶囊导航+浮动圆钮（缺省 `topbar`） |
| `detailStyle` | `cinema` / `glass` / `poster` | 详情页排版：影院大图 / 玻璃信息卡 / 左海报右信息（缺省 = 基础排版） |
| `discoverStyle` | `shelf` / `shelfWide` / `wall` | 发现页：内容行 / 宽卡内容行 / 海报墙（缺省 = 基础行） |
| `filterStyle` | `plain` / `card` | 筛选条：朴素 / 卡片容器（缺省 `plain`） |
| `nav` | `side` / `top` | 导航形态 |
| `density` | `compact` / `comfy` | 行高与内边距整体缩放 |
| `motion` | `full` / `reduced` | 动效强度（与系统「减少动效」取更弱者） |
| `navHeight` | 40–72（px） | 顶栏高 |
| `sideWidth` | 160–280（px） | 侧栏宽 |
| `cardWidth` | 120–260（px） | 卡片宽 |

**重要**：结构样式由**宿主**提供（`global.css` 的宿主结构层）。你只能声明**已有枚举**，
插件皮肤无法越过宿主既有枚举 —— 这是「v1 不许任意 CSS」的配套约束。
省略字段 = 缺省值；只给 `tokens` 不写 `layout` 也完全合法（= 单行顶栏 + 基础排版 + 只换配色）。

## 4. `base` 怎么选

- `base` 决定**未覆盖令牌**回落哪一份基线（深色基线 / 亮色基线）——**不回落到别的皮肤**。
- 深色皮肤：只写「和深色基线不同」的令牌即可（但**品牌色建议至少给全 `--accent` 系**，否则 hover 色会是基线蓝）。
- 亮色皮肤（浅底）：**必须给全所有颜色类令牌**（surface×5 / accent×6 / text×3 / border×3 / 语义×4），
  否则没写的那些会漏出深色基线的值。
- `base` 同时决定窗口原生底色（`nativeTheme`），所以要「浅色界面 + 深色标题栏」是不支持的组合。

## 5. 自检（发布前逐条过）

- [ ] `contributes[].type` = `theme`，且插件是 `kind:"asset"` + `permissions: []`（**code 插件不允许声明皮肤**）
- [ ] `theme.id` 匹配 `[a-z0-9-]{3,40}`，且**不与内置皮肤（netflix / bilibili / apple / douban）或已装插件重名**
- [ ] 令牌名全部在词表内（无自造前缀）；值类型/范围合法（alpha 类必须带透明；长度带 `px`；时长 `ms`；阴影分层）
- [ ] **没有** `style` / `css` / `styles` / `stylesheet` 字段，包里也**没有** `.css` 文件
- [ ] `layout` 字段名与取值都在枚举内
- [ ] 亮色皮肤已给全颜色类令牌
- [ ] 装上后：设置页能看到该皮肤 → 选中即时生效 → 卸载后回落默认皮肤（三步都过）

对照拒装原因码：`THEME_TOKENS_REQUIRED` · `UNKNOWN_THEME_TOKEN` · `BAD_THEME_TOKEN_VALUE` ·
`THEME_STYLE_NOT_ALLOWED` · `BAD_THEME_LAYOUT` · `THEME_ID_TAKEN`

---

## 6. 发布产物示例：`assets/theme-sakura.winbox`

**这就是「规范的皮肤插件」长什么样**（2026-10-18 归档；1.8 KB，已通过宿主真机端到端验收）：

- 包内**只有两个文件**：根级 `plugin.json`（= `plugin.theme.json` 骨架的实际值）+ `LICENSE` ——
  **没有任何 `files/`、没有任何 `.css`**（皮肤不提供资源，颜色/形状/动效全是令牌）。
- 清单要点：`kind:"asset"` + `permissions: []`；`contributes[0] = { type:"theme", id:"sakura", label:"🌸 樱花",
  base:"dark", tokens:{39 项}, layout:{shell:"topbar", detailStyle:"cinema", discoverStyle:"shelf",
  navHeight:58, cardWidth:176} }`。
- 生效值 = **`plugin:sakura`**（宿主给插件皮肤统一加 `plugin:` 前缀；插件 `id` 与皮肤 `theme.id` 是两回事：
  包名/安装目录用插件 `id`（`theme-sakura`），设置页与 `data-theme` 用 `plugin:<theme.id>`）。
- 想**自己复现**（任意 OS 上把两个文件打成 zip 再改名即可）：

```powershell
# 目录里先摆好 plugin.json + LICENSE（都必须在包根级）
Compress-Archive -Path plugin.json, LICENSE -DestinationPath out.zip
Rename-Item out.zip theme-sakura.winbox     # ★ 文件名 = <插件 id>.winbox
```

- **自测三步**（装完就能验，不用改宿主任何代码）：
  1. 设置页「插件 / 组件」→ 安装该 `.winbox`（或把 `.winbox` 解出的目录放到 `<userData>/plugins/theme-sakura.winbox/`）；
  2. 设置页「外观主题」应多出一项 **🌸 樱花**，点它 → 界面立刻换成粉调（且**外壳仍复用宿主 topbar**，因为 `layout.shell='topbar'`）；
  3. 「插件 / 组件」里**卸载** → 皮肤项消失、当前皮肤自动回落「网飝」。
- 宿主仓库里有一条**交叉用例**守着这个包（`tests/pluginContract.spec.ts`：解包 → 根级两文件 →
  无 `.css` → 清单与 `theme` 贡献项均过校验），所以本文件**不许手改成不合规内容**。
