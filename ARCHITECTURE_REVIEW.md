# Win-Box 架构评审：14 项原则

评审日期：2026-10-25
评审对象：当前工作区，包含未提交文件；结论不代表某个发布版本。

## 结论

**整体为部分符合，全面整改尚未完成。** 按下方口径，11 项是“部分符合”，3 项为“以符合/大体符合为主”，目前没有一项可称为全仓验收通过。已有多个真实应用用例、消费者端口、纯状态转换和 IPC 适配器；`SpiderHost` 转发门面和相应的私有状态测试路径已移除。主要剩余问题集中在播放器 Presenter 的跨控制器编排、尚未逐一分类的 UI 到 IPC 依赖、动态蜘蛛运行时契约、全局样式跨层覆盖，以及部分组合根/测试夹具接口仍较具体。配置持久化是一个序列化 `UserConfig` 根聚合的一次原子提交；现有 `UserConfigApplicationService` 的多项命令都维护该聚合不变量，不能仅凭方法数量或文件长度断言 SRP 违反，也不能把配置切片误判为独立事务聚合。播放器控制视图现在消费独立展示契约；偏好持久化与音轨控制分别有应用端口和存储/IPC/HLS 适配器；弹幕候选展示格式与搜索查询清洗已拆层。播放设置的通用状态协调已移出设置 JSX，订阅设置的直播源操作也已通过端口隔离；PlayerPage 的展示视图和播放器标题栏现在是被动组件，window IPC 集中到布局组合容器/播放器适配器，但 session hook 的状态编排与更大范围的页面审计仍未完成。文件变短、增加 hook 或静态边界检查通过，都不能单独证明原则已经满足。

## 最新 CLI 复核（2026-10-25）

- **工具选择：** 代码检索、架构检查、类型检查、lint 和测试均使用 CLI；computer use 只适合补充真实窗口的视觉复现。默认 PowerShell 启动路径失效且普通 shell 调用被沙箱拒绝后，改用已授权的 `cmd.exe` 与仓库本地 `.cmd` 工具入口继续执行。
- **本轮修正：** 音频播放进度从自制 `role="slider"`/指针处理改成原生 `input[type=range]`，seek 由 Presenter action 更新；设置和直播源提示改用原生 `output` 状态元素。按现有对比度回归规则移除了禁用进度条整体 opacity，避免整控件被淡化。
- **最终工作树验证：** Vitest **398 个文件通过、3 个跳过；3515 项通过、5 项跳过**。main、renderer、test 三套 TypeScript 检查均通过（项目本地 TypeScript 7.0.2）。Oxlint 源码/脚本/测试、renderer React/性能及 JSX 可访问性阶段均通过；`architecture-boundaries.mjs` 输出 `Architecture boundaries passed.`。另有 25 项音频/主题对比度定向回归通过。
- **未完成验收：** 未运行生产构建、安装包制作、桌面实机视觉/播放验收；本次检查不等于 14 项原则整改完成，整体仍是部分符合。测试运行中保留了 `usePlaybackSettingsPresenter` 的 React `act(...)` 非失败警告及 Node localStorage 实验性警告。
- **后续音频边界收敛：** 原生进度滑块替代旧 DOM 指针 seek 后，移除了失去生产调用者的坐标/键位映射函数、`AudioProgressTrackBounds` 与全局指针释放订阅。将泛化的 `AudioPlayerInteractionPort` 收窄并改名为 `AudioPlayerKeyboardEventsPort`，适配器也改成 `audioPlayerKeyboardEventsAdapter`；视图回归测试验证语义 slider、seek 委托和无时长禁用行为。
- **该增量验证：** main、renderer、test 三套 TypeScript 检查通过；完整 Oxlint / 架构边界检查通过；音频纯规则、会话 hook、视图共 3 个测试文件、6 项通过。该增量尚未重跑全量 Vitest；上一条记录的全量绿灯发生在此增量之前。
- **播放器端口与状态所有权继续整改：** 将原先同时供进度菜单读取 viewport、供失败重试重载窗口的 `PlayerWindowPort` 拆成 `PlayerViewportPort` 与 `PlayerWindowReloadPort`，并分别注入两个浏览器适配器；字幕适配器只依赖 viewport 能力。跳过片段的菜单捕获/清除/关闭行为移入 `useSkipSegmentsController`，Presenter 不再直接读取当前片段另一端点或调用持久化 commit。
- **该增量验证：** main、renderer、test 三套 TypeScript 检查通过；全 Oxlint 与架构边界检查通过；跳过片段、菜单定位、字幕、音频相关 8 个测试文件共 44 项通过。已用 CLI 确认旧宽端口、无用音频指针接口与旧 seek 规则无剩余引用。增量后未重跑全量 Vitest、生产构建或桌面实机验收。
- **播放器交互 hook 归层：** `usePlayerPopupKeyboard` 只被播放器的弹幕、字幕、音轨、内核、速度/画面比例菜单使用，却放在通用 `renderer/lib`。现将它归入 `features/playback` 并改名为 `usePlaybackPopupKeyboard`，所有调用点改为 feature 内依赖；键盘、Escape、焦点恢复和指针离开行为保持原样。
- **该增量验证：** playback popup 相关 4 个 Vitest 文件、10 项通过；main、renderer、test 三套 TypeScript 检查通过；严格 Oxlint、React/perf、JSX a11y 和架构边界检查通过。旧 hook 名称与通用 `lib` 引用已无残留。全量 Vitest、生产构建和桌面实机复核未在该增量后重跑。
- **HomePage 搜索/浏览交接：** `HomeSearchWorkflow` 原先持有宽泛的可变浏览状态并推进共享搜索代数，直接知晓浏览列表、分页筛选和快照 ref。现由 `useHomeBrowseController` 持有浏览快照并实现窄 `HomeSearchBrowsePort`，提供当前档案/源身份、使浏览请求失效、保存/恢复快照和返回路径决策；搜索代数由搜索工作流自行拥有。浏览开始和来源切换用语义取消动作通知搜索流程，避免互相改写对方的代数状态；Presenter 只接线该端口与搜索工作流。
- **该增量验证：** Home 搜索、来源会话、浏览控制与搜索执行/文件夹 5 个 Vitest 文件、34 项通过；main、renderer、test 三套 TypeScript 检查通过；严格 Oxlint、renderer React/perf、JSX a11y 与架构边界检查均通过。新增架构回归禁止 HomeSearchWorkflow 导入 React、浏览控制器或 renderer IPC。未重跑全量 Vitest、生产构建、安装包或桌面实机验收。
- **Home 来源选择策略归层：** `homePageModel` 原来把搜索/分类展示投影、来源恢复策略和来源筛选值归一化放在一起；`useHomeSourceSession` 因此反向依赖页面展示模型，并自行重复执行刷新时的可用源回退。现将来源身份/可用性选择移入纯 `application/homeSourceSelection`，将空筛选值清理移入 `application/homeBrowseFilters`；首载与刷新共用同一来源可用性策略，来源会话不再导入展示模型或直接判断源类型。架构扫描现在禁止该展示模型依赖回流。
- **该增量验证：** 来源策略、首页模型、来源会话和架构边界 4 个 Vitest 文件、216 项通过；main、renderer、test TypeScript 检查、严格 Oxlint、renderer React/perf、JSX a11y、架构扫描和 `git diff --check` 均通过。全量 Vitest、生产构建、安装包和桌面实机验收仍未运行。

## 总体进度与本轮状态（2026-10-25）

- **总评：** 14 项原则的首轮评判已记录在下表，当前整体仍为“部分符合”。这是一份持续整改中的架构评审，不是全仓验收结论；各原则都还有未覆盖路径。
- **依赖盘点：** 当前 src/renderer 有 483 个 TS/TSX/JS/JSX 模块，70 个静态导入 renderer IPC client。其中 66 个在 feature 层（65 个位于 adapters 目录、1 个命名 adapter）、2 个在 lib，2 个在应用入口；页面、普通组件和布局层当前没有直接 client 导入。adapter/组合根依赖基础设施属于预期，导入数量本身不是违规数。
- **已改造路径：** 主进程组合根与消费者端口、蜘蛛运行时 provider、播放与字幕/弹幕、订阅/档案/网盘登录、聚合搜索与发现数据，以及播放器、更新门禁、搜索面板、发现详情、历史、收藏和 WebDAV 存储页面均已有不同程度的 application/port/adapter/Presenter/View 分层。历史、收藏和存储页的状态/动作已移出 JSX；播放器 Presenter 仍是主要跨域协调点。
- **本轮继续：** 插件槽位已拆成 composition root、端口、IPC/action adapter、Presenter 与被动 View；窗口标题栏的 IPC 状态与命令已移入 adapter/Presenter；页面错误边界改为接收上层注入的报告回调。播放器 Presenter 内的瞬时命令失败提示和内核画面比例同步也分别移入专责 hook。详情页的背景与收藏源元数据读取改由独立端口和 adapter 提供。设置页的多档案合并导出、订阅组操作、源体检和失败源清理已从 ConfigPage 移入各自端口/Presenter/用例。HomePage 的 browse/search/drive、档案来源和网页源能力由 feature adapters 注入；配置刷新与档案激活也由设置 adapters 注入。封面查找从通用 `lib/useCovers` 移入独立 covers feature，由 `CoverLookupPort` 和 IPC adapter 提供元数据查询，八个调用点改为 feature hook。插件快捷键从 `lib/pluginKeymaps` 移入 plugins feature：匹配规则为无副作用应用逻辑、IPC 拉取为端口 adapter、keydown listener 留在 hook；插件命令从混合 IPC/窗口/主题逻辑拆成 `createPluginCommandRunner` 与 `PluginCommandPort`，App/provider 注入具体 adapter。主题注册表加载现由框架无关协调用例与 renderer adapter 承接，竞态控制和 IPC 边界已纳入静态规则。页面及普通组件当前均无直接 IPC client 导入；HomePage 的搜索、浏览结果 JSX 已移至独立 passive view，并由显式类型化模型驱动；profile/source/focus 配置刷新已拆到带端口的 useHomeSourceSession，但 presenter 仍持有 React 搜索状态、用户动作和跨浏览/搜索协调；ConfigPage 也仍有页面级状态，故 SRP/Passive View 尚未完成。**本轮新增：** display preferences 的 React/IPC/DOM 分层改为 application session + 尺寸与缩放端口 + adapter/presentation hook；搜索窗口策略改为纯 route decision，移除 `lib/searchWin.ts` 的模块求值期 hash 快照和混合路由/IPC职责，详情页从 App 组合点接收搜索动作。
- **最新增量：** ConfigPage 的档案激活/广播/刷新顺序现位于带 ProfileActivationPort 的 application use case；播放器兼容设置已拆为异步 Presenter 与被动 View，保存成功后的状态刷新失败不再误报保存失败。首页搜索状态文案现由纯展示映射负责，空闲状态不再误显示“搜索中”。页面仍保留跨设置区共享的忙碌与错误展示状态。具体范围见本轮详细记录。
- **本轮继续：** 主题对比度审计发现所有皮肤的 `--border` 都低于 3:1，部分控件边界最低约 1.05:1；这不是装饰线问题，因为同一令牌用于输入框、按钮、卡片等功能边界。已提高六套主题的功能性边界色，保留 `--border-soft` / `--hairline` 作为低强调装饰线；主题对比度用例现在也覆盖九类正文/语义文本令牌及 `--border` 对四级表面的 3:1 要求。当前人工复算六套主题正文最低 4.92:1、功能性边界最低 3.10:1，未发现语义文本令牌缺失。
- **当前静态验证：** 仓库声明的 TypeScript 7 runner 因缺少 `@typescript/typescript-win32-x64/lib/tsc.exe` 无法启动。本轮改用缓存中的 TypeScript 5.9.3 API 对 main、renderer、test 三个 tsconfig 执行 `noEmit`，均为 0 诊断；这只能作为兼容编译检查，不能等同于 TS 7 验证。全 `src` 架构边界脚本在本轮新增 Python 脚本 I/O 规则之前曾通过；当前改动后的脚本因 Node REPL 禁止 `node:process` 尚未执行，不能写作当前快照通过。
- **尚未验证：** 本轮 Vitest 运行器未启动：工作区没有 `node_modules`，Node REPL 子进程 PATH 没有 `node`，桌面命令执行器仍解析到不存在的 `D:\develop\PowerShell\7\pwsh.exe`。未运行 Oxlint、生产构建、安装/桌面视觉验收或真实线路与播放验收。轻量 harness 与手工冒烟不等同于正式测试结果。
- **接下来优先：** 对 VideoPlayerPresenter、HomePage 搜索状态协调、ConfigPage 页面装配、运行时失败/取消语义、CSS/Atomic Design 和全窗口主题对比度继续按实际责任与依赖证据审查；补齐 14 项原则中尚未证实的行为与替换性评估。两个 renderer/lib 中的 IPC 引用分别是显式 `externalPlaybackAdapter` 和 `preferenceStore`；本轮确认后者是围绕单一偏好聚合的持久化 adapter，已把旧 key 映射抽离，不会为了降低文件行数而拆成七份存储。配置持久化仍按单一 UserConfig 根聚合保留，除非发现明确独立变更原因或依赖负担。

## 本轮继续推进（2026-10-25，设置页面深链接副作用）

- **确认的问题：** `ConfigPage` 除了组合设置区，还直接查询 DOM、展开 `<details>`、滚动到深链接目标、观察条件渲染面板，并用 `requestAnimationFrame` 把焦点移到标题。这使页面组件同时掌握路由装配、设置区域组合和浏览器导航副作用。
- **已调整：** 新增 `useConfigSectionNavigation`，把深链接目标查找、父级展开、面板 MutationObserver、滚动和标题聚焦集中到设置导航 hook。`ConfigPage` 只传入请求区段/当前标签并委托聚焦动作。架构扫描现禁止该页面重新直接依赖这些 DOM 副作用。
- **回归覆盖：** 新增 hook 用例覆盖条件面板稍后挂载后展开父级、滚动到目标和聚焦区段标题；架构边界用例覆盖 DOM 查询、MutationObserver、scrollIntoView 与 requestAnimationFrame。
- **原则影响：** 改善 #1、#6、#11、#14 的展示副作用隔离与可验证性。ConfigPage 仍有初始配置读取和档案激活编排，尚不能称为被动视图或 SRP 完成。
- **验证：** TypeScript 5.9.3 API 对 main、renderer、test 三个配置执行 `noEmit`，均为零诊断；全 `src` 架构边界扫描通过。
- **未验证：** 新增 Vitest 行为用例没有运行。终端的 `pwsh.exe` 路径不存在，`cmd.exe` 无法进入受限工作区；Node REPL 导入 `vitest/node` 明确被禁止加载 `node:process`。未运行构建、lint 或桌面验收。

## 本轮继续推进（2026-10-25，首页级联与分类契约归属）

- **确认的问题：** `homePageModel` 依赖 `CascadeBar` 组件定义的类型，也从 `useHomeBrowseController` 借用 `SortClassView`；`useHomeSourceSession` 与 `useHomePagePresenter` 同样引用 controller 导出的类型。纯分类/筛选映射和来源会话契约因此反向依赖 UI/控制器实现。
- **已调整：** 新增框架无关的 `HomeCascadeLevel` 展示数据结构；分类列表统一用 feature-owned `HomeSortClassView` 合约。移除控制器导出的 `SortClassView` 别名，模型、来源会话和 Presenter 不再把类型所有权放在组件或 hook 上。
- **防回归：** 架构扫描禁止 homePageModel 依赖 CascadeBar/浏览控制器、来源 session 依赖浏览 hook，也禁止 Presenter 直接借用 CascadeBar/控制器导出的类型；新增 fixture 测试覆盖这些反向依赖。
- **原则影响：** 改善 #4、#5、#6、#7、#11、#14 的契约所有权、依赖方向和脱离组件测试能力。
- **验证：** TypeScript 5.9.3 API 对 main、renderer、test 三个配置执行 `noEmit`，均为零诊断；全 `src` 架构边界扫描通过。
- **未验证：** Vitest 行为与架构 fixture 用例尚未运行；运行环境限制详见下方记录。

## 本轮继续推进（2026-10-25，首页分页动作归属）

- **确认的问题：** `useHomePagePresenter` 持有跳页输入、数字清洗、页数上限计算及上一页/下一页加载动作；分页数据和分类加载却由 `useHomeBrowseController` 管理。浏览用例的操作策略因此落在页面组合器。
- **已调整：** 将跳页输入与分页动作移入 `useHomeBrowseController`。控制器负责数字输入清洗、最大页数约束、当前/加载状态保护以及分类请求；Presenter 只把语义动作交给展示模型。无页数信息时拒绝跳页，避免把第 0 页请求发给数据源。
- **回归覆盖：** 浏览控制器用例覆盖非法字符清洗、超出范围时钳制到末页和请求参数；行为用例未由 Vitest 运行。
- **原则影响：** 改善 #1、#6、#11、#14，使浏览用例与其分页状态/操作保持在同一替换边界；HomePage 仍负责多工作流协调。
- **验证：** TypeScript 5.9.3 API 对 main、renderer、test 三个配置执行 `noEmit`，均为零诊断；全 `src` 架构边界扫描通过。
- **未验证：** Vitest/构建/lint 仍受当前执行器限制，详见“未验证”记录；尚无运行器或桌面行为结果。

## 本轮继续推进（2026-10-25，首页搜索与浏览加载状态隔离）

- **确认的问题：** 首页浏览请求、聚合搜索/文件夹展开和来源切换共用一个 `loading` 布尔值。任一工作流可以直接清除其他工作流的展示状态；浏览无限滚动也读取该共享状态。它让取消与加载状态的所有权不清晰，消费者无法独立替换或核验两种工作流。
- **已调整：** 分别建立 `browseLoading` 与 `searchLoading`。浏览控制器只读取/写入浏览状态；搜索用例只写搜索状态，搜索开始时通过窄展示动作取消浏览加载；来源会话明确重置两个工作流。视图模型按各自页面区域消费对应状态，首页滚动恢复仅受浏览加载影响。
- **回归覆盖：** `useHomeSearchController.spec.tsx` 增加搜索接管加载状态的用例，确认晚到的浏览完成动作不会释放搜索加载状态；浏览控制器测试改为断言独立的浏览状态。
- **原则影响：** 改善 #1、#4、#6、#8、#11、#14 的状态所有权与可替换性。该局部拆分没有解除首页 Presenter 的跨工作流编排职责，也不代表首页 SRP 已完成。
- **验证：** TypeScript 5.9.3 API 对 main、renderer、test 三个配置执行 `noEmit`，均为零诊断；全 `src` 架构边界扫描通过。
- **未验证：** 本次新增/调整 Vitest 用例没有运行。终端的 `pwsh.exe` 路径不存在，`cmd.exe` 无法进入受限工作区；Node REPL 导入 `vitest/node` 明确被禁止加载 `node:process`。未运行构建、lint 或桌面验收。

## 本轮继续推进（2026-10-25，首页筛选偏好依赖边界）

- **确认的问题：** `useHomePagePresenter` 直接导入 `uiPrefs` 的 `useHomeFilters` 和 `setHomeFilters`。Presenter 因此同时承担页面展示协调和全局偏好存储接线；消费者不能仅通过替换其输入来隔离偏好状态。
- **已调整：** 将读取/切换筛选偏好的 React 适配器放到 `homeFilterPreferenceAdapter`，由 `HomePage` 组合入口读取并注入 `{ isOpen, toggle }`。Presenter 现在仅消费这个窄展示输入，并把开关状态和语义动作传入页面模型。
- **防回归：** 架构边界扫描禁止 `useHomePagePresenter` 再导入 `uiPrefs`；新增架构用例覆盖这条反向依赖。
- **原则影响：** 改善 #5 DIP、#6 SoC、#11 Passive View 输入显式化和 #14 替换/隔离能力；没有解决 HomePage presenter 仍协调搜索、浏览与导航的主要 SRP 问题。
- **验证：** TypeScript 5.9.3 对 main、renderer、test 三套配置执行 `--noEmit` 均零诊断；全 `src` 架构边界扫描通过。新增 Vitest 架构用例尚未由 Vitest 运行；未运行 lint、生产构建或桌面验收。

## 本轮继续推进（2026-10-25，首页搜索展示契约反向依赖）

- **确认的问题：** `homePageViewModel.ts` 从 `HomeBrowseResults`、`HomeSearchResults` 导入组件 Props 作为展示模型定义；`HomeBrowseResults` 又从 `useHomeBrowseController` 导入 `SortClassView`。页面契约因此依赖具体 View 与 controller hook。封面失败回调还把 React synthetic event 从渲染叶子组件传到 Presenter。
- **已调整：** 首页展示模型现在独立定义分类/搜索结果字段与动作类型，两个结果 View 依赖展示模型；展示模型不再导入 View 或 React。浏览结果组件不再引用控制器 hook。图片事件在卡片/View 内提取失败图片地址，Presenter 接收字符串值，不接触 React event。
- **防回归：** 架构扫描新增禁止展示模型导入具体 View/React，以及结果 View 导入 controller hook；对应架构用例覆盖这两类反向依赖。
- **原则影响：** 修正 #4 ISP（展示契约不复用组件实现 Props）、#6 SoC、#11 Passive View 和 #14 可测试性；仍未对所有 renderer 视图完成相同核验。
- **验证：** TypeScript 5.9.3 的 main、renderer、test 三套配置零诊断；全 `src` 架构边界扫描通过。新增 Vitest 用例尚未执行；未运行 lint、构建或桌面视觉验收。

## 本轮继续推进（2026-10-25，首页工作流错误状态隔离）

- **确认的问题：** 首页浏览、搜索以及档案/来源会话共用 `err`。任一 workflow 的成功清理会抹除另一 workflow 的错误；搜索结果是否展示还受来源会话的错误字符串控制。
- **已调整：** 现分别维护浏览、搜索、来源会话错误。各控制器只更新所属状态；搜索结果只由搜索错误决定是否显示，来源刷新失败不会误隐藏已有结果。档案/来源配置读取启动及成功后清理自己的错误。
- **回归覆盖：** 新增 `HomePageView.spec.tsx`，覆盖来源刷新错误不遮挡现有搜索结果、搜索错误会隐藏旧结果；架构扫描同时保护 Presenter 对偏好存储的依赖方向。
- **原则影响：** 改善 #1、#6、#8、#11、#14 的状态所有权与副作用隔离；播放器协调器与首页其余搜索/浏览状态仍需继续审查。
- **验证：** TypeScript 5.9.3 的 main、renderer、test 三套配置零诊断；全 `src` 架构边界扫描通过。新增/现有 Vitest 用例尚未运行；未运行 lint、生产构建或桌面验收。

## 本轮继续推进（2026-10-25，首页浏览偏好与会话记忆注入）

- **确认的问题：** `useHomeBrowseController` 直接调用全局 `useWaterfall`，并直接读写模块级 `sessionSort` Map。浏览流程因此控制数据加载的同时隐式选择偏好与会话状态实现。
- **已调整：** `HomePage` 组合入口读取瀑布显示偏好并注入浏览 hook；分类筛选/页码记忆改为 `HomeCategoryStateMemoryPort`，生产 adapter 继续映射到原有渲染进程内存 Map，保持原有生命周期和键语义。控制器与测试通过窄端口替换状态记忆。
- **防回归：** 架构扫描禁止浏览 controller 重新依赖通用偏好与 session sort adapter；现有 hook 测试改用 fake memory port。
- **原则影响：** 改善 #5 DIP、#6 SoC、#8 可变状态边界和 #14 测试替换能力；React 生命周期与滚动观察仍保留在 controller hook。
- **验证：** TypeScript 5.9.3 的 main、renderer、test 三套配置零诊断；全 `src` 架构边界扫描通过。Vitest 未执行，故测试改动尚无运行器结果；未运行 lint、构建或桌面验收。

## 本轮继续推进（2026-10-25，禁用态对比度与播放器选集面板）

- **确认的问题：** 全局按钮、两种导航外壳、发现页翻页、字幕/跳过面板和图片浏览器分别用 `opacity: .25–.45` 表示禁用态。这会连同文字和图标一起变淡；播放器选集抽屉又将半透明白字叠在任意视频帧上并加 18px 背景模糊，最差画面无法保证文字对比度。
- **已调整：** 移除上述禁用控件的整体透明度衰减，改用主题禁用文字色保持可读；播放器画面上的禁用传输键继续采用适合视频底部黑色控制渐层的浅色，图片翻页键采用不透明暗底。选集抽屉改为不透明主题表面、主题语义文字/边框和无模糊；滑入只移动面板，不再把文字整体淡化。
- **回归覆盖：** `themeContrast.spec.ts` 新增全样式目录扫描，禁止 `:disabled` 规则将控件整体 opacity 降至 1 以下；`playerStyleArchitecture.spec.ts` 更新媒体控件禁用色断言，并覆盖选集抽屉的实底、无模糊和主题文字 token。
- **静态核验：** 对现有六套主题的基础文字/表面色按 WCAG 相对亮度公式复算，最小值为 5.11:1；对当前所有 CSS `:disabled` 规则作同样扫描，未发现小于 1 的 opacity。它们是静态证据，不等同于实际窗口渲染验收。
- **未运行：** 当前工作区 shell 无法启动；Node REPL 禁止导入 Vitest 所需的 `node:process`，因此新增 Vitest 回归用例尚未运行。主题切换与播放画面上的最终视觉效果也尚未在桌面窗口确认；不能据此宣称全应用对比度问题已全部解决。

## 本轮继续推进（2026-10-25，首页路由搜索取消状态）

- **确认的问题：** `HomeSearchWorkflow.handleRouteChange()` 的 effect 清理会推进搜索代次，使旧请求的 `finally` 正确忽略过期结果，却没有释放该请求先前持有的 `loading` 和错误提示状态。路由参数变化或 profile readiness 改变时，旧搜索可能留下永久 loading。
- **已调整：** 路由清理先取消待执行帧并使请求代次失效，再清除搜索 loading/error；过期响应仍被丢弃，不会覆盖新页面状态。首页搜索记忆时间戳也改由已注入的 wall clock 提供，Presenter 不再直接读取系统时钟。
- **回归覆盖：** `useHomeSearchController.spec.tsx` 新增路由聚合搜索在途时移除 `agg` 参数、随后让旧响应返回的用例，检查 loading 及时释放且旧结果不回填。
- **原则影响：** 改善 #6、#8、#14 的取消副作用与时钟依赖边界；并没有证明整个 HomePage presenter 已符合 SRP/Passive View。
- **验证限制：** 该行为用例尚未由 Vitest 执行；当前 shell 无效，且 Node REPL 不允许导入 Vitest 所需的 `node:process`。时钟替换也尚未由 Presenter 行为测试覆盖。本轮没有用静态推断冒充测试通过。

## 本轮继续推进（2026-10-25，UI 偏好聚合的纯映射边界）

- **复核结论：** `preferenceStore` 是 renderer 持久化 adapter：它管理 main-process IPC、浏览器预览/localStorage 回退、跨窗口订阅、版本新旧判断和监听器生命周期。它服务于一个共享的 `UiPreferencesSnapshot` 聚合，不应为了缩短文件而拆成七个彼此独立的偏好仓库。聚合快照到旧字符串 key 的投影、旧值迁移、单 key patch 翻译则是可脱离 I/O 的逻辑，过去与适配器混放。
- **已调整：** 新增 `uiPreferenceMapping.ts`，集中快照校验/补默认值、读写值映射和 legacy key 常量；`preferenceStore` 只保留 IPC、localStorage、缓存与订阅副作用。`theme.ts`、`uiPrefs.ts` 和 display adapter 改用同一组语义化 key，避免持久化键在消费者中重复声明。架构扫描新增约束，映射模块不得依赖 React、IPC client 或 Electron。
- **回归覆盖：** 新增映射用例，覆盖旧快照补默认值、错误快照拒绝、快照与 key 双向映射、旧主题迁移、默认值和非法/未知单 key 写入。
- **静态验证：** TypeScript 5.9.3 对 main、renderer、test 三套配置执行 `--noEmit` 均通过；全 `src` 架构边界扫描通过。
- **执行器限制：** 定向 Vitest 在收集用例前启动失败，原因仍是 Rolldown 缺少 `@rolldown/binding-wasm32-wasi`；新回归用例尚无测试运行器结果。git 状态查询也被系统的 `git.exe` 启动错误 `BUG (fork bomb)` 阻断，因此只确认本轮显式修改过的文件，不能据此声称整个工作区无其他改动。
- **原则影响与边界：** 这为 #6、#8、#14 建立了更清楚的映射/副作用边界，提升其可独立验证性；没有证明 preferenceStore 全面符合 SRP，也没有解决播放器 Presenter、HomePage 状态协调、CSS/Atomic Design 和运行时契约等高优先级遗留问题。

## 本轮继续推进（2026-10-25，首页滚动记忆生命周期）

- **确认的问题：** `useHomePagePresenter` 同时协调浏览/搜索数据，还直接绑定滚动 DOM 事件、恢复浏览位置并提供回到顶部动作。卸载时有两组独立 effect 分别写 key/profile 和记忆字段、各自调用一次 `persist()`，职责重复且产生两次持久化。
- **已调整：** 新增 `useHomePageMemorySession`，集中滚动监听、阈值状态、一次性滚动恢复、稳定回顶动作和卸载持久化。退出页面时一次提交 key、profile、分类、页码、筛选和当前 scrollTop，再持久化一次。Presenter 只组合该会话并把 back-to-top 模型交给 View。
- **回归覆盖：** 新增 hook 用例，覆盖滚动恢复与 restore flag 清除、超过阈值后显示、回顶动作、卸载时提交最新完整快照及只持久化一次。
- **静态验证：** TypeScript 5.9.3 对 main、renderer、test 三套配置执行 `--noEmit` 均通过；全 `src` 架构边界扫描通过，并新增规则，禁止首页 Presenter 重新直接处理滚动 DOM 事件或 imperative scroll。
- **执行器限制：** 新增行为测试仍未能由 Vitest 运行：当前测试启动器在收集用例前因缺失 `@rolldown/binding-wasm32-wasi` 失败。未运行 lint、生产构建或桌面验收。
- **原则影响与边界：** 改善 #1、#6、#8、#11、#14 的页面责任分离和副作用生命周期边界；首页 Presenter 仍负责搜索/浏览状态和 view model 协调，不能据此宣称首页或 14 项原则已经全部整改完成。

## 本轮推进记录（2026-10-24，播放器会话端口隔离）

- **确认的问题：** `resolvePlayerPlayback`、`hydratePlayerInit` 与 `usePlayerPageEvents` 原先都接收完整 `PlayerPageSessionPort`。例如，只需执行播放解析的用例也能调用详情加载、窗口事件订阅和临时文件清理；这让消费者依赖了无关能力，且把该用例的替身接口扩大到整个页面会话。
- **已调整：** 将页面会话能力拆为 `PlayerPlaybackResolutionPort`、`PlayerInitHydrationPort`、`PlayerPageEventsPort` 和 `PlayerTemporaryFileCleanupPort`。完整 `PlayerPageSessionPort` 仅组合这些端口，供 session controller 与 renderer adapter 使用；播放、历史恢复和事件订阅分别依赖自己的窄端口。架构扫描器现在会阻止这三个消费者重新引用聚合端口。
- **涉及原则：** 这是 #4 ISP、#5 DIP、#6 SoC、#7 Ports & Adapters 与 #14 可测试性的一处已确认边界修正；它不代表播放器 session 状态编排或全仓原则验收完成。
- **当前验证：** 全 src 架构扫描通过；以缓存的 TypeScript 5.9.3 对 main、renderer、test 三个配置分别执行 `--noEmit` 均通过。仓库指定 TypeScript 7 平台 runner 仍不可用。
- **未完成验证：** 现有 `architectureBoundaries.spec.ts`、`playerEpisode.spec.ts`、`playerWindowControl.spec.ts` 尚未进入测试收集；Vitest 启动时加载 `@rollup/rollup-win32-x64-msvc` 得到 `Access is denied`。不得把它记为测试通过或断言失败。本轮没有添加新的行为测试，因此新端口消费者替身行为仍缺直接回归证据。

## 本轮继续推进（2026-10-24，播放器会话状态模型）

- **确认的问题：** `usePlayerPageSession` 以多组独立 `useState` 表示解析流程，URL、错误、解析中和网盘绑定状态可组合成互相矛盾的展示状态；同时在初始化得到空集数时，`resolve` 提前返回而遗留 `resolving=true`。
- **已调整：** 新增无 React/IPC 依赖的 `playerPageSessionState.ts`，用互斥的 `idle / hydrating / resolving / ready / drive-bind-required / failed` 状态表达解析阶段，并由纯 selector 生成现有展示契约。Hook 保留异步请求代次、端口调用、React 生命周期及事件订阅；状态迁移由 reducer 原子完成。空集数初始化现在进入 idle，不再永久显示加载中。
- **行为证据：** 新增 `playerPageSessionState.spec.ts`，覆盖加载/播放地址/网盘绑定/失败状态互斥、重新初始化清除旧播放地址、初始化错误、空集数结束加载，以及不可变更新和无关 dismiss 不改状态。四项断言通过轻量测试 harness；由于当前 Node REPL 禁止加载 `node:process`，Vitest 本身未执行。
- **验证：** 当前快照的 main、renderer、test 三套 TypeScript 配置由缓存的 TypeScript 5.9.3 执行 `--noEmit` 均通过；全 `src` 架构边界扫描通过；变更文件没有尾随空白。没有运行 lint、全量测试、构建或真实播放器验收。
- **原则影响：** 这为 #1、#3、#6、#8、#11 和 #14 减少一处状态不变量与纯逻辑测试边界问题，但 `usePlayerPageSession` 仍拥有异步会话编排，`VideoPlayerPresenter` 仍负责跨多个播放子域协调；不得将局部状态模型视为整个播放器已符合这些原则。

## 本轮评审进度与修正（2026-10-24，按 14 项原则核验）

- **新增确认的边界问题：** usePlayerAudioTracks 直接导入 application/sessionAudioPreference.ts 的模块级可变单例。偏好并非网络/文件 I/O，但隐式共享状态不在 hook 的依赖契约中，消费者难以替换，也让用例隔离依赖全局清理。
- **本轮修正：** application/sessionAudioPreference.ts 现在只声明 SessionAudioPreferencePort；renderer 生命周期内的内存实现移到 adapters/sessionAudioPreferenceMemoryAdapter.ts，由 VideoPlayer.tsx 组合并注入。音轨 hook 不再导入实现；测试改用逐例 fake port。变更保持偏好仅在 renderer 会话内记忆的原行为。
- **原则映射：** 修正针对 #5 DIP、#8 副作用/可变状态边界和 #14 可测试性；单独窄化偏好端口也避免把记忆职责并入音轨命令接口。它不解决播放器 Presenter 的跨子域协调。
- **当前播放器评估：** VideoPlayerPresenterDependencies 当前声明 27 个能力字段。此计数只用于发现依赖跨度，不能单独作为 SRP/ISP 违规证据；实际待整改点仍是 Presenter 同时组合内核、会话、音轨、字幕/弹幕和多个控制展示模型。
- **本轮验证：** 缓存 TypeScript 5.9.3 对 main、renderer、test 三个 tsconfig 执行 --noEmit 均通过；架构边界扫描通过，规则新增禁止音轨 hook 直接导入内存适配器。定向 Vitest 因 Rolldown 可选 binding 缺失，在收集用例前启动失败；这批行为测试仍未验证。未运行 lint、生产构建或桌面验收。

## 逐项评判

判定口径：**符合**表示当前主要路径具备该原则要求；**部分符合**表示已有边界但关键路径仍违反；**明显违背**表示当前实现把职责或依赖方向放在错误层级。兼容旧协议、框架生命周期等合理约束不按“纯粹主义”要求重写。

| # | 原则 | 当前判断 | 具体证据、问题与重构方向 |
|---|---|---|---|
| 1 | 单一职责 SRP | **部分符合（P1，协调器需按责任证据继续审查）** | 蜘蛛运行时、来源、网盘、播放、订阅等装配已迁至 [`createSpiderHostServices`](src/main/spider/createSpiderHostServices.ts) 及子组合根；旧 `SpiderHost` 转发门面已删除，IPC 使用 [`MainIpcApplicationPorts`](src/main/ipc/MainIpcApplicationPorts.ts)，集成测试直接调用应用服务图。档案合并、Python 代理、单源诊断与全源体检已进入各自应用用例。`UserConfigApplicationService` 的命令共同维护一个序列化 `UserConfig` 根聚合，原子提交/回滚已下沉到 `UserConfigRepository`，并且源、档案、直播、订阅组已有消费者应用服务；仅凭其 504 行或方法数不足以证明它违反 SRP，暂不作为拆分类目标。renderer 的 [`PlayerPage.tsx`](src/renderer/pages/PlayerPage.tsx) 已收敛为组合入口，[`PlayerPageView.tsx`](src/renderer/pages/PlayerPageView.tsx) 单独负责声明式渲染；`usePlayerPageSession` 协调 hydration 与播放解析阶段，但解析/绑定/错误互斥状态由 React-free reducer 建模，历史进度和成功播放记录另有 hook/用例/端口。`VideoPlayerPresenter` 是播放器特性组合器，依赖已注入到具体 hook；仅凭文件大小、能力数或使用多个播放器子域不足以证明它违背 SRP，需继续核验它是否拥有多个独立业务策略或重复状态。HomePage 的搜索/浏览用例协调仍是更明确的审查对象；来源配置、滚动记忆和展示 JSX 已分层。 |
| 2 | 开闭 OCP | **部分符合，运行时分派已开放（P2）** | [`SpiderFactory.ts`](src/engine/spider/SpiderFactory.ts) 现在按注入的 [`SpiderRuntimeProvider`](src/engine/spider/SpiderRuntimeProvider.ts) 顺序选择实现；provider 只接受 source 和带泛型宿主能力的 `SpiderInit`，不再同时接收重复的完整 EngineHost 参数。JS/Python/JAR 默认实现集中在 built-in provider 列表中，扩展提供者可优先处理新协议而不改工厂。新增测试覆盖扩展协议、优先级、缓存和默认运行时回退。剩余限制是生产 composition root 目前仍只注册默认运行时，第三方插件发现、冲突策略与卸载生命周期尚未定义；当前扩展点不应被描述成已完成通用插件生态。 |
| 3 | 里氏替换 LSP | **部分符合（P1 契约风险）** | [`Spider.ts:55`](src/engine/spider/Spider.ts#L55) 的兼容基类仍用空串、`false`、`null`、空实现表示缺少能力；这有可能与“合法空结果”混淆。VOD 来源适配器已过滤其暴露的可选能力；本轮又将直播调用改为显式 [`SpiderLiveContentAdapter`](src/engine/spider/SpiderLiveContentAdapter.ts)，继承空实现会报 `OPERATION_UNSUPPORTED`，合法空字符串仍保持有效结果。VOD 与直播边界现在共用 `isSpiderOperationImplemented`，避免两套 stub 检测规则漂移。本轮修复了 JVM 兼容基类空桩及旧 Spider API 缺失重载被误当成功/普通错误的问题；Java runner 通过方法声明类判断实现能力，Python runner 对缺失方法发出机器可读标记，JS/Worker 保留类型化错误。JVM/Python 进程池和单次进程退出现由 `normalizeSpiderRuntimeFailure` 共用应用错误映射；三类运行时分别有缺失能力与合法空值测试。最新复核发现 Python 池对执行/排队超时会错误回退冷进程、与 JVM 语义不等价；现通过纯函数 `spiderPoolTimeoutResult` 统一两类池超时结果，避免重复启动，并以三项策略测试覆盖。播放器插件内核会话端口之前把状态订阅、命令和停止声明为可选；调用方在缺少命令时把操作当作成功空操作、缺少停止时跳过清理。本轮将 MPV/插件运行时端口分别建模并要求插件会话能力完整，删除静默降级。蜘蛛三运行时准备失败、取消、执行错误的完整 conformance matrix 仍未完成。 |
| 4 | 接口隔离 ISP | **部分符合（全仓仍需复核）** | 主进程 IPC 端口已按网盘、字幕、弹幕、元数据、直播、源目录、订阅与档案等消费者拆分，移除了多组仅转发的宿主方法；播放状态写入也使用单一 patch 端口。播放器控制器通过分组展示契约接入 View；面板协调器使用布尔命令而非要求 React `Dispatch`。本轮逐项核对 `VideoPlayerPresenterDependencies` 的 27 项能力：它们在 Presenter composition layer 分别交给偏好、内核、媒体会话、音轨、字幕、弹幕、跳过片段、DLNA、网盘绑定、窗口/键盘等具体 hook；这符合组合根汇集依赖的用途，当前没有证据显示子控制器被迫依赖整包能力。播放解析、历史恢复和窗口事件也分别消费 `PlayerPlaybackResolutionPort`、`PlayerInitHydrationPort`、`PlayerPageEventsPort`。后续 ISP 缺口应由其它端口消费者“依赖未使用能力”的实际证据确认，不能用字段数量代替。 |
| 5 | 依赖倒置 DIP | **部分符合（P1/P2）** | [`SpiderHostInfrastructurePorts.ts`](src/main/spider/SpiderHostInfrastructurePorts.ts) 现在声明 HTTP、KV、用户配置、网盘学习状态、日志、目录和凭据编解码端口；具体实现集中在 [`createDefaultSpiderHostInfrastructure.ts`](src/main/spider/createDefaultSpiderHostInfrastructure.ts)，由 [main/index.ts](src/main/index.ts) 注入。配置、字幕、弹幕、元数据、备份与订阅导入应用服务已在主进程组合根中组装；订阅用例只通过运行时端口访问蜘蛛配置。`createSpiderHostServices` 作为组合根组装蜘蛛运行时、来源、网盘、播放、直播与订阅。生产 IPC 现在只接收消费者端口；播放偏好经 `PlayerPreferencesPort` 访问，音轨用例经 `PlayerAudioTracksPort` 访问，字幕搜索记忆、服务、设置、内核命令、超分能力与档位分别经窄端口访问，localStorage/IPC/窗口 viewport 留在 adapters。本轮进一步把 Presenter 的媒体源、偏好、内核命令、MPV 查询/会话、窗口、网盘、弹幕等具体实现移到 `VideoPlayer.tsx` 组合注入，并把 `MpvStatusQueryPort` 注入内核选择 hook；修改后的静态依赖核对通过，类型与行为测试尚未重跑。服务图仍以具体服务类表达，不过它主要留在组合根与集成夹具边界。组合根选择具体适配器是合理的；后续应改进测试夹具的可替换性，并避免用该具体图类型向领域用例传递额外能力。 |
| 6 | 关注点分离 SoC | **部分符合（P1）** | 生产入口由 main/index.ts 组合具体服务，再向 IPC 注册器传入按消费者收窄的 MainIpcApplicationPorts；VOD、诊断、网盘、字幕、弹幕、元数据、直播、订阅、源与档案 IPC 直接调用对应服务。旧 SpiderHost 转发门面已从生产和测试中删除。配置应用服务协调多个配置用例，但这些用例仍写入一个序列化 UserConfig 根聚合并共同提交或回滚。renderer 播放器已分成 [VideoPlayerPresenter.ts](src/renderer/features/playback/VideoPlayerPresenter.ts)、[VideoPlayerView.tsx](src/renderer/features/playback/VideoPlayerView.tsx) 与薄入口 [VideoPlayer.tsx](src/renderer/components/VideoPlayer.tsx)。View 只接收分组状态和动作并声明式渲染；插件快捷键/命令/对话框整合已迁到 usePlayerPluginCommands；弹幕候选标签格式与查询清洗拆层，搜索 I/O 留在 renderer adapter。面板开关、互斥、悬停与浮层定位由 `usePlayerPanelSession` 整合。发现页的数据加载经窄端口注入，服务端分页追读/去重已移入 React-free 用例。Presenter 的外部播放器 fallback 现经应用用例和注入端口执行；它仍组合内核、媒体会话、字幕/弹幕、音轨和网盘绑定等能力；不能把文件搬迁等同于职责完成。HomePage 的搜索/浏览 DOM 现分离为 HomePageView 与 HomePageViewModel，异步来源会话已拆入 useHomeSourceSession；滚动 DOM 和会话记忆由 `useHomePageMemorySession` 处理；首页搜索/浏览状态协调仍由页面 presenter 承担。 |
| 7 | 端口与适配器 | **部分符合（P1）** | Spider、VOD、播放和 IPC 已有端口/适配器；文件、网络、存储和凭据依赖在主进程组合根注入。VOD 查询、诊断、网盘、字幕、弹幕、元数据、直播、源、订阅和档案 IPC 直接接入各用例的消费者端口；`createSpiderHostServices` 作为组合根创建服务。配置、字幕、弹幕、元数据、备份和订阅导入服务也在组合根创建，领域用例通过运行时端口连接蜘蛛配置。弹幕季号提取已从网络端点集合抽为独立纯领域模块 `engine/danmaku/episodeMetadata.ts`，端点模块继续重导出原 API；弹幕候选搜索现通过注入的 search、expand、memory 与 clock 端口运行，字幕搜索/记忆和播放控制亦分别有消费者端口，具体 IPC/localStorage/viewport 由 renderer adapters 提供。发现分类探索通过 `DiscoverExplorePort` 查询，分页应用用例只依赖 query port；榜单目录、预览与分类数据各有窄消费者端口。播放器外部播放 fallback 只依赖窄端口，Electron IPC/storage adapter 在组合点注入；上下文菜单复制地址也经 PlayerClipboardPort 接入浏览器剪贴板 adapter。剩余风险是部分服务图接口仍暴露具体服务类型，以及组合根/集成夹具的替身粒度还可继续收窄；测试基础设施不再调用生产默认适配器。 |
| 8 | 纯函数与副作用隔离 | **部分符合（P2）** | 搜索 reducer、配置投影、播放状态转换、字幕外观、弹幕设置、弹幕候选标签格式化、DanmakuSearchWorkflow 搜索决策和播放器菜单坐标转换已有纯逻辑；内核选择决策与 MPV 状态查询的 React 适配器分离。`toPlayerProgressRecord` 是纯投影；`persistPlayerProgress` 和 `recordOpenedPlayerEpisode` 通过窄历史端口记录/持久化，React 定时器和卸载时机留在 `usePlayerHistoryProgress`，localStorage/历史聚合 I/O 留在 adapter。页面窗口命令现由独立窗口 hook/adapter 承担，播放器设置、音轨、字幕、超分、弹幕与上下文菜单剪贴板等副作用也有各自端口与生命周期 hook；菜单定位/全局输入仍留在 React 生命周期 hook。`usePlayerPageSession` 仍协调多个异步阶段与取消代次，但解析状态已通过纯 reducer 表达；新 init 开始时现清除旧影片状态，失败时保留可重试输入。Presenter 仍混合部分模型组装与跨功能命令协调。UI 偏好的快照校验、旧 key 迁移和 key/patch 投影现位于 `uiPreferenceMapping.ts`，不触碰 IPC、DOM 或浏览器存储；副作用由 `preferenceStore` adapter 管理。HomePage 的滚动事件、滚动恢复与会话持久化现集中在 `useHomePageMemorySession`，浏览状态仍由 presenter/ref 与 adapter 协同管理。 |
| 9 | 原子设计 Atomic Design | **局部符合，尚未通过全局验收（P2）** | `components/ui` 有 Button/Card/Field/Tabs 基础控件。原 4,752 行 `global.css` 已拆成 foundation、common、player、pages、semantic tokens、components、layouts 和四个 shell 样式模块；`global.css` 现在是保持层顺序的导入清单，旧规则仍处在同一 `legacy` cascade layer，未改变规则顺序。发现专属 `BoardPreviewCard` 已归到 discovery feature 组件层，避免通用 components 反向依赖 feature application port。新增组合测试锁定导入次序；当前 src/renderer 有 32 个 CSS 文件、约 6,438 行，sidebar/pillbar shell 模块仍分别约 938/1,025 行且使用全局选择器，尚未完成按原子控件 / 组合组件 / feature 组件收敛。对比度验收按 [WCAG 2.2 SC 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum) 的文本对比要求、[SC 1.4.11](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast) 的控件/状态视觉要求和 [SC 2.4.11](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) 的焦点可见要求进行，并覆盖悬停、选中、禁用、错误、主题切换。**功能性边界与键盘焦点环现都有六套主题、四级表面的 3:1 自动对比度测试**；全局 `--focus-ring-color` 回退到已通过 AA 文本对比的 `--text-accent`，Desktop 深浅主题仍覆写为各自焦点色。`themeContrast.spec.ts` 通过 26 项；真实页面控件状态/焦点覆盖和全局 Atomic Design 收敛仍未完成。
| 10 | 组合优于继承 | **符合为主，保留协议继承** | Spider 运行时以工厂和组合适配器组装；`Spider` 继承主要是上游蜘蛛 API 兼容边界，React ErrorBoundary 继承属于框架要求。没有证据表明重写这些继承能降低耦合。新能力继续用组合端口；优先修复基类空实现带来的能力语义问题，而非仅为原则移除继承。 |
| 11 | 被动视图 / Presentation Model | **局部符合，仍需全仓验收** | 播放器 JSX 已迁至 [VideoPlayerView.tsx](src/renderer/features/playback/VideoPlayerView.tsx)，只消费分组 presentation model 并把交互委托给动作；入口 [VideoPlayer.tsx](src/renderer/components/VideoPlayer.tsx) 只组合 Presenter 与 View。各控制器以 `PlayerControlsViewModel` 对应分组作为 props 类型，展示契约不反向导入控件。字幕、弹幕和跳过片段面板发出语义命令，状态约束由 React-free reducer 应用；内核运行时发现与自动选择策略、插件命令整合已离开 Presenter；面板会话状态与交互另由 `usePlayerPanelSession` 所有。独立播放器路由也已拆成薄组合入口 [PlayerPage.tsx](src/renderer/pages/PlayerPage.tsx) 与被动 [PlayerPageView.tsx](src/renderer/pages/PlayerPageView.tsx)。HomePage 通过特征内的类型化 HomePageViewModel 驱动 passive HomePageView；滚动 lifecycle 已移出页面 presenter。Presenter 按原则本就负责展示模型与动作编排，因此“它构造整套展示模型”不等于 View 违例；全仓仍需检查其它视图是否自行执行业务策略/副作用，以及 ConfigPage 等页面的状态协调。 |
| 12 | 语义化命名 | **大体符合（仍需持续审计）** | 本轮移除了无调用者的 UserConfigManager 兼容别名，并把测试迁到 UserConfigApplicationService；MediaRuntimeManager、PluginSandboxManager、BossKeyManager 分别改为 [MediaRuntimeProvisioner](src/main/player/MediaRuntimeProvisioner.ts)、[PluginSandboxLifecycle](src/main/plugin/sandbox/PluginSandboxLifecycle.ts)、BossKeyController。源配置、档案、直播频道和订阅组现由不同应用服务承担，业务入口使用语义命名（如 addSource、deleteProfile、selectLive），不再沿用 IPC 的 cfg 前缀。当前 source 声明扫描未发现以 Manager 或 Handler 结尾的 class/interface/type；WorkerData 等协议结构仍需按真实载荷语义单独判断，不因后缀机械改名。 |
| 13 | 设计模式合理性 | **目前大体合理，避免继续堆层** | Factory、Adapter、Strategy、Reducer 和 Ports 对应运行时替换、协议差异或状态转换。`SpiderFactory` 的协议选择已改为有序 provider；`SpiderHost` 转发门面已删除，生产 IPC 注入消费者能力端口。服务图仍在组合根保留具体实现类型。不要为每个函数增加只转发的类；新增模式必须能说明替换点、生命周期所有权或测试替身收益。 |
| 14 | 可测试性 | **部分符合（P1/P2）** | 纯应用策略、状态转换、搜索协调、运行时 provider、播放面板/会话、档案激活、来源选择、设置 Presenter、详情/发现用例均有独立行为测试；`spiderHostIntegrationFixture.ts` 使用拒绝意外网络的测试替身。`usePlayerHistoryProgress.spec.tsx` 已验证五秒 checkpoint 采用最新来源/档案/剧集快照，且卸载时只写一次最终记录；`usePlayerPageSession.spec.tsx` 覆盖快速切集时丢弃过期取链结果。JS Worker 真实线程测试覆盖能力缺失、执行错误、超时、合法空值、排队取消、在途取消及 worker 丢失后重开；JVM 真实 runner 和 Python runner 分别覆盖运行时错误/缺失能力、合法空值及部分超时/取消语义。2026-10-26 增量验证：DAV 服务与解析 13 项、JS 沙箱/Worker 33 项通过，三套 TypeScript 检查通过；全量 Vitest、lint 与生产构建未在这两个增量后重跑。历史全量基线（2026-10-25）：409 个测试文件、3,566 项通过，3 个文件与 5 项跳过；不能代替当前增量后的全量验收。完整 JS/Worker/JVM/Python 准备失败、执行失败、取消、超时共同行为矩阵仍未完成；真实桌面媒体播放及 UI 验收也未完成。 |

## 第二轮复核记录（2026-10-24；后续状态以文首为准）

- 对 `src/renderer` 的 307 个 TS/TSX/JS/JSX 文件重新扫描后，发现 65 个文件导入 `api/client`。它们包含适配器、应用组合点、页面、交互组件和少数 hook；计数是导入入口数而不是确认的架构违规数。代表仍需审查的路径包括 `ConfigPage.tsx`、`PlayerPage.tsx`、`HistoryPage.tsx`、`FavoritesPage.tsx`、`PlaybackSettingsSection.tsx`、`components/SourcePicker.tsx` 和 `components/DriveBindModal.tsx`。
- `scripts/architecture-boundaries.mjs` 的 renderer 基础层规则主要限制层级和 Electron 导入；IPC client、浏览器全局与 adapter 方向的限制仍通过少数文件名映射逐条声明。因此，它能防止已登记路径回退，却不能证明其它页面/控件没有绕过端口。应先分类上述文件，再把已确认的依赖方向规则补成可复用的架构测试。
- 本轮发现播放器 Presenter 和内核选择 hook 仍有具体 renderer adapter 依赖，并已移至 `VideoPlayer.tsx` 组合点：`VideoPlayerPresenterDependencies` 接收播放器偏好、媒体源、内核命令、运行时事件、网盘绑定、MPV、窗口及弹幕等端口；`usePlayerKernelSelection` 接收 `MpvStatusQueryPort`。新增架构边界映射及 fixture 用例，禁止这些 adapter 导入回流。Presenter 的跨控制器编排仍然集中，端口注入本身不等于 SRP/Passive View 已完成。
- PlayerPage 的插件窗口控制事件此前在页面中同时完成 IPC 订阅、episode 边界决策、命令映射和 MPV 调用。现将映射抽成纯函数 `resolvePlayerWindowControl`，订阅放入 `usePlayerWindowControls`，IPC 和 MPV 命令分别通过端口适配器注入；边界规则禁止该 hook 导入 client 或 adapter。新增测试覆盖换集边界、六类命令及无效输入。PlayerPage 的取链、详情、主窗口事件和窗口命令仍直接依赖 client，所以这只是一个垂直流程拆分。
- 设置功能曾由多个可视组件直接调用 IPC。缓存清理、代理、WebDAV、老板键、插件快捷键、源管理、源诊断、插件内核及插件生命周期/面板/命令现经消费者端口访问，`ConfigPage` 作为组合点注入 renderer/browser adapters；现有源管理和诊断测试改为端口替身，并新增插件设置端口行为测试。架构边界检查禁止这些 UI 组件重新导入 client/命令执行器/主题适配器。此处记录的是上一轮快照：当时 `PlaybackSettingsSection` 仍有 IPC 直连；本轮已移除直连，但整个设置域的职责拆分与依赖审计仍未完成。
- 最新快照 main/renderer/test TypeScript、lint、架构检查、diff check 通过；受影响的源诊断、源管理、播放器设置和插件设置 4 个测试文件、15 项通过。最近一次全量 Vitest 结果是这些设置端口改动前的 354 个文件、3,221 项；真实线路播放和全窗口视觉验收未完成。

## 上一轮复核增量：播放器设置端口与组件拆分（2026-10-24）

这一节记录 Presenter 拆分之前已验证的播放器设置边界；不能外推为全仓已通过 14 项原则评审。

| 原则 | 本轮证据与仍存在的问题 | 后续重构方向 |
|---|---|---|
| 1. SRP | MPV/FFmpeg 下载生命周期在独立面板；MPV 路径/可用性在 `PlaybackCompatibilitySettingsSection`；点播与磁力外部播放器行为由 `useExternalPlayerSettings` 承担。`PlaybackSettingsSection` 仍同时加载共享偏好、处理内部播放模式、保存 M3U8 设置、展示多种子设置并组合插件设置，仍有不同变更原因。 | 把共享偏好状态/播放模式/M3U8 用例与纯展示分开；父组件只负责装配共享 settings 和子片段，不再同时写存储、生成消息和渲染各子域。 |
| 2. OCP | 播放器设置能力通过端口替换 IPC 实现；外部播放器探测仍以固定的点播/磁力两种调用表示，尚无证据需要抽象出更多策略。 | 只在确认新增播放器类型会反复修改既有控制流时引入策略/注册表；当前不要为理论扩展点增加层。 |
| 3. LSP | 本轮不改可替换运行时契约；端口替身和生产 IPC adapter 共享同一 TS 接口。 | 继续覆盖取消、失败、缺失组件等结果语义；不能让“状态未知”被当成“未安装”。 |
| 4. ISP | `PlaybackSettingsSection` 仍接收多个子域能力供组合；外部播放器 hook 只接收 `PlayerSettingsWritePort` 与发现端口，兼容播放片段只接收 settings reader/writer、MPV status 和 runtime 端口，下载面板只接收 runtime 端口与刷新动作。当前应继续审查父层是否只转交必要能力，不以 props 数量直接定为违规。 | 保持子消费者最小端口；复核父组件是否只做组合，避免它承担不需要的子域状态或让外层页面依赖内部子能力。 |
| 5. DIP | 播放设置、外部播放器、兼容播放、下载面板和对应 hooks 均不直接导入 IPC client；具体调用位于 `playbackSettingsAdapters` 并由 `ConfigPage` 注入。 | 扩展边界测试到设置余下的 UI；检查 `ConfigPage` 是否仅作组合根，不在其中加入业务规则。 |
| 6. SoC | 安装 I/O/进度、外部播放器探测/保存、MPV path/status 刷新各由独立 feature 处理；`PlaybackSettingsSection` 仍在自身完成通用偏好读取、播放模式写入、M3U8 写入和消息反馈。 | 将共享状态转换/保存流程迁入独立 presenter/controller，再让 JSX 只渲染模型并委托语义动作。 |
| 7. 端口与适配器 | 新增媒体运行时和外部播放器消费者端口；外部播放器 hook 只依赖 writer/discovery 契约。专属 IPC adapter 留在 `playbackSettingsAdapters`；架构规则禁止 hook/面板重新导入 client/adapter。 | 将相同办法用于剩余真实 I/O 消费者，同时只保留有可替换基础设施或测试收益的端口。 |
| 8. 纯函数与副作用隔离 | 安装/查询/取消及外部播放器探测/保存 I/O 已收敛到调用端口的 hook；两个 hook 仍映射面向用户的中文状态文案。 | 将安装和保存结果转成语义化结果类型，再由 presentation formatter 负责文案，避免异步控制、业务结果和本地化展示挤在同一边界。 |
| 9. 原子设计 | 下载面板已经成为独立设置片段，但本轮没有完成全局组件层级、共享控件和其它页面复用审计。 | 先识别跨页面稳定复用的基础控件，再明确设置片段/设置页等复合组件边界；不因拆文件而宣称 Atomic Design 完成。 |
| 10. 组合优于继承 | 本轮通过组合设置片段和端口完成职责拆分，没有新增继承。 | 继续通过组合注入替代实现；不为满足原则而改写上游蜘蛛 API 必需的继承。 |
| 11. 被动视图 / Presentation Model | 外部播放器、兼容播放和运行时片段已经隔离局部状态；通用 `PlaybackSettingsSection` 仍直接执行偏好 I/O 和构造本地化消息，且承担多个面板的 JSX，因此尚非被动视图。专属 hook 也仍将流程和文案映射放在一起。 | 将通用偏好输入/加载状态/可用性/反馈归 Presenter，再让视图接收显式 model 与语义动作。 |
| 12. 语义化命名 | `PlaybackCompatibilitySettingsSection`、`MediaRuntimeDownloadsSection` 与 `useExternalPlayerSettings` 描述了具体能力；`useMediaRuntimeManagement` / `MediaRuntimeManagementPort` 仍偏泛。 | 在确认它具体管理的是安装与运行状态生命周期后，按真实能力改名，避免只做机械词替换。 |
| 13. 设计模式合理性 | adapter 与端口解决 IPC 替换和测试替身问题，下载子组件拥有自己的 UI/安装生命周期，具备明确收益。 | 不继续增加仅转发的 hook/class；先以当前组件职责图判断是否真的有新的替换点。 |
| 14. 可测试性 | 新增媒体运行时 hook/下载组件、外部播放器工作流和兼容播放片段边界；播放设置/运行时/架构规则定向测试合计 3 个文件、104 项通过。覆盖 active 生命周期、进度订阅、MPV 安装/刷新失败/不可用状态、外部播放器设置和端口边界。 | 对共享偏好用例和其它设置增加不依赖 IPC 的行为测试；继续以真实行为而非文件大小作为可测试性证据。 |

本轮验证：main/renderer/test 三套 TypeScript 检查通过；全量 lint（包括架构边界和 UI lint）通过；受影响测试 3 个文件、104 项通过。没有重跑全量 Vitest、生产构建、桌面视觉验收或真实线路播放测试。

## 当前优先级

1. **P1：动态运行时契约**——JS/Worker 的缺失操作、JVM 继承空桩/缺失重载、Python 缺失方法现有明确不支持语义；继续用共享用例覆盖准备失败、取消、超时、执行错误及合法空值，并保持对外错误语义一致。不把真实线路现场可用性等同于本地单测。
2. **P1：播放编排**——VideoPlayerPresenter 仍协调多个控制器。配置方面，UserConfigApplicationService 是单一序列化根聚合协调器，仓储负责原子提交，源/档案/直播/订阅组已另有消费者服务；当前没有充分证据把它列为实际 SRP 违例，先保护共享事务不变量并观察具体变更原因。SpiderHost 已移除，测试夹具使用测试端口，少量服务图具体类型只留在组合根边界。
3. **P1：Passive View**——播放器的 JSX 已进入独立 View，Presenter 输出按媒体、播放状态、面板和动作分组的模型；跳过片段草稿现在由 ViewModel 提供并通过语义命令编辑，View 不再拼装下一份状态快照。Presenter 仍编排过多播放器能力，需继续将播放会话策略与适配器 I/O 分开。
4. **P2：Atomic Design 与对比度**——播放器倍速菜单已有 desktop 层的文字、选中、悬停和键盘焦点样式；仍需收敛全局硬编码颜色和 shell 覆盖，并对所有窗口和主题做视觉验收。
5. **持续：DIP/ISP/LSP 防退化**——扩充边界规则和同契约测试，规则只覆盖明确列出的依赖时不宣称全架构合格。

## 关键违背项与验收方向

| 严重度 | 证据 | 违反的原则 | 重构目标 |
|---|---|---|---|
| P2（观察项，不先拆） | [`UserConfigApplicationService`](src/main/store/UserConfigApplicationService.ts) 暴露多种配置命令，但源、档案、直播与订阅组都作为一个序列化 `UserConfig` 根聚合更新；原子落盘/回滚已在 `UserConfigRepository`，消费者入口也已按配置能力拆分。当前不足以单凭方法数判作 SRP 违例。 | SRP、SoC、ISP | 保留聚合一致性。只有代码证据显示某一组命令有独立变更原因、需要不同生命周期，或迫使消费者依赖无关能力时，再拆内部用例；依旧通过同一仓储原子提交并保留事务测试。 |
| P1（全仓复核中） | 当前 482 个 renderer 模块中，70 个静态导入 `api/client`：66 个 feature 模块（65 个位于 `adapters/`、1 个命名 adapter）、2 个 lib 和两个应用入口。`App.tsx` 与 `main.tsx` 是组合入口；剩余 lib 与命名 adapter 需继续逐一确认它们是否是基础设施边界，而不能按导入数量直接判违规。封面查询、快捷键列表 IPC、受限插件命令已从通用 `lib` 迁入 feature ports/adapters；页面、普通组件和布局当前无直接 client 导入。历史、收藏、存储、详情页面、插件槽位、窗口标题栏、错误边界、HomePage 与 ConfigPage 均已把视图/控制流程中的 IPC 映射迁至 feature adapters。 | SoC、DIP、Passive View、可测试性、SRP | 分类审查剩余 lib/命名 adapter/入口，保留真正的 adapter 与组合根，迁出依赖基础设施的通用状态逻辑；为并发请求、取消、listener 清理和跨窗口同步补行为证据。 |
| 已迁移（类型与静态边界检查通过，行为测试未运行） | HomePage 原先把 browse/search/drive port 实现写在页面模块，还直接读取配置/档案来源并打开网页源。现在 IPC wrappers 集中在 `homePageAdapters`，并补充 `HomeSourceSelectionPort` 与 `HomeWebSourcePort`；页面不再导入 renderer IPC client，静态边界规则禁止 client 回流。聚合结果与浏览结果 JSX 已移到 HomePageView，呈现数据通过 HomePageViewModel 传入；初次来源恢复及 profile/source/sources/focus 事件刷新现由 useHomeSourceSession 使用窄端口协调；搜索/浏览状态和用户动作仍留在 useHomePagePresenter；UI memory 经窄端口和适配器提供，因此整页 SRP/SoC 尚未完成。 | DIP、SoC、Ports & Adapters、可测试性 | 为配置/档案来源切换、过期请求丢弃、网页源启动失败与聚合搜索进度事件补行为覆盖；继续将搜索用例、结果投影和页面 DOM 协调分层。 |
| 已迁移（类型与静态边界检查通过，行为测试未运行） | HomePage、ConfigPage 原有的 renderer client 直接调用现已分别移入 `homePageAdapters`、配置快照和档案激活 adapters；对应 application ports 不依赖 React/client。静态盘点确认这两个页面均不再直接导入 `api/client`。 | DIP、SoC、Ports & Adapters、可测试性 | HomePage JSX 与类型化展示模型现已分离；配置/来源刷新、搜索/浏览状态协调仍留在 useHomePagePresenter。继续将这些流程按状态所有权拆分，保持 adapter 仅由组合点注入，不把 adapter 导入共享 UI 组件。 |
| P2（边界已迁移，行为测试待运行） | `SourcePicker.tsx` 已不再导入 renderer IPC 或配置事件；Shell 注入 `SourcePickerPort` adapter，`useSourcePickerController` 管理加载代次、错误和源/档案切换，视图保留浮层焦点、定位、过滤与计时器。当前需要确认新增跨档案/快速切换回归用例在可运行的 Vitest 环境中通过。 | SoC、DIP、端口与适配器、可测试性 | 保持 DOM 生命周期和配置事务分层；在修复依赖绑定后运行源选择 hook/component 测试，验证失败重试、同档案切源与跨档案原子切换。 |
| 已迁移（行为测试待运行） | `DriveBindModal`、`DriveLogin`、`UcTvBind` 已移除直接 IPC；`DriveBindingDialog` 组合注入凭据/网页登录/UC TV 三个端口，credential 保存/解绑、网页登录和 QR 轮询分别由控制 hook 持有异步状态。 | SoC、DIP、端口与适配器、被动视图、可测试性 | 用端口替身运行新增保存/解绑/网页登录/Token 轮询测试，并检查卸载时取消轮询与错误反馈；该路径的生产 IPC 目前只在 `driveBindingAdapter`。 |
| 已迁移（行为测试待运行） | `UpdateGate` 不再直接导入 `api/client`；`UpdateGatePort`、`updateGateAdapter`、`useUpdateGatePresenter`、纯 `presentUpdateGate` 和 `UpdateGateView` 分别承接基础设施、流程、纯展示映射与被动视图。保留检查失败放行、下载取消/重试和安装进度行为；本轮只通过类型与静态边界检查，未运行行为回归。 | SRP、SoC、DIP、纯函数隔离、Passive View、可测试性 | 为更新检查失败放行、进度阶段、下载取消、安装错误和重复触发添加端口替身行为覆盖；确保安装窗口启动失败后 busy 状态能正确恢复。 |
| 已迁移（行为测试待运行） | `HistoryPage` 由 composition root 注入 `HistoryPagePorts`；应用用例协调续播和详情，`historyPageAdapters` 负责 IPC、来源解析、localStorage、播放器窗口、对话框确认，Presenter 管理更新检查与删除/撤销/清空状态，`HistoryPageView` 只接收状态和动作。更新检测仍限批 12、并发 3，失败不误报；封面加载在组合根消费共享封面能力。行为测试尚未运行。 | SRP、SoC、DIP、纯函数隔离、Passive View、可测试性 | 用端口替身验证外部播放成功/失败及内置 fallback、最新进度、详情档案参数、清空确认、撤销快照、更新检测批次和卸载取消。 |
| 已迁移（行为测试待运行） | `FavoritesPage` 由 storage/catalog/detail/confirmation ports 组合：收藏领域记录与纯筛选/排序位于 application，localStorage 与档案/详情 IPC 留在 `favoritesPageAdapter`，Presenter 管理外部快照、编辑、删除/撤销和清空确认，View 仅消费展示状态与动作；收藏快照结构与操作含义保持不变。 | SRP、SoC、DIP、ISP、Passive View、组合、可测试性 | 用内存 port 覆盖跨窗口刷新、筛选/排序/分类、编辑保存/取消、删除撤销、清空确认、详情恢复档案失败；当前只通过类型与边界检查。 |
| 已迁移（当前类型与边界检查通过） | `StoragePage` 已拆为 WebDAV browsing port、IPC adapter、Presenter 和 passive view；路径导航、请求代次保护、加载/选择状态留在 Presenter，格式化与行渲染留在 View，页面入口组合注入。当前行为回归未运行。 | SRP、SoC、DIP、Ports & Adapters、Passive View、可测试性 | 以 fake port 覆盖目录读取、快速切路径时丢弃旧响应、文件/目录动作和读取失败；确认仍保留原有下载/播放入口语义。 |
| 已迁移（当前类型与边界检查通过） | 插件槽位拆成组合入口、`PluginSlotPort`、IPC/命令 adapter、Presenter 与声明式 `PluginSlotView`；受限插件视图模型只映射为宿主组件，点击动作委托 adapter，静态规则阻止 client、命令执行器和 adapter 回流到 view/presenter/application。当前未运行动作行为回归。 | SRP、DIP、ISP、SoC、Ports & Adapters、Passive View、可测试性 | 用 fake port 覆盖加载成功/失败、空槽、动作缺失、确认取消和动作失败投影；确保插件输出仍只能表达被允许的视图模型。 |
| 已迁移（当前类型与边界检查通过） | 窗口标题栏 IPC 已集中到 `WindowTitleBarPort` adapter，Presenter 管理应用图标/最大化状态与按钮命令，既有 `TitleBarView` 继续被动渲染；`PageErrorBoundary` 改为接收错误报告回调，IPC 报告由 diagnostics adapter 提供。未改变标题栏展示或错误恢复操作；行为测试未运行。 | SoC、DIP、Ports & Adapters、Passive View、可测试性 | 为最大化切换失败/状态同步、组件卸载期间加载以及错误报告失败添加替身覆盖；继续检查两个布局 shell 的标题栏行为一致性。 |
| 已迁移（类型与静态边界检查通过，行为测试未运行） | 配置页的合并导出原先在页面里同时管理选择状态、调用 `mergeExport`/`mergeSave`、统计去重结果并拼反馈文案。现由 `mergeAndSaveProfiles` 用例、`MergeProfileExportPort`、IPC/保存适配器、`useMergeProfileExportPresenter` 和被动 `MergeProfilesExportSection` 分担；合并结果显示在对应区块，源体检消息不再复用合并提示状态。 | SRP、SoC、DIP、ISP、Ports & Adapters、Passive View、纯函数/副作用隔离、可测试性 | 为空选择、导出失败、用户取消保存、摘要归并和成功保存路径补行为覆盖；继续将档案激活、配置快照读取和页面状态协调从 ConfigPage 的视图/组合逻辑中拆开。 |
| 已迁移（类型与静态边界检查通过，行为测试未运行） | `ConfigPage` 原先自己处理订阅组移除/上游覆盖确认、调用 IPC、刷新配置和转换错误。现为 `SubscriptionGroupManagementPort` + IPC adapter + `useSubscriptionGroupManagement`，`SubscriptionGroupsSection` 继续通过回调表达用户意图。 | SRP、ISP、DIP、SoC、Ports & Adapters、Passive View、可测试性 | 覆盖用户取消确认、删除失败/刷新失败以及两种 refresh resolution；继续把档案激活、体检与配置页面的数据装配从页面控制流程拆开。 |
| 已迁移（类型与静态边界检查通过，行为测试未运行） | 源体检/失败源清理以前由 `ConfigPage` 管理 audit 状态、批量 IPC、静默吞掉逐项删除失败、估算剩余源并改名档案。现由 `SourceHealthAuditPort`、`removeFailedSources` 用例、Presenter 和被动体检区承接；剩余数根据实际成功删除的源计算，失败项会显示，档案保存/改名失败也不会被伪报成成功。 | SRP、SoC、DIP、Ports & Adapters、Passive View、纯函数/副作用隔离、可测试性 | 覆盖全部删除成功、部分删除失败、全部删除失败、零剩余源、档案改名失败、体检失败与刷新失败；ConfigPage/HomePage 已无直接 client 依赖，后续重点改进它们的状态所有权与展示模型。 |
| 已迁移（行为测试待运行） | `SearchPanel` 组件不再导入 IPC client、localStorage 搜索历史或搜索窗口实现；推荐、历史、导航能力分别由端口声明，Presenter 管理异步请求与状态，View 管理 DOM 生命周期。保留 250ms 联想防抖、过期响应丢弃和原有键盘/浮层行为。 | SRP、SoC、ISP、DIP、Passive View、纯函数隔离、可测试性 | 用 fake recommendation/history/navigation ports 覆盖热搜失败重试、输入过期结果丢弃、回车搜索原始词、搜索记录持久化和卸载计时器清理；当前只做类型和边界检查。 |
| 已迁移（行为测试待运行） | `DiscoverDetailPage` 页面请求通过 `DiscoverDetailMetadataPort`；两个独立元数据来源用 `Promise.allSettled` 并行读取，展示层作为 `DiscoverDetailPageView` 单独声明。stale response 由 hook 请求代次处理；没有新增重试或改变缺省文本。 | SRP、SoC、DIP、端口与适配器、Passive View、纯函数隔离、可测试性 | 覆盖两来源同时成功/单侧失败、快速更换 query 时旧结果不回填、空片名跳过请求，以及 poster/简介 fallback。 |
| P1（本轮部分迁移） | `PlayerPage.tsx` 现是 session/window adapters 的组合点；`PlayerPageView.tsx` 只声明式渲染页面状态与动作。播放 init/switch 订阅在 `usePlayerPageEvents`，窗口 pin/mini/close 在 `usePlayerPageWindow`，历史来源补全与播放请求在应用用例，观看进度回写由独立 port/hook/adapter 处理。`usePlayerPageSession` 仍负责组合多个状态和过期请求决策；这些新流程尚无行为测试覆盖。 | SRP、SoC、DIP、Passive View、纯函数/副作用隔离、可测试性 | 继续核验 session hook 的状态所有权和并发取消语义，避免它变成新的万能 controller；为过期解析、详情失效回退、卸载清理和历史进度刷新加端口替身行为测试。 |
| P1 | [VideoPlayerPresenter.ts](src/renderer/features/playback/VideoPlayerPresenter.ts) 仍协调内核切换、音轨、超分、字幕/弹幕、播放会话和多个面板；播放生命周期、全局事件、瞬时命令反馈 timer 与内核画面比例同步已有专用 hook/端口。当前 27 项依赖字段体现功能跨度，但数量本身不是违例证明；真实问题是同一 Presenter 仍组合多种状态所有者、播放策略和整套控制展示模型。 | SRP、SoC、被动视图、ISP、可测试性 | 按状态所有权继续审查播放会话/内核命令、字幕与弹幕工作流及控制展示模型的边界；只在存在独立变化原因时拆 sub-presenter，每层保留窄能力，不把字段包进更大的万能对象。 |
| P2 | 全局 CSS 已按责任域拆到多个样式文件，但旧规则仍使用全局选择器，sidebar/pillbar shell 样式仍分别约 938/1,025 行；语义 token 与局部硬编码并存。 | Atomic Design、SoC、可读性 | 继续把重复基础控件迁到组件样式，把页面专属规则迁到 feature 样式，逐步减少跨 shell 特异度覆盖；验收需检查最终主题组合中的文字、焦点、禁用、浮层状态，而非只看单个控件。 |
| P1 | JS/Worker、JVM、Python 的构建与取消路径不同；现有契约测试不能代替所有运行时在同一输入/错误语义下的 conformance。 | LSP、OCP、可测试性 | 建立共享的 runtime conformance cases，明确“不支持、准备、取消、超时、执行失败、合法空值”的外部行为；具体运行时只负责适配，不改变调用者可观察语义。 |

## 本轮已落实的重构

- 聚合搜索协调器现在拥有请求去重、搜索缓存、会话级不支持来源、配置/凭据版本与失效入口；`SpiderHost` 不再分别持有这些搜索状态。
- 配置/凭据改变后，旧请求不再覆盖新缓存、污染不支持来源集合或继续推送旧进度。
- `SearchCache` 增加精确键 API，关键词大小写归一和档案/版本复合身份不再共用同一键语义。
- 封面工作流从 `renderer/lib/useCovers.ts` 迁入 covers feature；设置/海报搜索由 `CoverLookupPort` 和 IPC adapter 提供，八个既有调用点继续消费同一 hook 行为，静态边界规则禁止 hook 与应用端口回连 IPC。
- 插件快捷键从通用 `lib/pluginKeymaps` 迁入 plugins feature：快捷键过滤/匹配规则独立为无副作用应用逻辑，`PluginKeymapPort` 经 adapter 读取列表，React hook 只管理窗口 keydown 生命周期与回调，App 组合根注入 adapter。
- 插件动作执行从 `lib/pluginCommands` 拆为 `createPluginCommandRunner` 和 `PluginCommandPort`：URL/导航/主题/直播导出的决策留在应用用例，窗口、主题系统和 IPC 副作用由 adapter 实现；App 通过 Context 注入，插件槽位/设置 adapters 在基础设施边界组装。
- 首页搜索 hook 的端口从大量 React setter 收窄为语义命令：设置搜索加载/错误、清理浏览结果、恢复浏览快照、载入首页、保存搜索记忆。
- 首页搜索请求、重试、路由触发、记忆恢复与文件夹展开/退出已迁入 React-free 的 `HomeSearchWorkflow`；它只依赖应用端口，DOM 滚动恢复由页面展示命令完成，浏览器动画帧由 renderer adapter 提供。
- 首页搜索工作流输入已按 ISP 收窄，应用层不再依赖 React ref、DOM 节点或浏览器路由 hook。
- 架构边界扫描现在识别静态 CommonJS `require()`，并支持显式 source-root 参数，避免这类导入绕过分层规则或扫描路径依赖当前 shell 目录。
- 边界扫描还会阻止 `SpiderPlaybackService` 直接导入主进程网盘、网络和磁力适配器；相应违规路径已加入 `architectureBoundaries.spec.ts` 的回归覆盖。
- 蜘蛛运行时的 JS Worker、JVM 桥和 `SpiderFactory` 具体组装已从 `SpiderHost` 构造器移入 `createSpiderRuntimeAssembly`；运行时仍共享同一个 `EngineHost`，保持原有能力与生命周期。
- 来源网关、搜索就绪检查、聚合搜索调度、蜘蛛运行时生命周期和会话级来源健康状态已从 `SpiderHost` 移入 `createSpiderSourceAssembly`；搜索调度与运行时预热共用该装配创建的同一健康状态，配置变更仍通过原协调器清理实例、搜索缓存并安排预热。
- 网盘 token/UC TV 存储、凭据同步和登录适配器已移入 `createDriveAccountAssembly`；账号存储在蜘蛛运行时之前初始化，`EngineHost.driveTokens` 读取该存储，账号变更回调仍在调用时才触发。
- 网盘分享播放的云端解链适配器、百度 JVM 上下文读取、临时文件清理持久化及删除网络适配已移入 `createDriveSharePlaybackAssembly`；`SpiderHost` 只保留给播放用例使用的服务引用和网盘 Cookie 读取闭包，云盘网络/文件存储装配不再散落在主机构造器。
- 蜘蛛播放用例的组装已移入 `createSpiderPlaybackAssembly`；`SpiderPlaybackService` 的端口改为消费者拥有的窄接口，不再用 `Pick<ConcreteAdapter, ...>` 表达驱动依赖，解析器、媒体探测、磁力播放与网盘播放可以由独立替身提供。保留 `probeSelfResolveUrl` 兼容测试缝隙。
- 直播用例的字节转文本与 EPG 缓存 I/O 已移到 `createLivePlaybackAssembly`；`LivePlaybackService` 只消费标准化文本，不再直接依赖 Node `Buffer`，EPG 存储仍按首次使用懒创建。
- 当前运行 `SiteConfig` 已从 `SpiderHost` 移入 `SourceRuntimeConfiguration`；该服务统一持有配置并协调持久化配置投影、导入配置应用和依赖缓存失效。最近一次导入报告现由 `SubscriptionImportCoordinator` 持有，单仓和多仓导入共用同一协调边界；宿主保留 API 兼容方法。
- SpiderHost 集成夹具已停止调用生产 `createDefaultSpiderHostInfrastructure()`：测试中的用户配置、运行时 KV、网盘学习和网络能力由夹具内替身提供；网盘 JSON 文件只写入临时目录，默认网络端口拒绝任何意外请求。
- 订阅抓取诊断现作为 `{ text, hint }` 随各自请求返回，并由导入用例局部消费；移除了 `SpiderHost` 的 `lastConfigFetchHint` 共享可变字段，避免并发子仓请求互相覆盖诊断，也减少了配置导入用例对宿主状态的隐式依赖。
- JS 蜘蛛的分页搜索此前漏传调用方的超时预算与 `AbortSignal`，会退回固定超时且不能响应取消；现已沿用普通搜索的调用契约透传，并增加了针对运行时调用参数的回归用例。
- 字幕、弹幕与元数据服务由 main/index.ts 的组合根创建，插件能力以回调端口注入；设置备份也移出 SpiderHost，IPC 只接收 snapshot/restore 能力。该条是当时的阶段记录；后续已删除 SpiderHost 上仅转发的字幕/弹幕方法，当前结论以逐项评判和后文记录为准。
- 播放器的进度、缓冲、播放错误、内核错误、加载、直播和网速状态已移入 React-free 的 [`PlayerPlaybackPresentation.ts`](src/renderer/features/playback/application/PlayerPlaybackPresentation.ts)；HTML5/MPV 会话与媒体源准备现在通过单一 patch 端口提交状态，不再接收十个独立 React setter。纯模型有重复事件与不可变更新测试。`VideoPlayer` 仍负责跨控制器组合，因此 Passive View 只完成第一阶段。
- 播放器倍速菜单的 desktop 样式已显式设置不透明表面、主文字、已选中状态、悬停状态和 `:focus-visible` 指示，避免继承通用按钮的颜色覆盖；这只修复该菜单，不能代表全局对比度问题已清零。
- `SpiderHost` 现在只消费 `SpiderHostInfrastructurePorts`；生产 Electron/文件系统实现由 `createDefaultSpiderHostInfrastructure` 提供，主进程组合层显式注入。相关集成测试统一经由 `createSpiderHostIntegrationFixture` 构造。备份 IPC 适配器改为依赖本地窄 `BackupIpcHostPort`，架构扫描新增防止具体宿主依赖回归的规则。
- 网盘 IPC 现在直接依赖 `DriveAccountService` 的本地能力端口；`SpiderHost` 中仅被 IPC/代理使用的网盘转发方法已移除，本地代理也直接读取账号服务。相关流程已有 `DriveAccountService.spec.ts` 行为覆盖。
- 字幕、弹幕、元数据 IPC 已改为直接依赖各自领域服务的消费者窄接口；`SpiderHost` 上对应的纯转发方法已删除，路由继续在 IPC 适配器中完成输入归一与通道映射；元数据路由测试已迁移到服务语义接口。
- 配置 IPC 不再用一个包含约 30 个操作的复合端口覆盖多个用例；源、档案、订阅组、订阅导入任务和直播频道分别由独立消费者端口与注册入口承接，保持通道、参数归一和响应格式不变。
- 源、档案、直播频道、订阅组的配置用例拆成 src/main/configuration/ 下四个独立应用服务，由同目录的 createConfigurationApplicationServices 组装后从 main/index.ts 注入 SpiderHost；配置业务服务不再反向依赖蜘蛛上下文或 Electron。档案源列表与本地包引用清理均通过消费者端口提供。
- 字幕、弹幕、元数据和设置备份服务由主进程组合根创建并注入/路由；SpiderHost 不再创建这些跨域服务，也不再持有设置备份职责。备份 IPC 只接收 snapshot/restore 能力。
- SpiderHost 的磁力播放、插件扩展和订阅导入进度回调改为构造期 SpiderHostOptionalIntegrations；移除了应用创建后再向宿主写入多项可变回调的做法。订阅进度的 Electron 广播由主进程组合根提供，订阅 IPC 适配器不再修改宿主状态。
- 来源体检与单源实时诊断从 SpiderHost 的跨域方法迁入 `SourceDiagnosticsApplicationService`；服务通过目录、来源网关、HTTP、日志、时钟和超时端口工作，IPC 改为调用该用例。新增的服务测试覆盖端口调用和缺失来源时不触发 I/O；本轮仅做类型检查，行为测试尚未运行。
- 直播 IPC 已直接依赖 `LivePlaybackService` 的用例接口；宿主仅转发的直播加载、EPG、模板和导出方法已删除，IPC 回归替身随接口改名更新。
- VOD IPC 的首页、分类、详情、单源搜索已直接依赖 `SourceCatalogApplicationService`；`SpiderHost` 中仅转发这些查询的方法已删除。播放请求和聚合搜索分别通过 `SpiderPlaybackRequestService`、窄化的 `AggregateSearchRunnerPort` 接入；搜索进度仅作为单次 IPC 请求参数传递，删除了未被设置的宿主级默认回调状态。
- 播放请求的档案/来源解析、最终直链校验与诊断记录已迁入独立的 `SpiderPlaybackRequestService`；它只依赖来源解析端口、播放用例接口和诊断端口。VOD IPC 直接调用该用例，旧 `SpiderHost.play()` 多域入口已删除，集成测试改为直测用例，不再借宿主门面访问播放流程。
- 全源搜索 IPC 不再通过 `SpiderHost.searchAll()` 转发；IPC 只消费 `AggregateSearchRunnerPort.run`，健康失效仍由宿主内部通过完整协调器处理。移除了从未被调用方设置的宿主级默认进度回调，进度仅通过每次请求的回调传递。
- `SpiderHomeContentService` 不再自己读取系统时钟或创建全局定时器；`SpiderSourceAdapter` 作为运行时边界提供 deadline 端口，服务单测统一注入即时/可控时限替身。
- 备份 IPC 直接消费 `SettingsBackupService` 的 snapshot/restore 能力；`SpiderHost.settingsSnapshot()` 和 `restoreSettings()` 两个纯转发方法已删除，代理变更后的运行时复位仍作为独立窄回调提供。
- 直播蜘蛛加载不再直接调用兼容基类方法；VOD 和直播适配器共用 `isSpiderOperationImplemented` 判断兼容基类 stub 与真实 override，避免能力探测规则分叉。继承空 stub 显式解释为 `OPERATION_UNSUPPORTED`，已实现能力返回空字符串仍是合法结果；测试覆盖继承 stub、空结果和错误传播。
- 本轮按职责语义收敛命名：MediaRuntimeProvisioner、PluginSandboxLifecycle、BossKeyController、SubscriptionGroupProfilePort；移除未被代码依赖的 UserConfigManager 兼容别名，并将相关测试和注释迁到 UserConfigApplicationService。

- 本轮将播放器展示视图从原播放器文件拆到 VideoPlayerView.tsx；VideoPlayer.tsx 现在只组合 Presenter 与 View。Presenter 按媒体身份、导航、画布交互、播放状态、弹幕、上下文菜单、选集、技术面板、状态覆盖和控制条输出分组展示模型；View 不再直接调用 IPC、window.location.reload() 或持有播放控制 hook。Presenter 仍过度集中，是下一阶段整改目标。

## 本轮继续记录（2026-10-24）

- 订阅导入任务生命周期与配置导入入口从 `SpiderHost` 的跨域兼容门面迁到 `SubscriptionImportApplicationService`；IPC 通过订阅导入用例端口调用，配置 IPC 的当前来源列表与诊断报告通过独立只读端口读取。订阅服务组装、作业存储和 Electron 进度广播已迁到主进程组合根，宿主只提供蜘蛛配置运行时端口。
- 新增 `SubscriptionImportApplicationService.spec.ts` 覆盖非法地址在副作用前拒绝、保留 `#line=N` 子仓选择、配置导入默认快照及取消信号传递、自动刷新和任务释放；扩展 `configurationIpc.spec.ts` 验证 IPC 到用例服务的路由；相关宿主集成测试改为通过语义服务接口调用。
- 配置持久化边界已拆到 `UserConfigRepository`：它负责装载权威快照、维护修订号、原子落盘、失败回滚和提交后通知；`UserConfigApplicationService` 保留跨档案决策和纯转换编排。既有事务回滚行为由服务层测试覆盖。
- 本轮验证：`pnpm run typecheck`（main、renderer、test）通过；`node scripts/architecture-boundaries.mjs` 通过；`git diff --check` 通过；定向 Vitest 8 个文件、92 项测试全部通过（订阅用例与协调器、自动刷新、配置 IPC、SpiderHost 配置集成、档案命名、配置应用服务、配置事务）。


- 本轮继续重构（2026-10-24）：蜘蛛服务装配由 `createSpiderHostServices` 在主进程组合根创建；`SpiderHost` 接收只读服务图，不再承担运行时/来源/网盘/播放装配。百度分享识别移至独立工具模块，避免组合根反向导入兼容门面；档案合并导出迁到 `ProfileConfigurationApplicationService`，IPC 直接调用档案用例；Python 代理请求迁到 `PythonSourceProxyApplicationService`，主进程路由直接调用用例；移除宿主中确认无调用方的 `getSource` / `poolAliveCount` 和陈旧依赖。
- 主进程与 IPC 的生产调用路径进一步移除了 `SpiderHost`：`main/index.ts` 现在直接协调服务生命周期与网盘凭据同步，`registerIpc` 改为接收 `MainIpcApplicationPorts`，其中每个领域入口使用消费者端口。

## 本轮继续记录（2026-10-24）

- 删除已无生产调用者的 `SpiderHost` 兼容转发门面，并将配置切换、播放、订阅、网盘和档案测试改为直接经应用服务图/消费者端口运行；全源搜索测试现在实例化真实 `AggregateSearchCoordinator`，不再伪造宿主原型对象。对宿主私有 `vm`、蜘蛛工厂和诊断字段的测试访问已清除。
- `SpiderFactory` 的 JS/Python/JAR 类型分支迁入内置 `SpiderRuntimeProvider`；工厂接收有序运行时 provider，扩展协议可在不修改工厂类的情况下注册，扩展 provider 明确优先于内置协议，内置 JAR provider 保留原 fallback。新增测试验证新协议、优先级、缓存及默认运行时回退。
- 配置变更时的蜘蛛实例清理现在调用 `SpiderRuntimeLifecycle.clearSpiderInstances`，经生命周期端口到达具体缓存；依赖不再绕过运行时端口触碰实现缓存。
- 播放器网速与老板键 IPC 事件现在通过独立 renderer adapter 接入窄事件端口，再由生命周期 Hook 负责订阅、清理和最新状态转发。老板键 session 不随播放状态更新重建，因此进入时记录的音量/播放状态能跨 React 重渲染保留；测试也覆盖部分订阅失败时释放已注册 listener。
- 播放器 Presenter 不再导入或传递整体 renderer `client`：MPV session/status、内核命令、网盘凭据提示和打开绑定设置分别依赖消费者端口，client 映射在 renderer adapters；架构边界测试禁止 Presenter 再直接 import IPC client。
- CMS 搜索 deadline 通过时钟端口控制，移除了测试对真实 `Date.now()` 的精确 60,000ms 断言，避免 1ms 测试竞态。
- 蜘蛛缓存清理在清空引用时同步取消调用并释放每个唯一实例；同步销毁异常和异步拒绝经日志端口可观测，且不会中断其它实例回收。新增架构边界测试防止运行时实现分支回流至工厂。
- 首页浏览与聚合卡片的稳定事件回调改用 `useLayoutEffect` 更新 latest-ref，避免可交互卡片在 passive effect 更新旧闭包之前触发；全量回归曾复现首页推荐影片点击留在原页面，修复后通过同一集成测试。
- 上一个已完整验证基线（2026-10-24，早于最新 Presenter/LSP 边界变更）：main、renderer、test 三套 TypeScript 检查通过；架构边界检查与 `git diff --check` 通过；Vitest 通过 328 个文件（3 个条件跳过），3,054 项通过、5 项跳过。该记录只说明当时的代码快照，不作为当前快照的全量验证证据。未做真实第三方线路播放、桌面 UI、安装流程或全窗口视觉验收。

- 播放控制展示模型现在显式声明控件数据契约，不再用 `ComponentProps<typeof ConcreteControl>` 反向依赖具体渲染组件；Presenter 生成模型，控制栏按对应分组将数据传给控件；编译器校验分组契约。架构扫描新增规则，禁止展示契约重新导入具体控制组件。Presenter 仍负责组装该模型，未声称其编排职责已经拆完。
- Spider 可选能力检测已抽到共享 `isSpiderOperationImplemented`；VOD 与直播适配器共用继承 stub 判定，新增同步返回合法空串的 LSP 回归用例。
- 播放控制组件的 props 类型现在直接引用 `PlayerControlsViewModel` 对应分组，形成单一展示契约；跳过片段草稿、内核选择、超分反馈及 MPV 技术状态类型已从控件或 controller hook 移入 presentation/application 类型模块。MPV 技术状态纯映射也已从 React hook 移出，避免纯状态逻辑依赖 React 生命周期。
- 播放器内核选择和 HTML5 source 探测门控已迁到 React-free 的 `resolvePlayerKernelDecision`，覆盖 MPV 可用性未决、显式 HTML5、兼容性源自动选 MPV 与禁用 MPV 的分支；Presenter 保留资源/运行时输入采集，不再内联决定规则。

## 当前验证状态

- 当前架构结论：第一轮已按 14 项逐条评判，第二轮全仓证据追踪及整改仍在进行。旧 `SpiderHost` 门面和测试内部字段依赖已清除；蜘蛛运行时工厂新增 provider 扩展点。剩余重点是配置应用服务的用例协调边界、播放器 Presenter 的跨控制器编排、UI 到 IPC 的全仓依赖追踪、跨运行时 LSP conformance、全局样式拆分与视觉验收，以及少量服务图接口仍暴露具体实现类型的风险。配置切片目前共处单个原子持久化根聚合，不按跨聚合事务问题处理。
- 历史验证记录（旧快照）：TypeScript main/renderer/test、lint、架构边界检查曾通过；Vitest 339 个文件、3,125 项通过，3 个条件跳过文件、5 项测试跳过。该结果早于后续改动，不作为当前快照证据；更近的完整基线及数量见上方总体状态。
- 最近一次旧快照验证（不代表当前代码）：三套 TypeScript、lint、架构扫描和全量 Vitest 曾通过；具体数字见历史条目。本轮新增/拆分的边界不能沿用该结果作为行为验收。
- 当前快照验证：仓库声明的 TypeScript 7 runner 无法找到 Windows 平台 tsc.exe；本轮使用缓存 TypeScript 5.9.3 对 main、renderer、test 三套配置分别执行 `--noEmit`，均通过。全 `src` 架构边界扫描通过。针对变更文件的 Oxlint 因原生 binding access denied 且 WASI binding 缺失而无法启动。
- 当前尚未验证：本轮行为测试、完整 lint、生产构建、桌面 UI/安装验收、真实线路和播放；JS/Worker、JVM、Python 共享运行时 conformance 全矩阵，以及全窗口主题/对比度验收也仍开放。

## 本轮继续（2026-10-24）

- 播放器 Presenter 不再直接挂载 HTML5/HLS、MPV 与媒体诊断生命周期；新增 `usePlayerPlaybackSessions` 作为会话组合边界，按 HTML5、MPV 和诊断三组输入协调已有 Hook。Presenter 仍负责跨播放器功能与展示状态编排，这项拆分降低了生命周期和控制面板状态耦合，但没有把 Presenter 宣称为已完成重构。
- 架构边界扫描新增规则，禁止 `VideoPlayerPresenter` 重新直接导入底层会话及诊断 Hook；对应架构回归用例覆盖三个入口。
- 播放器 `VideoPlayerView` 之前仍从原始 props 取封面、续播位置与集序号；现在这些字段进入 Presenter 的 `media` 展示组，View 只接收模型。架构扫描器和回归测试禁止 View 重新读取 `props.*` 或依赖 `VideoPlayerProps`。
- 播放倍速菜单问题经样式级联复核：`global.css` 中较晚的非分层通用 `button` 规则优先于组件分层声明，覆盖了菜单文字与选中样式。播放器专属规则现放在该 shell reset 之后，显式提供语义文字、悬停、选中及键盘焦点样式；`playerStyleArchitecture.spec.ts` 锁定规则顺序与状态。
- 主题对比度审计在所覆盖的 6 套主题/外观配置、60 组文字与表面对比中发现 Netflix 主题 `--text-faint: #808080` 只有 3.82:1，低于普通文本 4.5:1 门槛。改为 `#a3a3a3`，新增对文字/表面及强调色文字组合的自动化检查；这仍不是整个应用每个页面、状态和弹层的视觉验收。
- 全量回归还暴露出快速订阅导入测试把剩余超时预算精确断言为 22,000ms；实现按启动后已用时间扣减预算，实测 21,999ms 符合“至多 22 秒”契约。测试现检查剩余预算大于 0 且不超过 22,000ms，避免计时竞态。
- 本轮完整 Vitest 5：330 个文件通过、3 个按条件跳过；3,079 项通过、5 项跳过。另有 main、renderer、test 三套 TypeScript 5.9.3 检查和架构边界检查通过。自动化结果不等同于实际桌面窗口的视觉或第三方播放验收。

## 本轮继续（2026-10-24）

- 播放器展示契约 `PlayerControlsViewModel` 已移除对 React `Dispatch`、`SetStateAction`、`Ref`、`ComponentProps` 与事件类型的直接依赖，改用本地结构化状态更新、元素句柄和指针坐标类型。进度条只把 `{ clientX, clientY }` 交给 Presenter，不再跨边界传递完整 React 鼠标事件；同时增加架构规则和回归用例，阻止展示契约重新导入 React。
- 当时被动视图尚未完成：部分控件仍自行拼装下一份状态对象。该具体问题已由后续跳过片段草稿命令重构处理；被动视图仍评为部分符合，因为播放器 Presenter 的跨能力协调仍过于集中，且其它控件仍有展示投影和事件归一逻辑留在组件中。
- 当前快照以缓存 TypeScript 5.9.3 编译器 API 检查 main、renderer、test 三套配置，均为 0 个诊断；当前架构边界扫描通过。由于本轮执行环境拒绝加载 `@rollup/rollup-win32-x64-msvc` 原生扩展（`ERR_DLOPEN_FAILED: Access is denied`），本轮新增的 Vitest 回归用例尚未实际运行；因此最近一次全量 Vitest 结果仍是前述基线，不代表当前快照已完成全量回归。
- 播放器内核可用性探测、插件内核发现、兼容源匹配、用户偏好解析和自动内核选择现由 `usePlayerKernelSelection` 统一拥有；`VideoPlayerPresenter` 不再直接执行 MPV 状态探测或挂载内核决策规则，控制模型只把用户选择转交给内核切换用例。架构边界新增回归规则，阻止 Presenter 重新导入内核发现 hook/决策函数。三套 TypeScript 检查与架构边界扫描均在该改动后重新通过；Vitest 因上述原生模块加载失败仍未验证本轮回归用例。
- 字幕、弹幕面板已由状态 setter 回调改为语义命令；`reduceSubtitleAppearance` 与 `reduceDanmakuSettings` 负责校验、限界和不可变状态转移，View 不再直接导入字幕查询归一化或弹幕端点合并逻辑。当前 Vitest 环境受阻，因此这些新组件回归测试尚未执行；纯 reducer 逻辑曾通过独立执行验证。
- 播放器 Presenter 不再直接读取窗口 viewport 或调用 `window.location.reload()`；对应能力位于 `PlayerWindowPort` renderer adapter，进度菜单坐标边界通过纯函数转换。新边界规则与三组坐标边界检查已加入；TypeScript 5.9.3 三配置、架构扫描通过，坐标函数用当前编译源码独立执行的 3 个边界例均通过。Vitest 回归仍受原生 Rollup 模块加载限制。
- `SpiderRuntimeProvider` 的工厂方法已从 `(source, init, host)` 收窄到 `(source, init)`；`SpiderInit` 增加宿主泛型，以在去除重复参数后仍准确表达 JS 蜘蛛所需的扩展宿主能力。边界扫描阻止 provider 契约重新导入完整 EngineHost 类型。main、renderer、test 三套 TypeScript 检查与架构扫描在修改后通过；provider Vitest 尚因原生模块加载限制未执行。
- 本轮把 4,752 行 `global.css` 按基础 token、通用页面、播放器、页面/动效、shell 基座、四种 shell、语义 token、组件层和布局层拆到 13 个 CSS 模块；旧规则仍在 `legacy` 层，导入顺序保持原级联顺序。所有模块均由 PostCSS 解析，加入全局样式组合与导入顺序测试，并迁移播放器样式架构测试和主题 token 测试读取组合样式。该步骤降低了单文件职责混杂，没有宣称原子组件样式迁移或全窗口视觉验收完成。
- 对当前 6 套主题/外观 token 重新按 5 种文本角色 × 4 种基础表面及前景/强调色计算 120 组对比度，当前抽样没有低于 4.5:1 的组合。此结果只覆盖主题 token，不覆盖组件硬编码色、透明叠层、播放器画面、悬停/禁用等所有实际渲染状态。

## 本轮继续（2026-10-24）

- 修正跳过片头/片尾面板的依赖方向：草稿类型从渲染组件移至 `application/skipSegmentsDraft.ts`，`useSkipSegmentsController` 不再导入 `SkipSegmentsControl`。
- 将草稿变更从控件拼接完整 `{ intro, outro }` 对象改成 `change-intro` / `change-outro` 语义命令；纯 reducer 在应用层维护不可变转换，控件只发送输入意图。`hasSegments` 和弹幕启用源数量也由 Presenter 投影到 ViewModel，控件不再自行计算这些业务展示状态。
- 增加 reducer 行为测试、控件命令测试和架构边界回归规则；TypeScript 5.9.3 对 main、renderer、test 三个配置检查均为 0 诊断，架构边界扫描通过。由于 Vitest 运行器仍无法加载 Rollup Windows 原生模块，本轮新增 Vitest 用例没有在 Vitest 内执行；另对 reducer 源码转译后的实现执行了 3 项直接断言。
- 这次只关闭一个明确的 Passive View / DIP / SoC 缺陷；播放器 Presenter 跨控制器协调、动态运行时 conformance 和全局样式组件化仍是未完成项。

## 本轮继续（2026-10-24）

- 将播放器插件快捷键流程（作用域键位注册、确认对话框、命令执行、结果/异常通知）从 `VideoPlayerPresenter` 提取到 `usePlayerPluginCommands`。Presenter 不再直接依赖 `usePluginKeymaps`、`runPluginCommand` 或 `useAppDialog`；播放内核命令的错误状态仍留在 Presenter，因为它由播放器内核适配器写入，属于不同的命令链路。
- 增加 Presenter 依赖边界回归和控制器测试，覆盖 player scope、宿主确认、结果通知与异常通知。
- 项目配置的 TypeScript 7 `pnpm run typecheck` 和 `pnpm run architecture:check` 均通过；定向插件控制器与架构边界测试通过（40 项）；全量 Vitest 通过 335 个文件、3 个条件跳过，3,104 项通过、5 项跳过。
- Presenter 的内核/会话/多面板编排仍未完成拆分；本项仅关闭插件命令集成这一条明确的 SoC / SRP 边界。


## 本轮继续（2026-10-24）

- 弹幕候选显示格式从引擎搜索归一模块迁至播放器 presentation/formatDanmakuCandidateLabel.ts；面板调用展示函数，控制器仅依赖 application/danmakuCandidateLabel.ts 声明的窄格式化端口，由 Presenter 注入展示实现。查询候选清洗、用户集号解析仍留在引擎查询模块。
- 季号提取从混合网络端点、候选排序的 `endpoints.ts` 抽至纯领域模块 `episodeMetadata.ts`；端点模块重导出 `seasonOf` 以保持现有调用 API。
- 架构扫描现禁止弹幕视图重新导入引擎查询归一模块；候选格式行为测试迁入单独文件。
- 当前变更后，项目 TypeScript 三套配置与架构边界扫描通过；定向测试 6 个文件、95 项通过；全量 Vitest 通过 337 个文件（3 个条件跳过），3,111 项通过、5 项跳过。

## 本轮继续记录（2026-10-24）

- 弹幕搜索策略与外部副作用完成进一步分层：`DanmakuSearchWorkflow` 通过 search、expand、memory、clock 端口执行；renderer adapter 负责 IPC 与 localStorage；控制器不再直接依赖 IPC client、localStorage 或混合职责的搜索模块。
- 增加工作流行为测试，覆盖记忆命中、目标集数选择和记忆持久化失败时仍保留结果；架构规则禁止控制器重新导入 IPC client、旧混合模块或展示实现。
- 最新代码快照：TypeScript main/renderer/test 三套检查、架构边界检查通过；定向测试 6 个文件、95 项通过；全量 Vitest 337 个文件通过（3 个条件跳过），3,111 项通过、5 项跳过。
- 新确认的 LSP 风险：JS 沙箱缺失 spider method 会抛 `OPERATION_UNSUPPORTED`，Python runner 的动态属性查找也能识别缺失；JVM 的兼容基类将首页、分类、详情、搜索、播放和直播方法都实现为空值，反射分发会调用继承桩，因此应用边界可能收到空串而不是“不支持”。需进一步检查 JVM 错误 envelope，并建立共享运行时契约后修复，当前尚未完成。


## 本轮继续记录（2026-10-24）

- 按 LSP 修复 JVM 动态蜘蛛缺失能力语义：SpiderRunner 现在确认反射方法实际由蜘蛛类层级实现，而非直接继承桌面兼容 Spider 空桩；搜索仍支持旧二参数重载，旧版 Spider 基类根本没有该重载时也返回操作不支持。
- Python runner 对缺少的蜘蛛方法抛出专用标记；JVM/Python pool envelope 与单次进程错误统一映射到 OPERATION_UNSUPPORTED。JS worker 原有缺失方法错误码保持一致；合法空字符串仍作为成功结果返回。
- 扩展真实 JVM integration fixture，验证一次性与常驻调用的合法空结果，并验证继承空桩确实返回 unsupported。真实 JVM 集成定向测试 7 项全部通过；Spider process outcome、source adapter、live adapter 和 architecture boundary 定向测试也通过。
- 修正 React 生命周期边界：HomeSearchWorkflow 不再于 render 中创建/修改可变流程对象；播放器内核从当前决策派生，事件回调最新值在 layout effect 更新；清理全量 lint 暴露的未使用声明。
- 全量 lint 和架构边界检查通过。全量 Vitest 正在针对以上最终变更复跑，最终数量以本记录后续更新为准。

## 本轮继续记录（2026-10-24）

- 将面板瞬态状态、互斥面板策略、悬停取消、浮层定位和控制条可见性整合到 `usePlayerPanelSession`。Presenter 不再单独组装这些面板生命周期，也不再在 render 阶段写 `controlsRevealRef`。
- `usePlayerPanelCoordinator` 的面板状态输入改用布尔值和 `(open: boolean) => void` 命令，不再把 React `Dispatch<SetStateAction<boolean>>` 暴露为策略接口。面板会话行为测试覆盖互斥打开、可见性维持、状态切换和最新已提交状态下的 toggle。
- 验证：`pnpm run lint`、main/renderer/test 三套 TypeScript 检查、架构边界检查通过；面板会话定向测试 3 个文件、51 项通过；运行时错误归一/JVM/JS 定向测试 5 个文件、68 项通过；全量 Vitest 339 个文件通过，3 个条件跳过，3,125 项通过、5 项跳过；Python runner unittest 6 项通过。
- 运行时契约进度：JVM 真实 runner、JS worker 和 Python runner 现在分别有缺失操作/合法空结果覆盖；JVM/Python 错误 envelope 与单次进程退出共用 `normalizeSpiderRuntimeFailure`，得到同一 `OPERATION_UNSUPPORTED` 和用户文案。准备失败、超时、取消、执行错误尚未整理成覆盖三类运行时的统一 conformance matrix。
- 整体仍为部分符合。Presenter 仍负责内核、播放会话、字幕/弹幕、音轨、网盘绑定和整体展示模型编排；CSS/组件层收敛和桌面视觉验收也未完成。

## 本轮继续记录（2026-10-24，架构端口与取消语义）

- 播放器偏好已定义纯应用模型和 `PlayerPreferencesPort`；browser localStorage 读写集中在 `playerPreferencesStorageAdapter`。`usePlayerPreferences` 仅依赖端口，架构边界测试禁止它重新依赖 browser storage 或 DOM。
- `PlaybackSettingsSection` 改为接收 `PlayerPreferencesPort`，由 `ConfigPage` 组合注入；UI 不再自行调用存储函数。播放器选项、展示模型和 HTML5/MPV session 的纯偏好类型现在直接从 application model 导入，防止展示层经基础设施模块反向取领域类型。
- 跨集音轨偏好从持久偏好模块拆出为会话状态；音轨 hook 现在通过 `PlayerAudioTracksPort` 工作。IPC 命令与 HLS.js 轨道读取/选择在 renderer adapter，Presenter 仅在组合点创建并注入 adapter。音轨行为和静态边界规则有独立测试。
- 修复蜘蛛共享 JVM/Python 进程池的取消返回：已派发操作取消时立即结束调用方等待并丢弃迟到结果，但运行中的调用仍占用并发槽直到响应/超时；不伪造底层强制中断，也不提前释放真实资源额度。测试覆盖已取消的 in-flight 请求、迟到响应、排队公平和兄弟请求存活。
- JVM/Python 进程池超时现在也保留仍在底层执行的并发槽，调用方立即得到超时结果；只有迟到响应释放槽位，或同一进程所有在途工作均超时后才回收该进程。JS Worker 活跃调用取消会立即结束调用方等待、忽略迟到结果，但保留串行 worker lane 直到真实完成/超时；排队调用可即时移除。
- 验证：`pnpm run typecheck` 通过；`pnpm run lint` 通过，含 architecture boundary 与 renderer UI lint；设置与 architecture-boundary 定向测试 2 个文件、59 项通过；运行时超时/取消定向测试通过；全量 Vitest 342 个文件通过，3 个条件跳过，3,142 项通过、5 项跳过。
- 边界：这仍是局部整改，不代表 14 项原则已满足。Presenter 仍是跨控制器协调器；JS/Worker、JVM、Python 准备失败/超时/执行失败/取消的共享契约矩阵未完成；播放器以外的一些偏好消费者仍需确认存储边界；全局颜色与组件层的全窗口视觉验收未完成。本轮未做桌面端视觉验收。

## 本轮继续记录（2026-10-24，字幕职责与依赖方向）

- `useSubtitleSearch` 不再直接读写 `localStorage` 或调用 IPC client；字幕搜索 provider、查询、下载、启用通过 `SubtitleSearchPort`，历史查询词通过独立 `SubtitleQueryMemoryPort`。浏览器存储和 renderer client 调用集中于 `subtitleSearchAdapters`，由播放器组件组合点注入。
- `useSubtitlePlayback` 的设置读写、MPV/插件内核字幕命令与 viewport 高度读取移到 `SubtitlePlaybackPort` adapter；HTML `TextTrack` 生命周期和 MPV/插件内核轨道命令分别拆到 `useHtmlSubtitleTrack` 与 `useNativeSubtitleTrack`。搜索/播放 hook 测试使用替身或真实 renderer adapter，新增静态边界测试禁止 IPC/localStorage 回流到字幕搜索 hook。
- 验证：字幕搜索/播放与架构边界定向测试 4 个文件、63 项通过；`pnpm run typecheck`、`pnpm run lint`、`git diff --check` 通过；全量 Vitest 343 个文件通过、3 个条件跳过，3,149 项通过、5 项跳过。
- 整体仍部分符合：播放器 Presenter 的跨控制器协调、全局 CSS/组件层次与完整视觉验收、运行时三类实现的统一失败/超时/取消契约矩阵，以及设置页其它 localStorage 消费者的边界审计都未完成。未打包或发布。

## 本轮继续记录（2026-10-24，聚合来源搜索边界）

- 复核发现聚合播放来源页仍有具体耦合：`useMovieSources` 同时解析全子仓搜索范围、接收 IPC 逐源进度、归并部分结果并管理重试；`MovieSourcesPanel` 直接请求网盘目录并给每条剧集补回父源身份。这违背 SoC、DIP、Ports & Adapters，也让这些行为只能通过组件加真实 client 测试。
- 将跨子仓搜索与网盘目录展开分别抽到 React-free `searchMovieSources` / `loadMovieSourceFolder` 用例；定义 `MovieSourcesSearchPort` 和 `MovieSourceFolderPort` 两个消费者接口，由 renderer adapter 调用 IPC。hook 只负责 React 生命周期、局部进度刷新节流与待初始化来源的重试；页面保留筛选/文件夹显示状态，不再直接访问 IPC client。
- 增加行为覆盖：多档案范围去重、仅接受本次查询/档案进度、无档案时回退活动档案、空配置错误、搜索后退订，以及目录展开后保持原档案/源身份。架构扫描禁止 hook 和面板直接导入 renderer client。
- 验证：main/renderer/test TypeScript 检查通过；全量 lint、架构边界和 renderer UI lint 通过；生产构建通过；应用用例、页面组件和架构边界定向测试 79 项通过；全量 Vitest 349 个文件通过、3 个条件跳过，3,180 项通过、5 项跳过。集成测试曾捕获“把目录名误传为目录 id”的回归，已修正并由目录用例与聚合入口回归测试共同锁定。
- 评判更新：#6 SoC、#7 Ports & Adapters、#8 副作用隔离、#14 可测试性各关闭一处明确耦合；整体仍“部分符合”。剩余优先项仍是 Presenter 的跨用例编排、动态运行时统一失败/取消契约、发现/详情等其它 renderer hook 的 IPC 边界，以及全局样式/多窗口主题视觉审查。

## 本轮继续记录（2026-10-24，详情用例边界）

- 详情加载 controller 原先直接读取配置、请求详情、访问 UI 记忆，并自己恢复档案/线路/集数；详情播放 controller 也直接调用 IPC 和 UI 记忆，混合播放结果解释、过期请求保护、React 状态更新及持久化。
- 新增 `loadDetailRoute` 与 `resolveDetailEpisodePlayback` 两个 React-free 应用用例，分别通过 `DetailDataPort`、`DetailPlaybackPort` 访问配置、详情、播放和选集记忆；renderer adapters 现在是这两条链路唯一 IPC/内存依赖点。控制器只保留路由响应保护、React 状态协调和 UI 回调。发现 `autoAggregateDone` 没有读者且 setter 从未被调用，移除了这组死状态。
- 行为覆盖档案选择、详情记忆恢复/失效回退、分页索引、空详情不写记忆、网盘绑定结果、失败文案和源切换期间忽略过期取链响应；架构边界阻止 detail controllers 重新导入 IPC client 或 uiMemory。
- 验证：三套 TypeScript 检查、lint、架构边界、renderer UI lint、生产构建通过；全量 Vitest 351 个文件通过、3 个条件跳过，3,191 项通过、5 项跳过。构建仍有 HLS chunk 574.41 KB 警告。
- 评判更新：#6 SoC、#7 Ports & Adapters、#8 副作用隔离、#11 被动视图的 UI/用例分工、#14 可测试性又关闭两处详情路径耦合；整体仍未完成。未解决重点是 `VideoPlayerPresenter` 跨功能编排、运行时错误/取消共同行为契约、其余 discovery/settings hooks 的 IPC/存储直连，以及样式层次和 WCAG 全窗口验收。

## 本轮继续记录（2026-10-24，发现数据边界）

- 发现页的推荐/分类 hook、分类探索 hook、榜单 hook 之前都直接导入 renderer IPC client；分类探索 hook 还负责标签查询构造、分页追读、去重、偏移上限和增量状态发布，职责混在 React 生命周期里。
- 增加消费者拥有的 `DiscoverLandingPort`、`DiscoverExplorePort`、`DiscoverBoardPort`，具体 IPC 集中在 `discoveryAdapters`，页面组合点负责注入。榜单目录和预览也分别通过窄端口读取，预览卡片不再依赖 renderer client。
- 将分类探索“补足一个 40 项 UI 批次”的多页追读、重复项归并和 500 偏移上限迁到 React-free `loadDiscoverExploreBatch`。Hook 仍负责请求代次保护、渐进发布与 React 状态，这是视图生命周期职责；筛选语义和展示投影尚未全部移出 hook。
- `pnpm run typecheck` 在本次 discovery 边界重构后通过（main/renderer/test 三个 TypeScript 配置）；`pnpm run lint`（包括架构边界和 renderer UI lint）通过；分页应用用例、发现 controller 与架构边界定向测试 3 个文件 81 项通过。没有重跑全量 Vitest 或生产构建，因此上文之前的全量测试和构建结果不代表这一最新快照。
- 静态架构规则现在禁止发现页数据 hooks、榜单目录和榜单预览卡片直接导入 renderer IPC client；具体访问统一留在 consumer adapters。
- 评判更新：此轮为 #6 SoC、#7 DIP/Ports & Adapters、#8 副作用隔离和 #14 可测试性分别关闭发现数据层的直接 IPC 依赖与分页算法混放问题。整体仍部分符合；Presenter、运行时统一契约、剩余跨特性样式/主题验收仍未完成。

## 本轮继续记录（2026-10-24，进程池超时等价性）

- 跨运行时复核发现 Python 常驻进程池将 `timeout` 与 `queue-timeout` 当作可回退的一般传输故障，随后启动一次性 Python 进程；这会把死源等待时间翻倍，并违反该方法“仅传输层失败才回退”的既定契约。JVM 分支已有不冷启动的专门语义，但两段映射此前重复实现，容易漂移。
- 新增 React/Node I/O 无关的 `spiderPoolTimeoutResult` 纯策略；JVM 与 Python 桥接都调用同一映射。执行超时保留 SPIDER_TIMEOUT 原因，排队超时也直接结束当前来源，只有进程退出/启动/写入等传输故障才回退一次性进程。
- 新增三项纯策略回归测试。最终快照 `pnpm run typecheck` 三配置、`pnpm run lint`（含架构边界和 UI lint）、`git diff --check` 通过；定向运行时测试 3 文件 28 项通过；全量 Vitest 353 个文件通过、3 个条件跳过，3,203 项通过、5 项跳过；生产构建成功。
- 该修复关闭 #3 LSP 与 #8 副作用/失败语义中的一处具体运行时漂移，但不代表三类运行时的完整 conformance matrix 已完成；播放器 Presenter、设置存储边界、全窗口视觉验收仍未完成。生产构建当前仍报告 HLS chunk 574.41 KB 与 Babel transform 耗时警告。


## 本轮继续记录（2026-10-24，外部播放 Presenter 依赖）

- Presenter 直接导入 renderer/lib/externalPlay 以调用外部播放器 fallback，越过应用用例与组合注入边界；这使 Presenter 不容易在脱离 Electron IPC/storage 的情况下验证该流程。
- 外部播放 fallback 现通过窄端口读取偏好并启动播放器；框架无关应用用例负责决定，renderer IPC/storage adapter 在 VideoPlayer 组合点注入。架构扫描禁止 Presenter 直接导入 renderer adapter。
- 最终验证：main/renderer/test 三套 TypeScript、lint（含架构边界与 UI lint）、git diff --check 通过；架构边界/外部播放定向测试 84 项通过；全量 Vitest 353 个文件、3,204 项通过，3 个条件跳过、5 项跳过；生产构建成功。
- 该修复进一步关闭 #5 DIP、#6 SoC、#7 Ports & Adapters、#14 可测试性中的一条边界问题；Presenter 仍负责编排多个播放子域，整体评估继续为“部分符合”。

## 本轮继续记录（2026-10-24，播放设置被动视图）

- `PlaybackSettingsSection` 此前还在 JSX 组件内读取本地内核偏好、加载共享播放器设置、保存播放模式和 M3U8 开关，并维护消息状态。现将这些状态与动作移到 `usePlaybackSettingsPresenter`；组件只消费 Presenter 模型、组合外部播放器/兼容播放片段并委托语义动作。子区通信传动作回调，不暴露 React state setter。
- Presenter 只通过 `PlayerPreferencesPort` 和 `PlayerSettingsPort` 访问偏好与 IPC-backed 设置，不导入 renderer client、storage adapter 或 IPC adapter。`architecture-boundaries.mjs` 加入限制，fixture 测试覆盖三种禁止依赖。
- 新增 hook 行为测试，覆盖 inactive 时不读取、deep-link 展开、模式加载/保存成功与失败、M3U8 设置保存；测试文件和变更源码通过 Babel 语法解析。
- 当前直接架构边界扫描通过。当前检查宿主提供 Node 24.22.1，而项目声明要求 Node >=26.12；pnpm 启动器引用的 Node 路径不存在，直接启动 Vitest 因 Rolldown 原生绑定初始化失败，直接 TypeScript CLI 无法找到其平台编译器入口。因此新增行为测试和类型检查未执行，lint 与全量测试也未执行；不得沿用上一节的通过结果代表当前快照。
- 评判更新：这项拆分减少 #1 SRP、#6 SoC、#8 副作用聚集、#11 被动视图的一处设置链路职责，但没有完成独立 application use case、Presenter/view model 类型化或整个设置页的职责审计。整体仍为 11 项部分符合、3 项大体符合，无全仓原则验收通过项。
- 后续优先：拆解 `VideoPlayerPresenter` 内播放生命周期与展示模型协调，审计其 17 项依赖的实际消费者归属；再分类 65 个 renderer `api/client` 导入，并对确有越层的组件增加消费者端口和边界规则。全局视觉验收、跨运行时契约和真实线路/桌面验收仍未完成。

## 本轮继续记录（2026-10-24，直播源设置边界）

- `LiveSourcesSection` 原来直接执行 `cfgSetActiveLive`、`cfgDeleteLive`、`cfgUpdateLive`，并在视图里协调确认、刷新、错误回调和编辑状态；这是已确认的 SoC/DIP/Passive View 耦合，不是从导入计数推断。
- 新增 consumer-owned `LiveSourcesManagementPort` 和单一 IPC adapter；`useLiveSourcesManagement` 负责动作编排、确认后的删除、改名归一、刷新和错误投影。视图保留表格、焦点行为和 `AppDialog` 确认 UI，通过 `ConfigPage` 组合注入端口。静态边界规则禁止 section/hook 重新依赖 renderer client 或该 adapter。
- 新增 hook 行为测试覆盖选择后刷新、取消删除、确认删除并退出同项编辑、名称 trim/空名忽略及错误处理。当前 317 个 renderer 模块有 65 个文件静态导入 `api/client`；其中 adapter 与组合根不可计作违规，待分类的页面/交互消费者仍需继续审计。
- 当前直接架构扫描通过；11 个本轮变更的源码/测试文件通过 Babel 语法解析。受运行时与原生编译器路径问题影响，当前 Presenter 与直播源 hook 测试、类型检查和 lint 均未执行；不得把新写的测试算作已通过。
- 评判更新：这次对 #1 SRP、#4 ISP、#5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用隔离、#11 被动视图和 #14 可测试性各消除了一个明确边界问题；组件仍持有少量 UI 确认/呈现职责，且完整验证未过，整体仍为部分符合。
- 后续继续：复核 `VideoPlayerPresenter` 的状态所有权与多个播放控制器协调，分类剩余 `client` 导入。主题对比度全窗口审查、Atomic Design 组件层次收敛、三类蜘蛛运行时契约矩阵和真实播放验收仍是开放事项。

## 本轮继续记录（2026-10-24，已保存档案管理边界）

- `SavedProfilesSection` 原先在渲染组件内直接通过 renderer IPC 创建、重命名和删除配置档案，同时管理输入、编辑和保存中状态。现在通过 `SavedProfilesManagementPort` 和单一 IPC adapter 执行档案操作；`useSavedProfilesManagement` 持有动作状态、空白名称归一、防重复提交、刷新和错误投影；视图只呈现模型并委托语义动作，`ConfigPage` 负责注入 adapter。
- 新增 hook 行为测试，覆盖创建名称归一及默认名、重命名 trim/空名忽略、删除后刷新、非 Error 异常映射、保存中重复提交保护。架构规则禁止视图和 hook 直接依赖 IPC client 或 concrete adapter。
- 直接架构边界扫描通过；故意在临时档案视图样例中恢复 `api/client` 导入后，规则以一条明确违规拒绝该样例，临时文件已清理。本轮 8 个改动源码/测试文件通过 Babel 语法解析。
- 当前工具链仍阻断完整验证：三个 TypeScript 配置均无法启动，仓库的 wrapper 指向不存在的 `@typescript/typescript-win32-x64/lib/tsc.exe`；定向 Vitest 在收集测试前因缺少 `@rolldown/binding-wasm32-wasi` 失败；Oxlint 的 Windows native binding 返回 `Access is denied` 且 WASI fallback 缺失。因此本轮行为测试、类型检查和 lint 均未执行成功，不能将已编写测试称为通过。
- 评判更新：针对 #1 SRP、#4 ISP、#5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用隔离、#11 被动视图和 #14 可测试性，移除配置档案视图的一处确定依赖与状态混合。它不代表 14 项原则或全仓 UI 验收完成；`ProfileSwitcher`、播放器 Presenter、剩余 renderer client 导入、跨窗口主题/对比度与运行时契约仍开放。

## 本轮继续记录（2026-10-24，档案切换依赖与事件刷新）

- `ProfileSwitcher` 原先在视图里直接加载配置、激活档案、发布 profile/source 事件、监听窗口焦点与来源变化，并管理请求代次和切换锁。现通过 `ProfileSwitcherPort` 注入配置读取、激活、事件发布与刷新订阅；具体 IPC/window event 留在 adapter，`useProfileSwitcher` 管理状态与竞态，视图保留搜索输入、聚焦和滚动行为。Shell layout 组合点负责注入。
- 档案切换事件会同步触发来源刷新订阅。控制器现在抑制自己刚发布的同步事件，并执行一次明确刷新，避免切换后同一配置被重复读取；测试模拟同步事件并断言请求次数。架构规则禁止视图/hook 直接导入 IPC client、配置事件或 adapter。
- renderer 中 `api/client` 静态导入仍为 65 个文件，因为移除视图导入同时新增了 adapter 导入；feature 导入仍为 36 个，其中 adapter 32 个，剩余 4 个 feature UI/hook 仍待实际分类。故导入数不下降不代表此边界未改善。
- 架构扫描通过；临时 fixture 将 `api/client` 导入注入 `useProfileSwitcher` 后，规则以一条违规拒绝；本轮 8 个源码/测试文件通过 Babel 语法解析。renderer TypeScript CLI仍因缺失平台 `tsc.exe` 退出；Vitest 仍在收集前因 Rolldown WASI binding 缺失而退出。新行为测试尚未执行成功，不能声称通过。
- 评判更新：针对 #1 SRP、#4 ISP、#5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用隔离、#11 被动视图和 #14 可测试性，消除档案切换路径一处确定的 UI/IPC 与事件副作用耦合。全仓架构和 UI 仍未完成；播放器 Presenter、其它直接 IPC 消费者、对比度/Atomic Design 和运行时等价契约保持开放。

## 本轮继续记录（2026-10-24，主题注册表依赖边界）

- `renderer/lib/theme.ts` 原先同时订阅 React 外部状态、操作 DOM/CSS、读写 UI 偏好并直接通过 renderer IPC 获取插件主题。现将插件主题拉取/竞态协调移到 `createPluginThemeRegistryLoader`，`PluginThemeRegistryPort` 只暴露 `fetch` 与 `synchronize`；IPC 只留在 `pluginThemeRegistryAdapter`，main 启动和设置页通过适配器触发同一加载器。
- 注册表加载器忽略迟到的旧响应；当前请求失败时保留已注册皮肤，同时仍同步当前主题。新增行为用例覆盖两种语义，架构边界 fixture 禁止主题协调用例和 `lib/theme.ts` 重新导入 IPC client。
- 当前快照验证：全 src 架构边界扫描通过；仓库 main、renderer、test 三个 TypeScript 配置使用缓存的 TypeScript 5.9.3 执行 `--noEmit` 均通过。仓库指定的 TypeScript 7 runner 仍不可用。
- 行为测试尚未运行：Vitest 在测试收集前因缺少 `@rolldown/binding-wasm32-wasi` native binding 启动失败；不能将新增主题用例称为通过。本轮未运行 lint、生产构建或桌面视觉验收。
- 评判更新：本次关闭主题插件注册链路中一处 #5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用协调和 #14 可测试性边界问题。`lib/theme.ts` 仍同时拥有 DOM 主题应用、偏好存取和 React 外部 store；这一组副作用还需继续拆分。整体 14 项原则评估仍为部分符合，播放器 Presenter、ConfigPage/HomePage 状态协调、剩余 IPC consumers、运行时契约及全窗口 UI 验收仍未完成。

## 本轮继续记录（2026-10-24，首页展示边界与搜索时钟注入）

- HomePage 原先把浏览/搜索 DOM 与路由、配置刷新、搜索协调、网盘状态和 UI memory 生命周期放在同一个 React 页面函数中。现 HomePage.tsx 只从 React Router 读取路由、组装具体适配器并渲染 HomePageView；独立的 useHomePagePresenter 输出分组 HomePageViewModel，视图只声明式渲染并委托动作。初次来源恢复及 profile/source/focus 事件已拆入 useHomeSourceSession；搜索与浏览状态、用户动作仍由 Presenter 协调，这关闭了整页 JSX/SRP 混杂的一部分，不记为整个首页流程拆分完成。
- 搜索 hook 原先直接从 rendererSearchClock 适配器取得计时器、动画帧和 wall clock。现在这些 runtime ports 从页面组合点注入 useHomeSearchController，并由架构边界规则阻止 hook 与展示模型依赖具体适配器。Presenter 对 router、browse/search/drive/source/web adapters、搜索调度器与 home-memory 的依赖均通过组合 root 注入；homePageMemoryAdapter 隔离 uiMem 的读取、patch 与持久化。
- 展示复核同时发现 fallback banner 曾由页面与 HomeBrowseResults 重复渲染；现在只保留结果视图中的一处。普通窗口的文件夹搜索返回按钮也与顶部返回操作重复；仅在隐藏搜索工具栏的搜索弹窗显示页内返回按钮。
- 当前验证：tsconfig.web.json 使用缓存 TypeScript 5.9.3 的 --noEmit 编译通过；全 src 架构边界扫描通过。没有运行行为测试、Oxlint、完整 main/test typecheck、生产构建或桌面视觉验收；不能据此声称行为兼容已通过。
- 后续仍需复核：Presenter 中搜索动作和跨浏览/搜索协调、UI memory 写入、聚合搜索 route 状态所有权。整体 14 项结论仍为部分符合。


## 本轮继续记录（2026-10-24，首页来源会话与播放器菜单视图拆分）

- HomePage 的初次配置/源恢复，以及 profile/source/sources/focus 事件刷新，现从 useHomePagePresenter 拆入 useHomeSourceSession。新 hook 接受 HomeSourceSelectionPort、HomeSourceSessionEventsPort、HomeBrowsePort、HomePageMemoryPort 和窄动作模型；window 事件名及订阅清理由 homeSourceSessionEventsAdapter 承接，静态规则禁止 hook 直接访问 window；原有配置读取代次、事件解绑、过期请求抑制、来源记忆选择、聚合搜索入口和分类页恢复路径均保留。HomePage 仍是具体 adapter 与路由的组合点，Presenter 仍负责搜索状态/动作及浏览与搜索的协调。
- PlayerContextMenu.tsx 原先同时定义 hook 状态/窗口事件/剪贴板副作用和 JSX。现在菜单组件只渲染位置、引用和语义回调；usePlayerContextMenu.ts 单独管理菜单生命周期并提供关闭、切换详情、复制地址等动作；复制文本通过 PlayerClipboardPort 与浏览器剪贴板解耦，由 VideoPlayer 组合根注入 adapter。Presenter 依赖 hook 而非 JSX 组件，架构规则禁止 VideoPlayerPresenter 重新导入菜单 view。菜单定位及全局鼠标/键盘监听仍在 hook 中，需桌面实测确认行为。
- 当前静态验证：缓存 TypeScript 5.9.3 对 tsconfig.json、tsconfig.web.json、tsconfig.test.json 执行 --noEmit 均通过；全 src 架构边界扫描通过。由于仓库声明的 TypeScript 7 runner 路径仍不可用，这不是 TypeScript 7 runner 验证。
- 本轮未运行行为测试、lint、生产构建、播放器实际播放或桌面视觉验收；不能据此声称行为兼容或 UI 已验收。没有新增行为测试。
- 评判更新：此次分别减轻 #1 SRP、#6 SoC、#7 Ports & Adapters、#8 副作用隔离、#11 被动视图和 #14 可测试性中的若干边界混合；播放器上下文菜单仍在 hook 中处理 window 定位与输入事件；HomePage Presenter 和 VideoPlayer Presenter 仍是较大的协调器。全仓评估依旧“部分符合”，其余全局 UI、运行时契约与跨页面状态边界仍待逐项处理。

## 本轮继续记录（2026-10-24，首页搜索结果展示模型不变量）

- HomePageViewModel.search 以前用 hasResults 布尔值与始终非空的 results 对象重复表达状态；Presenter 在 agg 仍为 null 时使用 agg! 构造该对象，View 虽靠布尔条件不渲染它，但契约本身允许不一致。现在 results 明确为 HomeSearchResultsModel | null，加载态单独放在 search.loading，View 只在 report 存在时渲染结果组件；移除了重复布尔值和非空断言。
- 这让 ViewModel 的状态与可渲染能力一致，关闭首页展示模型一处不安全的 LSP/Passive View 契约，而不是只调整文件结构。
- 缓存 TypeScript 5.9.3 的 main/renderer/test --noEmit 和全 src 架构边界扫描通过。没有运行行为测试、lint、生产构建或真实首页视觉验收；初始搜索、错误与重试的画面仍需运行时验证。

## 本轮继续记录（2026-10-24，播放会话基础设施端口）

- 复核发现 HTML5 与 MPV 生命周期 hook 直接调用 `lib/uiMemory` 读写续播位置；HTML5 hook 还通过 `window.api` 自行判断 Electron runtime。媒体会话因此直接知道存储实现和宿主环境，不能用纯内存替身独立验证续播策略。
- 新增最小的 `PlaybackPositionMemoryPort` 与 `PlaybackRuntimePort` 应用契约；UI memory 和桌面环境检测分别留在 renderer adapters，由 `VideoPlayer` 组合根注入。两个 hook 不再导入存储实现；注入端口也纳入生命周期 effect 的依赖项，端口替换会正确重建会话。
- HTML5 与 MPV 会话测试现注入 profile/source 隔离的内存替身，并仍断言进度恢复和保存。架构边界规则禁止两个 hook 重新导入 `uiMemory`，并禁止 HTML5 hook 直接读取 `window.api`。用临时故意违规 fixture 实际运行最新扫描器，扫描器报告两条违规；fixture 与临时扫描文件已清理。
- 最终快照用缓存的 TypeScript 5.9.3 对 main、renderer、test 三份配置执行 `--noEmit`，均为零诊断；最新架构边界扫描通过；本轮变更文件未发现行尾空白。Vitest 未能启动：当前 Node REPL 执行器拒绝导入 `node:process`，因此新增 hook 行为断言已编写但未执行；没有运行 lint、构建或桌面播放验收。
- 评判更新：这项改动关闭播放会话里一处明确的 #5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用边界与 #14 可测试性缺口。它不等同于整个播放器或全仓通过；Presenter 仍是大型多域协调器，播放器 UI 和其他页面/设置边界、完整测试及运行时验收仍待继续。

## 本轮继续记录（2026-10-24，详情滚动记忆边界）

- 复核发现 `DetailPage` 直接读写 `uiMem.detail`、在卸载时安排持久化，并把滚动监听/恢复混在页面内；其中还有读取后空操作的遗留代码。详情选择记忆同时被详情加载用例使用，滚动重构必须保留 `flag`、`ep` 与 `scrollTop` 在同一条选择记录里的写入语义。
- 将详情选择记忆抽成 `DetailSelectionMemoryPort`，详情加载适配器和滚动适配器共用同一存储实现。新增 `DetailScrollMemoryPort` 与 `useDetailScrollMemory`，由其拥有滚动监听的挂载/解绑、页面复访恢复、最新选线/集数快照写入和清理时持久化；`DetailPage` 不再导入 `uiMemory`，只接线当前 key、选线、集数、detail 变更和容器 ref。
- 新增 hook 行为用例，覆盖 detail 到达时恢复位置、滚动时保存完整选择状态以及清理时持久化。当前执行器仍拒绝 Vitest 导入 `node:process`，所以用例未执行，不能记作通过。架构扫描规则禁止 DetailPage 和 scroll hook 直接读取 UI memory/adapter；最新全仓扫描通过，临时违规 fixture 证实扫描器会拒绝播放器与详情页的三类越层依赖。
- 最新快照缓存 TypeScript 5.9.3 main/renderer/test `--noEmit` 零诊断；架构边界扫描通过；本轮变更文件无行尾空白。没有运行 lint、生产构建或桌面 UI 验收。
- 评判更新：这处理了 #1 SRP、#5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用隔离、#11 Passive View（页面不再执行存储 I/O）和 #14 可测试性中的一条具体依赖链。全仓仍未验收；代码盘点还确认 `components/AudioPlayer.tsx` 直接读写 UI memory，并把音频生命周期状态、键盘/指针交互与 JSX 放在同一组件里，这是下一处待整改点；`VideoPlayerPresenter` 的大范围跨域协调仍然开放。


## 本轮继续记录（2026-10-24，音频播放器职责与适配器边界）

- `components/AudioPlayer.tsx` 原先在一个组件中维护音频生命周期/进度/音量/循环状态、读写 `uiMemory`、访问模态全局状态、注册全局键盘与指针事件并渲染整套 UI。现将它收敛为播放器组合入口；新增 `AudioPlayerView` 被动视图、无 React 依赖的 `AudioPlayerModel`、`useAudioPlaybackSession` 会话 hook，以及续播位置、模态快捷键守卫和浏览器事件适配器。会话不再直接依赖存储、模态实现、具体 adapter 或 `window`；视图只接收展示模型并委托动作。播放进度条增加 slider 语义和方向键 5 秒步进，拖动宽度为 0 时不会产生无效 seek。
- 新增行为用例覆盖 profile/source 范围的续播读取、时间更新写入、卸载保存与暂停，以及空格/上下曲快捷键、编辑目标忽略、模态拦截和事件解绑。Vitest 本轮未执行：当前 Node REPL 加载 `vitest/node` 时被执行器明确拒绝导入 `node:process`；不得把新增用例算作已通过。
- 新增静态架构约束禁止音频入口/会话重新直接访问 `uiMemory`、`modalScope` 或具体适配器，也禁止展示视图反向依赖 hook/adapter。最新全 src 扫描通过；分别注入三类违规依赖的临时 fixture 均触发预期诊断，临时目录已清理。缓存 TypeScript 5.9.3 的 main、renderer、test 三套 `--noEmit` 检查均为零诊断。
- 本轮范围未覆盖：`useAudioPlaybackSession` 仍以 React hook 协调浏览器 `HTMLAudioElement` 生命周期；播放器 Presenter 的跨控制器职责、全窗口主题/对比度和 Atomic Design 层次仍需逐项审查。本轮没有运行桌面播放验收、lint 或构建。整体 14 项评估继续为“部分符合”，不能称为全仓完成。


## 本轮继续记录（2026-10-24，播放器快捷键运行时边界）

- `usePlayerKeyboardShortcuts` 此前直接查询 `isNativeModalOpen`、注册 `window` 的 keydown/keyup/blur 监听并创建 timeout/interval。这里同时混有快捷键决策、浏览器事件转换、模态状态和调度实现，导致 hook 不能用完全隔离的事件/时间替身测试。现新增 `PlayerKeyboardEventsPort`、`PlayerKeyboardSchedulerPort`、`PlayerKeyboardModalGuardPort`；hook 接收组合后的窄端口，真实 DOM target 检查、window 监听、计时器和模态查询集中在 `playerKeyboardShortcutsAdapter`，由 `VideoPlayer.tsx` 组合注入。保持空格、方向键、长按连播、音量、Escape、模态忽略和 blur 清理语义。
- `usePlayerKeyboardShortcuts.spec.tsx` 改用真实 browser adapter 继续覆盖原有按键行为；架构规则和 fixture 回归禁止 hook 直接依赖 modalScope、window 事件或全局 timer。全 src 架构扫描通过；模态导入、window listener、setInterval 三种违规 fixture 均各自触发预期诊断并已清理。
- 缓存 TypeScript 5.9.3 的 main、renderer、test 三套 `--noEmit` 检查均为零诊断。Vitest 本轮行为用例未执行：Node REPL 执行器拒绝导入 `node:process`；不能把已有/新增快捷键测试称作通过。没有运行播放器桌面交互验收、lint 或构建。
- 这消除了快捷键 hook 的一处 #5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用边界和 #14 可测试性缺口；调度器/事件端口还使不同运行时替换更明确，但不能据此判定 #2 OCP 全局通过。`VideoPlayerPresenter` 仍是大型编排器；当前也未验证实际键盘交互。整体 14 项评估仍为部分符合。

## 本轮继续记录（2026-10-24，跳过片段控制器依赖边界）

- useSkipSegmentsController 原先通过旧 storage facade 读写浏览器存储，直接在 window 上安装菜单外点击与 Escape 监听，查询全局模态状态并创建提示定时器；保存时间也隐含依赖 Date.now()。这让控制器同时承担状态协调和多种基础设施副作用。
- 新增 SkipSegmentsControllerPorts，将 memory、菜单关闭事件、scheduler 与 clock 作为替换端口；浏览器存储解码/跨窗口 merge、DOM 监听、模态检查、timeout 和 wall clock 集中在 skipSegmentsControllerAdapter，由 VideoPlayer.tsx 组合注入。应用纯模块持有记录归一、合并、继承与播放判据；时间戳改为显式参数。旧 renderer/lib/skipSegments.ts 已无生产引用，删除后内核 session、控制器和展示模型统一引用 playback application。
- 保留清除标记、跨窗口新旧记录取舍、模态打开时 Escape 不关闭菜单、资源/分集切换重载等语义。新增 controller fake-port 用例与存储解码用例；架构边界新增禁止具体 adapter、browser storage/window/timer/clock/console 在 hook 内回流的规则。全源码扫描通过；临时违规源验证了 storage import 和 window listener 会被规则拒绝。将纯 application TypeScript 转译后直接执行，验证了较新的显式清除标记胜过旧快照且不会继承旧设置。
- 当前快照 main、renderer、test 三个 tsconfig 使用缓存 TypeScript 5.9.3 执行 --noEmit 均为零诊断；全 src 架构边界扫描通过。Vitest 尚未运行：本机命令执行器无法启动（默认 pwsh.exe 缺失；Node REPL 子进程不可用），因此新增行为测试只算已编写和类型检查，不算通过。没有运行 lint、构建、安装或桌面播放验收。
- 本项改善 #1 SRP 的副作用边界、#4 ISP、#5 DIP、#6 SoC、#7 Ports & Adapters、#8 副作用隔离及 #14 可测试性的一条具体路径；不是全仓通过。播放器 Presenter 的跨域协调、HomePage/ConfigPage 的状态所有权、剩余 renderer lib IPC 适配职责、主题/对比度和 Atomic Design 仍待继续审查与整改。

## 本轮继续记录（2026-10-24，详情导航决策隔离）

- 详情导航曾由 renderer/lib/detailWin.ts 同时判断辅助窗口和导航模式、生成路由并直接调用 IPC。现将目标选择提取为 application/detailNavigation.ts 的纯决策函数；browser hash、偏好读取、IPC 窗口打开和实际导航分别留在 features/detail/adapters/detailWindowNavigationAdapter.ts。旧 lib/detailWin.ts 只保留兼容导出，不再导入 IPC client。
- 新增纯策略用例覆盖主窗口 inline 跳转、详情/搜索辅助窗口、window 模式和空 query；架构规则禁止详情导航 application 依赖 React、IPC client、具体 adapter 或 browser globals。当前全源码架构扫描通过；临时注入 adapter import 与 window 访问的 fixture 都被拒绝。
- 这次将 renderer/lib 直接导入 IPC client 的文件从 5 个减为 4 个；总导入数保持 70，因为具体 client 能力仍需由新命名的 feature adapter 提供。当前快照三个 tsconfig 使用缓存 TypeScript 5.9.3 检查均零诊断，19 个本轮涉及文件无尾随空白。
- 新增的 detailNavigation.spec.ts 和架构 fixture 测试尚未由 Vitest 执行；命令行进程启动受当前执行器限制。没有运行 lint、构建、桌面路由或窗口交互验收。#5 DIP、#6 SoC、#7 Ports & Adapters 和 #14 可测试性得到一处明确改善；其余 renderer lib IPC 边界、播放器 Presenter、HomePage/ConfigPage 状态协调及全局主题仍未完成。

## 本轮继续记录（2026-10-24，显示偏好与搜索窗口策略边界）

- 显示偏好原先在 `renderer/lib/displayPrefs.ts` 同时使用 React 外部 store、IPC、偏好订阅和 DOM CSS 写入。现移入 `features/display`：无 React/DOM/IPC 的 `createDisplayPreferencesSession` 负责快照、竞态保护和纯海报尺寸投影；scale 与 poster sizing 作为独立端口注入；具体 IPC、偏好读取和 CSS 写入留在 adapter；React `useSyncExternalStore` 留在 presentation hook；`main.tsx` 和设置页经 feature composition facade 连接。
- 搜索窗口原先由 `lib/searchWin.ts` 在模块加载时固定读取 `window.location.hash`，并在同一模块里做路由/偏好判断、Router 回调绑定、DOM hash 修改与 IPC 开窗。现将窗口动作判定提取为纯 `resolveSearchWindowNavigation`，路由协议判断复用 `shared/searchWin` / `shared/detailWin`；窗口 hash、偏好和 IPC 只留在 search adapter，详情页的搜索动作由 `App` 组合点注入。删除旧 lib 模块并迁移全部生产/测试引用。此举修复了窗口身份可能随路由改变而保持旧值的问题，也将开窗策略变成不启动 UI 即可替换验证的用例。
- 新增 display session、search navigation policy/adapter 和架构边界用例；扫描器现在禁止两个纯 application 反向依赖 React、IPC、DOM 或具体 adapter。用临时 fixture 确认 React/IPC/DOM 依赖会被拒绝，共享 route helpers 合法通过；临时文件已清理。
- 本快照验证：缓存 TypeScript 5.9.3 对 main、renderer、test 三份配置执行 `--noEmit` 均为零诊断；全 src 架构扫描通过；纯 search navigation policy 用当前 TS 源转译为临时 ESM 后，手工执行 6 种场景（空词、保留搜索窗口 profile/scope、inline 去除 `sw` 标记、详情窗口、新窗口回退、hash 身份变化）均符合预期；display session 也手工验证了迟到初始读取不会覆盖新事件、显式缩放更新、海报尺寸重算和 dispose；架构违规/合法 fixture 逐项运行通过。Vitest、Oxlint、生产构建和桌面/播放验收未运行；新建行为测试只完成类型检查，不记为已通过。
- renderer 当前 482 个 TS/TSX/JS/JSX 模块、70 个直接 IPC client imports：66 个在 feature（65 个在 `adapters/`、1 个命名 adapter），2 个在 `lib/`，2 个在应用组合入口。页面和普通组件保持无直接 IPC client 导入。整体评审仍是 11 项部分符合、3 项大体符合、0 项全仓验收通过；本轮改善 #1、#5、#6、#7、#8、#11、#14 的两条具体路径，不表示全局符合。播放器 Presenter、HomePage/ConfigPage 的协调状态、偏好 store 的副作用归属、样式对比度/Atomic Design、运行时 conformance、正式测试/构建与真实桌面验收仍待继续。


## 本轮评审校正与首页导航用例（2026-10-25）

- **职责校正：** 当前工作的核心是按用户给出的 14 条原则审查真实代码、区分已证实的架构违例与合理的框架/聚合边界，并据此安排重构；不能把零散 UI 修补或新增抽象层数量当作完成度。本文逐项表格是当前评判基线：11 项部分符合、3 项大体符合、0 项全仓验收通过。这个数字是静态审查结论，不代表当前版本构建、测试或运行时验收通过。
- **新增证据：** 首页浏览结果与聚合搜索结果点开后的导航决策现移到 `features/home/application/homeItemNavigation.ts`。用例对文件夹、推荐型源和普通 VOD 作互斥决策；跨档案来源元数据通过 `HomeItemSourceLookupPort` 查询；Presenter 只执行 folder/recommendation/detail 动作。新增 `tests/homeItemNavigation.spec.ts` 覆盖这三种分支与来源查询失败时的详情回退。
- **原则映射：** 这是 #1、#4、#5、#6、#7、#8、#11、#14 的局部边界改进。应用逻辑仍依赖稳定的共享模型和来源分类规则，但不依赖 React、IPC、存储或具体 adapter；无需为了“纯粹”而复制来源识别规则或再加转发层。
- **验证边界：** 此次代码改动的 TypeScript main/renderer/test `--noEmit` 与全 `src` 架构扫描在前一验证轮通过；Vitest 仍在收集用例前因缺失 `@rolldown/binding-wasm32-wasi` 启动失败，所以新增行为用例尚未由正式测试运行器执行。不能据此声称导航回归测试通过。
- **继续顺序：** 下一步先以依赖图和状态所有权审查播放器 Presenter，而不是按 701 行机械拆文件；再梳理 HomePage 搜索/浏览状态是否存在多处写入和竞态；其后审查运行时替换契约、剩余具体服务依赖，以及 Atomic Design / 对比度规则的覆盖范围。只有找到独立变化原因、状态不变量或可替换边界才拆分。


## 本轮复核：高耦合协调器与边界判定（2026-10-25）

- **播放器 Presenter（#1 SRP、#4 ISP、#6 SoC、#11 Passive View）：** 当前 `VideoPlayerPresenter.ts` 有 701 行、汇集 27 项端口能力，但逐项复核发现每项都交给具体 feature hook/adapter，控制组件也只接收 `PlayerControlsViewModel` 中的分组契约；这两点本身属于合理组合与被动展示，不构成 ISP 或 Passive View 违例。真正待证的是组合器是否持有多个彼此独立变化的策略/重复状态，而不是是否组合多个播放器功能。共享 refs 中，`handoffRef` 承接 HTML/MPV 切换时的位置与暂停状态，`liveKindRef` 镜像当前流类型，`skipSegRef` 供两内核播放会话共用；它们有跨内核不变量，拆分前必须归属到明确的播放会话状态所有者。后续只在发现独立变化原因或不变量被多处写入后拆出协调器，保留 Presenter 作为播放器组合根。
- **首页 Presenter（#1、#6、#8、#11）：** `useHomePagePresenter.ts` 仍聚合 browse/search/drive/source session、React 路由状态、结果筛选/封面投影和 view model 组装。浏览与搜索当前共用页面级 `loading/error` 是有意的展示状态复用；`browse-started` 会退出搜索态并使搜索代次失效，搜索开始则会使列表代次失效，因此不能仅凭共用 setter 判为竞态或 SRP 违例。本轮追查到的真实问题是取消后状态归还缺失：`exitSearch` / `exitFolder` 使请求代次失效后，过期请求的 `finally` 不再清 `loading`，而退出转换以前也没负责清理；同样的残留还会发生在“无源的新请求已取消旧请求后立即失败”。现由退出转换和无源失败分支显式清理忙碌和旧错误，并在 controller 行为用例中覆盖这三个路径。后续仍应以唯一写入者/状态不变量审视页面 presenter，不把互斥状态拆成平行布尔值。
- **设置页（#1、#6、#11）：** `ConfigPage.tsx` 当前主要充当组合根和页面路由容器，配置/订阅/体检/网盘等主体已下沉到 feature。它仍拥有通用错误/忙碌状态、初始快照刷新和设置锚点的 DOM MutationObserver。前两者是否应下沉要以多个 feature 是否共享同一事务/提示为判据；锚点展开属于页面表现生命周期。当前没有足够证据将整个 ConfigPage 判为 SRP 违规，也不应只按 337 行继续拆分。
- **不是违规的结构：** `components/VideoPlayer.tsx` 在组合根组装具体 renderer adapters 是依赖注入的正确方向；领域用例不能因此反向依赖这些 adapter。`Spider` 为兼容上游协议而保留的继承边界也不应仅为满足“组合优于继承”而重写；真正要修的是基类空实现与合法空结果/缺失能力的语义契约。
- **本次复核结论：** #10 的现有继承总体合理；#12 的语义命名总体可接受；#13 已有模式与替换点基本匹配，当前风险是继续堆无独立职责的 wrapper。其余原则仍按逐项表标记为部分符合/全局未验收。首页取消加载缺陷已修复并补了 3 条回归用例；尚未执行当前修改后的测试和类型检查。执行环境的 `exec_command` 仍尝试解析不存在的 `D:\develop\PowerShell\7\pwsh.exe`，NodeRepl 也被策略拒绝访问 Node 可执行文件；因此不能把此前通过的快照检查外推为本轮通过。下一步继续对播放器状态/失败取消生命周期做责任图和替换性审查，再决定是否拆协调器。

- **本轮实现：** `HomeSearchWorkflow.exitSearch` 与 `exitFolder` 在使请求代次失效时，现同步清理共享搜索忙碌/旧错误状态；“新请求先使旧请求失效、随后因没有选中源而提前返回”的分支也明确完成失败状态迁移，避免旧请求因 stale guard 跳过 finally 清理后卡住页面。新增 3 条 `useHomeSearchController` 行为回归用例，分别覆盖搜索中退出、展开文件夹中返回、无源的新请求取消旧搜索。
- **边界判定：** 浏览和搜索共用 `loading/error` 不是当前已证实的 ISP/SRP 违例：模式切换会互相失效，页面只显示一个活动工作流。实际缺陷是取消责任没有在发起取消的转换里收尾；本轮以最小变更修复，不额外造一层并行状态管理器。
- **验证状态：** 本轮新增测试未执行，类型检查也未重跑。执行器无法启动配置的 PowerShell；NodeRepl 的文件访问允许工作区编辑，但对子进程和本地可执行文件执行受限。此前快照的静态检查不能当成本轮变更的验证结果。

## 本轮继续（2026-10-25，来源切换取消状态与路由快照）

- **确认的问题：** `useHomeSourceSession` 收到 profile/source 变化后会推进浏览与搜索 generation，使旧请求不再有权写回；但 `loading` 仍由被取消请求的 `finally` 清理。generation 已过期时其 `finally` 会正确跳过，于是后续配置刷新失败就没有任何请求收尾，页面可能永久处于加载态。另一个问题是事件订阅只按页面激活/profile id 重建，原闭包会继续使用旧 `pathname` 和全档案范围，路由变化后可能误取消仍有效的全档案搜索。
- **已调整：** 来源会话通过语义动作 `clearLoading` 清理由来源变更而失效的工作流；仍在 `/search` 的全档案搜索不被清掉或推进其 generation。事件处理和异步刷新从最新的 `routeRef` 读取路由，避免为读取新 route 重建订阅并意外取消首载配置读取。Presenter 仍负责组合 React state setter，来源会话只调用注入动作。
- **回归覆盖：** 新增 `tests/useHomeSourceSession.spec.tsx` 两个场景：来源请求被取消且配置刷新失败时释放 loading；路由已切到全档案搜索后触发来源事件时保留搜索 generation/loading。
- **原则映射：** 此处改善 #6 关注点分离、#8 副作用/取消生命周期、#11 视图与会话状态边界、#14 可测试性；同时让异步路由决策基于最新展示上下文。它不是 HomePage 整体符合 SRP/Passive View 的证据。
- **验证状态：** 缓存的 TypeScript 5.9.3 编译器 API 对 `tsconfig.json`、`tsconfig.web.json`、`tsconfig.test.json` 执行无输出检查，均为 0 条诊断。检查还暴露 `useHomeSearchController.spec.tsx` 的 harness 忘记返回 `keyRef`，已补齐；随后三个配置全部 0 诊断。`pnpm exec vitest run tests/useHomeSourceSession.spec.tsx tests/playerStyleArchitecture.spec.ts` 仍无法启动：配置的 `D:\develop\PowerShell\7\pwsh.exe` 不存在，显式切换 `cmd.exe` 后执行器又报告当前目录无效；新增行为测试没有运行结果。Oxlint、生产构建与实际窗口验证也未运行，不能将静态类型通过等同于运行时通过。

## 本轮继续（2026-10-25，网盘账号标签的主题对比度）

- **确认的问题：** `DriveBindModal` 复用 Fluent UI `FluentTabList/FluentTab`，但只有 className，没有把应用主题色应用到未选中的 tab。组件默认淡灰在浅色表面上难以辨认。现有主题对比度测试验证基础文字 token 和表面组合，却不保证此第三方组件确实消费这些 token。
- **已调整：** 新增 `drive-account-cascade.css`，在 Fluent 默认样式之后为网盘 tab 应用语义文字/表面 token、48px 触控高度、明确的选中底色/前景、键盘焦点环以及窄窗口两列布局；选中时图标与文字继承同一高对比前景。保持 Fluent 的键盘 tab 语义与组件交互。
- **回归覆盖：** `playerStyleArchitecture.spec.ts` 新增断言，要求全局网盘弹窗的 tab 使用语义 token、有明显选中态和焦点环；`global.css` 在全局组件样式后导入专用覆盖层。
- **静态对比度核验：** 按 WCAG 相对亮度与 Alpha 合成复算当前 6 个主题的普通文字对 surface-2 为 15.31:1–17.58:1，选中态前景对强调色为 4.66:1–7.97:1，均达到 4.5:1。测试断言与 TypeScript 编译均不等同于 Fluent 真实 DOM / 桌面视觉验收。
- **蜘蛛替换性复核：** `SpiderSourceRuntimeAdapter` 不把继承的空 stub 暴露成能力，`SpiderLiveContentAdapter` 对缺失直播方法报 `OPERATION_UNSUPPORTED`，而显式空结果仍保留；对应测试已有覆盖。当前不因 #10 “组合优于继承”机械重写上游兼容基类。剩余工作是完整运行时 conformance matrix 和实际替换失败路径。
- **验证状态：** 本轮三个 TypeScript 配置各 0 诊断；针对新增 CSS 规则、导入顺序和 6 个主题的静态断言/对比度复算通过。Vitest、Oxlint、构建与桌面窗口验收仍未运行；原因及限制见上一节，不把静态核验记为运行时通过。

## 本轮继续（2026-10-25，设置配置快照并发所有权）

- **确认的问题：** `ConfigPage.refresh` 可由多个设置 feature 并发调用；它没有请求代次保护，先发出的慢配置读取可能在后发请求之后覆盖较新的页面配置，并额外广播来源变化。卸载中的读取也可能继续尝试更新页面状态。
- **已调整：** 新增 `useConfigurationSnapshotSession`，按请求代次只允许最新且仍挂载的读取提交配置和广播变化；`ConfigPage` 通过已有 `ConfigurationSnapshotPort` 注入配置快照适配器。设置页面继续持有错误提示、profile activation 和页面路由组合，没有把组合根误搬入领域层。
- **回归覆盖：** 新增 `useConfigurationSnapshotSession.spec.tsx`，覆盖旧请求晚到不覆盖新快照/不重复广播，以及卸载后迟到响应不提交/不广播。架构扫描新增边界，禁止该 session 直接导入 IPC client 或具体 snapshot adapter，并新增两种反例 fixture。
- **原则映射：** 修正 #6、#8 的异步写入所有权与副作用时序，改善 #7、#14 的端口替换和可重复测试边界；该 hook 不是 ConfigPage 整体被动视图重构完成的证据。
- **验证状态：** TypeScript 5.9.3 对 main、renderer、test 三配置均为 0 诊断；架构扫描器脚本语法解析为 0 诊断。Vitest 仍未能导入：NodeRepl 明确拒绝 `node:process`；shell 也无法启动/定位当前工作目录。新增行为和 architecture fixture 测试都未执行，lint、构建及桌面设置页验收未运行。

## 本轮继续（2026-10-25，蜘蛛调用结果的替换契约）

- **确认的架构缺口：** SpiderCallResult.problemCode 原先可省略，spiderCallOutput 因此在跨 JVM/Python 边界时猜测缺失错误码为 SPIDER_ERROR。更根本的问题是空字符串同时可表示合法空结果和失败的空 payload，消费者靠 reason 的真假推断结果种类；新增运行时或错误路径容易悄悄改变调用者可观察语义。
- **已重构：** 将结果改成带 ok 判别字段的联合类型：成功必须是 ok: true、空 reason 与空错误码；失败必须提供 reason 和非空 SourceProblemCode。spiderCallSucceeded / spiderCallFailed 集中构造两种结果，JVM 池、Python 池、一次性子进程和池超时都显式使用对应构造器；消费边界按 ok 判别，不再从 reason 推断结果种类。
- **回归覆盖：** 更新 JAR/Python fake runtime 与桥接器契约期望；增加相同空 payload 下“合法成功”和“蜘蛛超时”的区分检查，并确认失败传播仍携带 SPIDER_TIMEOUT。这为 #3 LSP、#6 SoC、#7 端口适配器和 #14 可测试性补强一个明确的过程运行时契约；尚未证明 JS/Worker 与 JVM/Python 的完整 conformance。
- **验证状态：** 当前 TypeScript 5.9.3 编译器 API 按三个仓库配置各加 noEmit 执行，main、renderer、test 均 0 条诊断。Vitest 未运行；本机 shell 仍无法启动配置的 pwsh，NodeRepl 对测试运行器所需的 node:process 访问受限。架构边界脚本未运行，且本轮没有新增跨层导入；不能把类型检查当作行为测试或全仓架构扫描通过。

## 本轮继续（2026-10-25，JS 蜘蛛取消信号的替换语义）

- **确认的运行时契约缺口：** `JsSpiderRuntimePort` 声明 `ensureLoaded(signal?)` 与 `callMethod(..., signal?)`，但进程内 `JsSandbox.ensureLoaded` 原先忽略参数，`callMethod` 直到脚本完成才检查取消；同一个 `signal` 在池化运行时能及时结束调用方等待。worker 沙箱丢失错误的重开分支也没有把信号传给重开和重试。另一个状态缺陷是：调用方取消等待后，已启动的 worker `open` 仍会完成，但打开状态原先只在调用方收到结果后登记，导致下一次请求可能重复加载和初始化。由此相同端口的取消行为不一致（#3 LSP），长搜索取消后也可能留下额外等待或重复工作。
- **已调整：** 新增 `awaitWithAbort`，取消只解除当前调用者的等待，不撤销其他调用共享的脚本加载任务；`JsSandbox.ensureLoaded` 和方法调用都按此语义处理。`withTimeout` 接入同一信号并在取消时立即清除自身 timer。worker 重开/重试现在继续传递原信号；worker 打开状态/风格改由真实 `open` 回执登记，后续调用可采用仍存活的沙箱，不重复加载。正在运行的脚本本身无法安全中断，也不会被伪装成已中断；它仍可能完成副作用，这与 worker 的现有执行边界一致。
- **回归覆盖：** `jsSandbox.spec.ts` 新增共享加载被单个调用取消后仍能为后续调用完成，以及运行中调用立即返回取消、底层脚本仍完成副作用两项行为用例。`jsWorkerPoolContract.spec.ts` 增加真实 worker 的取消加载后回执记账与不重复请求检查。另将实际 `awaitWithAbort` 与 `withTimeout` 实现转译到隔离临时模块直接执行：取消原因立即返回，另一个共享 waiter 仍收到结果，底层任务完成。临时模块已删除。
- **验证边界：** 当前 main、renderer、test 三套 TypeScript 5.9.3 `noEmit` 编译均 0 诊断；同一架构扫描器代码通过临时入口注入受限的 `process.argv`，对全 `src` 运行并输出 `Architecture boundaries passed.`，临时入口已删除。Vitest 仍不能启动：Node REPL 明确拒绝测试工具所需的 `node:process`，shell 工作目录也不可用；隔离 helper smoke check 不等于沙箱集成测试。未运行 lint、生产构建或桌面搜索验收。
- **原则映射与剩余工作：** 此项是 #3、#6、#7、#8、#14 的一处可证实改进，并未证明 JS/Worker/JVM/Python 的整体运行时替换矩阵通过。整体架构仍维持前述 11 项部分符合、3 项大体符合、0 项全仓验收通过；继续按真实状态所有权和替换语义整改，不以新增抽象数量计完成度。

## 本轮继续（2026-10-25，音频会话媒体 I/O 边界）

- **确认的边界问题：** `useAudioPlaybackSession` 已注入存储、键盘与模态端口，但仍直接操作 `HTMLAudioElement`，并持有进度 DOM ref 后读取布局；播放策略状态、浏览器媒体 I/O 和进度几何读取因此仍耦合在同一个 React 会话 hook 内。原测试也通过覆写 `HTMLMediaElement.prototype` 全局方法才可运行，导致会话行为难以脱离具体 DOM 媒体实现检查。
- **已重构：** 新增窄 `AudioPlaybackMediaPort`，真实媒体元素操作移至 `audioPlaybackMediaAdapter`，由 `AudioPlayer` 组合注入；hook 只持有最小结构化媒体句柄并调用端口。移除展示模型暴露的原始音频/进度 ref；进度控件只在拖动开始时读取一次 DOM bounds，并将 `{ left, width }` 传入会话。恢复位置、进度比例、相对 seek 与方向键语义移到无 I/O 的纯 application 函数；视图只委托按键并处理浏览器默认行为。
- **回归覆盖：** 音频会话测试改用 fake media port，不再全局覆写浏览器原型；新增纯用例覆盖进度范围夹取、相对 seek 边界、无效位置与可恢复剩余时长。架构边界扫描器新增规则，阻止音频会话重新引入 `HTMLAudioElement`、DOM 布局读数或直接媒体方法。
- **验证状态：** main、renderer、test 三套 TypeScript 5.9.3 `noEmit` 均 0 诊断；包含新边界规则的全 `src` 架构扫描再次输出 `Architecture boundaries passed.`。实际纯 application 模块的临时 ESM 冒烟检查覆盖中点 seek、末端夹取、恢复位置、方向键 delta 与未支持按键，结果符合预期，临时模块已删除。新增 Vitest 行为测试仍未执行，因为当前执行环境不能启动 Vitest 所需的 `node:process`；因此不将其报告为通过。未运行 lint、构建或桌面播放。
- **原则映射与剩余工作：** 本项改善 #1、#5、#6、#7、#8、#11、#14 的具体边界和可替换性；没有因此认定音频/视频整体 Passive View 或 Atomic Design 全局完成。播放器 Presenter 的会话状态所有权、媒体运行时 conformance、主题对比度覆盖与未执行的正式回归仍待继续。


## 本轮继续推进（2026-10-25，配置档案激活用例）

- **确认的问题：** `ConfigPage` 在页面里顺序编排 profile 激活、变更广播和配置刷新。它虽调用 adapter，但应用流程的先后关系仍由 React 页面掌握，使其行为难以脱离页面独立复用和验证。
- **已调整：** 新增 `activateConfigurationProfile` 应用用例，通过 `ProfileActivationPort` 和刷新回调接入副作用。页面仍保留共享忙碌/错误提示（这些状态同时协调多个设置区），只负责启动用例及展示结果；不把这描述成整个设置页已成为 Passive View。
- **回归覆盖：** 新增行为测试，检查“激活 → 广播 → 刷新”的严格顺序，以及激活失败时不广播、不刷新；架构边界测试禁止用例反向依赖 renderer IPC client、具体 adapter、React 或路由框架。
- **原则影响：** 改善 #1、#5、#6、#7、#11、#14 的应用流程隔离、依赖方向和行为可替换性；ConfigPage 仍有页面级状态协调，整体 SRP/Passive View 评估不变。
- **验证：** 缓存 TypeScript 5.9.3 API 对 main、renderer、test 三个配置执行 `noEmit`，各 0 条诊断；全 `src` 架构边界扫描通过。将实际应用用例转译为临时 ESM 后手工检查顺序和失败隔离，两项冒烟检查通过，临时文件已删除。
- **未验证：** Vitest 无法在当前 Node REPL 中加载（启动时报 `process is not defined`），所以新增行为/架构测试没有测试运行器结果；TypeScript 5.9.3 结果不等同于仓库声明的 TypeScript 7 验证。本轮未运行 lint、生产构建或桌面验收。


## 本轮继续推进（2026-10-25，播放器兼容设置的被动视图与保存语义）

- **确认的问题：** PlaybackCompatibilitySettingsSection 把 MPV 状态读取、路径保存、异步反馈和 JSX 放在同一组件。路径保存成功后若随后读取 MPV 状态失败，原有外层 catch 会误报“保存失败”，用户无法判断设置是否已写入。
- **已调整：** 新增 usePlaybackCompatibilityPresenter 管理状态读取、路径草稿、保存并发状态、安装后刷新及反馈文案；新增 PlaybackCompatibilitySettingsView，只消费 view model 与语义动作。Section 现在只组合 Presenter、被动视图和运行时下载片段。保存成功后的状态刷新异常会明确显示“已保存，但状态刷新失败”，并禁用保存期间的重复提交/编辑。
- **回归覆盖：** 新增 Presenter hook 用例，覆盖路径去空白后保存、可用性更新，以及“保存成功、状态刷新失败”的区分；架构规则阻止该 View 导入 Presenter/端口/IPC，并禁止在 View 内重新引入 React 状态或浏览器副作用。
- **原则影响：** 局部改善 #1、#6、#8、#11、#14。它没有把整个设置域变成 Passive View；共享设置状态、其他设置片段与全局 Atomic Design 仍需继续评审。
- **验证：** TypeScript 5.9.3 API 对 main、renderer、test 三套配置执行 noEmit 均为 0 诊断；全 src 架构边界扫描通过。新增 Vitest 用例尚未运行，不能报告为通过；当前 Node REPL 导入 Vitest 报 process is not defined。本轮未运行 lint、生产构建、桌面或视频播放验收。


## 本轮继续推进（2026-10-25，首页搜索状态展示契约）

- **确认的问题：** `useHomePagePresenter` 同时编排浏览/搜索/来源会话，并在其中拼接搜索进度、失败和空闲提示。尤其是搜索已空闲且尚无报告时仍显示“搜索中，请稍候…”，把未开始、来源未就绪和失败状态混为一谈。
- **已调整：** 新增纯函数 `buildHomeSearchStatusModel` 集中把搜索状态投影为顶栏和空状态文案。空闲且有关键词时显示“搜索尚未开始”，档案来源尚未就绪时显示“正在准备搜索来源”，没有关键词时给出输入提示；失败、进行中、跨档案进度及目录状态保持独立语义。Presenter 只提供状态输入并消费投影结果。
- **回归覆盖：** 新增 `homeSearchStatusModel.spec.ts`，覆盖空闲、并发进度、失败、来源准备和空关键词状态。
- **原则影响：** 改善 #6 关注点分离、#8 纯映射无副作用、#11 展示模型和 #14 脱离 React 的可测试性；没有解除 HomePage Presenter 的跨工作流协调职责，也不代表首页 SRP 完成。
- **验证：** TypeScript 5.9.3 API 对 main、renderer、test 三套配置执行 noEmit 均为 0 诊断；全 `src` 架构边界扫描通过；将展示映射转译为临时 ESM 后手动检查空闲、跨源进度、来源准备三条路径，结果符合预期，临时文件已清理。
- **未验证：** 本轮尝试运行定向 Vitest 仍因命令执行器无法进入工作区而返回“当前目录无效”；Vitest 行为用例没有运行器结果。未运行 lint、生产构建、桌面视觉验收及真实线路/播放验收；执行器限制见“总体进度”。

## 本轮继续推进（2026-10-25，MPV 状态事件与跳过策略隔离）

- **确认的问题：** usePlaybackKernelSession 同时订阅/筛选会话事件、映射展示状态、决定错误/EOF 结果，并执行进度保存与跳过片尾/片头。状态优先级和分段策略因此只能借 React hook 测试，多个引擎共用的状态语义也没有显式契约。
- **已调整：** 新增纯函数 projectMpvPlaybackEvent，将合并后的 MPV/插件内核快照转换成展示 patch、进度/画面尺寸投影、保存/跳过意图和终止状态计划；EOF 解析失败、成功结束只触发一次、错误清除自动下一集及“进程退出优先”都显式保留。新增 decideMpvSegmentSkip，把直播排除、跳过片头一次和片尾阈值一次等策略从 React hook 中移出。hook 保留事件订阅、旧 session 丢弃、port I/O、toast/seek/自动下一集副作用。
- **回归覆盖：** 新增 mpvPlaybackEventModel.spec.ts 与 mpvSegmentSkipPolicy.spec.ts，分别描述状态/cache/resolution/进度映射、错误 EOF 与正常 EOF 去重、live 不跳过、intro/outro 只触发一次等行为。新增用例尚未由 Vitest 执行。
- **已验证：** TypeScript 5.9.3 API 对 tsconfig.json、tsconfig.web.json、tsconfig.test.json 执行 noEmit 均为 0 诊断；全 src 架构边界脚本运行通过；从实际转译的纯模块做了 5 条状态/分段策略冒烟检查并清理临时目录。
- **未验证：** Vitest 运行器仍不可用；直接以工作区为 cwd 启动 shell 返回“当前目录无效”；改从允许的系统目录启动再进入工作区返回“拒绝访问”；NodeRepl 也禁止导入 Vitest 所需的 node:process。没有本轮播放器 UI/桌面运行或真实源播放的验证结果，也没有运行 lint/生产构建。
- **原则影响与边界：** 改善 #1、#6、#8、#11、#14 的责任分配、展示状态映射、副作用最小化和纯策略可测试性，并强化 #7 的应用层边界。MPV 启停/并发事件处理仍归会话 hook 所有，这是单一生命周期责任；不会因新增纯函数就将 hook 宣称为完全符合 SRP。14 项全仓整改和运行时验收仍未完成。
## 当前整体进度更新（2026-10-25）

- **目标范围：** 14 项原则已有逐项判定、代码证据和重构方向；按当前评审口径，11 项仍部分符合、3 项大体符合、没有一项达到全仓验收完成。该口径描述工作区当前架构，不代表发布版本。
- **本轮落实：** MPV/插件内核状态事件投影和跳过片段决策已成为无 React/I/O 的 application 函数，并增加纯行为用例；会话生命周期仍在 hook/port 边界。由于旧 hook 同时适用于 MPV 与插件内核，命名和端口现统一为 Playback Kernel，改动同步到消费者、架构规则与测试路径。
- **设置边界复核：** 当前 PlaybackSettingsSection 由 usePlaybackSettingsPresenter 提供共享设置模型/动作，具体 IPC 经 ConfigPage 注入的端口；它现在是组合片段的页面级壳层。旧条目中“该组件自己读写偏好”的结论属于 2026-10-24 Presenter 重构前记录，已不作为当前违规依据。
- **本轮验证：** 缓存的 TypeScript 5.9.3 对 main、renderer、test 三套配置执行 noEmit 均为 0 诊断；全 src 架构边界检查通过；直接转译实际纯模块的 5 条状态/跳段冒烟路径通过，验证临时目录已移除。
- **明确未通过/未运行：** 新增 Vitest 用例没有运行。直接以工作区为 cwd 启动 shell 返回“当前目录无效”；从 C:\Windows\System32 启动再进入工作区返回“拒绝访问”；NodeRepl 禁止加载 Vitest 依赖的 node:process；TypeScript 5.9.3 兼容检查和手工冒烟不代替测试运行器。Oxlint、生产构建、桌面视觉验收和真实来源播放均未运行。
- **下一步：** 继续核对播放器会话端口与状态 ownership、HomePage/ConfigPage 剩余状态协调、JS/Worker/JVM/Python 的运行时替换与错误/取消 conformance、Atomic Design/全主题对比度，并在可用的 Vitest 执行环境中跑新增与回归用例。


## 本轮继续：按状态所有权证据复核首页网页源（2026-10-25）

- **职责校正：** 这项工作的首要产物是对用户列出的 14 项原则逐条给出有代码依据的判断与重构方向；不能把“已经拆了几个 hook”当作评审本身，也不能只汇报编辑文件。本文件“逐项评判”中的 14 行是当前审查矩阵，整体仍是 11 项部分符合、3 项大体符合、0 项全仓验收通过。
- **确认的具体问题：** `useHomeSourceSession` 将档案/来源配置读取失败写入 `sourceError`，`useHomePagePresenter` 的网页源窗口启动也写入同一状态。网页源失败可能覆盖/清除配置错误，来源刷新也可能覆盖/清除网页启动错误。这是 #1/#6 的真实状态所有权冲突；不是由 Presenter 的行数或端口数推断出来的。
- **已调整：** 新增 `useHomeWebSource` 专管网页源打开请求、重复提交保护、忙碌状态、错误反馈以及切源/卸载后的过期响应丢弃。`HomePageViewModel` 为网页源错误与打开状态提供独立字段；视图在网页源横幅内显示启动错误并在打开中禁用按钮。档案/来源错误仍归 `useHomeSourceSession`，两个工作流不再互相写状态。
- **回归覆盖：** 新增 `useHomeWebSource.spec.tsx`，描述请求参数、端口失败反馈、切源后丢弃过期结果；`HomePageView.spec.tsx` 描述网页源错误不覆盖档案配置错误。测试文件已写入；本轮没有运行 Vitest，不能报告为行为通过。此前同一执行环境在测试 runner 启动前受限，具体限制见验证状态记录。
- **原则影响与范围：** 改善 #1、#6、#8、#11、#14 的职责、异步副作用和展示状态归属。没有因此解除 `useHomePagePresenter` 的搜索/浏览/路由协调；也没有据此改变 #2、#3、#5、#7 等运行时或依赖层结论。
- **静态验证：** 缓存 TypeScript 5.9.3 对 `tsconfig.json`、`tsconfig.web.json`、`tsconfig.test.json` 的 `noEmit` 检查均为 0 诊断；带本轮代码的全 `src` 架构边界扫描输出 `Architecture boundaries passed.`。
- **尚未验证：** 新增 Vitest 行为用例、Oxlint、生产构建、桌面视觉验收和网页源真实启动均未执行；当前类型/静态边界结果不能替代这些证据。
- **继续方向：** 下一轮继续按 14 项矩阵审查真实状态所有者和替换契约。优先补齐 `VideoPlayerPresenter` 与 `usePlayerPageSession` 的行为级替换/并发证据、JS/Worker/JVM/Python 的共享运行时 conformance，以及 Atomic Design/主题对比度的完整覆盖；不把组合根本身、继承 API 兼容层或具体文件尺寸机械判为违例。


## 本轮继续：插件播放器内核的可替换契约（2026-10-25）

- **确认的违例：** `PlaybackKernelSessionPort` 将插件内核的状态订阅、启动、命令、停止均声明为可选；`usePlaybackKernelSession` 在缺少命令时返回已解决的 `Promise`，在缺少停止时略过 teardown。于是满足该类型的对象可以被会话选择，却无法保持核心播放控制/资源生命周期语义，违反 #3 LSP，也让组合会话的实际能力边界不明确。
- **已调整：** 将 MPV 会话能力和插件内核会话能力分别声明为 `MpvPlaybackSessionPort`、`PluginPlaybackSessionPort`；`PlaybackKernelSessionPort` 表示二者完整组合。插件状态订阅、启动、命令和停止现在全部必需；会话不再用可选调用或成功空操作掩盖不完整实现。生产 adapter 已提供所有能力，测试替身也改为完整实现。
- **回归覆盖：** 既有 `usePlaybackKernelSession.spec.tsx` 的插件内核用例已覆盖专用状态通道、启动、passthrough 命令、停止及启动失败回退；测试替身的编译现强制实现完整契约。该行为测试本轮未运行。
- **原则影响：** 改善 #3 LSP、#4 ISP、#6 SoC、#7 Ports & Adapters 与 #14 可测试性。仍需验证 JS/Worker/JVM/Python 蜘蛛运行时完整替换语义；不能从本项推出所有动态运行时已符合 LSP。
- **静态验证：** TypeScript 5.9.3 对 main、renderer、test 三套配置执行 `noEmit` 均 0 诊断；全 `src` 架构边界扫描通过。
- **尚未验证：** Vitest、Oxlint、生产构建和桌面/真实插件内核播放验收未运行；编译及架构扫描不能替代插件内核行为测试。


## 本轮继续：播放器页面会话的竞态行为覆盖（2026-10-25）

- **审查结论：** `usePlayerPageSession` 通过纯 reducer 管理互斥解析展示状态，以共享代数丢弃过期取链响应，并将解析、历史来源恢复、开窗事件、历史记录和临时文件清理通过端口连接。没有仅凭 162 行或多端口就判为 SRP 违例；本轮明确缺口是没有 hook 级用例证明“快速切集后旧响应不会覆盖新集，也不会被记录为最新历史”。
- **回归覆盖：** 新增 `usePlayerPageSession.spec.tsx`：第一集取链保持挂起，切换到第二集并成功后再放回第一集旧响应；断言当前播放 URL 保持第二集、历史仅记录第二集、卸载清理临时文件。
- **原则影响：** 改善 #1（基于真实职责边界，不机械拆 session controller）、#6、#8、#11、#14；session hook 仍是播放器页面工作流协调器，后续需要进一步审查 profile/source 变化与 history progress 的可替换行为。
- **静态验证：** TypeScript 5.9.3 的 main、renderer、test 三套 `noEmit` 检查均 0 诊断。本用例未由 Vitest 执行，不能报告为行为通过。
- **尚未验证：** 快速切集 hook 行为、档案变更/详情失效竞态、历史进度定时写入及卸载、Oxlint、生产构建、播放器窗口实际播放均未运行。


## 本轮继续：运行时准备阶段的取消与并发契约（2026-10-25）

- **确认的替换差异：** JS 蜘蛛在懒加载时通过 `awaitWithAbort` 让已取消调用立即结束；JAR/Python 蜘蛛则直接等待 `ensureReady()`。聚合搜索取消若恰逢 jar 转换或 Python 脚本下载，取消信号可能被准备期吞掉；准备失败还可能以普通源错误冒泡。Python 蜘蛛也没有共享同一实例的脚本准备 Promise，并发首次请求会重复检查/下载同一脚本。这是实际调用语义和副作用并发的差异，不是基于类大小的猜测。
- **已调整：** JAR/Python 蜘蛛将准备工作提升为实例级单飞 Promise；搜索 waiter 通过 `awaitWithAbort` 单独退出，不会取消可由其它调用复用的转换/下载。取消后若准备失败，取消状态优先于准备错误；另一活跃调用仍可等待同一任务并继续执行。JAR/Python 都保留准备失败后后续重试的语义。
- **回归覆盖：** 新增 JAR 测试覆盖取消单个等待者、让共享转换继续以及后续请求复用结果；新增 Python 测试覆盖两个并发搜索只下载一次、取消旧搜索不影响当前搜索。
- **原则影响：** 改善 #3 LSP（跨运行时取消语义）、#6 SoC（调用等待与共享准备生命周期分离）、#8 副作用并发边界和 #14 可替换行为测试；运行时错误/取消/超时整体 conformance matrix 仍未完成。
- **静态验证：** 缓存 TypeScript 5.9.3 对 main、renderer、test 三个 tsconfig 执行 `noEmit`，均 0 诊断。
- **尚未验证：** 两个 Vitest 用例尚无测试运行器结果；尝试显式使用 `cmd.exe` 从工作区运行定向用例时，执行器返回“当前目录无效”。未运行 Oxlint、生产构建、完整架构脚本复跑或桌面/真实蜘蛛验收。该静态编译结果不等同于运行时行为通过。

## 本轮继续：Python 脚本加载端口与基础设施适配器（2026-10-25）

- **确认的架构违例：** `PySpider` 原本同时解释 `file://`/HTTP 地址、检查文件、计算缓存路径、下载脚本并调用 Python runner。搜索用例因此直接承担文件系统与网络副作用，无法替换脚本存储/下载实现，也不能独立验证缓存与协议调用，违反 #1、#6、#7、#8、#14。JAR 与 Python 的准备阶段对取消信号也有不同表现。
- **已重构：** 新增 engine-owned `PythonSpiderScriptPort`，表达同步就绪探测与异步脚本加载结果；新增 main-owned `PythonSpiderScriptAdapter` 集中处理 file URL、HTTP 下载、URL 哈希缓存及同 URL 并发合并。`PySpider` 只依赖窄脚本端口和 Python 运行端口，不再导入文件/路径/URL/哈希设施或直接发 HTTP；组装根注入真实适配器。缺端口的工厂配置明确降级为 `UnsupportedSpider`。后台预热仅在脚本成功解析后才准备 Python 运行时，避免源加载失败时仍触发运行时下载。
- **并发/取消契约：** 同一个 `PySpider` 的准备等待保持单飞；不同源实例通过脚本适配器按脚本 URL 合并下载。取消只让当前搜索 waiter 退出，不取消其他调用复用的下载或运行时准备。既有 JAR 适配器也使用可取消等待共享转换。
- **回归用例：** 调整 Python 蜘蛛适配层用例使用 fake script port；新增 `pythonSpiderScriptAdapter.spec.ts` 覆盖缓存命中、并发下载合并、本地 file URL、无效/缺失地址、空脚本和下载异常；Python 取消用例覆盖取消旧 waiter 后活跃搜索仍执行。测试文件已写，Vitest 本轮未能启动。
- **边界防回归：** `architecture-boundaries.mjs` 现在禁止 `PySpider` 再导入 `node:fs`、`node:path`、`node:url`、缓存哈希设施，或直接通过 `EngineHost.http` 下载脚本；`architectureBoundaries.spec.ts` 增加对应依赖反向 fixture。
- **已验证：** TypeScript 5.9.3 API 对 `tsconfig.json`、`tsconfig.web.json`、`tsconfig.test.json` 执行 `noEmit` 检查均为 0 诊断。
- **尚未验证：** Vitest 运行器未执行：工作区没有 `node_modules`，`node` 不在 Node REPL 子进程 PATH；桌面命令执行器仍尝试不存在的 `D:\develop\PowerShell\7\pwsh.exe`。架构脚本尝试从 Node REPL 导入时被宿主禁止 `node:process`，因此本轮不能声称全仓架构扫描通过。Oxlint、生产构建、JAR/Python 实际子进程和外部线路验收也未运行。
- **原则影响与范围：** 直接改善 #1、#3、#6、#7、#8、#14；新增架构断言保护该局部依赖边界。它没有完成 14 项原则的全仓整改，当前整体仍为 11 项部分符合、3 项局部大体符合、0 项全仓验收通过。

## 本轮继续：主题功能性边界对比度（2026-10-25）

- **判定依据：** 按 [WCAG 2.2 成功准则 1.4.11](https://www.w3.org/WAI/WCAG22/understanding/non-text-contrast.html)，识别控件及状态所需的视觉线索需要与相邻颜色达到至少 3:1；纯装饰分隔线不承担控件识别职责，可保留弱化样式。
- **实测问题：** 六套主题的 `--border` 在四级表面令牌上有低于 3:1 的组合；最低约 1.05:1（Netflix 深色卡片表面），Bilibili / Apple / Douban 浅色主题也在约 1.16–1.32:1。该 `--border` 被基础输入框、卡片和多处可交互面板复用，因此会让控件边界难以辨认；`--border-soft` 与 `--hairline` 主要作为低强调装饰线，未按功能边界强制提亮。
- **已调整：** 提高 Netflix、Bilibili、Apple、Douban、Desktop 深色与 Desktop 浅色六套主题的 `--border`，并保持 `--border-soft` / `--hairline` 的装饰职责。新值在每套主题四级表面上的最低对比比分别为 3.10、3.98、3.92、3.84、3.49、3.32:1。
- **防回归：** `themeContrast.spec.ts` 将语义文本色 `--text-accent-secondary`、`--text-danger`、`--text-warn`、`--text-success` 纳入 4.5:1 AA 检查，并验证每套主题的 `--border` 在全部基础表面至少 3:1。
- **静态核验：** 依照该测试中的 Alpha 合成和相对亮度公式逐主题复算，九类文字令牌最低 4.92:1、功能边界最低 3.10:1，且六套主题均提供所需语义文本令牌。TypeScript 5.9.3 API 对 main、renderer、test 三套 tsconfig 的 `noEmit` 均为 0 诊断。
- **尚未验证：** Vitest 测试运行器、完整 UI 组件状态/焦点覆盖、Oxlint、生产构建和桌面实机视觉检查未运行。公式复算不是 Vitest 运行结果；也不能据此宣称整个 UI 已完成 WCAG 或 Atomic Design 全局验收。
- **原则影响与范围：** 局部改善 #6（令牌职责区分）、#9（功能边界与装饰样式分层）及 #14（自动对比度回归断言）。没有完成剩余全局 CSS/Atomic Design 审计，也不改变 14 项整体仍部分符合的判定。


## 本轮继续：播放器内核命令错误反馈（2026-10-25）

- **确认的问题：** 播放器 Presenter 的原生字幕轨道与 SPDIF 设置会向内核发送命令，但空 catch 静默吞掉失败。播放控制命令已有统一的短时反馈模型，这两项用户操作绕开了反馈通道，错误无法辨认。
- **已调整：** 新增无 UI/网络/存储依赖的 runPlayerKernelCommandWithFeedback 应用函数；字幕轨道与 SPDIF 命令失败现在带原命令信息进入已有播放器反馈状态，成功操作不产生错误提示。
- **回归用例：** 新增用例覆盖原命令身份与错误传递、成功时不报告错误。Vitest 用例已写，当前没有测试运行器结果。
- **验证：** TypeScript 5.9.3 API 对 main、renderer、test 三份 tsconfig 的 noEmit 检查均为 0 诊断。
- **原则影响与边界：** 局部改善 #6、#8、#11、#14 的副作用反馈与可测试性；没有完成整个播放器 Presenter 的 Passive View，也没有完成 14 项全仓整改。Oxlint、生产构建和桌面播放验收仍未运行。

## 本轮继续：首页搜索记忆写入归属（2026-10-25）

- **确认的问题：** `HomeSearchWorkflow` 已负责搜索、文件夹和路由状态，但 `HomePagePresenter` 仍负责搜索记忆的 profile 回填、版本时间戳和持久化；这把应用流程的状态规则留在 React 组合层，削弱 #6、#7、#8、#14 的边界。
- **已调整：** 新增窄 `HomeSearchMemoryPort`，由 `HomeSearchWorkflow` 为保存、清空和退出搜索统一计算 profile 与 `updatedAt` 并写入端口。`HomePagePresenter` 不再直接写搜索记忆；浏览开始时通过搜索用例清空旧记忆。UI 视图与现有搜索/浏览行为未变。
- **回归覆盖：** `useHomeSearchController.spec.tsx` 验证记忆保存、清空、profile 与时钟戳由应用流程经替身端口提交。首页视图测试补上每例 DOM 清理，档案切换测试改为断言当前设计的空订阅标题；4 项失败来自测试隔离缺失和已更新的空状态文案，并非搜索实现回归。
- **验证：** `pnpm run typecheck` 的 main、renderer、test 三个配置全部通过；`pnpm run architecture:check` 通过；15 个首页相关 Vitest 文件全部通过，共 69 项。
- **原则影响与范围：** 改善 #1、#6、#7、#8、#11、#14 的责任归属、端口隔离和可测试性。`useHomePagePresenter` 仍负责搜索/浏览/路由界面协调；播放器跨功能协调、运行时一致性、全局 Atomic Design 与桌面视觉验收仍未完成。此次未打包、发布或创建分支/工作区。

## 本轮继续：renderer preload 依赖边界（2026-10-25）

- **复核证据：** CLI 全仓检索确认 `window.api` 当前仅出现在 `renderer/api/client.ts`、`renderer/lib/preferenceStore.ts` 和两个 feature adapter 中；`AudioPlayer` 已是组合入口，旧审查记录中它直接管理 UI memory 与浏览器事件的问题已处理。
- **已调整：** 架构扫描器此前只针对插件弹窗拦截直接 preload 访问，现统一限制到类型化 API client、偏好持久化边界和 feature adapters，并增加展示层拒绝、adapter 放行的回归夹具。
- **验证：** `pnpm run typecheck` 三个 TypeScript 项目通过；架构与插件定向测试 3 个文件、213 项通过；`node scripts/architecture-boundaries.mjs` 与 `git diff --check` 通过。此项只加强 renderer preload 依赖方向，不代表 14 项原则或全仓体验验收完成。

## 本轮继续：跨蜘蛛运行时的取消错误契约（2026-10-25）

- **发现的差异：** Python 蜘蛛新加的共享脚本加载取消用例失败；JAR 已有同类断言也受同一个问题影响。调用方用 `AbortController.abort(new Error(...))` 时，`abortError` 原样返回普通 `Error`，不会命名为 `AbortError`。运行时取消因此可能被播放代理的错误日志当成故障记录，也破坏了 JS/JAR/Python 共享的取消可替换契约。
- **已修正：** `abortError` 现在始终创建名称为 `AbortError` 的新错误；保留调用方原因中的消息并将原错误挂到 `cause`，不改变原始错误对象。SourceGateway、CMS/Spider 搜索适配器、CMS 搜索服务和跨档案搜索检查统一走该取消契约；即使底层端口只用普通 `Error` 拒绝，调用方也能得到明确的 `AbortError`。
- **行为验证：** 新增用例覆盖 Error/string/default 原因、共享任务 waiter 与 VOD 网关/适配器取消；Python、JAR、JS Worker、蜘蛛进程池、HTTP 和播放代理的相关回归总计 17 个测试文件、275 项全部通过。修正测试替身的泛型后，再运行 VOD/Spider/JAR/Python 六个文件的 126 项复核也全部通过。
- **静态验证：** 最终 `pnpm run typecheck` 的 main、renderer、test 三套检查通过；生产代码修改后 `pnpm run architecture:check` 输出 `Architecture boundaries passed.`。
- **原则影响与边界：** 改善 #3（运行时取消行为替换）、#6、#8 与 #14 的共同契约和测试证据；错误、超时、能力缺失等完整跨运行时矩阵和桌面/真实蜘蛛验收仍未完成，不能据此判定整套运行时或 14 项原则全局通过。

## 本轮继续：播放器内核交接状态端口与全量回归（2026-10-25）

- **确认的职责边界问题：** HTML5 与 MPV 会话通过 Presenter 中同一个可变 ref 交换位置和暂停状态；两个会话都能读取并重写它，资源身份校验分散在调用侧。内核切换数据虽已按 URL、profile-scoped progress key 和目标内核校验，但状态所有权仍暴露为共享实现细节。
- **已重构：** 新增窄 `PlaybackHandoffPort`，集中 `stage`、`readFor` 和 `markPositionApplied`。内存实现持有单个待交接快照，在写入和读取边界复制对象；调用只允许访问匹配当前资源、档案进度键和目标内核的快照。HTML5 和 MPV 会话不再直接修改共享 handoff ref，Presenter 只负责创建端口并注入各会话。
- **回归覆盖：** 新增 `playbackHandoff.spec.ts`，验证资源/档案/目标内核隔离、快照不可被调用方原地改写、只清除匹配会话的位置，以及新交接覆盖旧交接。保留 HTML5、MPV 会话和内核切换行为测试。
- **测试维护与关联缺陷：** 全量套件先暴露出旧测试仍检查已拆分前的页面源码、来源选择器未按子仓层级操作、更新提示测试宿主未加载真实 Presenter/View、组件模型断言缺少新增反馈字段，以及计时器/异步 callback 替身不稳定。测试已迁到当前 Hook、Adapter、样式合成和交互契约；解绑成功提示也统一使用网盘显示名。
- **验证结果：** `pnpm exec vitest run`：396 个文件通过、3 个文件跳过；3510 项通过、5 项跳过。播放器/来源/设置/更新提示等 12 个定向测试文件 62 项通过。`pnpm run typecheck` 的 main、renderer、test 三套配置通过；`pnpm run architecture:check` 通过。
- **原则影响与边界：** 局部改善 #1、#6、#7、#8、#14 的状态所有权、端口方向、副作用隔离和行为可测性。`liveKindRef` 与跳过片段仍被两个播放会话共享，本轮未抽象；播放器 UI 也未做桌面实际画面验收。14 项原则的全仓评估与整改仍未完成；本轮未打包或发布。

## 本轮继续：播放器会话状态端口与全量回归（2026-10-25）

- **确认的问题：** HTML5 与 MPV 会话直接接收 Presenter 的 `liveKindRef` 和 `skipSegmentsRef`，能够读写视图组合层的可变实现。该共享方式让会话规则依赖 React ref，状态边界难以脱离 UI 宿主替换。
- **已重构：** 新增 `PlaybackSessionStatePort`，以 `getLivePlaybackKind` / `setLivePlaybackKind` 和 `getSkipSegments` 表达会话所需事实。应用端口在内部封装直播态，并按需从跳过片段控制器读取最新设置；Presenter 负责创建并注入端口，两个会话不再接收上述裸 ref。
- **回归覆盖：** 新增 `playbackSessionState.spec.ts`，验证直播态语义访问与跳过片段最新值读取；更新 HTML5、MPV 会话测试宿主使用端口。定向 3 文件共 21 项通过。
- **验证结果：** 当前代码上的 `pnpm exec vitest run`：397 个文件通过、3 个跳过；3513 项通过、5 项跳过。`pnpm run typecheck` 的 main、renderer、test 三套检查通过；`pnpm run architecture:check` 输出 `Architecture boundaries passed.`。测试运行同时显示 `usePlaybackSettingsPresenter` 两条非失败 React `act(...)` 警告及 Node localStorage 实验性警告。
- **原则影响与边界：** 局部改善 #1、#6、#7、#8、#11、#14 的状态边界、依赖方向与可测试性。此端口只封装播放器会话事实，并未拆分 Presenter 的全部协调职责；UI 视觉、实际媒体源、打包发布和 14 项原则全仓验收仍未完成。

## 本轮继续：观看历史卡片操作与可见层级（2026-10-25）

- **复核用户截图对应行为：** 当前 `HistoryPageView` 实际只渲染一个“从观看历史移除”按钮，并把它与“详情”放在海报下方；删除不再覆盖封面。但该行为没有视图级回归测试，历史/收藏操作条 CSS 还存在两套叠加定义，容易让控件尺寸、背景和交互态随级联顺序漂移。
- **已调整：** 合并历史与收藏操作条的重复基础规则，保留在海报下方的单一操作区、语义状态色、稳定按钮盒模型、悬停和键盘焦点样式。
- **回归覆盖：** 新增 `HistoryPageView.spec.tsx`，验证播放、详情、移除是独立按钮；每张卡只有一个移除入口且不覆盖海报；缺少源身份或 vod id 时不显示不可用的详情操作。

## 本轮继续：设置页错误反馈状态归属（2026-10-25）

- **确认的问题：** `ConfigPage` 把订阅导入、源体检、订阅组、档案激活和配置读取的错误都写入同一个 `err`，但订阅导入错误也在导入对话框中展示；其它工作流的错误会串入订阅对话框，反馈所有权不清。
- **已调整：** `useSubscriptionImport` 现在拥有自己的 `error` 与 `notice`，`SubscriptionImportSection` 只消费导入工作流模型；配置加载、体检、订阅组和档案激活继续使用设置页全局错误提示，并在来源页也可见。导入错误不再由 ConfigPage 注入。
- **回归覆盖：** 导入视图测试覆盖导入失败提示；架构边界测试禁止把页面级错误 setter 注入导入 workflow。
- **验证：** 三套 TypeScript 检查通过；7 个定向测试文件、223 项通过；架构扫描和 `git diff --check` 通过。此项修复一个明确的设置页反馈串线，不代表配置页其余职责或全局 UI 对比度已完整验收。
- **验证：** 历史视图、播放器样式架构、观看历史行为 3 个测试文件共 32 项通过；main、renderer、test TypeScript 检查通过；`pnpm run architecture:check` 通过。本轮未重跑全量测试，因此全量绿灯只对应上一轮播放器端口变更前的状态。
- **原则影响与边界：** 局部改善 #6、#9、#11、#14 的样式职责、层级与被动视图行为覆盖。桌面实机视觉/键盘操作验收、其他页面对比度全面审计、14 项原则全仓整改仍未完成；未打包、发布或新建工作区/分支。

## 本轮继续：小窗口播放器顶栏对比度（2026-10-25）

- **确认的问题：** `.mini-strip` 将整条标题和按钮设为 `opacity: .35`，鼠标悬停才恢复；pillbar 的浅色悬停态又将按钮文字设为白色。dualbar、pillbar 对 MPV 也无条件覆盖小窗条，可能把视频浮层渐变改成浅色底。
- **已修正：** 去除整条透明度衰减，始终显示清晰文字；按钮常态继承前景色，悬停使用主题强调色，关闭按钮使用 danger/on-danger 语义对。dualbar、pillbar 的浅色覆盖仅用于非 MPV 窗口；修正视图注释，使其与实际交互一致。
- **验证：** `pnpm run typecheck` 的 main、renderer、test 三套检查通过；`playerStyleArchitecture.spec.ts` 7 项通过；`node scripts/architecture-boundaries.mjs` 与 `git diff --check` 通过。未进行桌面运行时截图复核。
- **原则影响与边界：** 局部改善 #6、#9、#14 的样式职责和可读性回归覆盖；此项只修复播放器缩小窗口顶栏，不代表整个应用的低对比度问题已全面审计或修复。

## 本轮继续：音量滑杆圆点居中复核（2026-10-25）

- **当前源码证据：** `.vp-vtrack` 采用水平 range 绕中心旋转为竖向轨道；WebKit 拇指上移量为轨道与拇指高度差的一半，抵消原生横向 range 的默认偏移。style composition 中没有发现 shell 对该轨道的二次几何覆盖。
- **CLI 视觉复核：** 使用本机 Edge headless 载入当前播放器样式，在 50% 音量渲染竖向轨道；截图中的白色圆点与轨道中轴对齐。此结果验证当前 CSS 渲染，不等同于用户所安装版本或完整应用窗口的复测。
- **回归覆盖：** `playerStyleArchitecture.spec.ts` 新增几何约束，验证 range 居中旋转并按轨道/拇指尺寸差计算 WebKit 拇指偏移。
- **结论与边界：** 当前源码未呈现截图所述的偏心状态，因此本轮不再叠加 CSS 偏移修正；旧安装包是否包含当前样式、其它音量交互状态和实机 DPI 缩放仍需分别核实。

## 本轮继续：播放历史进度的会话替换测试（2026-10-25）

- **确认的验证缺口：** `usePlayerHistoryProgress` 已从页面会话拆出并通过 `PlayerHistoryProgressPort` 隔离 I/O，但此前没有行为测试证明定时 checkpoint 随 episode/profile/source 变化读取最新快照，也没有证明卸载时只写入当前会话的一次最终 checkpoint。
- **回归覆盖：** 新增 `usePlayerHistoryProgress.spec.tsx`，使用假时钟验证定时持久化改用切换后的播放 URL、档案、来源和剧集身份，并验证卸载时最终写入当前快照。
- **原则影响与边界：** 加强 #6、#8、#11、#14 对历史记录副作用和可替换端口的行为证据；未借文件行数推断 SRP 违例，也未改变播放器业务行为。
- **验证：** 新增 hook 测试与 `usePlayerPageSession.spec.tsx`、`playerPageSessionState.spec.ts` 共 3 个文件、7 项通过；main、renderer、test 三套 TypeScript 检查、`pnpm run architecture:check` 与 `git diff --check` 通过。
- **未完成：** 本项测试覆盖定时更新和卸载 checkpoint，不代替真实窗口播放进度与跨路由卸载时序验收；其它高耦合模块审查仍在进行。

## 本轮当前工作区全量验证（2026-10-25）

- **全量 Vitest：** `pnpm test` 完成，402 个文件通过、3 个跳过；3537 项通过、5 项跳过。包含本轮新增的 `usePlayerHistoryProgress.spec.tsx`。
- **静态与 lint：** main、renderer、test 三套 TypeScript 检查通过；`pnpm run lint` 的源代码/脚本/测试、架构边界、renderer React/performance 与 JSX 可访问性阶段全部通过。
- **非失败提示：** 测试仍输出 `usePlaybackSettingsPresenter` 两条 React `act(...)` 警告和 Node localStorage 实验性警告；本轮没有处理这两条既有提示。
- **验收边界：** 未运行生产构建、安装包制作、真实桌面窗口视觉/播放验收；当前 evidence 不证明 14 项原则全仓完成。

## 本轮 CLI 复核：蜘蛛替换契约与测试提示（2026-10-25）

- **工具选择：** 代码搜索、静态检查和测试均使用 CLI；computer use 只用于必须在实际桌面窗口复现的交互/视觉问题。本轮没有打开桌面应用，也没有将浏览器截图当作源码或安装包的验收证据。
- **Spider 替换契约复核：** `Spider` 保留上游兼容所需的默认方法；`SpiderSourceRuntimeAdapter` 会将继承的空桩转换为可选能力，真实覆写即使返回合法空结果仍可调用；直播缺失能力由 `SpiderLiveContentAdapter` 返回 `OPERATION_UNSUPPORTED`。本轮未发现需要再增加一层 adapter 的证据。
- **定向验证：** 蜘蛛能力边界、直播能力、来源 adapter、JS 沙箱和 Python 蜘蛛 5 个测试文件共 60 项通过；`usePlaybackSettingsPresenter.spec.tsx` 4 项通过，未再出现此前记录的 React `act(...)` 警告。Node localStorage 实验性提示与该 React 警告无关。
- **结论边界：** 这轮是对已有替换契约与验证记录的复核，没有新增生产代码改动。14 项原则全仓验收、运行时跨实现 conformance matrix、播放器真实媒体/窗口验收和整体 UI 对比度审计仍未完成；本轮未打包或发布。

## 本轮继续：播放器窗口新初始化状态与重试（2026-10-25）

- **确认的问题：** 收到新的播放器 `init` 时，`hydration-started` 保留上一资源的 `init`、剧集索引和标题；新档案恢复失败后页面可能继续展示旧剧集。首次 hydration 失败时 `PlayerPageView` 又只在 `init` 存在时显示重试按钮，形成无可恢复入口的失败状态。
- **已调整：** 新 hydration 清空旧资源状态与 `initRef`；hook 保留尚未 hydration 成功的原始 init，失败后重试会重新恢复来源/详情，播放解析失败则仍只重试当前剧集。正在 hydration/解析时忽略重复重试。`PlayerPageView` 在无 init 但已有错误时也显示重试操作，上一集/下一集仅在有剧集上下文时显示。
- **回归覆盖：** Reducer 测试断言新初始化清掉旧资源状态；hook 测试覆盖旧剧集清空、新档案 hydration 失败后重试并成功播放；页面视图测试覆盖无 init 的失败页仍可重试。
- **验证：** 3 个定向测试文件 7 项通过；`pnpm run typecheck` 的 main/renderer/test 均通过；`pnpm run lint` 的 Oxlint、React/perf、JSX a11y 和架构边界均通过；完整 `pnpm test` 为 403 个文件通过、3 个跳过，3539 项通过、5 项跳过。
- **原则影响与边界：** 局部改善 #1、#6、#8、#11、#14 的状态所有权、会话切换语义、被动视图和行为可测性；`usePlayerPageSession` 仍是页面级应用协调器，本次修复不等同于它已完全符合 SRP。实际桌面媒体播放、完整 UI 对比度与 14 项原则全仓验收仍未完成；本轮未打包、发布或新建分支/工作区。

## 本轮继续：全局焦点环回退与主题可见性验证（2026-10-25）

- **确认的问题：** `--focus-ring-color` 原先只在 Desktop 主题中定义，但网盘账号 tab 等跨主题组件直接使用它，没有回退值，非 Desktop 主题的键盘焦点轮廓可能因 `var()` 无法解析而不绘制。错误的对比度测试默认用亮度很高的品牌 `--accent` 代替实际 `--text-accent`，先暴露出 Bilibili 蓝在浅色表面只有 2.33:1；该色并不是通用焦点环的实际声明值。
- **已调整：** 在全局语义 token 中将 `--focus-ring-color` 默认映射到 `--text-accent`；Desktop 深色/浅色的专属颜色仍按主题覆盖。焦点对比度测试现在使用每主题显式焦点色或实际全局回退色，并核对其在四级表面上均达到至少 3:1。
- **验证：** `themeContrast.spec.ts` 26 项通过；播放器初始化相关 3 个测试文件共 7 项通过；main、renderer、test TypeScript 检查通过；全量 lint、架构边界检查通过；当前最终工作区 `pnpm test` 为 403 个文件通过、3 个跳过，3546 项通过、5 项跳过。
- **原则影响与边界：** 改善 #6、#9、#11、#14 的主题 token 一致性、键盘焦点状态可辨识和自动回归覆盖。此项验证不等于所有实际页面的控件状态均已测量；当前 14 项原则仍有大量未验收路径，未进行生产打包、安装或真实桌面视觉验收。

## 本轮 CLI 复核：播放器加载状态对比度（2026-10-25）

- **确认的问题：** 播放器与图片预览共用 `.vp-loading`，加载文字原先只依赖继承颜色、文字阴影和覆盖媒体画面的半透明层；遇到高亮画面时没有局部、稳定的文字底色。
- **已修正：** 为 `.vp-load-text` 增加紧凑的深色状态胶囊、白色媒体文字令牌、清晰边界和紧凑内边距，不再依赖阴影增强可读性；同一规则覆盖视频加载/缓冲和图片加载提示。
- **回归覆盖：** `playerStyleArchitecture.spec.ts` 校验语义文字色、深色底色、紧凑尺寸，并以纯白画面作为最坏背景计算对比度，要求满足 WCAG AA 4.5:1。
- **验证：** 播放器样式与主题对比度 36 项通过；main、renderer、test TypeScript 检查通过；`pnpm run lint` 中 Oxlint、React/perf、JSX a11y 与架构边界检查通过；Windows 换行约定下 `git -c core.whitespace=cr-at-eol diff --check` 通过。
- **构建观察：** `pnpm run build:renderer` 成功；Vite 仍报告 `hls` chunk 为 574.41 KB（gzip 178.97 KB），超过 500 KB 提示阈值。本轮没有改动它，不能把该性能待办误算为已解决或归因于 CSS 修复。
- **原则影响与边界：** 这是展示层局部可读性和可测性的修复，改善关注点分离下的视觉契约并为 CSS 建立回归测试。尚未完成整个应用所有组件/浮层状态的 WCAG 对比度矩阵，也没有进行桌面窗口实机视觉验收；不能将本项描述为全局对比度问题已全部解决。

## 本轮 CLI 复核：跨蜘蛛运行时 quick 搜索参数（2026-10-25）

- **确认的问题：** `Spider.searchContent(key, quick, ...)` 声明了 quick 搜索能力，但 JAR 与 Python adapter 忽略调用方的 `quick`；JVM `SpiderRunner`、CPython runner 和兼容用 Jython runner 又固定传 `false`。JS 蜘蛛会透传该标记，因此同一搜索请求会因 spider 运行时不同而改变语义。JAR 与 Python 的分页实参位置也分别依赖未显式声明的旧布局。
- **已修正：** JAR 与 Python adapter 现在统一发送 `[key, quick, page?]`；JVM、CPython 与 Jython runner 都保留 quick 值和页码，并兼容旧版 JAR `[key, page]` 及 Python `[key, '', page]` / `[key, page]` 参数布局。
- **回归覆盖：** adapter 用例验证 quick 与分页线缆参数；CPython runner 用例覆盖 true/false、默认页码与两种旧布局；真实 JVM 一次性与常驻模式覆盖 quick、分页及旧调用兼容。
- **验证：** 针对性 runner/adapter/JVM 用例 28 项通过，其中真实 JVM 集成 8 项实际运行；Python runner 6 项通过；main、renderer、test TypeScript 检查通过；全量 Vitest 为 409 个文件通过、3 个跳过，3566 项通过、5 项跳过；`pnpm run lint` 含 Oxlint、React/perf、JSX a11y 与架构边界检查全部通过。
- **原则影响与边界：** 局部改善 #3、#6、#7、#13、#14 的运行时替换语义、显式参数契约与行为回归。跨所有运行时的失败/取消/超时完整 conformance matrix 仍未完成；14 项原则的全仓整改、真实桌面视觉/播放验收及生产构建仍未完成。普通 `git diff --check` 会把该已修改主题 fixture 的 CRLF 行尾报告为尾随空格；按仓库现有 Windows 约定使用 `git -c core.whitespace=cr-at-eol diff --check` 检查。
- **本轮 CLI 验证（2026-10-25）：** `tests/jarRuntimeState.spec.ts` 的 8 项测试通过；`pnpm run typecheck:test` 通过。新增公共 `JarSpider.searchContent` 边界断言，检查 `SPIDER_TIMEOUT` 映射、源/操作详情和调用方超时参数透传。该测试只补齐 JVM wrapper 的一格契约证据，不代表跨运行时矩阵或 14 项原则全仓验收完成。
- **当前快照全量验证（2026-10-25）：** `pnpm run typecheck`、`pnpm run architecture:check`、`pnpm run lint` 均通过；`pnpm test` 通过 409 个文件、3568 项，3 个文件与 5 项跳过。`themeContrast.spec.ts` 和 `playerStyleArchitecture.spec.ts` 本轮单独复跑 36 项通过。Playwright CLI 实际浏览器复核未能启动：daemon 父目录缺失，备用 screenshot 命令又因 Chromium headless shell 未安装失败；未下载浏览器。全局 UI 对比度矩阵、实际桌面窗口与播放行为仍需验收。

## 本轮架构整改（2026-10-26，WebDAV 端口与 Worker 取消语义）

- **范围清理：** 从本轮架构分支撤回了未被请求的详情页离线下载和应用退出自动上传 WebDAV 备份；没有将额外数据上传行为混入架构整改。用户原有的 `libnc.so` 文件仍留在工作区，未纳入提交。
- **端口边界：** `DavService` 不再自行实例化 `HttpClient`，改为由组合根注入 HTTP、仓库与日志端口；新增行为测试验证目录读取通过注入端口、缺少服务器时不发网络请求。提交 `mry`：`refactor:webdav-service-ports`。
- **取消契约：** 修复 JS Worker 丢失后自动重开路径漏查取消信号的问题。新增真实 Worker 集成测试，先摘除正在路由的 worker，再在恢复调用结果与调用方取消之间制造竞态，断言最终向调用者报告取消。提交 `pxy`：`fix:worker-retry-abort`。
- **本轮增量验证：** DAV/目录解析测试 13 项通过；JS 沙箱与真实 Worker 测试 33 项通过；`pnpm run typecheck` 的 main、renderer、test 三个项目通过。全量 Vitest、lint、生产构建尚未在这两个增量后重跑。
- **仍未完成：** 14 项总评仍为 11 项部分符合、3 项局部大体符合、0 项全仓验收通过。跨 JS/Worker/JVM/Python 的准备失败、执行失败、取消和超时完整矩阵；`VideoPlayerPresenter` 跨子域协调；全仓 UI/IPC 与 Atomic Design/对比度审计；真实桌面播放和安装验收仍开放。

## 本轮架构整改（2026-10-26，主题状态边界）

- **确认并修复的边界：** 原 `renderer/lib/theme.ts` 同时负责主题用例协调、文档 DOM/token 写入、偏好持久化、插件 CSS 注入和 React 外部 store 订阅。现拆为 React-free 的 `themeApplication`（通过偏好、注册表、文档和事件端口协调）、`themeDocumentAdapter`（DOM/token/CSS）、`useThemeStore`（React 订阅）及 renderer composition runtime；页面和设置调用点已迁移，旧混合模块已删除。
- **行为覆盖：** 新增主题应用用例测试，覆盖主题应用与写入顺序、启动读取不回写、注册表加载中的保留行为，以及皮肤移除后归一化并持久化默认主题。既有主题应用、外观设置和注册表测试继续通过。
- **本轮全量验证：** `pnpm test` 完成，420 个测试文件通过、3 个跳过；3631 项通过、5 项跳过。`pnpm run typecheck` 的 main、renderer、test 三套检查和 `pnpm run lint`（含架构边界、React/perf、JSX a11y）通过；`pnpm run build` 的 main 与 renderer 生产构建通过。
- **回归修复：** 全量测试发现两个失败项：JVM/Python cwd 测试依赖已删除的 `JarSpiderBridge.runSubprocess` 私有入口，现改为直接验证共享 `SpiderSubprocessRunner`；存储初始读取失败同时显示在表单和列表，现把 `listError` 与操作反馈分开。两项定向复测通过，随后全量 Vitest 通过。
- **构建提示：** 生产构建成功，但 Vite 仍提示 HLS chunk 约 574 KB、超过 500 KB 阈值；本轮没有做 bundle 拆分优化。桌面视觉验收仍未执行。
- **原则影响与限制：** 此次关闭主题设置链路中 #1、#5、#6、#7、#8、#14 的一处具体职责与可替换性缺口；它不改变全仓 14 项总评。JS/Worker/JVM/Python 共同行为矩阵、播放器真实状态所有权审查、余下 UI/IPC 依赖分类、Atomic Design/全窗口视觉验收仍开放。
- **提交：** `zqm`（主题职责拆分）、`nmm`（lint 清理）、`tvx`（Python runner 测试）、`wvz`（存储错误展示）、`lmv`（主题状态记录）。`libnc.so` 保持独立、未提交。
- **本轮继续：Python 进程池取消边界（2026-10-26）：** Python 适配器原先将结果处理也包在池提交的宽泛 `catch` 中；若可替换的池端口返回 `reason: 'cancelled'` 而调用侧没有已中止信号，适配器抛出的取消异常会被自己捕获并落到一次性进程重跑。现将 `catch` 缩到提交操作，取消从运行时边界明确传播；合法空结果、蜘蛛执行错误、池超时均不重跑，传输故障仍走一次性回退。现有 `SpiderProcPool` 只会因传入的 AbortSignal 中止而返回取消，因此生产实现通常会被前置 `throwIfAborted` 拦截；这次修复明确了替换端口也必须遵守的边界契约。
- **本轮继续：跨运行时消费者契约矩阵（2026-10-26）：** 新增 source-level conformance 用例，让 JS、Python、JVM 三个来源适配器对合法空结果、能力缺失、执行失败、超时和调用前取消保持相同的调用者可见结果；取消用例同时断言不会启动准备或执行。它验证的是 `Spider` 消费者边界，不代替 Worker/JVM/Python 进程池内部的完整故障矩阵。
- **本轮继续：运行时拒绝异常归一（2026-10-26）：** `PySpider` 会把运行时抛出的普通异常映射为带 source/operation 的 `SPIDER_ERROR`，`JsSpider` 与 `JarSpider` 则允许部分可替换端口的普通异常直接漏出。现在两个边界也保留既有 `SourceProblemError`、尊重取消，并将未知拒绝规范为含来源和操作身份的 `SPIDER_ERROR`；同一消费者矩阵新增该场景。
- **验证与原则影响：** Python 池适配器 5 项测试、JS/Python/JVM 消费者契约 6 项测试及相关 JS/Python/JVM 测试 53 项通过；三套 TypeScript 检查及仓库 lint 通过。改善 #3 LSP、#6 SoC、#14 可测试性的一处错误语义漂移；进程准备失败、池内部取消/超时和真实 Worker 的完整行为矩阵仍开放，14 项总评未完成。
- **本轮全量复验（2026-10-26，包含 JS/JVM 异常边界改动）：** `pnpm test` 通过 422 个测试文件，3 个跳过；3642 项通过、5 项跳过。`pnpm run typecheck` 三套项目、`pnpm run lint`（边界/React/perf/a11y）通过；`pnpm run build` 主进程与 renderer 生产构建通过。构建仍有 `hls` 574.41 KB 超过 500 KB chunk 阈值及 Babel transform 耗时提示；本轮未处理 chunk 拆分或做桌面真实播放/安装验收。
- **本轮继续：播放器音轨依赖倒置（2026-10-26）：** `VideoPlayerPresenter` 与音轨 IPC adapter 原先共同持有 `HlsInstance` ref，应用协调层因此直接依赖 `hls.js`。现在 HTML5 会话私有拥有并销毁 HLS 实例，只通过 `AdaptiveAudioTrackController` 暴露选轨与轨道快照；HLS 专用 adapter 封装第三方对象映射，Presenter 和音轨用例不再导入 `hls.js` 类型。HLS 仍按需动态导入；574 KB 是 HLS 独立 chunk 的体积告警，不等于每次启动都下载/加载该模块。
- **本轮验证与限制：** HLS adapter、HTML5 播放会话及音轨 hook 定向测试 15 项通过；`pnpm run typecheck`、`pnpm run lint`（包含架构边界）与 `pnpm run build` 通过。构建确认 HLS 仍为独立 `hls` chunk（574.41 KB），没有把它并入播放器首屏 chunk；本轮不包含桌面真实播放验收。此边界改善 #4 ISP、#5 DIP、#6 SoC、#7 Ports & Adapters 与 #14 可测试性的一处具体缺口，14 项原则整体评估仍未完成。
- **本轮继续：搜索匹配与结果投影分层（2026-10-26）：** Renderer 原先从 `engine/vod` 导入聚合来源键与一个同时负责片名匹配、跨子仓/来源筛选和来源均衡排序的模块。来源身份键与纯片名归一/拼音匹配现位于 `shared`；按来源/子仓筛选、统计与排序投影位于 Search feature application，首页、详情、发现和搜索控件按边界导入。旧 `engine/vod/searchRelevance.ts` 已移除，没有兼容门面或重复实现。
- **本轮验证与限制：** 聚合搜索、片名匹配、来源筛选相关定向测试 36 项通过；`pnpm run typecheck`、`pnpm run lint`（含架构边界）和 `pnpm run build` 通过。构建产物保持原有 chunk 切分，HLS 仍独立动态加载。此项改善 #1 SRP、#6 SoC、#7 Ports & Adapters 与 #14 可测试性的一处跨层混放；全仓剩余 UI/IPC 分类、Presenter 状态所有权、Atomic Design/对比度验收、运行时故障矩阵及桌面实机验收仍开放。
- **当前结论：** 以上是当前代码快照的验证，不是 14 项完成证明。仍开放：播放器跨域状态所有权和细节 UI/Atomic Design 审计、全窗口对比度与真实视觉验收、Worker/JVM/Python 进程内部的准备失败/取消/超时 conformance、renderer 剩余视图/适配器分类及桌面播放/安装验收。

## 本轮继续：单次蜘蛛子进程启动失败契约（2026-10-26）

- **确认的问题：** `SpiderSubprocessRunner` 对 Node 子进程异步 `error` 事件返回 `SPIDER_ERROR` 结果，但注入的 `spawn` 端口若同步抛错，Promise executor 会把原始异常直接拒绝给上层，破坏可替换运行器的一致失败语义。
- **已修正：** 启动端口及其环境准备同步失败现在统一记录启动诊断并返回 `SPIDER_ERROR` 的 `SpiderCallResult`；取消仍以 `AbortError` 拒绝，不会被错误归一化成普通启动失败。
- **回归覆盖：** `spiderSubprocessRunner.spec.ts` 覆盖异步启动错误只结算一次、同步端口抛错映射、运行中取消会终止子进程并保留取消原因，共 3 项。
- **验证：** 定向测试 3 项通过；`pnpm run typecheck` 三套项目通过；`pnpm run lint`（含架构边界与 renderer React/perf/a11y）通过。本项只关闭单次进程同步启动异常这一格，不代表蜘蛛各运行时的准备失败、进程内部取消/超时 conformance matrix 已完成。

## 本轮继续：首页瀑布流观察器边界（2026-10-26）

- **确认的问题：** `useHomeBrowseController` 同时维护浏览数据/分页状态并直接实例化全局 `IntersectionObserver`，DOM 可见性生命周期和浏览查询控制因此耦合在一个 hook 中，且无法以替身观察器独立验证。
- **已调整：** 新增 `HomeWaterfallObserverPort`、浏览器 adapter 与生命周期 hook；HomePage composition root 注入 adapter。浏览控制器保留分页与数据状态，observer hook 管理建立/断开与刷新，回调通过 ref 读取最新分页动作。
- **回归覆盖：** 新增 observer 生命周期与停用状态测试 2 项；既有浏览控制器行为测试 7 项继续通过。
- **验证：** 两个定向测试文件共 9 项通过；`pnpm run typecheck` 三套项目通过；`pnpm run lint`（含架构边界和 renderer React/perf/a11y）通过。首页搜索/浏览跨会话协调、其余 renderer DOM/IPC 分类与全局 UI/Atomic Design 审计仍开放。

## 当前工作区全量复验（2026-10-26）

- **测试：** `pnpm test` 通过 424 个测试文件，3 个文件跳过；3650 项通过、5 项跳过。
- **静态检查：** `pnpm run typecheck` 的 main、renderer、test 三套项目通过；`pnpm run lint` 通过，包含架构边界、React/perf 与 JSX a11y。
- **构建：** `pnpm run build` 的 main 与 renderer 生产构建通过。Vite 仍提示独立 `hls` chunk 为 574.41 KB（gzip 178.97 KB），超过 500 KB；Babel transform 回调耗时仍是 renderer 构建的主要瓶颈。
- **未验收：** 这次全量 CLI 复验不替代桌面视觉、实际媒体源播放或安装覆盖/数据保留验收；14 项原则整改仍未完成。

## 本轮继续：常驻蜘蛛进程池同步启动失败（2026-10-26）

- **确认的问题：** `SpiderProcPool.submit` 遇到注入的 `spawnFn` 同步抛错时会 reject 原始异常，而相同的异步启动故障会按 `PoolResult` 返回 `spawn-error`；预热路径也会直接抛错。这会让替换运行时改变调用方的回退与启动行为。
- **已修正：** 集中处理进程创建失败：提交调用稳定返回 `{ ok: false, reason: 'spawn-error' }` 供单次运行时回退；预热将启动失败作为 best-effort 停止并返回实际启动数。若子进程已启动但流/事件初始化失败，会先尝试终止该进程，再返回失败结果。
- **回归覆盖：** `spiderProcPool.spec.ts` 新增提交失败映射与预热失败两项行为测试；该文件现有 20 项覆盖继续通过，共 22 项通过。
- **增量验证：** `pnpm exec vitest run tests/spiderProcPool.spec.ts` 通过；`pnpm run typecheck` 三套项目和 `pnpm run lint`（含架构边界、React/perf/a11y）通过。该增量后尚需复跑全量测试与生产构建。

## 进程池修正后的完整复验（2026-10-26）

- **全量测试：** 424 个测试文件通过、3 个跳过；3652 项通过、5 项跳过。`SpiderProcPool` 的同步启动失败契约包含在全量结果中。
- **生产构建：** main 与 renderer 构建通过。仍有 `hls` 独立 chunk 574.41 KB（gzip 178.97 KB）超过 500 KB 提示；renderer 构建约 8.5 秒，其中 Babel transform 回调约 7.9 秒。它们是已观察到的性能待办，本轮没有擅自改分包或编译行为。
- **总体边界：** 全量 CLI 验证不代表 14 项原则整改完成，也不替代桌面真实媒体播放、安装覆盖/数据保留和全窗口视觉验收；架构剩余项继续按本文件未完成清单跟进。

## 本轮继续：JS / Python / JVM 准备失败契约（2026-10-26）

- **确认的覆盖缺口：** 既有跨运行时矩阵覆盖合法空结果、能力缺失、执行错误、超时、未标记异常和调用前取消，却没有统一验证准备阶段失败是否阻止实际蜘蛛调用。
- **已补回归：** 三类 Spider 适配器分别注入 JS 沙箱加载、Python 脚本加载和 JVM jar 转换失败；统一断言调用方收到 `SPIDER_ERROR`，准备只运行一次且蜘蛛方法没有执行。未发现需要改动的生产行为。
- **验证：** 定向 `spiderRuntimeConformance.spec.ts` 7 项通过；三套 TypeScript 检查和 lint 通过；全量 `pnpm test` 通过 424 个文件、3653 项测试，跳过 3 个文件和 5 项测试。
- **未关闭：** 该用例不覆盖 Worker/JVM/Python 进程池内部的启动、执行、取消和超时竞态；全仓 UI/IPC 与 Atomic Design 审计、桌面实际播放/安装验收仍开放。
