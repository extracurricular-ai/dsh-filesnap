# dsh-filesnap — 同步回退 DSH 对话与文件

[![npm](https://img.shields.io/npm/v/dsh-filesnap?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-filesnap)
[![CI](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml/badge.svg)](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml)
[![许可证](https://img.shields.io/npm/l/dsh-filesnap?color=1f6feb)](LICENSE)
[![powered by 🦀 Rust](https://img.shields.io/badge/powered%20by-%F0%9F%A6%80%20Rust-b7410e?logo=rust&logoColor=white)](https://github.com/extracurricular-ai/filesnap)
[![无需 Git](https://img.shields.io/badge/git-not%20required-2ea44f)](#为什么选择-dsh-filesnap)

[English](README.md) | 中文

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
同步回退对话与工作区文件，不碰 Git。每次回退都发生在一个新的 fork 中，因此改变主意时
还可以用 `/redo` 回去。

![dsh-filesnap：对话与工作区一起回退](assets/social-preview.png)

```console
> /rewind 2
Rewound to turn 2 (把限流改成按租户维度).
Files: 7 written, 1 deleted.

The conversation continues in session-9f3c1a04-….
Run /redo there to reverse this rewind.
```

## 快速开始

### 环境要求

- 带有 `web` 或 `headless` profile 的 DeepSeek Harness
- Node.js `^22.19` 或 `>=24`
- x64 或 arm64 架构的 Linux、macOS 或 Windows

原生 [filesnap](https://github.com/extracurricular-ai/filesnap) 二进制会随插件
一起安装，不需要另装 Rust、Git 或其他运行时。

> [!IMPORTANT]
> dsh 目前没有为仓库外插件提供正式的事件类型注册接口，因此 dsh-filesnap 会在加载时
> 注册自己的 session 事件。**如果卸载插件，它捕获过的会话将暂时无法打开，重新安装后
> 即可恢复访问。** 会话数据仍完整保留在磁盘上。详见
> [架构限制](docs/architecture.zh.md#上游事件注册缺口)。

### 1. 安装

```console
$ dsh plugin --profile web add dsh-filesnap
```

启动器可能提示本包没有 `dsh.bundle`。这是预期行为：dsh-filesnap 通过插件 row
挂载，而不是一个 profile layer。

### 2. 启用

在 `~/.dsh/profiles/web/cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: filesnap
      name: dsh-filesnap
```

如果使用 headless profile，把命令和路径中的 `web` 都换成 `headless`。

### 3. 验证并使用

```console
$ dsh --profile web --dump-config | grep -A 1 filesnap
- id: filesnap
  name: dsh-filesnap
```

重启 profile，完成一轮 agent 任务，然后输入 `/rewind`。如果组合后的 profile 中没有
插件，或浏览器控件没有出现，请看[排障指南](docs/troubleshooting.zh.md)。

## 为什么选择 dsh-filesnap

| | 意味着什么 |
|---|---|
| **对话 + 文件** | 在选中的轮次 fork 对话，并把工作区恢复进同一个 fork。 |
| **不依赖 Git** | 在 Git 仓库和普通目录中都能工作，不改变 commit、branch、stash 或 worktree 状态。 |
| **回退也能撤销** | 在还原写入前先创建救援点，`/redo` 可以撤销这次回退。 |
| **覆盖面更完整** | 支持二进制文件、被 Git 忽略的文件，以及经 `ctx.fs` 发生在项目目录外的编辑。 |
| **原生引擎** | 有界扫描、内容寻址和还原运行在独立的 **🦀 Rust** 小型二进制中，不占用会话的 Node 进程。 |
| **范围可检查** | `/rewind status` 会报告存储占用，以及哪些文件未被保护和对应原因。 |

这套设计不会把版本控制当作快照仓库。带版本日期和源码审计的完整对比见
[插件对比](docs/comparison.zh.md)。

## 命令

| 命令 | 结果 |
|---|---|
| `/rewind` | 列出每轮开始前捕获的工作区状态。 |
| `/rewind <turn>` | 在该轮 fork 对话，并恢复对应文件。 |
| `/redo` | 撤销落在当前会话中的回退。 |
| `/rewind status` | 报告存储内容和当前未受保护的文件。 |

`/rewind` 接受列表中显示的轮次编号或 point id。它刻意不支持“往回三轮”这样的相对
寻址：还原会覆盖文件，因此目标必须明确。

这两个命令都不会触发模型轮次。回退是用户对对话执行的操作，不应该再经过被回退的对话。

## 哪些文件会被保护

每次模型 step 之前，dsh-filesnap 会捕获三个有界集合的并集：

- 工作区已知的文件，包括 Git 报告的 tracked 文件名；
- 在 `ctx.fs` 写入或编辑之前观察到的路径，即使路径位于项目目录之外；
- 最近发生变化的工作区文件的有界扫描，用来覆盖 shell 命令造成的写入。

内容按哈希寻址，因此未变化的文件会被复用，不会每轮复制一份。`.filesnapignore` 是
对称的：被忽略的路径不会被存储、恢复，也不会被还原操作删除。只有目标快照明确记录某个
路径当时不存在，还原才有权删除它。

`/rewind status` 会重新扫描当前目录，并列出超出覆盖范围的项目，例如无法读取、过大或
不是普通文件的路径。覆盖细节与还原不变量见[架构说明](docs/architecture.zh.md)。

## 性能

引擎运行在模型请求之前，而模型请求通常需要数秒。当前在 warm page cache 下得到的初步
测量是：

| 工作区 | 捕获文件数 | 首次捕获 | 重复捕获 |
|---|---:|---:|---:|
| 本仓库 | 84 | 20 ms | **8 ms** |
| DeepSeek Harness monorepo | 磁盘上 70,918 个文件中的 7,995 个 | 1.75 s | **268 ms** |

这些数字只描述原始测量机器，不是对所有设备的承诺。跟踪集合是有界的，不会每轮遍历
70,918 个文件；重复捕获还会复用未变化的内容。测量方法、尚缺的机器元数据和复现命令见
[基准测试](docs/benchmarks.zh.md)。

## 浏览器体验

可选的 `./client` export 会增加：

- 每条已完成 assistant 消息旁边的回退操作；
- header 中的 redo 和存储状态操作。

转录本身已经是轮次列表，所以插件不会再增加一个重复的 checkpoint 面板。在浏览器中，
部署先创建正确组合的子会话，host 把文件还原进去，client 再打开该子会话。headless 场景
则由 host 插件自行 fork。

浏览器 bundle 会在发布流程中完成类型检查和构建，但目前还没有自动化浏览器内测试。

## 配置

默认值适用于普通本地部署。

| 字段 | 默认值 | 用途 |
|---|---|---|
| `command` | 自动解析 | 指向另一个引擎构建，或由远程 subprocess provider 解析的裸命令。 |
| `dataDir` | 平台数据目录 | 存储位置，永远不在项目目录中。 |
| `timeoutMs` | `120000` | 单次引擎调用的墙钟上限。 |
| `graceMs` | `2000` | 取消或超时后从 SIGTERM 到 SIGKILL 的宽限时间。 |
| `maxOutputBytes` | `1048576` | 每条输出流的内存上限。 |
| `declareEdits` | `true` | 在编辑之前立即记录文件 pre-image。 |

未知字段和不可用值会在插件加载时失败，不会等到某次回退点悄悄消失后才暴露。

## 当前限制

- 卸载插件后，包含其事件类型的会话在重新安装前无法读取；不会删除任何会话数据。
- 在 web 输入框中键入 `/rewind` 只会报告子会话 id，不会自动跳转；逐轮浏览器操作会完成跳转。
- host 自行执行的 headless fork 会继承模型 route 和 preset，但不会继承部署的 per-agent
  模型选择或 workspace 挂载。
- shell 在工作区外、大小边界之外或近期变化预算之外创建的文件，需要同时被文件系统写入
  事件观察到才能覆盖。
- 引擎已经支持 `gc`、`doctor` 和删除 session，但插件还没有把它们暴露为 `/rewind`
  子命令。

事件注册限制见[架构说明](docs/architecture.zh.md)，操作问题见
[排障指南](docs/troubleshooting.zh.md)。

## 文档

| 文档 | 回答什么问题 |
|---|---|
| [架构说明](docs/architecture.zh.md) | 何时捕获、fork 与还原的顺序，以及记录了什么。 |
| [插件对比](docs/comparison.zh.md) | 不同 dsh rewind 设计的区别，并标明审计版本。 |
| [基准测试](docs/benchmarks.zh.md) | 已发布的时间数据意味着什么，以及如何复现。 |
| [排障指南](docs/troubleshooting.zh.md) | 安装、profile、client bundle 和存储诊断。 |
| [参与贡献](CONTRIBUTING.zh.md) | 本地开发、构建和四层测试。 |

快照引擎也可以脱离 dsh 使用：通过 Rust（`cargo add filesnap`）或其带版本的 JSON Lines
CLI 集成。本仓库完整的 subprocess adapter 是 [`src/cli.ts`](src/cli.ts)。

## 参与贡献

欢迎用中文或英文参与：

- [Discussions](https://github.com/extracurricular-ai/dsh-filesnap/discussions)：问题、想法和使用案例；
- [Issues](https://github.com/extracurricular-ai/dsh-filesnap/issues)：bug 和明确的改进项；
- [Pull requests](https://github.com/extracurricular-ai/dsh-filesnap/pulls)：已经实现的修改。

修改 host/engine 边界前请阅读 [CONTRIBUTING.zh.md](CONTRIBUTING.zh.md)。安全问题请通过
[SECURITY.md](SECURITY.md) 中的私有渠道报告，不要创建公开 issue。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE)。它使用的
[filesnap](https://github.com/extracurricular-ai/filesnap) 引擎采用同一许可证。
