# Win-Box 全仓审计与剩余工作清单

日期：2026-10-26。审计代码：`7469c61e87c0a8a4f8042afd00787ef10ad6f741`；分支：`codex/architecture-cleanup-20261025`。本报告是本次快照的统一待办账本，原 `ARCHITECTURE_REVIEW.md` 保留为过程记录。

## 明确结论

**14 项原则的全面整改尚未完成。已识别的必需工作是 36 个去重任务：9 个已复现缺陷、21 个架构/性能改造项、6 个验收项。预计 122–218 工程小时。另有 2 个可选扩展，不计入这 36 项。**

本轮进行了审计和故障复现，没有修复生产代码，也没有打包或发布新版本。9 个缺陷由 12 个失败用例覆盖（Vitest 10、Python 2）；“此前测试绿灯”不能关闭它们。架构欠账表示边界/资源预算仍需改造，不等于每项已经引发用户可见故障。验收项表示缺少当前快照的证明，不能当成已确认程序错误。

| 类别 | 去重任务 | 工程小时 | 关闭条件 |
|---|---:|---:|---|
| 已复现缺陷 B01–B09 | 9 | 22–42 | 修复根因，相应探针转正式回归并通过 |
| 架构/性能改造 A01–A21 | 21 | 74–132 | 消费者边界/状态所有权明确，相关行为测试通过 |
| 集成/实机验收 V01–V06 | 6 | 26–44 | 当前提交的实际结果、环境和证据齐全 |
| **必需合计** | **36** | **122–218** | 不把可选新功能混进验收 |
| 可选扩展 O01–O02 | 2 | 14–28（O02 仅研究） | 另行明确产品范围后执行 |

工时为熟悉代码的单人有效工程工时，包含必要实现、局部回归及单独集成验收，不是日历承诺。第三方源恢复、未知 Android/JNI 兼容扩展、等待用户登录/外部网络的时间不在估算内。任务可并行或合并共享测试，但不重复把同一根因按文件/原则计费；不据文件数推导完成率。新增任务必须补充触发条件、证据、影响与估算，不能只因为文件长就持续加账。

## 审计范围与可信边界

| 范围 | 文件数 |
|---|---:|
| `src/engine` | 133 |
| `src/main` | 233 |
| `src/renderer` | 593 |
| `src/shared` | 47 |
| **应用源码合计** | **1006** |
| tests（含夹具） | 494 |
| resources（兼容代码、上游脚本、资产） | 203 |
| scripts / build | 38 / 11 |
| 其它配置、文档、CI | 15 |
| **分支文件树合计** | **1767** |

JS/TS 共 **1464 个模块**完成 Babel AST 解析（应用源码 973 个），解析失败 0；检查了 1763 条可解析的源码运行时依赖边，顶层跨层违规 0、静态运行时环 0。renderer 的 71 个 IPC client 导入点中，69 个在 adapters、2 个在组合根。选定 application 导入规则与 `*View` 状态/effect hook 规则没有信号。

这些数字只证明对应规则，不证明 14 项全部满足：计算型动态导入、运行时 provider/IoC、原生/JVM 运行行为、最终 CSS 级联都不在该依赖图内。**96 个文件做了关键链路定向阅读，不能表述为 1767 个文件逐行人工审完。** Java/Python/样式采用文本扫描与重点链路复核；压缩包、图片和二进制只盘点，没有反编译所有依赖。外部 node_modules、缓存、重复构建/release 目录不计作自有源码待重构。

文件树来自实际清理分支，已交叉核对 GitButler 合成索引隐藏的新文件；不把 `git status` 的合成 staged 删除误报为用户文件被删。未提交的 `libnc.so` 不在此次代码基线内，本轮未改动它。

逐文件记录、读取区段、源码摘要和直接任务引用见 [inventory.json](D:/developWorkPlaces/win-box/architecture-audit/inventory.json)；任务数据见 [tasks.json](D:/developWorkPlaces/win-box/architecture-audit/tasks.json)；31 个混合 JSX 候选的逐项判定见 [ui-candidates.json](D:/developWorkPlaces/win-box/architecture-audit/ui-candidates.json)。`scan-only`/`inventory-only` 表示没有完成人工或运行验证，不表示该文件已通过全部原则。

## 已完成且应保留的改造成果

| 路径/能力 | 当前已建立的结果 | 仍不能据此关闭的事项 |
|---|---|---|
| 用户配置聚合 | UserConfig 根聚合的严格原子提交、失败内存恢复；DriveStore 严格写入 | B06 其它用户设置仍吞错；B07 提交后通知语义 |
| 蜘蛛能力/工厂 | Consumer ports、provider 注入、基础空桩与真实能力的适配边界 | Python 差异 B09、生命周期 B01–B04、V01 |
| 聚合搜索 | 跨档案/源用例、调度预算、进度、结果相关度与来源筛选路径存在 | 真正后台取消 A02、全局进程上限 B04、V02/V05 |
| 播放器页面 | 单集解析和播放器页会话已进入独立 application workflow；事件端口已收窄 | 顶层控制编排 A08、HTML5 会话 A09、真实媒体 V02 |
| 多个页面/控件 | 历史、收藏、存储、插件槽位、标题栏、倍速等已有 Presenter/View 或窄展示合约 | 其它页面 A11–A17；无 hook 的 View 不能替代视觉验收 |
| 元数据/弹幕/字幕 | 多个主进程用例已有 provider、设置、缓存端口；渲染 IPC 已归位 | 当前真实来源、能力替换和边界状态验收 |
| 统一基础控件 | Fluent UI 包装、语义 token、普通文本/边界对比度和原生 option 兜底已引入 | A18 样式所有权、V03 全窗口最终计算样式 |
| 可选媒体组件 | 官方资产策略、SHA-256、PE 校验、临时解压、原子 manifest 已有 | A06 预算与可替换安装用例；A21 包体账本 |
| 智能安装 | 运行中停止/覆盖或先卸载再安装、data 保护的脚本已经存在 | V04 当前安装包和实际锁定/集成场景验收 |
| CLI 与 Git | 本轮前该唯一清理分支已有 107 个本地提交；正式门禁/Windows CI 配置存在 | 未 push、未核实本分支远端 CI；V06 当前候选交付 |

这里的“已建立”按具体路径计算，不等于一个原则全仓验收通过。工厂/组合根可以认识具体适配器，DOM 适配组件可以拥有平台生命周期，兼容上游协议的 Spider 基类不应为消除继承而重写；这些不重复列成整改工作。

## 14 项原则逐项结论

| # | 原则 | 当前结论 | 对应剩余任务 | 验收方向 |
|---:|---|---|---|---|
| 1 | SRP | 已拆出多个真实用例；运行时桥、播放器编排、部分页面仍跨责任 | A07–A19 | 按变更原因/状态所有权拆分，不按行数拆文件 |
| 2 | OCP | provider/插件贡献扩展点已存在；热更新身份和样式所有权仍有问题 | B08、A18、A20 | 扩展不会修改中央分支；同 id 更新能替换旧实现 |
| 3 | LSP | 尚未通过；存在可复现的生命周期和 Python 能力语义差异 | B01、B03–B09、V01–V02 | 成功/空/不支持/失败/取消/销毁均满足共同消费者契约 |
| 4 | ISP | 消费者窄端口已有较大改善；部分协议/页面仍暴露宽运行状态 | B04、A06–A10、A14、A19 | 用例只见自己需要的能力，不依赖整个播放器/宿主 |
| 5 | DIP | 顶层依赖方向通过静态检查；生命周期所有权/组合边界仍待收敛 | B02、A06–A07、A12、A16、A20 | 纯用例可注入 I/O；平台适配器不反向进入领域 |
| 6 | 关注点分离 | renderer IPC 已归位；其它 JSX/副作用和 CSS 跨层覆盖仍存在 | A08–A20 | 视图、工作流、存储/平台各自有明确边界 |
| 7 | Ports & Adapters | 已有多条端到端端口路径；不等于所有 main/engine 模块都是纯应用 | B02、A02、A05–A07、A09–A10、A12、A16、A19–A20 | 领域/用例离开 Electron/React/真实网络存储仍能运行 |
| 8 | 纯函数/副作用隔离 | 已有 reducer/策略；队列、池、全局测量器和取消仍有实际缺口 | B01–B09、A01–A06、A10、A16–A17 | 可变资源由单一所有者关闭；纯状态转换不执行 I/O |
| 9 | Atomic Design | 已有 Fluent 原子包装；业务 organism 位置和全局样式仍未统一 | A15、A17–A18、V03 | 原子不导入业务 feature，布局不重写控件语义/尺寸 |
| 10 | 组合优于继承 | provider/端口组合已建立；未发现必须全仓去继承的独立任务 | B09、V01；O01 可选 | 保留上游兼容 Spider 基类；用边界修复默认桩语义 |
| 11 | Passive View / Presentation Model | *View 静态无状态/effect；仍有未命名为 View 的混合页面/组件 | A08、A10–A18 | 不靠改名规避规则，按业务职责和 DOM 适配角色判定 |
| 12 | 语义化命名 | 暂未定位独立的必改阻断；不能宣布所有命名逐个通过人工审查 | 随 A07–A20 调整 | 未发现 Manager/Handler 类型声明；8 个 *Data 均有协议/DTO 上下文，禁止机械改名 |
| 13 | 模式合理性 | 工厂/适配器有实际用途；观察者提交结果和插件生命周期需修正 | B07–B08、A20、V01 | 模式维护错误/状态契约，避免新建只转发的抽象层 |
| 14 | 可测试性 | 已有大量独立用例和 CLI 门禁；12 个新失败证明原覆盖不足 | B01–B09、V01–V06 | 修复用例转为正式绿灯，当前提交集成/实机结果可复查 |

命名检查找到 8 个 `*Data` 类型声明（Worker/PluginWorker/PlayerInit/ZipEntry 的传输结构），没有 Manager/Handler 类型声明。它们有协议上下文，不以字符串后缀机械判违规；语义命名仍须随责任重构复核。第 10、12 项没有额外硬凑一个“必须全仓改名/去继承”任务。

## 9 个已复现缺陷

复现源与观测值见 [隔离探针说明](D:/developWorkPlaces/win-box/architecture-audit/evidence/README.md)。探针显式执行时预期失败，正常测试目录不自动收录它们；修复后需迁入正式测试并转绿，不能靠忽略目录宣称修复。

### B01 · JS Worker 崩溃和释放必须结清全部调用

- [ ] P1；原则 #3/#8/#14；**3–5 小时**；可独立开始。
- **证据/差距：** Worker 退出后第三个排队调用仍 pending；dispose 后已执行调用没有立即结束。旧超时与队列承担了错误的终态所有权。
- **位置：** [src/engine/js/worker/JsWorkerPool.ts:242](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:242)；[src/engine/js/worker/JsWorkerPool.ts:298](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:298)；[src/engine/js/worker/JsWorkerPool.ts:470](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:470)
- **重构方向：** 用一个幂等终态操作结清 pending/queued 调用，清理定时器及 abort listener，拒绝迟到回执。
- **关闭条件：** 真实 Worker 下测试三个以上排队调用、执行中 dispose、崩溃+取消竞态；所有 Promise 恰好结算一次，不等待旧调用超时。
- **复现：** `lifecycle.probe.spec.ts:19`、`lifecycle.probe.spec.ts:33`

### B02 · 销毁蜘蛛不能新建 Worker，且池必须有明确宿主所有者

- [ ] P1；原则 #1/#5/#7/#8/#14；**2–4 小时**；依赖 B01。
- **证据/差距：** 销毁尚未打开的 sandbox 会调用 pick 并创建 3 个 Worker。工厂返回函数隐藏了 pool.dispose，应用生命周期没有显式持有 JS 池。
- **位置：** [src/engine/js/worker/JsWorkerPool.ts:115](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:115)；[src/engine/js/worker/JsWorkerPool.ts:347](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:347)；[src/engine/js/worker/JsWorkerPool.ts:485](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:485)；[src/main/spider/createSpiderRuntimeAssembly.ts:41](D:/developWorkPlaces/win-box/src/main/spider/createSpiderRuntimeAssembly.ts:41)；[src/main/spider/SpiderRuntimeLifecycle.ts:164](D:/developWorkPlaces/win-box/src/main/spider/SpiderRuntimeLifecycle.ts:164)
- **重构方向：** 销毁只访问已经存在的 slot；工厂返回可创建、可统一释放的窄能力，由组合根持有并接入配置重置/退出。
- **关闭条件：** 未打开或已回收的源 destroy 不产生 Worker；重复清缓存/配置切换/退出后 Worker、队列、回执监听恢复基线。
- **复现：** `lifecycle.probe.spec.ts:45`

### B03 · 进程池 dispose 漏杀同组中间进程

- [ ] P1；原则 #3/#8/#14；**1–2 小时**；可独立开始。
- **证据/差距：** 遍历 procs 时 kill 会 splice 同一数组；3 个同组进程观测 kill 次数为 [1,0,1]，随后清空登记表丢失中间进程。
- **位置：** [src/engine/spider/SpiderProcPool.ts:529](D:/developWorkPlaces/win-box/src/engine/spider/SpiderProcPool.ts:529)；[src/engine/spider/SpiderProcPool.ts:570](D:/developWorkPlaces/win-box/src/engine/spider/SpiderProcPool.ts:570)
- **重构方向：** 对稳定快照回收全部子进程，并结清请求、计时器和组登记。
- **关闭条件：** 同组 3 个以上进程、混合忙闲组及重复 dispose 都无漏杀；退出/异常不留下未结算调用或定时器。
- **复现：** `lifecycle.probe.spec.ts:74`

### B04 · 满池失败回退一次性进程绕过全局资源预算

- [ ] P1；原则 #2/#3/#4/#8/#14；**4–7 小时**；依赖 B03。
- **证据/差距：** 全局常驻池满且无可回收空闲组时返回未分类空失败；调用方当作池故障再运行一次性 JVM/Python。边界探针确认池满后另一次 runSubprocess 仍被调用。
- **位置：** [src/engine/spider/SpiderProcPool.ts:234](D:/developWorkPlaces/win-box/src/engine/spider/SpiderProcPool.ts:234)；[src/engine/spider/JarSpiderBridge.ts:1138](D:/developWorkPlaces/win-box/src/engine/spider/JarSpiderBridge.ts:1138)；[src/engine/spider/PythonSpiderRuntimeAdapter.ts:124](D:/developWorkPlaces/win-box/src/engine/spider/PythonSpiderRuntimeAdapter.ts:124)
- **重构方向：** 区分容量耗尽、取消、崩溃和源错误；统一 pooled/one-shot 的 admission budget，满载时排队或有界拒绝，真正崩溃的回退也受预算约束。
- **关闭条件：** 混合 JVM/Python、不同源组、冷回退并发都不越过同一实际进程上限；排队超时/取消释放名额；保留合法崩溃恢复。
- **复现：** `lifecycle.probe.spec.ts:84`

### B05 · 媒体上游中途失败后下游响应悬挂

- [ ] P1；原则 #3/#8/#14；**2–4 小时**；可独立开始。
- **证据/差距：** 已发送响应头/数据后，上游 error 只记录日志并销毁上游，没有结束下游。回环探针中客户端一直等待响应体完成。
- **位置：** [src/main/server/PlaybackRelayService.ts:400](D:/developWorkPlaces/win-box/src/main/server/PlaybackRelayService.ts:400)；[src/main/server/PlaybackRelayService.ts:347](D:/developWorkPlaces/win-box/src/main/server/PlaybackRelayService.ts:347)
- **重构方向：** 用 pipeline 或等价的双向流生命周期收敛；区分头前错误/头后断流，并在客户端断开时终止上游和测速计时器。
- **关闭条件：** 头前失败、首块之后失败、图片伪装剥离分支和用户关闭窗口均结束响应；不挂起、不伪报完整视频、不泄漏连接。
- **复现：** `relay.probe.spec.ts:8`

### B06 · 用户设置写盘失败仍确认保存成功

- [ ] P1；原则 #1/#3/#4/#8/#14；**3–6 小时**；可独立开始。
- **证据/差距：** DavStore 先改内存，再调用吞异常的 flush；注入写盘失败后依然返回成功且内存含新条目。同样的用户设置写回模式还存在于 UC Token、插件字段及启停状态。缓存容错不能作为用户设置的提交语义。
- **位置：** [src/main/store/JsonStore.ts:53](D:/developWorkPlaces/win-box/src/main/store/JsonStore.ts:53)；[src/main/store/DavStore.ts:74](D:/developWorkPlaces/win-box/src/main/store/DavStore.ts:74)；[src/main/store/UcTvStore.ts:42](D:/developWorkPlaces/win-box/src/main/store/UcTvStore.ts:42)；[src/main/plugin/PluginSettingsService.ts:75](D:/developWorkPlaces/win-box/src/main/plugin/PluginSettingsService.ts:75)；[src/main/plugin/PluginHost.ts:465](D:/developWorkPlaces/win-box/src/main/plugin/PluginHost.ts:465)
- **重构方向：** 区分可丢弃缓存与用户数据；用户数据使用严格原子写入，写成功才发布内存/广播成功。给消费者定义窄的事务持久化端口，复用 DriveStore 已有严格写模式。
- **关闭条件：** 逐个消费者注入磁盘写入失败，UI 收到可重试错误，内存与重启后数据保持旧值；成功写入正常广播；缓存失败仍可容错。
- **复现：** `contracts.probe.spec.ts:10`

### B07 · 配置已持久化却因运行时观察者异常被报告为失败

- [ ] P1；原则 #1/#3/#8/#13/#14；**2–4 小时**；依赖 B06。
- **证据/差距：** commit 已写入新快照并增加 revision 后直接调用可抛异常的 onChange。故障注入得到“调用抛错，但持久化已是新配置”，调用方无法区分保存失败与运行时刷新失败。
- **位置：** [src/main/store/UserConfigRepository.ts:66](D:/developWorkPlaces/win-box/src/main/store/UserConfigRepository.ts:66)；[src/main/store/UserConfigRepository.ts:88](D:/developWorkPlaces/win-box/src/main/store/UserConfigRepository.ts:88)；[src/main/spider/SourceRuntimeConfiguration.ts:33](D:/developWorkPlaces/win-box/src/main/spider/SourceRuntimeConfiguration.ts:33)
- **重构方向：** 让持久化结果与运行时同步结果分离；通知失败可重试并有可见诊断，不把它伪装为未保存。避免不可靠的二次隐式回滚覆盖已完成提交。
- **关闭条件：** 观察者同步抛错时，返回明确的已保存/同步失败结果或等价可识别状态；重试同步不重复提交；写盘失败路径仍完整回滚。
- **复现：** `contracts.probe.spec.ts:23`

### B08 · 插件升级不重载代码，启动失败后也不重试

- [ ] P1；原则 #2/#3/#8/#13/#14；**3–6 小时**；可独立开始。
- **证据/差距：** sync 只判断相同 id 是否已有 box；入口、版本或权限变更不重建 Worker，失败 box 也一直留在表里。两次同步探针均只创建 1 次且没有释放旧 box。
- **位置：** [src/main/plugin/sandbox/PluginSandboxLifecycle.ts:42](D:/developWorkPlaces/win-box/src/main/plugin/sandbox/PluginSandboxLifecycle.ts:42)；[src/main/plugin/PluginHost.ts:128](D:/developWorkPlaces/win-box/src/main/plugin/PluginHost.ts:128)；[src/main/plugin/PluginHost.ts:411](D:/developWorkPlaces/win-box/src/main/plugin/PluginHost.ts:411)
- **重构方向：** 按载荷版本/内容指纹、入口和权限形成实例身份；替换时先终止旧会话，启动失败可显式重试，约束并发 refresh 的代次。
- **关闭条件：** 覆盖同 id 升级、入口不变但内容变、权限变更、失败后重试、停用/卸载时仍在 start 的竞态；旧插件不再收到能力回执。
- **复现：** `contracts.probe.spec.ts:44`、`contracts.probe.spec.ts:53`

### B09 · Python 默认空能力与初始化错误被当成成功

- [ ] P1；原则 #3/#4/#10/#14；**2–4 小时**；可独立开始。
- **证据/差距：** 继承 base.Spider 而未实现 searchContent 会返回合法空列表；_invoke 只检查方法存在。源 init 内部 TypeError 也被整个吞掉。这与 JS/JVM 已能区分 unsupported/真实执行失败的契约不一致。
- **位置：** [resources/jvm/python-runner/base/spider.py:27](D:/developWorkPlaces/win-box/resources/jvm/python-runner/base/spider.py:27)；[resources/jvm/python-runner/runner.py:87](D:/developWorkPlaces/win-box/resources/jvm/python-runner/runner.py:87)；[resources/jvm/python-runner/runner.py:214](D:/developWorkPlaces/win-box/resources/jvm/python-runner/runner.py:214)；[resources/jvm/python-runner/runner.py:314](D:/developWorkPlaces/win-box/resources/jvm/python-runner/runner.py:314)
- **重构方向：** 在兼容适配边界识别继承的默认桩；用签名匹配处理可选 init，传播函数体内部异常。保留真正实现的方法返回空列表这一合法结果。
- **关闭条件：** Python 标准库探针转绿；补齐单次/常驻两条执行模式、继承合法自定义实现、空结果、缺方法及内部异常；共同消费者无需识别运行时种类。
- **复现：** `python-capabilities.probe.py:20`、`python-capabilities.probe.py:27`

## 21 个架构和性能改造项

以下按独立责任/资源预算去重，不把大文件、hook 个数、缓存存在本身视为 bug；实测占用与收益由 V05 给出。

### A01 · 给 JS sandbox/蜘蛛实例缓存建立每源回收预算

- [ ] P1；原则 #1/#8/#14；**3–6 小时**；依赖 B01、B02。
- **证据/差距：** 缓存目前主要靠全量 clear/worker 回收；最后一个保留 Worker 内没有逐源淘汰预算。全仓跨源搜索可逐步积累 VM 上下文，现未量测实际 RSS 增量，不能直接称为已证实内存泄漏。
- **位置：** [src/engine/spider/SpiderCache.ts:6](D:/developWorkPlaces/win-box/src/engine/spider/SpiderCache.ts:6)；[src/engine/js/worker/entry.ts:20](D:/developWorkPlaces/win-box/src/engine/js/worker/entry.ts:20)；[src/engine/js/worker/JsWorkerPool.ts:456](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:456)
- **重构方向：** 建立活跃租约、源级 LRU/TTL 或字节/数量双预算；淘汰释放 VM/缓存且不能影响正在执行的源；与显式池所有权接线。
- **关闭条件：** 连续多轮全源搜索后源上下文数量受限；活跃调用不被淘汰；冷重建正确；按 V05 量测回收后的平台值。

### A02 · 搜索取消从展示代次贯穿 IPC 到后台请求

- [ ] P1；原则 #3/#4/#7/#8/#14；**4–8 小时**；依赖 B01、B04。
- **证据/差距：** 当前取消主要使旧结果失效；HomeSearchPort 没有取消能力，broker.clear 只移除登记。快速切关键词、关闭搜索窗口后，旧搜索仍可占用 HTTP/Worker/进程预算到自身截止。
- **位置：** [src/renderer/features/home/application/HomeSearchWorkflow.ts:88](D:/developWorkPlaces/win-box/src/renderer/features/home/application/HomeSearchWorkflow.ts:88)；[src/renderer/features/home/application/homePorts.ts:71](D:/developWorkPlaces/win-box/src/renderer/features/home/application/homePorts.ts:71)；[src/main/ipc/vodIpc.ts:42](D:/developWorkPlaces/win-box/src/main/ipc/vodIpc.ts:42)；[src/main/spider/AggregateSearchRequestBroker.ts:12](D:/developWorkPlaces/win-box/src/main/spider/AggregateSearchRequestBroker.ts:12)
- **重构方向：** 加入请求会话/取消端口；共享同词任务按订阅者计数，最后消费者退出才取消底层；不同关键词共享宿主资源预算。
- **关闭条件：** 连续提交 10 个查询/关闭窗口，旧任务在有界时间释放；一个窗口取消不能中断另一窗口仍订阅的同词搜索；无迟到 UI 更新。

### A03 · 限制子进程协议帧和日志缓冲大小

- [ ] P1；原则 #3/#8/#14；**2–4 小时**；依赖 B03。
- **证据/差距：** 一次性 stdout/stderr 和常驻行协议 buf 持续累积，没有单帧/累计字节上限。异常日志或不换行输出能够放大内存；尚未测定生产出现频率。
- **位置：** [src/engine/spider/SpiderSubprocessRunner.ts:57](D:/developWorkPlaces/win-box/src/engine/spider/SpiderSubprocessRunner.ts:57)；[src/engine/spider/SpiderProcPool.ts:449](D:/developWorkPlaces/win-box/src/engine/spider/SpiderProcPool.ts:449)
- **重构方向：** 分开结果帧预算与截断日志环；超限返回有类型诊断并回收进程；不能截断合法 JSON 后伪报源无结果。
- **关闭条件：** 用无换行大输出、超大 JSON、持续 stderr、拆包 UTF-8 与合法边界帧验证内存上界和恰好一次结算。

### A04 · 共享内存 HTTP 回执只能完成一次，超大响应必须显式失败

- [ ] P1；原则 #3/#8/#14；**2–4 小时**；依赖 B01。
- **证据/差距：** 超时回执与迟到 HTTP 结果都可写同一 SAB；超长序列化数据会被截到固定 8 MiB，可能变成不可解析 JSON。这里是代码确认的协议风险，本轮没有并发压力复现。
- **位置：** [src/engine/js/worker/JsWorkerPool.ts:185](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:185)；[src/engine/js/worker/JsWorkerPool.ts:225](D:/developWorkPlaces/win-box/src/engine/js/worker/JsWorkerPool.ts:225)；[src/engine/js/worker/protocol.ts:19](D:/developWorkPlaces/win-box/src/engine/js/worker/protocol.ts:19)；[src/engine/js/worker/remoteHost.ts:20](D:/developWorkPlaces/win-box/src/engine/js/worker/remoteHost.ts:20)
- **重构方向：** 使用 first-winner 状态/CAS 或等价单次发布协议；超限写入小型有类型错误帧；把数据写入与完成标志的内存顺序写清楚。
- **关闭条件：** 可控交错超时与成功回执，消费者永不读取被覆盖的半帧；大于预算返回明确 oversize；取消/迟到不污染下一次调用。

### A05 · 小型 HTTP 文本与 HLS 清单按字节和读取截止设预算

- [ ] P1；原则 #3/#7/#8/#14；**3–5 小时**；依赖 B05。
- **证据/差距：** 文本响应和清单使用完整 arrayBuffer；媒体流的无限 bodyTimeout 被清单缓冲路径沿用。误标的 m3u8/无限响应会占用等待与内存，尚未测量生产频率。
- **位置：** [src/main/server/UpstreamHttpClient.ts:66](D:/developWorkPlaces/win-box/src/main/server/UpstreamHttpClient.ts:66)；[src/main/server/UpstreamHttpClient.ts:39](D:/developWorkPlaces/win-box/src/main/server/UpstreamHttpClient.ts:39)；[src/main/server/PlaybackRelayService.ts:256](D:/developWorkPlaces/win-box/src/main/server/PlaybackRelayService.ts:256)
- **重构方向：** 流媒体与清单/配置采用不同读取策略；小体积响应按字节预算+总截止读取；客户端取消贯穿重定向、清单与流。
- **关闭条件：** 超大/无限清单及时终止；正常长视频不被 API 截止误杀；重定向、HEAD/Range 和错误状态不回归。

### A06 · 媒体组件下载补齐传输预算和可替换安装用例

- [ ] P2；原则 #1/#4/#5/#7/#8/#14；**3–5 小时**；可独立开始。
- **证据/差距：** 已实现官方资产选择、SHA-256、PE 检查、临时解压和原子 manifest；但安装类仍直接绑定 fetch/文件/Worker/全局 playerSettings，下载只在完成后检查字节数，缺显式请求总截止。
- **位置：** [src/main/player/MediaRuntimeProvisioner.ts:76](D:/developWorkPlaces/win-box/src/main/player/MediaRuntimeProvisioner.ts:76)；[src/main/player/MediaRuntimeProvisioner.ts:169](D:/developWorkPlaces/win-box/src/main/player/MediaRuntimeProvisioner.ts:169)；[src/main/player/MediaRuntimeProvisioner.ts:187](D:/developWorkPlaces/win-box/src/main/player/MediaRuntimeProvisioner.ts:187)
- **重构方向：** 保留现有可信下载链；用下载/解压/落盘/设置端口组织安装用例，流中超额就停止，统一超时、取消、清理结果。
- **关闭条件：** 慢/无限/超额响应、解压失败、manifest 写入失败、用户取消及重复安装均可用端口替身验证；失败仍能使用旧 active 版本。

### A07 · JAR 转换与运行会话策略的职责边界仍需收敛

- [ ] P2；原则 #1/#4/#5/#6/#7/#14；**5–9 小时**；依赖 B04、B09。
- **证据/差距：** 桥同时拥有转换阶段/缓存版本与修复、JVM 参数/本地资产、调用池回退和多运行时准备。已有转换注册表和运行时端口，但仍有跨责任共享可变状态。1431 行是定位信号，不是独立定罪理由。
- **位置：** [src/engine/spider/JarSpiderBridge.ts:279](D:/developWorkPlaces/win-box/src/engine/spider/JarSpiderBridge.ts:279)；[src/engine/spider/JarSpiderBridge.ts:589](D:/developWorkPlaces/win-box/src/engine/spider/JarSpiderBridge.ts:589)；[src/engine/spider/JarSpiderBridge.ts:968](D:/developWorkPlaces/win-box/src/engine/spider/JarSpiderBridge.ts:968)；[src/engine/spider/JarSpiderBridge.ts:1237](D:/developWorkPlaces/win-box/src/engine/spider/JarSpiderBridge.ts:1237)
- **重构方向：** 把 artifact preparation、launch specification 和 execution session 按变更原因形成边界，Node I/O 留在运行时适配器；兼容实现无需搬进纯领域。
- **关闭条件：** 转换/参数选择/回退策略可脱离真实磁盘与 JVM 测试；入口输出、代理端口身份、取消与进度行为保持；不新增只做转发的 Manager。

### A08 · 播放器 Presenter 的跨控制域编排仍过重

- [ ] P2；原则 #1/#4/#6/#8/#11/#14；**5–9 小时**；依赖 B05、A09。
- **证据/差距：** 已把解析、音轨、偏好、跳过片段等职责移出，但一个 Presenter 仍交叉接线内核交接、暂停/音量、字幕/弹幕互斥、自动下一集，并组装全部控件动作。视图已被动化，不等于跨会话状态责任已经清晰。
- **位置：** [src/renderer/features/playback/VideoPlayerPresenter.ts:165](D:/developWorkPlaces/win-box/src/renderer/features/playback/VideoPlayerPresenter.ts:165)；[src/renderer/features/playback/VideoPlayerPresenter.ts:361](D:/developWorkPlaces/win-box/src/renderer/features/playback/VideoPlayerPresenter.ts:361)；[src/renderer/features/playback/VideoPlayerPresenter.ts:690](D:/developWorkPlaces/win-box/src/renderer/features/playback/VideoPlayerPresenter.ts:690)
- **重构方向：** 按会话状态/控制区域组织专责展示模型；交接/恢复/互斥等业务决策有独立应用策略，顶层只组合和投影；保留窄消费者端口，不机械拆成多个转发文件。
- **关闭条件：** 用不挂载完整播放器的用例覆盖换内核保持位置/暂停、互斥弹层、自动下一集与老板键；现有控件全部保留；Presenter 不再修改其它子域的内部 ref。

### A09 · HTML5/HLS/FLV 资源绑定与恢复策略仍在同一 React effect

- [ ] P2；原则 #1/#3/#4/#6/#7/#8/#14；**4–7 小时**；依赖 B05。
- **证据/差距：** DOM 绑定、HLS/MPEG-TS 初始化/销毁、重试计数、内核/外置回退与观看时间线在一个会话 effect 中协调。已有 time-line 纯规则，但错误恢复矩阵仍依赖整个 hook。
- **位置：** [src/renderer/features/playback/useHtml5PlaybackSession.ts:53](D:/developWorkPlaces/win-box/src/renderer/features/playback/useHtml5PlaybackSession.ts:53)；[src/renderer/features/playback/useHtml5PlaybackSession.ts:90](D:/developWorkPlaces/win-box/src/renderer/features/playback/useHtml5PlaybackSession.ts:90)
- **重构方向：** 浏览器媒体适配器拥有元素与库实例；有限的恢复状态/预算决定留在框架无关工作流。按实际协议定义最小控制/事件端口，避免统一成无限大播放器接口。
- **关闭条件：** 假媒体端口即可验证 HTTP 错误、解码失败、重试耗尽、外置失败、切 URL 与晚到错误；DOM/HLS 集成仅验证绑定与清理。

### A10 · 首页浏览分页、筛选恢复与请求生命周期仍依赖 React 状态

- [ ] P2；原则 #1/#4/#6/#7/#8/#11/#14；**4–7 小时**；依赖 A02。
- **证据/差距：** HomeSearchWorkflow 已框架无关；浏览侧仍直接用多个 setState/ref 维护分类、分页、准备重试、瀑布追加与快照，接口暴露 React Dispatch/MutableRefObject。
- **位置：** [src/renderer/features/home/useHomeBrowseController.ts:11](D:/developWorkPlaces/win-box/src/renderer/features/home/useHomeBrowseController.ts:11)；[src/renderer/features/home/useHomeBrowseController.ts:46](D:/developWorkPlaces/win-box/src/renderer/features/home/useHomeBrowseController.ts:46)；[src/renderer/features/home/useHomeBrowseController.ts:126](D:/developWorkPlaces/win-box/src/renderer/features/home/useHomeBrowseController.ts:126)
- **重构方向：** 把浏览会话状态转换和异步用例集中成 application workflow，hook 只订阅发布状态和装配滚动观察器；继续复用已拆出的搜索/浏览窄接口。
- **关闭条件：** 不依赖 React 测试来源切换、乱序 home/category、筛选/分页恢复、重复分页/瀑布终止；现有视图与搜索回退不变。

### A11 · 设置页剩余页面状态与视图分离

- [ ] P2；原则 #1/#6/#11/#14；**2–4 小时**；可独立开始。
- **证据/差距：** 各设置业务 Presenter 已存在，但页面仍管理共享 busy/初载错误、标签路由、设置检索、初始加载和 JSX。不能因文件里没有直接 IPC 就称为 Passive View。
- **位置：** [src/renderer/pages/ConfigPage.tsx:111](D:/developWorkPlaces/win-box/src/renderer/pages/ConfigPage.tsx:111)；[src/renderer/pages/ConfigPage.tsx:150](D:/developWorkPlaces/win-box/src/renderer/pages/ConfigPage.tsx:150)；[src/renderer/pages/ConfigPage.tsx:175](D:/developWorkPlaces/win-box/src/renderer/pages/ConfigPage.tsx:175)
- **重构方向：** 以页面展示模型收口共享状态、路由解析与事件动作；ConfigPage 保留组合根装配，独立 View 只声明式渲染；不把已原子化配置聚合再拆成多个存储。
- **关闭条件：** 页面 View 不拥有业务状态/加载副作用；纯展示用例覆盖深链接、检索/清除、切标签和初载失败重试；导入/激活忙碌关系明确。

### A12 · 详情页仍直接编排收藏存储与窗口展示逻辑

- [ ] P2；原则 #1/#4/#5/#6/#7/#11/#14；**3–5 小时**；可独立开始。
- **证据/差距：** 详情数据与播放已有用例/端口；收藏读写、全局事件订阅、名称兜底、详情窗口判断和 JSX 仍混在页面。
- **位置：** [src/renderer/pages/DetailPage.tsx:124](D:/developWorkPlaces/win-box/src/renderer/pages/DetailPage.tsx:124)；[src/renderer/pages/DetailPage.tsx:136](D:/developWorkPlaces/win-box/src/renderer/pages/DetailPage.tsx:136)；[src/renderer/pages/DetailPage.tsx:37](D:/developWorkPlaces/win-box/src/renderer/pages/DetailPage.tsx:37)
- **重构方向：** 复用 favorites feature 的领域键和持久化边界，通过详情收藏端口/Presenter 同步；详情展示与动作模型分开，路由/窗口能力由组合点注入。
- **关闭条件：** 详情 View 不读 localStorage/全局收藏存储；同名跨档案身份不串；收藏移除/添加及辅助窗口刷新、播放/绑定入口都保持。

### A13 · 发现/榜单及影片来源面板补齐展示模型和错误状态

- [ ] P2；原则 #1/#4/#6/#7/#11/#14；**4–7 小时**；可独立开始。
- **证据/差距：** BoardsPage 把 sections 读取失败吞掉，把凭据读取失败当作无凭据；MovieSourcesPanel 同时持有筛选/文件夹状态、结果投影、异步展开、导航和 JSX。现有来源搜索用例不需重写。
- **位置：** [src/renderer/pages/BoardsPage.tsx:22](D:/developWorkPlaces/win-box/src/renderer/pages/BoardsPage.tsx:22)；[src/renderer/features/detail/MovieSourcesPanel.tsx:17](D:/developWorkPlaces/win-box/src/renderer/features/detail/MovieSourcesPanel.tsx:17)；[src/renderer/pages/DiscoverPage.tsx:39](D:/developWorkPlaces/win-box/src/renderer/pages/DiscoverPage.tsx:39)
- **重构方向：** 为榜单和来源面板分别提供 Presenter/View，加载/空/失败/缺凭据状态显式区分；来源筛选、相关度与封面投影可独立验证。
- **关闭条件：** 断网能看到错误并重试，不误导用户配 Key；来源筛选、片名相关/全部返回、封面兜底和文件夹返回保持；发现点击仍进入对应影片详情。

### A14 · 插件设置页仍把安装、启停、字段写回与 JSX 混合

- [ ] P2；原则 #1/#4/#6/#7/#11/#14；**3–5 小时**；依赖 B06、B08。
- **证据/差距：** 组件持有加载/安装/卸载/启停/字段保存流程与多个结果面板，直接调用依赖并刷新主题/广播，失败和保存后刷新关系分散。
- **位置：** [src/renderer/features/settings/PluginSettingsSection.tsx:10](D:/developWorkPlaces/win-box/src/renderer/features/settings/PluginSettingsSection.tsx:10)；[src/renderer/features/settings/PluginSettingsPanels.tsx:1](D:/developWorkPlaces/win-box/src/renderer/features/settings/PluginSettingsPanels.tsx:1)；[src/renderer/features/settings/PluginKeymapList.tsx:1](D:/developWorkPlaces/win-box/src/renderer/features/settings/PluginKeymapList.tsx:1)
- **重构方向：** 安装/启停等应用工作流与页面 Presenter 分层；字段草稿使用窄展示状态；被动 View 只委托命令，统一错误和已保存但刷新失败的反馈。
- **关闭条件：** 不挂载完整设置页即可测试权限确认、用户取消、安装失败、升级、启停/保存失败；View 覆盖选中/禁用/加载语义；不损失插件面板与快捷键功能。

### A15 · 来源选择器的业务投影与浮层状态继续归位

- [ ] P2；原则 #1/#6/#8/#9/#11/#14；**3–5 小时**；可独立开始。
- **证据/差距：** 源读取/切换已有 controller，但通用 components/SourcePicker 仍反向依赖订阅 feature，自己计算跨档案来源列表/检索、计时器和焦点，并渲染。
- **位置：** [src/renderer/components/SourcePicker.tsx:48](D:/developWorkPlaces/win-box/src/renderer/components/SourcePicker.tsx:48)；[src/renderer/components/SourcePicker.tsx:116](D:/developWorkPlaces/win-box/src/renderer/components/SourcePicker.tsx:116)；[src/renderer/features/subscriptions/ProfileSwitcher.tsx:1](D:/developWorkPlaces/win-box/src/renderer/features/subscriptions/ProfileSwitcher.tsx:1)
- **重构方向：** 将业务选择器归入 subscriptions organism；投影/动作进入 Presenter，浮层定位与焦点留在可复用 UI 适配层；基础原子不依赖订阅业务。
- **关闭条件：** 受控/自加载、跨档案一步切源、回车选择、Escape/焦点恢复和移出延迟关闭都可独立验收；当前源高亮有可识别语义。

### A16 · AppShell 的导航规则与跨窗口内存同步独立成会话边界

- [ ] P2；原则 #1/#4/#5/#6/#7/#8/#11/#14；**3–5 小时**；可独立开始。
- **证据/差距：** App 是合法组合根，直接接 IPC 本身不判错；问题是返回路径策略、快捷键、历史/收藏加载保存、窗口导航握手和 UI 同处一个外壳函数，互相借用路由状态。
- **位置：** [src/renderer/App.tsx:109](D:/developWorkPlaces/win-box/src/renderer/App.tsx:109)；[src/renderer/App.tsx:157](D:/developWorkPlaces/win-box/src/renderer/App.tsx:157)；[src/renderer/App.tsx:192](D:/developWorkPlaces/win-box/src/renderer/App.tsx:192)
- **重构方向：** 保留组合根；把返回决策做纯策略，外壳生命周期通过事件/持久化/窗口端口连接，展示外壳消费模型。不要为了清除所有 import 而制造 service locator。
- **关闭条件：** 主/详情/搜索/播放窗口的返回、挂载/卸载、焦点同步和迟到导航有端口替身测试；不遗漏历史保存，也不重复注册监听。

### A17 · 媒体绘制/图集/进度控件的状态和 DOM 适配边界明确化

- [ ] P2；原则 #1/#5/#6/#7/#8/#11/#14；**4–7 小时**；可独立开始。
- **证据/差距：** 弹幕布局虽在 engine，模块导入仍修改全局文本测量器；绘制缓存/RAF、图集重试/缩放拖动、进度手势与 JSX 仍共置。不能把这些 DOM 适配模块统称纯领域/被动 View。
- **位置：** [src/renderer/components/DanmakuOverlay.tsx:48](D:/developWorkPlaces/win-box/src/renderer/components/DanmakuOverlay.tsx:48)；[src/renderer/components/DanmakuOverlay.tsx:111](D:/developWorkPlaces/win-box/src/renderer/components/DanmakuOverlay.tsx:111)；[src/renderer/components/ImageViewer.tsx:31](D:/developWorkPlaces/win-box/src/renderer/components/ImageViewer.tsx:31)；[src/renderer/features/playback/PlayerProgressBar.tsx:1](D:/developWorkPlaces/win-box/src/renderer/features/playback/PlayerProgressBar.tsx:1)
- **重构方向：** 测量能力作为布局实例/调用依赖显式传入；绘制生命周期由 canvas adapter 持有，图集和进度的交互规则由 Presenter/纯坐标策略负责，View 只委托。
- **关闭条件：** 多实例测量不互相污染；拖动/键盘 seek/缩放/重试地址正确；关闭组件释放 RAF/监听；DPR、全屏与开关弹幕无拖影的实际结果由 V03 验收。

### A18 · 统一原子组件、交互状态和样式所有权，消除跨外壳补丁级联

- [ ] P2；原则 #2/#6/#9/#11/#14；**8–14 小时**；依赖 A11、A12、A13、A14、A15、A17。
- **证据/差距：** 已有 Fluent UI 包装和语义 token，但原生 button/模块 CSS/legacy/四套 shell/desktop 仍共同控制同一控件，专门的 rate/drive cascade 修补说明所有权未统一。31 个 JSX+状态/effect 模块是审查候选，不等于 31 个已确认缺陷。
- **位置：** [src/renderer/components/ui/Button.tsx:13](D:/developWorkPlaces/win-box/src/renderer/components/ui/Button.tsx:13)；[src/renderer/styles/global.css:1](D:/developWorkPlaces/win-box/src/renderer/styles/global.css:1)；[src/renderer/styles/global-player.css:1](D:/developWorkPlaces/win-box/src/renderer/styles/global-player.css:1)；[src/renderer/styles/desktop.css:336](D:/developWorkPlaces/win-box/src/renderer/styles/desktop.css:336)；[src/renderer/styles/player-rate-cascade.css:1](D:/developWorkPlaces/win-box/src/renderer/styles/player-rate-cascade.css:1)
- **重构方向：** 复用现有 Fluent/基础组件，制定状态契约和原子/分子/业务 organism 依赖规则；播放器控件样式由 feature 拥有，外壳仅布局，皮肤只 token；逐步移除重复覆盖而非再加高权重规则。
- **关闭条件：** 各控件默认/hover/focus/selected/disabled/loading/error 有明确前景、表面和语义；选中态不能只靠色差；功能无减少；对比度/缩放最终以 V03 的计算样式和真实窗口验收关闭。

### A19 · 本地脚本/目录/直播导入业务离开 IPC 适配器

- [ ] P2；原则 #1/#4/#5/#6/#7/#8/#14；**3–5 小时**；依赖 B07。
- **证据/差距：** IPC 适配器还直接循环复制脚本、推断命名、登记源、失败清理副本、处理纯 Python 目录二阶段确认及直播登记。UI 对话框和文件 I/O 是适配器职责，但批量提交/补偿策略应独立。
- **位置：** [src/main/ipc/index.ts:285](D:/developWorkPlaces/win-box/src/main/ipc/index.ts:285)；[src/main/ipc/index.ts:327](D:/developWorkPlaces/win-box/src/main/ipc/index.ts:327)；[src/main/ipc/index.ts:387](D:/developWorkPlaces/win-box/src/main/ipc/index.ts:387)
- **重构方向：** 文件选择/读写作为端口，批量导入和二阶段命名形成应用用例；保留每文件独立成败及清理补偿语义，不拆开 UserConfig 根聚合事务。
- **关闭条件：** 不加载 Electron 测试部分成功、取消命名、源登记失败、清理失败和配置并发更改；IPC 只做输入/对话框/DTO 委托。

### A20 · 架构门禁从大量特定文件规则扩到明确模块角色

- [ ] P2；原则 #2/#6/#7/#9/#11/#14；**3–5 小时**；依赖 A07、A08、A10、A18、A19。
- **证据/差距：** 跨顶层依赖规则可靠，但多数细粒度防回归按文件名逐条加。改名/新建模块可能不受同样规则约束；0 个跨层错误不能证明应用用例全部无框架依赖。
- **位置：** [scripts/architecture-boundaries.mjs:14](D:/developWorkPlaces/win-box/scripts/architecture-boundaries.mjs:14)；[scripts/architecture-boundaries.mjs:40](D:/developWorkPlaces/win-box/scripts/architecture-boundaries.mjs:40)；[scripts/architecture-boundaries.mjs:100](D:/developWorkPlaces/win-box/scripts/architecture-boundaries.mjs:100)
- **重构方向：** 明确 domain/application/adapter/composition/view 的角色目录或小型角色清单；通用 AST 规则覆盖新文件、相对别名/导出/动态字面量导入，保留必要平台例外及原因。
- **关闭条件：** 新增/改名一个违规 application 或业务原子组件会被同一规则拦下；合法组合根/DOM adapter 不误报；规则测试验证真实依赖而非仅匹配字符串。

### A21 · 按实际运行依赖闭包收敛包体，避免重复携带已打包库

- [ ] P2；原则 #1/#6/#14；**3–6 小时**；可独立开始。
- **证据/差距：** packager 保留全部生产 node_modules 并验证每个生产依赖都在包中；main/worker/renderer 已 bundle 多个相同库。Babel、解压器等确有运行时外部依赖，不能直接删 node_modules 或把所有依赖改 dev。当前尚无按包路径的字节账本。
- **位置：** [scripts/package-app.mjs:49](D:/developWorkPlaces/win-box/scripts/package-app.mjs:49)；[scripts/package-app.mjs:90](D:/developWorkPlaces/win-box/scripts/package-app.mjs:90)；[scripts/build-main.mjs:65](D:/developWorkPlaces/win-box/scripts/build-main.mjs:65)
- **重构方向：** 生成 dist 与动态 require/worker 共同需要的运行依赖闭包，按实际字节找重复；发布副本裁剪测试/源码/无用平台资源，保留许可证与所有运行时 external。
- **关闭条件：** 输出安装包/ASAR/资源分项大小及前后对照；隔离干净目录能启动 JS/JVM/Python、解压和下载能力；A/B 不减少 React Compiler 的 hooks 覆盖，不预承诺压缩比例。

## 6 个集成和实机验收项

单元测试覆盖代码契约；这些任务覆盖真实运行、打包与交互结果。测试未运行、缺依赖或外部源失效应报告 NOT_RUN/外部失败原因，不写作通过。

### V01 · JS/JVM/Python/原生桥共同替换契约与生命周期矩阵验收

- [ ] P1；原则 #3/#4/#7/#8/#10/#13/#14；**5–8 小时**；依赖 B01、B02、B03、B04、B08、B09、A03、A04、A07。
- **证据/差距：** 已有零散契约测试，仍缺同一消费者下的跨运行时完整对照。原生桥支持 ARM32/AArch64 的选定 JNI 能力，不能据此宣布任意 .so 均支持；例如返回 F/D 仍走不支持分支。
- **位置：** [src/engine/spider/SpiderSourceRuntimeAdapter.ts:17](D:/developWorkPlaces/win-box/src/engine/spider/SpiderSourceRuntimeAdapter.ts:17)；[resources/jvm/SpiderRunner.java:685](D:/developWorkPlaces/win-box/resources/jvm/SpiderRunner.java:685)；[resources/jvm/python-runner/runner.py:87](D:/developWorkPlaces/win-box/resources/jvm/python-runner/runner.py:87)；[resources/jvm/native-bridge/com/winbox/nativebridge/NativeBridge.java:536](D:/developWorkPlaces/win-box/resources/jvm/native-bridge/com/winbox/nativebridge/NativeBridge.java:536)
- **重构方向：** 建立共享 conformance fixtures：成功/合法空/缺能力/初始化失败/超时/取消/崩溃/销毁与晚回执；分别执行单次与常驻；原生范围按能力表列出。
- **关闭条件：** JS/JVM/Python 同一契约集通过，native 支持/不支持均有可识别诊断；报告真实运行和替身覆盖，缺 JDK/资产时显示 NOT_RUN，不能当 PASS。

### V02 · 真实播放与外置播放器、超分能力边界验收

- [ ] P1；原则 #3/#7/#14；**4–8 小时**；依赖 B05、B09、A05、A08、A09。
- **证据/差距：** 已有真实本地 VP8/HTML5/MPV 验收工具，外部源矩阵默认 NOT_RUN 且工具只检查导入/首页/搜索，不覆盖从真实结果解析到播放。PotPlayer 路径、格式兼容、全局账号及超分当前未做本快照实机对照。
- **位置：** [scripts/verify-playback.mjs:81](D:/developWorkPlaces/win-box/scripts/verify-playback.mjs:81)；[scripts/verify-playback.mjs:134](D:/developWorkPlaces/win-box/scripts/verify-playback.mjs:134)；[scripts/source-acceptance.mjs:31](D:/developWorkPlaces/win-box/scripts/source-acceptance.mjs:31)；[src/main/torrent/ExternalPlayback.ts:47](D:/developWorkPlaces/win-box/src/main/torrent/ExternalPlayback.ts:47)
- **重构方向：** 先可控夹具验证 MP4/HLS/TS、401/403/HTML 假媒体、Range/跳转；再按获准的代表来源测完整播放。单独验证已配置 PotPlayer 直接启动和失败反馈；超分按内核能力如实展示。
- **关闭条件：** 保存至少 HTML5、托管 MPV、PotPlayer 的实际启动/时间推进/暂停续播证据；源失效与播放器回归分开；账号切子仓可复用；明确托管 shader 不自动影响任意外部播放器。

### V03 · 全窗口可读性、交互状态、DPI 与功能保留验收

- [ ] P1；原则 #6/#9/#11/#14；**6–10 小时**；依赖 A08、A11、A12、A13、A14、A15、A17、A18。
- **证据/差距：** token 对比度测试和局部 CSS 已修，但不覆盖每个实际级联结果。暂停背景/图标尺度、原生菜单、音量 thumb 居中、选中态辨识与历史卡片的最终窗口效果尚未逐项签收。
- **位置：** [src/renderer/styles/desktop.css:665](D:/developWorkPlaces/win-box/src/renderer/styles/desktop.css:665)；[src/renderer/styles/global-foundation.css:1](D:/developWorkPlaces/win-box/src/renderer/styles/global-foundation.css:1)；[src/renderer/pages/ComponentShowcasePage.tsx:1](D:/developWorkPlaces/win-box/src/renderer/pages/ComponentShowcasePage.tsx:1)；[src/renderer/features/playback/PlayerVolumeControl.tsx:1](D:/developWorkPlaces/win-box/src/renderer/features/playback/PlayerVolumeControl.tsx:1)
- **重构方向：** 按窗口×组件状态×主题/外壳×DPI 建立检查矩阵；复用已有 showcase，计算最终样式并用真实 Electron 窗口复核；业务功能清单作回归对照。
- **关闭条件：** 主/详情/搜索/播放器/全局账号/设置/历史/直播/存储均有记录；100/125/150% DPI 与窄宽布局；沿用仓库普通文本4.5:1/功能边界3:1口径；键盘焦点、selected 语义、弹幕拖影和暂停无模糊逐项关闭。

### V04 · 运行中升级、先卸载再安装及数据保留验收

- [ ] P1；原则 #8/#14；**3–5 小时**；依赖 B02、B03、B06、A21。
- **证据/差距：** 实际安装器已有停止/覆盖或先卸载再安装页面，不能再说完全未实现。验收函数的 stopRunningProcess 默认 false，CLI 未传该选项；标准命令无法覆盖用户反复报告的运行中安装场景。注册表/快捷方式也在隔离验收外。
- **位置：** [scripts/installer-script.mjs:103](D:/developWorkPlaces/win-box/scripts/installer-script.mjs:103)；[scripts/installer-script.mjs:145](D:/developWorkPlaces/win-box/scripts/installer-script.mjs:145)；[scripts/verify-installation.mjs:32](D:/developWorkPlaces/win-box/scripts/verify-installation.mjs:32)；[scripts/verify-installation.mjs:99](D:/developWorkPlaces/win-box/scripts/verify-installation.mjs:99)
- **重构方向：** 将运行中安装场景接入可显式运行的验收入口；在隔离数据目录测试正常退出/强退/无关锁定、覆盖及卸载再装，再核对真实安装集成。
- **关闭条件：** 正在播放/老板键隐藏/后台无主窗口时可一键停止继续；其它安装目录不受影响；配置、订阅、账号、历史、收藏重启后保留；取消不破坏旧版；注册表/快捷方式正确。

### V05 · 建立可重复的性能与内存预算并执行前后对照

- [ ] P1；原则 #8/#14；**5–8 小时**；依赖 B01、B02、B03、B04、B05、A01、A02、A03、A05、A17。
- **证据/差距：** 已有内存探针和常驻页上限，但无本次快照受控前后数据。只采工作集/直接子进程、只看构建 Babel 耗时或 HLS chunk 警告，不能证明应用内存/播放体验已优化。
- **位置：** [src/main/util/memProbe.ts:140](D:/developWorkPlaces/win-box/src/main/util/memProbe.ts:140)；[src/main/index.ts:675](D:/developWorkPlaces/win-box/src/main/index.ts:675)；[src/engine/vod/aggregateSearchPolicy.ts:2](D:/developWorkPlaces/win-box/src/engine/vod/aggregateSearchPolicy.ts:2)；[src/renderer/features/navigation/KeepAliveRoutes.tsx:1](D:/developWorkPlaces/win-box/src/renderer/features/navigation/KeepAliveRoutes.tsx:1)
- **重构方向：** 固定机器/数据/窗口/冷热缓存条件，记录完整进程树与私有内存/工作集、CPU、搜索首个结果/总耗时、帧时间和关闭后资源恢复。根据数据再调并发与保留策略。
- **关闭条件：** 空闲、1000级源搜索、1080p/高分辨率播放、弹幕开关/高密度、连续10轮切源/窗口关闭有可重复报告；无单调增长；先基线后定数值预算，不虚报节省百分比。

### V06 · 当前提交的完整门禁、干净本地包和可追溯交付

- [ ] P1；原则 #7/#14；**3–5 小时**；依赖 B01、B02、B03、B04、B05、B06、B07、B08、B09、A01、A02、A03、A04、A05、A06、A07、A08、A09、A10、A11、A12、A13、A14、A15、A16、A17、A18、A19、A20、A21、V01、V02、V03、V04、V05。
- **证据/差距：** 以前的绿灯不等于新发现故障已关闭。清理分支已有本地提交但尚未 push，没有当前分支远端 CI 证明；本轮没有生成安装包/执行桌面验收。
- **位置：** [.github/workflows/windows-checks.yml:1](D:/developWorkPlaces/win-box/.github/workflows/windows-checks.yml:1)；[scripts/package-app.mjs:28](D:/developWorkPlaces/win-box/scripts/package-app.mjs:28)；[scripts/verify-installation.mjs:1](D:/developWorkPlaces/win-box/scripts/verify-installation.mjs:1)；[package.json:1](D:/developWorkPlaces/win-box/package.json:1)
- **重构方向：** 修复后在同一候选提交运行类型/lint/架构/正式测试/构建和上述验收，隔离目录制作唯一的本地安装包，记录 hash/尺寸/版本/提交。遵守用户不发布小版本、不创建多工作区的要求。
- **关闭条件：** 所有必需任务有实现与验收链接；旧绿灯不代替当前结果；本地 Setup 在干净目录安装运行通过；保留数据及产物来源可查；不发布 Release，审计/修复改动分步提交，临时目录清理。

## 2 个可选扩展（不计入 36 项）

### O01 · 第三方动态蜘蛛运行时插件的注册与卸载扩展

- [ ] P3；原则 #2/#4/#7/#13；**6–12 小时**；依赖 B08、V01。
- **证据/差距：** SpiderFactory 已支持 provider 注入；生产注册目前主要是内置运行时。把任意第三方运行时做成可下载插件属于新增产品范围，不是证明当前 OCP 的必需重写。
- **位置：** [src/engine/spider/SpiderRuntimeProvider.ts:9](D:/developWorkPlaces/win-box/src/engine/spider/SpiderRuntimeProvider.ts:9)；[src/main/spider/createSpiderRuntimeAssembly.ts:66](D:/developWorkPlaces/win-box/src/main/spider/createSpiderRuntimeAssembly.ts:66)
- **重构方向：** 若以后纳入范围，定义版本/权限/能力清单与进程预算，复用现有 provider 及插件生命周期，先做一个端到端样例。
- **关闭条件：** 可安装/停用/卸载示例 provider 且不改工厂分支；运行中更新安全回收，失败不拖垮其它来源。

### O02 · 跨外部播放器画面增强的可行性研究

- [ ] P3；原则 #2/#7/#14；**8–16 小时**；依赖 V02、V05。
- **证据/差距：** 当前托管播放器的 shader 链不等于对任意外部播放器通用后处理。有 GPU 并不自动提供外部进程的帧访问/插入点。
- **位置：** [src/renderer/features/playback/useSuperResolution.ts:1](D:/developWorkPlaces/win-box/src/renderer/features/playback/useSuperResolution.ts:1)；[src/main/player/PlayerEngineController.ts:31](D:/developWorkPlaces/win-box/src/main/player/PlayerEngineController.ts:31)
- **重构方向：** 仅估算研究：比较外部播放器公开插件接口、独立捕获后处理和托管引擎接入的成本，复用合适开源项目；不承诺无内核限制的通用超分。
- **关闭条件：** 形成支持矩阵与一个有可测画质/帧时延/占用的 PoC，再单独评估产品化；本项工时只覆盖研究，不覆盖所有播放器的完整实现。

## 建议执行顺序与提交粒度

| 阶段 | 范围 | 任务 | 工程小时 | 可核对产出 |
|---|---|---:|---:|---|
| 1 · 故障根因 | B01–B09 | 9 | 22–42 | 12 个已知失败用例转正式绿灯，先处理阻塞/漏进程/断流 |
| 2 · 资源与运行边界 | A01–A07、A21 | 8 | 25–47 | 真实取消、统一预算、有界缓存/协议、包体账本 |
| 3 · 页面与职责边界 | A08–A20 | 13 | 49–85 | 可独立用例/Presenter、被动视图和单一控件样式所有者 |
| 4 · 共同验收 | V01–V06 | 6 | 26–44 | 当前提交的完整测试、实机报告与本地包 |

阶段之间按任务依赖推进，可穿插，不要求等整仓改完才测试。每个 B/A 任务先有最小可验证切片，再单独提交；确属同一不变量的修改/回归可同一提交。继续使用唯一清理分支，不再创建一堆工作区。普通小切片不增版本号、不发布 Release。

## 本轮验证记录与不能声称的结果

- 当前快照 `pnpm run architecture:check` 已执行，退出码 0，输出 `Architecture boundaries passed.`；这只覆盖该脚本声明的规则。
- 全量静态 AST/依赖扫描：1464 模块，解析失败 0；可解析源码运行时跨层违规 0、环 0。它是依赖规则证明，不是全原则通过。
- 审计复现证据已单独提交：`f7108c051d8ae14988452fd9e230c57e093b5a96`（不含生产修改）。
- 隔离 Vitest：3 文件、10 用例失败；Python 标准库：2 用例失败。失败已按根因合并 B01–B09。进程容量探针使用受控 ChildProcess，不能当作真实 JVM RSS 测量。
- 过程日志上一次完整正式回归记载 441 文件通过、3 跳过，3736 用例通过、5 跳过；其后主按钮颜色切片只跑了受影响的定向回归。该历史绿灯不代表本轮发现的问题不存在。
- 本轮没有重跑正式全量 Vitest/typecheck/lint/生产构建，没有执行真实线路、安装器、全窗口视觉或性能基准，没有生成安装包。报告不借用旧记录声明当前验收完成。
- 源站 HTTP 444/404/423、登录页/验证页、TLS/超时属于导入诊断证据，不能凭截图就一律认定解析器错或源永久不可用；当前导入文案已作区分。外部来源需 V02 的可控响应对照与实际请求证明。
- 已排除：备份恢复在 backupIpc 具备补偿回滚；Java SpiderPool 有实例租约，不能仅凭并发线程数宣称同实例并发污染；MovieSourcesPanel 的 title 已在调用点作 key，不能无证据认定切片名一定复用旧文件夹。

## 清单维护规则

`tasks.json` 中每项的 id、类型、依赖、工时和关闭条件是本清单的账本。完成一个切片不代表整个任务完成；须补充实现提交、已跑命令和验收证据才将该项关闭。发现新问题先确认是否属于现有根因，再增加任务。自动扫描无信号、文件变短、增加接口、正式测试绿灯，都不能单独替代行为与交付验收。
