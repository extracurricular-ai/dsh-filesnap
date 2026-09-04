# dsh rewind 插件对比

[返回 README](../README.zh.md) · [English](comparison.md)

> [!NOTE]
> 本审计于 **2026-09-04** 对照各 npm 包的已发布产物核实。包的行为会变化；依赖某一行
> 之前请复查当前版本。如果结论已经过期或不完整，欢迎创建 issue。

这里把产品首页与必须携带版本、限制和证据的技术对比分开。关键问题不只是插件有没有一个
叫“rewind”的命令，而是它能恢复哪些状态，以及恢复过程中会怎样处理周围的工作。

## 能力矩阵

| | 引擎 | 文件 | 对话 | 撤销回退 | shell 写入 | 二进制 | Git ignored | 项目外 | 原对话完整 |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **dsh-filesnap** | **🦀 Rust** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | ✅ |
| [dsh-rewind](https://www.npmjs.com/package/dsh-rewind) 0.11.12 | JS | ✅ | ✅ | ⚠️ 仅最近一次 | ✅ | ✅ | ❌ | ❌ | ❌ 被遮蔽 |
| [dsh-checkpoint-rewind](https://www.npmjs.com/package/dsh-checkpoint-rewind) 0.6.1 | JS | ✅ | ✅ | ⚠️ 守护点 | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| [dsh-rewind-plugin](https://www.npmjs.com/package/dsh-rewind-plugin) 0.4.2 | JS | ✅ | ✅ | ❌ | ❌ | ☠️ | ✅ | ⚠️ | ❌ 被遮蔽 |
| [@anionex/dsh-turn-rewind](https://www.npmjs.com/package/@anionex/dsh-turn-rewind) 0.1.2 | JS | ✅ | ⚠️ 可选 | ⚠️ 走 API | ✅ | ✅ | ❌ | ❌ | ✅ |
| [dsh-recall-plugin](https://www.npmjs.com/package/dsh-recall-plugin) 2.0.0 | JS | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ 被归档 |
| [@zoytown/dsh-rewind](https://www.npmjs.com/package/@zoytown/dsh-rewind) 0.1.0 | JS | ✅ | ❌ | ✅ 只有文件 | ✅ | ✅ | ❌ | ❌ | ✅ |
| [@flow2dream/dsh-msg-rewind](https://www.npmjs.com/package/@flow2dream/dsh-msg-rewind) 0.1.6 | JS | ❌ | ✅ | ❌ | ❌ | — | ❌ | ❌ | ❌ 被截断 |

图例：✅ 完整支持；⚠️ 有条件或部分支持；❌ 不支持；☠️ 审计版本中观察到的数据损失风险；
— 不适用。

## 存储与仓库风险

| | 不需要 Git | 不写仓库 | 扛得住 `git gc` | 保留边界 | 捕获代价随什么增长 |
|---|:--:|:--:|:--:|---|---|
| **dsh-filesnap** | ✅ | ✅ | ✅ 不在 Git 中存东西 | 可达性 | 每轮一个有界并集 |
| dsh-rewind 0.11.12 | ❌ 会创建 | ☠️ `git init`、`reset --hard` | ☠️ 无引用 stash 对象 | 仓库 GC | worktree 大小 |
| dsh-checkpoint-rewind 0.6.1 | ⚠️ copy 降级 | ☠️ 写 `.git/objects` | ☠️ 无引用对象 | 每 session 50 点 + 512 MiB | worktree 大小 |
| dsh-rewind-plugin 0.4.2 | ✅ | ✅ | ✅ | 每 session 100 组 anchor | session 长度 |
| @anionex/dsh-turn-rewind 0.1.2 | ❌ 仅 Git worktree | ✅ | ✅ | 每 session 50 点 + 30 自动点 | worktree 大小 |
| dsh-recall-plugin 2.0.0 | ❌ 需要 Git CLI | ✅ shadow repo | ✅ | 未发现自动清理 | worktree 大小 |
| @zoytown/dsh-rewind 0.1.0 | ❌ 需要 Git CLI | ✅ shadow repo | ✅ | 30 天、每 workspace 50 session | worktree 大小 |
| @flow2dream/dsh-msg-rewind 0.1.6 | ✅ | ✅ | — | — | — |

“捕获代价随什么增长”是重要的运维属性。完整 worktree 方案随项目树增长；整文件备份方案可能
随 session 长度增长。dsh-filesnap 扫描有界并集，并对未变化字节做内容寻址复用。

## 审计版本中的三个高风险发现

### 无引用 Git 对象

`dsh-rewind` 和 `dsh-checkpoint-rewind` 把唯一快照放进没有持久引用的 Git 对象。
`git stash create` 不创建 stash reflog，且 dsh-checkpoint-rewind 0.6.1 中没有找到
`update-ref`。无引用对象可以被 Git GC 回收，在 `git gc --prune=now` 下会立即发生。

### 把二进制按 UTF-8 解码

dsh-rewind-plugin 0.4.2 用 `readFile(path, "utf8")` 读取 pre-image，再用
`writeFile(path, content, "utf8")` 写回（已发布包的 `lib/index.js:207` 和 `:607`）。
没有 Buffer/base64 路径或二进制检测，因此非法 UTF-8 字节无法原样往返。

### 破坏性恢复整个 worktree

dsh-rewind 使用 `git reset --hard`。它自己的限制说明该操作会影响完整 worktree，包括在
dsh 工具之外完成的修改。这意味着无关的未提交工作和当前 branch pointer 都可能变化。

这些发现说明 agent snapshot store 应与用户版本控制状态分离。它们不是对审计日期之后新
版本的结论。

## 由设计直接带来的差异

### 项目目录外的编辑

Git worktree 无法表达 `~/.config`、相邻 checkout 或根目录之外的文件。dsh-filesnap 通过
文件系统 seam 观察 pre-image，可以声明 agent 实际写入的任何绝对路径。

项目目录外的 shell 写入仍是边界：只有同一路径也被文件系统 seam 观察到时才能覆盖。

### 新建文件

排除 untracked 文件的快照，不一定能删除 agent 在目标 point 之后创建的文件。dsh-filesnap
会为自己确认过的“不存在”记录明确 tombstone，从而授权还原时删除，同时不会把每个未出现在
快照中的条目都误读成“应该删除”。

### 撤销回退

就地遮蔽对话后，没有原对话可返回。dsh-filesnap 先 fork，并在还原前创建救援点，因此
`/redo` 同时拥有原 transcript 和还原前 workspace 状态。

### 还原中断

最危险的失败是还原进行到一半。dsh-filesnap 在第一次写入前创建救援点，逐文件报告失败，
并且只依据已验证 tombstone 删除。完整不变量见[架构说明](architecture.zh.md)。

## 体积与性能快照

| 设计 | 快照引擎 | 额外安装 | 已发布的 70,918 文件测量 |
|---|---|---|---|
| **dsh-filesnap** | 编译后的 **🦀 Rust** 进程 | 约 0.23 MB 插件 + 4 MB 引擎 | 原始机器重复捕获 **268 ms** |
| 五个 Git 方案 | JavaScript 启动 Git | 包体加 Git 安装 | 审计 README 中未找到 |
| 两个非 Git JavaScript 方案 | session 进程内 JavaScript | 包依赖 | 审计 README 中未找到 |

dsh-filesnap 的数字是 warm-cache 初步结果，不是跨机器 benchmark。方法和复现说明见
[基准测试](benchmarks.zh.md)。

## dsh-filesnap 尚未提供

- 两个 point 之间的 diff 视图；
- 逐文件还原；
- `/rewind gc`、`/rewind doctor` 和 `/rewind delete` wrapper；
- client 控件的自动化浏览器内测试；
- 上游正式支持的事件类型注册路径。

审计时，前两项存在于 checkpoint 类替代方案中。有效的对比应该同时说明对方的优势和风险。

## 审计方法

对比使用 npm 已发布产物，而不只看 repository main 或宣传文案：

1. 记录准确的包版本；
2. 检查包内 README 和编译后的 JavaScript；
3. 定位 capture、retention 和 restore 路径；
4. 区分功能缺失与数据完整性风险；
5. 为每条结论标日期。

如需修正，请创建
[issue](https://github.com/extracurricular-ai/dsh-filesnap/issues)，附上新包版本和对应的已发布
代码路径。
