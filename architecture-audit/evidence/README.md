# 已知失败的审计复现

日期：2026-10-26。代码基线：`7469c61e87c0a8a4f8042afd00787ef10ad6f741`，清理分支 `codex/architecture-cleanup-20261025`。

这些探针记录**尚未修复的生产行为**，不是测试通过证明。它们使用真实 Node Worker、本机回环 HTTP、受控子进程边界及注入的持久化错误，不访问影片源、不启动 Java/PotPlayer、不修改用户配置。Python 探针仅使用标准库；requests/urllib3 是桩。进程数量测试中的 ChildProcess 是受控替身，不能当作实测 RSS 或真实 JVM 进程数。

`pnpm exec vitest run --config architecture-audit/evidence/vitest.config.mjs`：3 文件、10 个断言失败，退出码 1。

`python architecture-audit/evidence/python-capabilities.probe.py`：2 个用例失败，退出码 1。

当前正常测试配置仅包含 tests/，所以这些已知失败的探针需要显式指定配置才会运行。修复对应 B01–B09 后，把相关行为用例迁入正式测试集并使其通过，再归档这些探针；不要把忽略此目录当成缺陷已关闭。

观测值在 [observed-results.json](observed-results.json)。10 个 Vitest 失败加 2 个 Python 失败，按根因合并为 9 个修复任务：B01(崩溃队列/释放等待)、B02(销毁时新建 Worker)、B03(漏杀进程)、B04(满池回退绕过预算)、B05(上游流错误下游悬挂)、B06(写盘失败仍确认)、B07(持久化后观察者失败)、B08(插件升级/失败重试)、B09(Python 默认能力/初始化错误)。

B07 探针断言保存成功不能被无区别地报告为保存失败；实现也可改成显式的“已保存，但运行时刷新失败”类型结果，届时应按正式契约更新断言。容量和时间阈值随机器配置变化，验证目标是状态/预算不变量，不是固定并发数字。
