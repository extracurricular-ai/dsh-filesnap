# DSH Rewind & Redo — by FileSnap

[![npm](https://img.shields.io/npm/v/dsh-filesnap?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-filesnap)
[![CI](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml/badge.svg)](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml)
[![许可证](https://img.shields.io/npm/l/dsh-filesnap?color=1f6feb)](LICENSE)

中文 | [English](README.en.md)

**[完整使用手册 ↗](https://extracurricular.ai/dsh-filesnap/zh/)** · 安装、回退与撤销、快照清理、升级迁移和常见问题；支持按版本切换文档。

[0.4.0 界面截图与历史图库](docs/screenshots.zh.md)

**dsh-filesnap 是 DeepSeek Harness（DSH）的对话与文件回退插件。** 先查看将写回、恢复或删除的文件，确认后一起回退对话和已跟踪文件。原对话保留为分支，选错了可以用 `/redo` 撤销回退，无需 Git。

**0.4.2：修复首次快照读取失败后的重试、回退分支携带子代理，以及持久化 0.2.x 的冷分支读取和迁移。** 保留 0.4.0 的中断恢复面板；按钮通过独立 RPC 获取结果，不往对话历史写操作日志。

已在 DSH 0.1.2-rc.1 和已发布的 0.2.1-rc.2 上通过运行时测试，涵盖真实持久化读取、迁移和子代理克隆；尚未进行桌面 UI 端到端验证。详见 [更新记录](CHANGELOG.md)。

![dsh-filesnap：对话与工作区一起回退](assets/social-preview-whale-girl.jpg)

[完整中文演示（旧版）· 2:24](https://www.bilibili.com/video/BV1BiYT6qEjs/) · [English walkthrough（旧版）· 2:29](https://youtu.be/WPEXKesR_EM)

0.4.2 需要 FileSnap 引擎 **0.5.1+**。本次无需发布新引擎；预览接口不可用时会拒绝还原。

## 安装

```console
dsh plugin --profile web add dsh-filesnap
```

需要 DeepSeek Harness（运行时验证覆盖 **0.1.2-rc.1 / 0.2.1-rc.2**）、Node.js `^22.19` 或 `>=24`。支持 Linux、macOS、Windows 的 x64/arm64；FileSnap 0.5.1+ 引擎随插件安装。headless 用户把 profile 改为 `headless`。

重启对应 profile 即可，不需要手动添加 loader。若从 0.2.1 或更早升级，先删除 `~/.dsh/profiles/<profile>/cordis.patch.yml` 中手写的 `id: filesnap` 条目，避免与内置 bundle 重复。

## 回退与撤销

1. 让 DSH 完成至少两轮任务。已有可恢复快照时，assistant 回复的操作行会显示回退按钮。
2. 点击按钮，检查目标轮次与文件变更清单；取消或 Esc 关闭不会创建分支或恢复工作区文件。
3. 确认后创建分支并恢复文件，再打开新分支。原始提示词会回填到空输入框，不覆盖已有草稿或图片。
4. 选错了回退点，在新分支点击“撤销回退”或执行 `/redo`，预览文件清单后确认。还原成功且无剩余撤销记录时，自动归档旧分支并返回原对话；会话内容和快照保留。

没有可撤销记录（例如已完成 redo）时，会显示普通状态提示，不会要求升级引擎或再次确认。普通会话不会仅因没有撤销记录而被归档；文件恢复失败或仍有撤销记录时，分支也会保留。宿主不支持归档或归档失败时，保留分支并在还原结果中说明。

文件状态、忽略规则或轮次在预览后改变时，需要重新预览；确认令牌五分钟过期且只能使用一次。部分恢复失败会列出受影响路径，不会显示为无事发生。[完整流程与边界](docs/rewind-preview.zh.md)。

## 中断恢复

新回退及其 redo 被进程退出、超时或文件错误打断后，打开 **设置 → FileSnap → 中断恢复**，预览继续还原或回滚到操作前的文件清单，再确认。救援快照与必要状态独立保存，不写入对话；发现中断后的额外修改时会阻止覆盖。[操作方法与恢复边界](docs/recovery.zh.md)。

## 工作区快照与空间清理

点击会话头部的 **“查看快照状态”**，打开独立的“工作区快照”面板：

- **当前工作区索引**和**共享文件内容**分别展示，避免把跨工作区共享内容误算成当前项目独占空间。
- 查看各会话持有的快照轮次数，以及未受保护文件及原因。
- 在面板内点击空间清理，核对范围后确认。只回收未被引用的数据，保留现有快照、redo 救援数据和工作区文件。
- 清理完成后刷新占用。显示的是当前用量，不是预计释放量；仍被快照引用的内容不会释放。

不自动删除旧会话或过期快照，自动清理策略尚未提供。按钮结果不会追加到聊天记录。

## 旧版升级与自动迁移

**0.3.1 默认开启自动迁移（`autoMigrate: true`）。** 安装或升级后，重启对应 profile；DSH 加载新版插件时会自动扫描、备份并迁移未加载的旧会话。迁移不在 npm 安装脚本中执行，仅安装包而未重新加载插件不会触发迁移。

| 迁移任务 | 处理内容 |
|---|---|
| 旧版会话兼容 | 将旧版 FileSnap 自定义事件标为宿主可忽略，修复这些事件导致的卸载后无法打开会话的问题；保留消息内容、序号与分支边界。 |
| 红绿灯标题标记 | 将旧 `↩` 标题标记转换为 `🔴 Inactive ·`。普通旧标题不会自动推测为 `🟢 Active ·`。 |

后续回退或 redo 成功时，会将当前沿用的分支标为 `🟢 Active ·`，离开的分支标为 `🔴 Inactive ·`。标记表示分支选择，与 Agent 是否正在运行无关。

- **先备份，再修改**：每份修改过的日志旁都会保存原始备份。已兼容的数据自动跳过，重复加载插件不会重复迁移已完成的数据。
- **跳过正在使用的会话**：已加载的会话不会被修改。关闭后可重新扫描；若仍显示占用，重启 DSH 后先进入设置，不要打开目标会话。
- **查看结果与重试**：在 **DSH 设置 → FileSnap → 数据迁移** 查看本次启动的迁移结果，选择任务后可手动扫描、确认和重试。后续版本的迁移也统一从此入口管理。
- **可关闭自动迁移**：将插件配置 `autoMigrate` 设为 `false`，之后通过设置面板手动执行。

当前迁移支持 DSH JSONL 与 Zstd 压缩日志，不修改其他插件的事件。[迁移说明与离线修复](docs/migrations.zh.md)。

## 命令

| 命令 | 结果 |
|---|---|
| `/rewind` | 网页端打开轮次选择菜单；选择后预览文件变更并确认。终端中列出轮次。 |
| `/rewind <turn>` | 预览回退到该轮之前会改变的文件。 |
| `/rewind <turn> --confirm <token>` | 使用预览令牌确认恢复。 |
| `/redo` | 预览还原到回退前的文件清单，确认后执行。网页端选择菜单项后打开确认浮层。 |
| `/rewind status` | 输出工作区保护范围和磁盘占用。 |
| `/rewind cleanup` | 预览空间清理范围，返回确认令牌。 |
| `/rewind cleanup --confirm <token>` | 回收未引用数据。 |

网页端单独输入 `/rewind` 或 `/redo` 打开原生选择菜单。其他手动命令由 DSH 展示标准命令结果，不触发模型轮次；浏览器按钮与选择菜单直接调用 RPC。headless 回退返回新分支 id，需要自行打开。

## 与 dsh-rewind-plugin 怎么选

双方都支持对话与文件联动恢复和 Web 操作。SiriLee 的方案强调同窗口原地回退、仅对话模式与快捷键；本插件强调**保留原对话分支、`/redo` 撤销回退、跨路径和快照的内容去重复用**。

不要只按名称判断，也没有经过验证的“公认最好”排名。参见[源码对比](docs/comparison.zh.md)、[界面 FAQ](docs/faq.zh.md)。原存储实验基线为插件 **0.2.2** 和引擎 **0.4.0**，不能当作本版重新测量的结果：[7 组去重实验](docs/dedup-comparison.zh.md)。

## 覆盖范围与限制

- 恢复依赖事先捕获；支持二进制、Git 忽略文件，以及经 `ctx.fs` 观察到的项目外编辑。忽略规则、大小限制和捕获时机仍影响覆盖。
- 快照先于工具执行保存；写入/编辑前观察旧内容。它不是整台电脑的备份。
- 分支共享同一工作区；切换对话本身不切换文件副本。继承快照通过原生分支来源定位，需要保留祖先会话及对应快照数据。
- 第一个轮次前没有可保留的完整轮次，因此不提供该处的浏览器回退按钮。
- 预览不是工作区锁；外部编辑器与最终写入仍可能并发。文件恢复被拒后，已创建的空分支可能留在会话列表中。
- 尚无仅回退对话模式、逐文件勾选恢复、逐行 diff 和新的全局快捷键。

## 配置

| 字段 | 默认值 | 用途 |
|---|---|---|
| `command` | 自动解析 | 可选的引擎可执行文件。 |
| `dataDir` | 平台数据目录 | 独立快照存储位置，不写进项目。 |
| `timeoutMs` | `120000` | 单次引擎调用时限。 |
| `graceMs` | `2000` | 取消/超时后的终止宽限时间。 |
| `maxOutputBytes` | `1048576` | 每条输出流的内存上限。 |
| `autoMigrate` | `true` | 插件加载时自动迁移未加载的旧会话；关闭后可从设置手动迁移。 |
| `declareEdits` | `true` | 通过文件系统接口观察写入前的内容。 |

## 更多文档

[工作原理](docs/architecture.zh.md) · [迁移](docs/migrations.zh.md) · [排障](docs/troubleshooting.zh.md) · [路线图](docs/roadmap.zh.md) · [基准测试](docs/benchmarks.zh.md) · [跨助手实践](docs/cross-assistant.zh.md) · [贡献指南](CONTRIBUTING.zh.md)

[讨论](https://github.com/extracurricular-ai/dsh-filesnap/discussions) · [报告问题](https://github.com/extracurricular-ai/dsh-filesnap/issues) · [许可证](LICENSE)
