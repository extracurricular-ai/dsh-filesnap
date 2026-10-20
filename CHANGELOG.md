# Changelog

## 0.4.2

- 首次 points 读取失败后，重新打开会话可重试，仍显示的会话会延迟重试一次；取消过期重试并共享进行中的请求，避免恢复后的回退按钮再次消失（#14，修复 #13）。
- Retry failed initial points reads on reopening, with one delayed retry while the view remains visible. Cancel stale retries and share in-flight requests so recovered rewind buttons stay available (#14, fixes #13).
- 兼容两代持久化接口读取冷会话、枚举迁移日志和定位原始文件，修复 0.2.x 下 `persistence.inspect is not a function`（#17，修复 #16）。
- Read cold sessions, list migration logs and locate raw artifacts through either persistence generation, fixing `persistence.inspect is not a function` on 0.2.x (#17, fixes #16).
- 回退分支递归携带切点之前的子智能体及后代，并将各自日志截断到切点；原会话及其子代理保持完整，redo 可回到原件。旧运行时不写入其不支持的 catalog 事件（#17，包含 #8、#15，修复 #6）。
- Carry subagents and descendants into rewind branches recursively, cutting each log at the fork point. Preserve the original family for redo, and avoid catalog writes on runtimes without that vocabulary (#17, includes #8 and #15, fixes #6).
- 用原始会话 ID 识别子代理血缘，避免同一毫秒创建的不同子代理被误去重；冷加载后连续回退继承最新克隆，旧运行时也能发现孙代理。单个子代理失败仅告警，不中断文件回退。
- Identify subagent lineages by the original session ID so siblings created in the same millisecond stay distinct. Repeated rewinds after cold reload extend the latest clone; legacy runtimes discover descendants too. Individual carry failures warn without interrupting file rewind.
- 验证：DSH 0.1.2-rc.1 下 190 项测试通过，0.2.1-rc.2 下 189 项通过、1 项原生 v0 格式专用测试跳过；新增新版运行时 CI，覆盖真实冷读取、迁移备份和克隆会话重读。尚未进行桌面 UI 端到端验证。
- Validation: 190 tests pass on DSH 0.1.2-rc.1; 189 pass on 0.2.1-rc.2 with one native-v0-only test skipped. Add published-runtime CI covering real cold reads, migration backups and persisted clones. Desktop UI end-to-end validation is not included.
- 感谢 @1Dreamer666 的报告和修复。依赖及引擎要求不变，仍使用 FileSnap 0.5.1+，本次无需发布新引擎。
- Thanks to @1Dreamer666 for the reports and fixes. Dependencies and engine requirements are unchanged; FileSnap 0.5.1+ remains sufficient.

## 0.4.1

- 当 Connection 服务注册通道时访问不到 `webServer`（桌面端的 0.2.0-rc.2 构建），UI 通道改为直接挂载到宿主 web server 上的同一前缀路由；准入、信封校验与请求体上限不变，浏览器操作不再落到 405。
- Mount the UI channel directly on the host web server when the Connection service cannot reach `webServer` while registering a channel (the Desktop app's 0.2.0-rc.2 build). Admission, envelope validation and the body cap are unchanged, and browser actions no longer meet the 405.
- 兼容新旧客户端的会话导航和输入框附件字段，修复回退完成后新分支不打开、提示词不回填的问题；不覆盖已有草稿或附件（#11，修复 #9）。
- Resolve session navigation and composer attachment fields across client generations so a completed rewind opens its branch and refills an empty composer without replacing drafts or attachments (#11, fixes #9).
- 按运行中客户端导出的新旧名称选择图标，缺失时使用空图标兜底，避免回退、撤销回退及快照控件因 React 元素类型错误而崩溃（#12，修复 #10）。
- Resolve icons from the running client's current or legacy exports, with an empty glyph fallback, so rewind, redo and snapshot controls do not crash on missing icon exports (#12, fixes #10).
- 本版包含 #7、#11、#12，感谢 @1Dreamer666 的报告和修复。依赖及引擎版本要求不变。
- Includes #7, #11 and #12. Thanks to @1Dreamer666 for the reports and fixes. Dependencies and engine requirements are unchanged.

Known limitations / 已知限制：

- 首次 points 读取失败后的重试问题（#13）、回退分支携带子代理（#6）以及持久化 0.2.x 的冷分支读取和迁移兼容问题（#16）尚未修复；本版不代表全面兼容 harness 0.2.x。
- Failed initial points reads (#13), carrying subagents into rewind branches (#6), and cold branch reads and migration compatibility with persistence 0.2.x (#16) remain unresolved. This release does not establish full harness 0.2.x compatibility.

## 0.4.0

- 新增「设置 → FileSnap → 中断恢复」：预览继续或回滚未完成的回退与 redo，确认时重新检查文件，冲突时停止。
- 修改文件前持久化命名救援点及独立恢复状态；完成状态和 redo 栈一起提交，避免结果丢失后重复消费。必要元数据不写入对话，卸载不影响原生会话读取。
- 复用已发布的 FileSnap 0.5.1+，本次无需引擎更新。新恢复流程覆盖本版创建的回退及其 redo；旧版回退保留兼容路径。
- Add an independent interrupted-restore panel, durable host recovery metadata, repeatable rescue targets and conflict-checked confirmation. Block new Agent work in a workspace awaiting recovery.
- Verify actual host process termination before/after applying files, partial application, interrupted rollback, redo preservation and fresh-process conversation loading.

Limits: local workspace, one DSH process, no concurrent external writes. Changed ignore rules must be restored before recovery preview. This does not promise multi-file atomicity across machine power loss.

## 0.3.2

- Treat a missing or consumed undo record as a normal empty state in the redo dialog, command menu and headless command. Remove misleading engine-upgrade hints and restore/retry controls for this state; preserve actual engine errors.
- After a successful redo, check for remaining undo records and archive only an exhausted fork through the host's public archive API. Preserve conversations and snapshots; keep branches visible after file failures, remaining undo records or archive errors.
- Return to the original conversation after automatic archiving, including when the host archive update unmounts the old branch before the RPC returns.
- Engine requirement remains FileSnap 0.5.1+. No engine release is needed for this patch.

## 0.3.1

- Require file preview and single-use confirmation for `/redo` and the header redo button; recheck workspace, target and ignore rules before applying. Requires FileSnap 0.5.1.
- Mark branches `🟢 Active ·` / `🔴 Inactive ·` after successful rewind or redo; recognize legacy prefixes.
- Run versioned migrations automatically on plugin load (configurable with `autoMigrate`). Back up unloaded legacy logs and append native title revisions for old markers. Show startup results and keep manual retries in Settings.
- Host compatibility remains tested against DSH 0.1.2-rc.1. Source review of 0.1.5-rc.1/master finds session forks and archive APIs, but no message branch pager or public unarchive API.

Publish engine 0.5.1 before installing/publishing plugin 0.3.1.

## 0.3.0

- Bare `/rewind` opens the native searchable turn picker in the web UI, then the file preview and confirmation dialog.

- Preview the complete file impact list and require confirmation before browser or command rewinds. Recheck workspace state and ignore rules before restoring.
- Move browser actions from chat commands to independent authenticated RPC. No new `filesnap/*` session events, operation journals or command-result cards from buttons.
- Resolve snapshots using the engine index and DSH native fork lineage, including cold ancestors. New conversations reopen without the plugin installed.
- Add an independent workspace snapshot panel with records/shared content usage, per-session snapshot counts and excluded files.
- Add confirmed collection of unreferenced snapshot data; retain snapshots and redo recovery data.
- Add Settings → FileSnap → Data migrations, with a versioned task catalogue, read-only scan, confirmation, backup, stale-file checks and per-session results. The first task makes legacy session events ignorable. An offline tool is included for installations whose UI cannot start.
- Refill the complete original prompt only when the destination composer is empty; preserve drafts and images. Redo results provide an action to open the original conversation.
- Refresh bilingual documentation and the website. Historical performance/comparison evidence retains its original version labels.

Compatibility: validated with DSH 0.1.2-rc.1 and FileSnap 0.5.0. Loaded sessions are skipped by migration. Stop other DSH processes sharing the same session directory before migration. Legacy conversations need migration before opening without the old event registration. Keep ancestor conversations and snapshot data for inherited recovery points.

Integration changes: `filesnap` projection now contains structural anchors only; browser results use RPC. Custom event declarations and outcome `eventSeq` fields have been removed.
