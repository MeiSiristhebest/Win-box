# plugin.json 字段与白名单速查

> 唯一权威：`docs/design/插件制作规范.md` §4~§6。本文件是**速查**，冲突时以规范为准。

## 字段
| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `manifestVersion` | int | ✅ | 恒 `1` |
| `id` | string | ✅ | `[a-z0-9-]{3,40}`，唯一；决定安装目录 `<id>.winbox` |
| `name` | string | ✅ | 显示名 |
| `version` | string | ✅ | 语义化版本（更新检测用） |
| `apiVersion` | string | ✅ | 宿主 API **大版本**（如 `1.x`）；不匹配 → 拒装 |
| `kind` | `asset` \| `code` | ✅ | asset=声明式；code=L4 沙箱代码 |
| `main` | string | `code` 必填 | 沙箱入口相对名（如 `main.js`）；`asset` **不得有** |
| `author` / `license` | string | ✅ | 署名 / 许可 |
| `homepage` | string | 可选 | |
| `description` | string | 可选 | |
| `permissions` | string[] | ✅ | `asset` **必须为空**；`code` **必须**取下方白名单 |
| `permissionNotes` | object | 可选 | 每个权限的一句话用途（安装时展示给用户） |
| `contributes` | object[] | ✅ | 见下方 contributes 白名单 |
| `runtimeDeps` | object[] | 可选 | **只引用内置许可清单的 dep id** |
| `updateCheckUrl` | string | 可选 | `https://`；作者自配的更新源 |

## contributes 白名单（含允许的 kind）
| type | 允许 kind | 阶段 |
|---|---|---|
| `mpv.shaders` | asset | M1 |
| `theme` | asset | M2 |
| `danmaku.source` / `subtitle.provider` / `meta.provider` / `discover.source` | asset / code | M2 |
| `live.template` | asset | M2 |
| `player.engine` | code | M2（风险高，需显式授权） |
| `ui.slot` / `settings.panel` / `keymap` | asset | M2 |
| `ui.command` | asset / code | M2 |

**禁用**：`code.spider`（引擎解析行为）· `main.hook`（主进程执行）· `drive.provider`（网盘凭据）

## permissions 白名单（**只属 L4 / `kind:"code"`**）
`net` · `net.download` · `kv` · `settings` · `fs.plugin` · `log` · `notify` · `clipboard.read` · `clipboard.write` · `dialog` · `player.control` · `openExternal`

**禁用（永不提供）**：`main` · `spawn`/`child_process` · `eval` · `fs`（任意文件系统）· `cred` · `proxy`（含 `raw.net`）· `registry`

## `mpv.shaders` 结构
```jsonc
{ "type": "mpv.shaders",
  "modes": [ { "id": "efficiency", "label": "效率档", "hint": "弱机可用", "shaders": ["a.glsl", "b.glsl"] } ] }
```
- `shaders` **顺序即生效顺序**；名称**先插件 `files/`、再 runtimeDeps 目录**解析为绝对路径（**不要写绝对路径**）。

## runtimeDeps
```jsonc
"runtimeDeps": [ { "id": "anime4k-shaders", "files": ["Anime4K_Upscale_CNN_x2_M.glsl"] } ]
```
- 小资源（<1MB）建议直接进 `files/` 随包；重运行库才走 `runtimeDeps`（**安装后**才下载）。
