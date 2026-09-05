# dsh-filesnap 架构说明

[返回 README](../README.zh.md) · [English](architecture.md)

dsh-filesnap 是 rewind 系统中与 host 相关的半边。
[filesnap](https://github.com/extracurricular-ai/filesnap) 引擎负责捕获和还原文件；
本插件决定何时捕获、当对话可以 fork 时一个 point 表示什么，以及对话与文件应该按什么
顺序移动。

## 两层职责

| 层 | 负责 | 不负责 |
|---|---|---|
| `filesnap` 引擎 | 有界扫描、内容寻址、manifest、还原、undo 记录、垃圾回收 | 对话、dsh session、浏览器跳转 |
| `dsh-filesnap` 插件 | 轮次生命周期、编辑前观察、session 事件、fork/restore 顺序、命令和浏览器 projection | 存储格式和文件移动实现 |

引擎是一个静态 Rust 二进制：stdout 输出带版本的 JSON Lines，stderr 输出给人看的诊断，
退出码也是协议的一部分。本插件完整的进程适配器是 [`src/cli.ts`](../src/cli.ts)，其中
不包含任何 rewind 策略。

## 捕获生命周期

三个 host 挂载点覆盖不同的修改路径：

1. `agent/pre-step` 等待部署自己的决策；如果 step 确认进入，就在模型请求和任何工具运行
   之前捕获工作区。
2. `fs/write-intent` 在写入之前立即记录目标的 pre-image。
3. `fs/edit-intent` 在编辑之前做同样的事。

两个文件系统 listener 使用 `{ prepend: true }`。这些 hook 是单槽 decision waterfall，
部署策略可能占用该槽而不调用下一个 listener。dsh-filesnap 只观察目标并原样委托，因此
决策权仍属于部署，同时旧内容能在消失前被读到。

覆盖范围跟随 `ctx.fs` seam，而不是工具名称列表。新工具只要通过这个 seam 写文件就会被
覆盖。shell 写入不经过它，因此依赖下一轮边界的有界扫描。

## 跟踪集合

每次捕获使用三个有界集合的并集，而不是完整递归复制：

- 工作区已知的文件名，包括 Git tracked 文件；
- 被写入和编辑事件声明过的路径，无论路径位于哪里；
- 用来覆盖 shell 和其他 seam 外修改的近期变化有界扫描。

未变化的字节只保存一次，由多个 manifest 共同引用。忽略规则是对称的：不捕获、不还原，
也不删除。

## 回退顺序

顺序固定为：

```text
1. 选择一个明确的 rewind point
2. 在该 point fork 对话
3. 改文件前创建救援点
4. 把目标 manifest 还原进 fork
5. 在同一个 fork 中记录 rewind 和 undo 信息
6. 浏览器打开 fork；headless 命令返回其 id
```

fork 必须先存在。引擎会把 undo 记录写到 `--undo-for` 指定的 session 中，而它必须是用户
最终落脚的 session；否则 `/redo` 会存在于用户无法到达的地方。

浏览器已经有部署感知的 fork 路径，可以组合子会话的 preset 和 workspace 挂载，因此它先
创建 child，再调用 `/rewind <point> --into <child>`。headless 场景由 host 插件自行 fork。

## 还原安全不变量

- 第一个写入发生前，先创建救援点。
- 只有目标 manifest 中存在明确 tombstone，才允许删除路径。
- 捕获错误不会变成 tombstone；无法读取的路径只会跳过，不会被解释成删除许可。
- 单个文件的还原失败会被逐项报告，其余文件仍会继续尝试。
- agent 正处于活动轮次时拒绝 rewind。
- 捕获失败的轮次不会产生可选择的 rewind point。

## Session 事件与 projection

插件记录三个只存在于日志中的事件：

| 事件 | 含义 |
|---|---|
| `filesnap/point` | 这一轮之前存在一个快照 |
| `filesnap/rewound` | 本 session 已被回退，对话在 child 中继续 |
| `filesnap/redone` | 落在这里的回退已被撤销 |

这些记录必须在 session 日志里，因为 fork 会深拷贝 seed。child 会继承它保留轮次所对应的
point，即使它自己还没有运行任何新轮次。

浏览器不会解析 transcript，而是通过 `filesnap` session projection 把已提交事件折叠为只
包含 point 和最近 rewind 记录的 client-safe 值。projection 是可选的，因此没有 projection
registry 的 headless 组装仍能捕获并提供命令。

## Browser/host 边界

host 与浏览器代码使用不同的 Cordis `Context` 声明。跨边界数据只通过
[`src/wire.ts`](../src/wire.ts) 中的普通类型传递，避免 host-only 类型合并改变浏览器 API。

同一条 profile row 会挂载 host，并让 `./client` export 可用。web shell 直接提供构建后的
`lib/client.js`，不修改静态模块表。

## Service API

其他插件可以使用 `ctx.filesnap`：

```ts
const points = await ctx.filesnap.points(agent)
if (points.ok) {
  const outcome = await ctx.filesnap.rewind(
    agent,
    String(points.value[0].turn),
  )
}
```

`rewind` 接受 `{ kind: 'fork' }` 或 `{ kind: 'into', session }`。操作返回
`{ ok: true, value }` 或 `{ ok: false, refusal }`，调用方无需从异常文本中重新解析原因。

## 为什么 harness peer 都是 optional

`@deepseek-ai/*` 包是 peer dependency，因为插件运行在已经组合好的 harness 中。再携带一份
Cordis 或 session 包会制造互不兼容的 Service class 和 registry。

它们被标为 optional，是为了让裸 `npm install dsh-filesnap` 不会尝试安装第二套、可能冲突
的 harness release line。dsh profile installer 已经会提供当前部署使用的包。

## 上游事件注册缺口

dsh 的持久化读取器会拒绝日志里它不认识的 non-surface 事件类型，除非该事件的 envelope
带有 `ignorable: true`（`session-persistence/src/coordinator.ts` 的
`assertEventsSupported`）。harness 保留这个标记针对的正是这种情况——仓库外插件的信息性
事件——而且每一种表示形式都会保留它。但插件设不了它：`Session.append` 用 `deepFreeze`
构造 envelope，只把 surface 字段复制进去，在 `0.1.2-rc.1` 和 `master` 上都如此。没有选项，
没有钩子，也没有写入侧的接缝。

dsh-filesnap 因此在加载时把三个事件类型加入读取器的 known set。这个声明只能到达一个地方：
插件自己 import 到的那份 `@deepseek-ai/dsh-session` 模块实例。有两种情况它到不了读取器：

- **插件没有加载。** 卸载后，它捕获过的 session 在重新安装前无法打开。磁盘上的数据完好。
- **读取器持有同一个包的另一份实例。** 源码启动（`pnpm dsh`，经 tsx）把 harness 自己的包
  解析到 `src/`，而插件的 import 解析到 `lib/`。两个文件，两个 Set。插件装着、跑着，session
  照样被拒。构建版 CLI（`node apps/cli/lib/bin.js web`）和 npm 安装的 dsh 把所有包都解析到
  `lib/`，不受影响。

`tests/persistence.spec.ts` 把这个机制钉死：一份日志经真实的 store 和 JSONL 后端写入，
在本进程读回（声明存在：能开），再在一个从未加载插件的子进程里读回（被拒，按名字，在
point 所在的 seq）。

长期修复属于上游，而且很小：让 `append` 对 non-surface 事件接受 `{ ignorable: true }`，
并把它展开进冻结的 envelope。读取器、编解码器和 seed 校验已经认这个字段。它落地之后，
翻转的就是子进程那条断言，而加载时的声明只为更早写下的日志保留。

## 存储生命周期

默认存储位于平台数据目录，永远不在项目中。只要 point 仍引用内容，内容就保持可达；不会
仅仅因为变旧而删除。

引擎已经提供 `delete`、`gc` 和 `doctor`，但插件尚未把它们暴露为 `/rewind` 子命令。
目前可以使用 profile 中安装的二进制：

```shell
~/.dsh/profiles/<profile>/node_modules/.bin/filesnap gc
~/.dsh/profiles/<profile>/node_modules/.bin/filesnap doctor --workdir .
~/.dsh/profiles/<profile>/node_modules/.bin/filesnap delete --session <id>
```

操作前先运行 `/rewind status`，查看工作区记录、共享 blob 占用和未受保护路径。
