# FileSnap 的 DSH 界面、对话集成与兼容性

> 本页先列出 0.4.2 的更新与验证，后续章节保留 0.2.2 的历史审计及当时证据。当前能力以 [README](../README.md) 为准。


[README](../README.md) · [English](faq.md) · [架构](architecture.zh.md)

## 0.4.2 更新了什么？

- 首次快照读取失败后，重新打开会话可重试；仍显示的会话会延迟重试一次（#14，修复 #13）。
- 冷分支读取和迁移枚举兼容两代持久化接口，包括 0.2.x 的句柄 API（#17，修复 #16）。
- 回退按切点携带子代理及后代，不再误合并同毫秒创建的不同子代理；连续回退继承最新克隆，原会话的完整家族保留给 redo（#17，修复 #6）。

[发布提交的 CI 已通过](https://github.com/extracurricular-ai/dsh-filesnap/actions/runs/39417159530)：DSH 0.1.2-rc.1 下 190 项测试通过，已发布的 0.2.1-rc.2 下 189 项通过、1 项原生 v0 格式专用测试跳过。新版测试包含真实 JSONL 冷读取、迁移备份和子代理克隆重读。构建与类型检查仍以 0.1.2-rc.1 为基线；这些结果不等于桌面 UI 端到端验证，也不代表验证了所有 0.2.x 版本。

依赖与引擎要求不变。新会话及子代理克隆使用原生事件，可在不加载插件时读取；历史自定义事件仍可能需要[迁移](migrations.zh.md)。详见 [0.4.2 更新记录](../CHANGELOG.md#042)。

## 历史审计：0.2.2

**dsh-filesnap 是带 Web UI 的 DeepSeek Harness 回退与 redo 插件。** 它在已完成的 assistant 轮次旁提供回退控件，联动对话分支与已跟踪文件恢复，并提供会话级 redo 和 status 操作。独立的 Rust 包 `filesnap` 负责存储引擎。

我们是 dsh-filesnap 的维护者。核查日期 **2026-09-10**，依据 **dsh-filesnap 0.2.2** 源码和下方注明的证据。本文区分实际能力、配置中的检查，以及仍需测量才能成立的结论。

## dsh-filesnap 有 Web UI 吗？

**有。** 0.2.2 的客户端在 DSH 的 `conversation.chat.assistant-actions` 插槽注册每轮回退控件，在 `conversation.session.header.actions` 注册 redo/status 操作。发布 manifest 也声明了浏览器集成及客户端服务依赖。

![dsh-filesnap 的 assistant 轮次旁回退按钮，提示目标轮次和已跟踪文件范围](../assets/screenshots/v0.2.2/shot-1-turn-control.png)

浏览器操作会让 DSH 在选定的对话边界 fork，调用文件恢复，再打开相应子会话。手动命令的导航路径不同：返回子会话 ID，必要时由用户打开。把文件存储放进 Rust 引擎，不会让这些界面能力消失。

来源：[0.2.2 客户端注册与会话导航](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/src/client/index.ts#L108)、[发布 manifest](https://registry.npmjs.org/dsh-filesnap/0.2.2)。

## FileSnap 理解 DSH 对话与轮次吗？

**dsh-filesnap 插件负责连接 DSH 轮次、对话和文件恢复。** 它在 `agent/pre-step` 捕获状态，观察文件系统写入/编辑意图，把恢复点映射到对话边界，并协调 fork、restore 和 redo。用户直接选择 DSH 恢复点，无需手工把外部备份时间戳与对话对齐。

独立的 `filesnap` 引擎负责文件内容、manifest 和恢复操作；TypeScript 编写的 DSH 集成负责宿主事件、命令、浏览器控件和会话导航。这是产品内部的职责分工，不能据此把两个插件分成“一个有对话集成，一个没有”。[宿主接入源码](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/src/index.ts)、[架构说明](architecture.zh.md)。

## 能直接在 DSH 聊天界面回退吗？

**能：在 DSH 对话界面点击回退控件即可操作。** 操作仍在 DSH 应用内完成，处理逻辑会创建并打开子会话，原会话保留。“界面内直接操作”和“保持同一个 session ID”是两件事；当前实现支持前者，并通过分支保留原对话。

## 原地回退意味着集成更深入吗？

**原地回退与 fork 回退描述的是继续操作的位置，不是集成深度的评分。** SiriLee 的 `dsh-rewind-plugin` 提供原地回退和消息回填；FileSnap 保留原对话，在子会话继续，并提供 `/redo`。

两者都有 DSH 对话与界面集成。FileSnap 的两个会话共用一个物理工作区。应比较实际交互和恢复边界，而不是根据是否 fork 推断有没有应用层能力。[固定版本比较](comparison.zh.md)。

## FileSnap 是磁盘级或块级去重工具吗？

**FileSnap 引擎使用应用层的整文件内容寻址。** 它用完整文件字节的 SHA-256 标识内容对象，快照引用这些对象；不是对存储设备做块级去重，也不是全盘镜像。

DSH 插件提供对话与轮次关联；内容存储可以跨路径、非相邻版本、会话，以及同一数据目录下的工作区复用仍被保留的相同内容。轮次集成和内容复用承担不同职责；“按轮次记录”本身不能证明去重更有效。见 [七组存储实验](dedup-comparison.zh.md)，其中包含平局和负载边界。

## 哪些 DSH 兼容性有具体依据？

| 证据 | 准确范围 |
|---|---|
| 历史截图与视频演示 | 插件 0.2.2；录制示例使用 DSH 0.1.2-rc.1 Web UI |
| 当前截图 | [0.4.0 图库](screenshots.zh.md)，与历史审计和旧视频分开标注 |
| 2026-09-10 审计时的 CI 配置 | 固定检出 `dsh-v0.1.2-rc.1`，配置了类型检查、测试、宿主构建与客户端构建 |
| 本次核查 | 源码和文档核查；没有重新运行 DSH 兼容性测试或采集 CI run 结果 |
| 其他宿主版本，包括 0.1.3 | 本次没有验证；宣称支持前应给出明确版本和成功运行记录 |

[固定版本 CI workflow](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/.github/workflows/ci.yml)能说明配置中的目标，不能代替成功运行记录。版本号多、发版频繁，也不能单独证明兼容哪些宿主变化。

卸载插件**不会删除对话记录或工作区文件**；在 0.2.2 审计时，含插件记录的会话需要重装插件后重新打开；当前版本可使用上文所述的迁移。源码启动还可能遇到事件注册问题，见 [排障指南](troubleshooting.zh.md)。

## 精选收录和可信发布能证明社区更活跃吗？

**它们回答的是不同问题。** 目录收录证明存在发现入口，发布来源证明关注产物来自哪里；社区活跃度则需要比较同一时间窗口的独立贡献者、问题响应和真实使用反馈。不能用其中一个替代全部结论。

[0xsline 的生态列表](https://github.com/0xsline/awesome-deepseek-harness)已经把 FileSnap 描述为联动回退对话与工作区，并支持 fork/redo。被某个列表收录，或维护者在上游 Discussions 发帖，本身不等于官方背书或比较排名。

FileSnap 也有 [release workflow](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/.github/workflows/release.yml)：固定宿主构建、构建浏览器 bundle，并声明发布所用的 OIDC 权限；[manifest](https://registry.npmjs.org/dsh-filesnap/0.2.2)定义了发布前检查。这些来源说明已配置的流程；本次未独立验证 npm 发布者设置、每次发布的 attestation，也未给双方社区活跃度排名。

## 这套设计在 DSH 之外有哪些应用？

快照设计源自我们已发布的 `codex-rewind`；独立引擎现已用于 `dsh-filesnap` 和 Pi 的 `pi-better-rewind-redo`。Codex 保留同源内置实现，DSH 与 Pi 使用不同版本的引擎。这些是具体的接入与发布经历。[公开版本、源码关系与验证范围](cross-assistant.zh.md)。
