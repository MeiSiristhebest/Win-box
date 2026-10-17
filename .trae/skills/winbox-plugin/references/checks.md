# 发布前校验清单（工作流）

发布 `.winbox` 前，逐条核对；任一不通过就修，别发布。

## 1. 结构
- [ ] 根级有 `plugin.json`（**不得**多套目录层）
- [ ] 文件名 = `<id>.winbox`，且 `id` 与清单一致
- [ ] 包内附 `LICENSE`（= 插件**自身**许可，与 manifest `license` 一致）
- [ ] 若随包了**第三方资源**：`licenses/<上游名>.txt` 已原样归档，且根 `LICENSE` 有「署名 / 上游 / 许可」对照段（copyleft 上游如 GPL-3 / LGPL-3 必做）

## 2. 清单字段
- [ ] `manifestVersion = 1`
- [ ] `id` 符合 `[a-z0-9-]{3,40}`
- [ ] `apiVersion` 与目标宿主**大版本**一致
- [ ] `kind` 与 `permissions` 匹配：`asset` → `[]` 且无 `main`；`code` → 白名单非空且有 `main`
- [ ] `contributes[].type` 在宿主白名单内
- [ ] 所有路径（`main`/`files`/`shaders`）为**相对名**、无 `..`、无绝对路径
- [ ] ★ **`modes[].shaders` 的每一项都在包里真实存在**（`files/<名字>` 逐条命中；宿主安装期会拒装缺失项）
- [ ] 同一档位没有两条着色器抢**同一槽位**（`//!SAVE` 同名 ⇒ 互斥，应二选一）
- [ ] `runtimeDeps[].id` 都在**内置许可清单**内（未自报 url）
- [ ] `updateCheckUrl` 为 `https://`（作者自配）

### 2.1 怎么核「声明 ⊂ 包内」（可执行）
不要靠眼看。打包**之后**回读 zip 条目，逐条比对清单声明：

```powershell
# 把 .winbox 当 zip 读（★ Expand-Archive 只认 .zip 扩展名 → 先改个名）
Copy-Item <id>.winbox "$env:TEMP\pkg.zip" -Force
Expand-Archive "$env:TEMP\pkg.zip" -DestinationPath "$env:TEMP\pkg" -Force
(Get-Content "$env:TEMP\pkg\plugin.json" | ConvertFrom-Json).contributes[0].modes |
  ForEach-Object { $_.shaders } |
  ForEach-Object {
    $f = Join-Path "$env:TEMP\pkg\files" $_
    if (Test-Path $f) { Write-Host "OK   $_" } else { Write-Host "MISS $_" }
  }
```
出现任何 `MISS` ⇒ **不要发布**（宿主校验器会以 `INCOMPLETE` / 声明文件缺失拒装）。

## 2.2 皮肤（`type:"theme"`）—— 逐条核对
> 词表 / 枚举 / 自检全量口径：`references/theme-reference.md`；权威规范 `docs/design/皮肤与主题规范.md`。
- [ ] 插件是 `kind:"asset"` + `permissions: []`（**code 插件不得声明皮肤** → `UNKNOWN_CONTRIBUTE_KIND`）
- [ ] `theme.id` 匹配 `[a-z0-9-]{3,40}`；**不与内置皮肤（netflix/bilibili/apple/douban）或已装插件重名**（`THEME_ID_TAKEN`）
- [ ] `theme.label` 非空；`theme.base` ∈ `dark | light`
- [ ] `tokens` 非空，键**全部**在 39 项词表内（无 `--nf-*`/`--b-*`/自定义前缀 → `UNKNOWN_THEME_TOKEN`）
- [ ] 值类型正确：颜色合法；`--surface-glass`/`--accent-soft`/`--border-soft`/`--hairline` **必须含 alpha**；
      长度带 `px`（仅 `0` 可省）；时长带 `ms`/`s`；缓动仅 `cubic-bezier(a,b,c,d)`；阴影 `[inset] 2~4 长度 + 可选颜色`（`BAD_THEME_TOKEN_VALUE`）
- [ ] 值里没有 `;` `{` `}` `<` `url(` `expression(` `@import` `/*`
- [ ] 没有 `style` / `css` / `styles` / `stylesheet` 字段，包里也没有 `.css` 文件（`THEME_STYLE_NOT_ALLOWED`）
- [ ] `layout` 字段名与取值在枚举内（`shell` / `detailStyle` / `discoverStyle` / `filterStyle` / `nav` / `density` /
      `motion` / `radiusScale` / `navHeight` / `sideWidth` / `cardWidth`）（`BAD_THEME_LAYOUT`）
- [ ] **亮色皮肤已给全颜色类令牌**（surface×5 / accent×6 / text×3 / border×3 / 语义×4），否则未覆盖项会漏出深色基线
- [ ] 装上后三步走通：设置页出现该皮肤 → 选中即时生效 → 卸载回落默认皮肤

## 3. 行为约定
- [ ] 插件可被**随时停用**而不报错
- [ ] 若贡献正生效（如超分档位），**移除**时能回落默认
- [ ] 需要 `net` 的插件已在 `permissions` + `permissionNotes` 说明用途

## 4. 对照拒装原因码（规范 §10）
`MISSING_MANIFEST` · `ID_INVALID` · `API_VERSION_MISMATCH` · `KIND_PERM_MISMATCH` · `UNKNOWN_CONTRIBUTE` · `PATH_ESCAPE` · `SHA_MISMATCH` · `INCOMPLETE` · `DEP_NOT_ALLOWED`
皮肤专属（规范 §5）：`THEME_TOKENS_REQUIRED` · `UNKNOWN_THEME_TOKEN` · `BAD_THEME_TOKEN_VALUE` · `THEME_STYLE_NOT_ALLOWED` · `BAD_THEME_LAYOUT` · `THEME_ID_TAKEN`

## 5. 打包（PowerShell 示例）
```powershell
# ★ -Path 直接列条目（别传父目录，否则会多套一层）；plugin.json 必须在包根级
Compress-Archive -Path plugin.json, files, LICENSE, licenses -DestinationPath out.zip
Rename-Item out.zip <id>.winbox
```
- ★ `Compress-Archive -DestinationPath` **必须以 `.zip` 结尾**（不是 `.zip` 会被自动补成 `.zip`，得到 `out.winbox.zip`）；正确做法 = 先出 `.zip` 再 `Rename-Item` 成 `.winbox`。
- ★ 回读校验时 `Expand-Archive` **只认 `.zip` 扩展名**（见 §2.1：先 `Copy-Item` 成 `.zip`）。
- 宿主侧读 `.winbox` 是**按字节**解（不看扩展名），所以扩展名只影响 PowerShell 工具链，不影响安装。
- ★ **皮肤插件（`type:"theme"`）的包形态与别的插件不同**：包内**只有** `plugin.json` + `LICENSE`（+ 需要时 `licenses/`），
  **没有 `files/`、没有任何 `.css`**。照抄命令时把 `files` 去掉：
  `Compress-Archive -Path plugin.json, LICENSE -DestinationPath out.zip` → `Rename-Item out.zip <插件 id>.winbox`。
  可直接对照归档的发布产物示例 **`assets/theme-sakura.winbox`**（见 `references/theme-reference.md` §6；含自测三步）。
