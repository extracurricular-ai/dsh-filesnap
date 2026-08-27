# dsh-filesnap

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 的回退与撤销。

回到某一轮开始时的状态 —— **对话和它改过的文件一起回去**。在从没 `git init` 过的项目里能用,在用着 git 的项目里也能用:你的 commit、stash、工作区状态一概不动,也不会往你的仓库里存任何东西。

```console
> /rewind
Rewind points — the workspace as it stood before each turn:

  turn  when                 opened by
     1  2026-08-27 09:12:04  给上传接口加限流
     2  2026-08-27 09:18:41  改成按租户维度
     3  2026-08-27 09:31:10  再把租户查询缓存起来

Rewind with /rewind <turn>. The conversation forks at that point and the files go back with it.

> /rewind 2
Rewound to turn 2 (改成按租户维度).
Files: 7 written, 1 deleted.

The conversation continues in session-9f3c1a04-….
Run /redo there to reverse this rewind.
```

## 引擎是 [filesnap](https://github.com/extracurricular-ai/filesnap)

**真正吃重的逻辑不在这个仓库里。** 快照和还原由 [filesnap](https://github.com/extracurricular-ai/filesnap) 负责 —— 一个用 Rust 写的内容寻址存储,把目录还原成它先前某一刻的样子。有界扫描、内容寻址、原子还原、存储格式,全都在那边;想知道文件到底是怎么动的,该读的是那个仓库。

它是一个 4 MB 的静态二进制,不需要安装任何运行时;每轮跑一次,而它前面是一次以秒计的模型请求:

| | 捕获的文件数 | 首次捕获 | 之后每次 |
|---|---|---|---|
| 本仓库 | 84 | 20 ms | **8 ms** |
| harness 主仓 | 磁盘上 70,918 个,捕获 7,995 个 | 1.75 s | **268 ms** |

第二列是**有界扫描**:一次快照覆盖的是"这一轮有可能改到"的范围,而不是根目录下的一切 —— 所以 7 万个文件的 checkout 不会付出 7 万个文件的代价。最后一列是**内容寻址**:本仓库的第二次捕获一个文件都没有重新哈希,84 个全部复用 —— 十轮里只改一个文件,存储代价就是一个文件,而不是十份拷贝。

*(在本机用 `filesnap capture` 实测,page cache 热态。你的数字会不一样,但形状是一样的。)*

本包是 harness 这一半:决定**什么时候**快照、一个回退点在对话里意味着什么,以及一次回退的两半按什么顺序发生。

> **安装前请先知道这一点:** 插件把回退点记录为 session 事件,而 harness 没有为仓库外的插件提供声明事件类型的正式接口 —— 所以它在加载时通过修改一个 harness 常量来声明。这能工作,但有一个用户可见的后果值得先说清楚:**卸载插件后,被它抓过快照的对话会打不开**,因为读取端会拒绝一个含有未知类型的日志。磁盘上的数据完好无损;重新安装即可恢复访问。详见[已知限制](#已知限制)。

## 它做什么

**每轮抓一次快照。** 在 `agent/pre-step` 上,早于模型请求、也早于任何工具运行时,对工作区拍快照并把这个点记进 session 日志。这个抓取是被 await 的,所以第一次编辑落地时,快照不会处于"抓了一半"的状态。

**在编辑发生前记录 pre-image。** `fs/write-intent` 和 `fs/edit-intent` 在 provider 真正改动之前触发 —— 那是文件旧内容还存在的最后一刻。插件只报路径,由 filesnap 自己去读,所以存下来的 pre-image 基于**观察**而不是基于插件的**声称**。

这两个事件是**单槽决策 waterfall**,而部署自带的策略会占住那个槽且不往下委托。所以这两个监听器用 `prepend` 注册 —— 这么做安全的前提恰恰是它们不做任何决定:只记录,然后原样把决定权交出去,策略依旧拥有最终结果。如果按默认追加注册,它们**根本不会执行** —— 在 `tests/wiring.spec.ts` 补上"先挂一个不委托的决策者"(也就是 profile patch 层实际产生的顺序)这个用例之前,情况正是如此。

这些挂载点与具体工具无关。覆盖范围跟随 `ctx.fs`,而不是某个工具名单 —— 所以一个本插件从没听说过的工具,只要它通过这个 seam 写文件,就立刻受到保护。

**回退两半,而且只有一个顺序是对的。** 一次回退先 fork 对话,再把文件恢复**进那个 fork**。因为 filesnap 会把撤销记录归档到 `--undo-for` 指定的会话里,而那必须是用户最终所处的会话。顺序搞反,`/redo` 就存在于一个用户够不着的地方。

## 浏览器半边

可选,是一个独立产物。`lib/client.js` 提供两样东西,而这个拆分本身就是设计:

- **每一轮自己那条消息按钮排里的回退控件**,和复制、分支并排。转录本身**就是**回退点的列表(一轮一个),所以控件是收尾那条 assistant 气泡下的一个图标,tooltip 说明这次快照覆盖了什么。没有再弹一个面板重复那张列表。
- **header 里两个会话级控件**:撤销落在此处的回退(只有真有回退时才渲染),以及询问引擎当前存了什么。status 的回答落在对话里 —— 长列表本来就该待在那儿。

选中某一轮后,按 web 需要的顺序执行三步:

```
sessions.fork(atSeq)             部署自己的 fork —— 会组合子会话的 preset
                                 并把它挂进 workspace
/rewind <point> --into <child>   host 把文件放回去,并把撤销记录归档进那个 fork
sessions.open(child)             用户落在文件所落之处
```

host 插件自己也能 fork,headless 场景就是这么做的。但在 web 里不能:在部署那个正确的 fork 之外再建一个,会让子会话没被挂进它应属的 workspace。

**它和 host 半边挂在同一行上。** web shell 会扫描 host Loader 已挂载的每个条目、解析各自的 `package.json`,凡是声明了 `dsh.client` 的就把它 `exports["./client"]` 指向的文件提供出去 —— 所以挂载 host 半边的那一行 `- id: filesnap`,同时也把 `lib/client.js` 放到了 `/plugins/dsh-filesnap/client.js`。不需要往 web 构建里加任何东西,也不需要改静态模块表。

前提是 `npm run build:client` 跑过。没跑的话,shell 启动时会点名告诉你:

```
client-modules: client bundle not found; run `pnpm run build` before launch:
  package: dsh-filesnap
  path: …/lib/client.js
```

只想要命令的部署,构建 host 半边、永远不跑 `build:client` 即可 —— 那一行照常工作,只是没有浏览器入口。

## 命令

| | |
|---|---|
| `/rewind` | 列出本会话可以返回的点 |
| `/rewind <turn>` | 在那里 fork 对话,并把文件一起放回去 |
| `/redo` | 撤销落在本会话的回退,并交还给它 fork 自的那个对话 |
| `/rewind status` | 这里存了什么,以及哪些文件**没有**被保护 |

`/rewind status` 会重新扫描目录树,而不是读某次快照存下来的东西 —— 因为这个问题问的是项目**当下**的样子。这也是为什么没有任何地方每轮跑它:它的代价和一次快照相当。相比之下每轮的覆盖计数是免费的 —— 快照本来就报告了它们,于是它们搭日志的车,并显示在回退控件的 tooltip 里。

`/rewind <turn> --into <session>` 会把撤销记录归档进调用方**已经建好**的 fork,浏览器半边传的就是这个。

`/rewind` 接受列表里显示的轮次编号,或者点 id 原文。**没有**"往回三步"这种写法 —— 引擎刻意拒绝相对寻址,因为恢复操作会覆盖你的文件,而相对索引差一位既容易犯又容易漏掉。对着一张你正在看的列表数,和对着一个你以为的索引数,不是一回事。

两个命令都不经过模型轮次。回退是你**对**这段对话做的事,所以它不该经手被回退的那个东西。

## 安装

不需要手动装任何东西。`filesnap` 是本包的依赖,所以安装插件时会一并带来对应平台的预编译二进制:

```console
$ dsh plugin --profile web add dsh-filesnap
```

二进制是**解析**出来的,不是从 `PATH` 找的 —— 启动器的 `bin` 条目落在 profile 的 `node_modules/.bin`,而 subprocess provider 那套经过清洗的环境没有理由包含它。只有在想指向另一个构建、或者 subprocess provider 的执行世界不是本机(此时应填裸名)时,才需要设置 `command` 配置项。

`dsh plugin` 会把参数转发给 profile 目录里的 pnpm,并给出一条警告:

```
dsh: warning: dsh-filesnap declares no dsh.bundle — installed as a plain
dependency, not a profile layer
```

这条警告是预期内的:这是一个插件而不是 bundle,所以它靠一行 row 挂载,而不是靠 layer。往该 profile 的 `cordis.patch.yml`(`~/.dsh/profiles/web/cordis.patch.yml`)里加一行:

```yaml
# `insert` 收的是一个列表,不是单行。
- insert:
    - id: filesnap
      name: dsh-filesnap
```

`dsh --profile web --dump-config` 会打印实际启动的那棵树,可以确认这一行有没有生效:

```console
$ dsh --profile web --dump-config | grep -A 1 filesnap
- id: filesnap
  name: dsh-filesnap
```

## 本地试用

从一份 checkout 出发,在发布任何东西之前:

```console
$ npm run build                                   # profile 加载的是 lib/
$ dsh plugin --profile headless add /path/to/this/repo
```

把同样那行 `insert` 加进 `~/.dsh/profiles/headless/cordis.patch.yml`,用 `--dump-config` 确认它组合进去了,然后在一个临时目录里跑一个任务:

```console
$ cd /tmp/scratch && echo hello > notes.txt
$ dsh --profile headless "把 notes.txt 改成 goodbye"
```

会话的工作目录就是你运行它的地方,所以要在你想被快照的项目里跑。之后直接问引擎它记录了什么 —— session id 就是转录里那个:

```console
$ filesnap log --session <session-id>
{"v":1,"type":"log.entry","turn":"<session-id>.t1","manifest":"a1b2…","at":…,"files":2,"absent":0}

$ filesnap status | jq -r 'select(.type=="status.unprotected") | "\(.reason)\t\(.path)"'
```

如果你有 harness 的 checkout,`pnpm dsh --profile headless "…"` 会改从源码启动。那条启动路径通过仓库自己的 tsconfig 解析 workspace 包,所以必须以 harness 作为工作目录运行 —— 这也让它成为快照**其他**目录的错误方式。那种情况请用安装好的 `dsh`。

## 配置

每个字段在一台普通机器上都有正确的默认值;大多数部署一个都不用设。

| 字段 | 默认 | |
|---|---|---|
| `command` | *(自动解析)* | 通常不设 —— 随本包安装的二进制会被自动找到。想用另一个构建时设它;当 subprocess provider 的执行世界不是本机时,设成一个由该 provider 通过自己的 `PATH` 解析的裸名。 |
| `dataDir` | 平台数据目录 | 存储所在位置 —— Unix 上是 `$XDG_DATA_HOME` 或 `~/.local/share`,Windows 上是 `%LOCALAPPDATA%`。永远不在你的项目里面。 |
| `timeoutMs` | `120000` | 单次调用的墙钟上限。开销大的是每轮那次扫描。 |
| `graceMs` | `2000` | 超时或轮次被取消时,SIGTERM 到 SIGKILL 之间的宽限。 |
| `maxOutputBytes` | `1048576` | 每条采集流的内存上限。 |
| `declareEdits` | `true` | 在编辑前记录 pre-image。关掉它会把覆盖范围收窄到每轮扫描能看到的部分。 |

未知的键或不可用的值会在**加载时**失败,而不是在第一轮才失败:一个一小时后才以"快照丢了"的形式浮现的配置错误,和一个 bug 无法区分。

filesnap 自己的扫描上限刻意**不**暴露。一个需要你去发现的边界不算边界,而 `filesnap status` 回答了那个设置本来要被用来回答的问题 —— 这个项目里哪些文件没有被保护,以及为什么。

## 它不会做的事

- **动你的版本控制。** git 只被当作文件**名字**的一个来源来读,从不写入。
- **删除一个它从没观察过的文件。** 只有当被恢复到的那次快照曾经查找过某个路径、并且没有找到时,恢复才会移除它。
- **快照你排除掉的东西。** `.filesnapignore` 是对称的 —— 被忽略的路径不会被存储、不会被恢复,也不会被恢复操作删除。
- **因为一个文件失败而丢掉整次回退。** 写不进去的文件会被点名,其余的照常落地,结果里也会说明这一点。
- **回退一个正在轮次中的 agent。** 请先停下它。否则回退会覆盖该轮自己的工具还在使用的文件。
- **隐藏你回退离开的那个对话。** 它是被**标记**,而不是被归档 —— 标题前会多一个 `↩`,`/redo` 会把它去掉。`ctx.workspaceRegistry` 上有 `archiveSession`,但没有 unarchive,harness 自己的注释把它列为待办。把一对可逆操作中的一半归档掉,会让 `/redo` 之后两个对话都不可见 —— 比它想解决的混淆更糟。

## 它记录什么

三个仅存于日志的 session 事件,通过声明合并进 `SessionEventMap`。它们都不是 `SurfaceEventType`:一次回退改变的是磁盘上有哪些文件、以及你站在哪个对话里,这两者都不是模型看得到的消息。

| | |
|---|---|
| `filesnap/point` | 这一轮存在一个快照,以及它的寻址 id |
| `filesnap/rewound` | 本会话被回退了;对话在 `child` 中继续 |
| `filesnap/redone` | 一次回退在此被撤销 |

它们同时驱动一个名为 `filesnap` 的 **session projection**,浏览器靠它读取回退点列表,而不必从一份为别的目的渲染的转录里重新推导。这个 projection 通过 `ctx.inject` 注册,所以没有 projection 注册表的组装不受影响。

它们存在于日志而不是一张旁表里,是因为 fork 会深拷贝种子:记在日志里的点会跟着进入每一个继承了对应轮次的子会话,所以一个刚 fork 出来的会话在自己还没跑过任何一轮时,就已经能提供回退点。

**插件在加载时把这三个类型声明给持久化读取端,而且必须这么做。** 读取端会拒绝一个含有它不认识的类型的日志,除非该事件被标记为 `ignorable`,而这个逃生口的两半对仓库外的插件都是关闭的:`KNOWN_SESSION_EVENT_TYPES` 由仓库内的声明生成 —— 下游事件"由构造决定"不在其中,而注册接口"推迟到真有这样的消费者出现时再做";同时 `Session.append` 对非 surface 事件不接受任何选项,所以那个标记设不了。不声明的话,凡是本插件抓过快照的会话都会以 `SessionFormatUnsupportedError` 打不开。

这个声明**刻意不随卸载而撤销**,因为撤销它会让那些日志重新变成读不了的。这就是它的代价,直说:**卸载本插件会让它抓过快照的会话变得不可读。** 消除这个代价的修法在上游 —— 一个注册接口,或者一个能把事件标记为 ignorable 的 `append`。

## 给其他插件用

服务是 `ctx.filesnap`。

```ts
const points = await ctx.filesnap.points(agent)
if (points.ok) {
  const outcome = await ctx.filesnap.rewind(agent, String(points.value[0].turn))
}
```

`rewind` 接受一个可选的目标。`{ kind: 'fork' }`(默认)让它自己 fork 对话;`{ kind: 'into', session }` 则把撤销记录归档进你**已经**建好的会话 —— 一个自带 fork 逻辑的部署应该传这个,这样本插件就不会在它旁边再造一个。

每个操作返回 `{ ok: true, value }` 或 `{ ok: false, refusal }`,而不是抛异常。每个调用方都得把原因渲染出来,而异常会逼它们各自从一个消息字符串里重新推导。

## 为什么每个 `@deepseek-ai` peer 都是 optional

声明它们是为了让依赖关系可见,标成 optional 是为了让任何人都别去满足它。一个 dsh 插件**绝不能**携带自己那份 harness 包:它运行在一个已组装好的 harness 里,用的是那里已有的那份。第二份不是"重复依赖",而是**第二个 Cordis** —— 不同的 `Service` 类、不同的注册表,以及一个 `inject` 永远无法解析、而且是静默无法解析的插件。

profile 的安装路径本身已经避免了这一点(profile 的 pnpm 设置里有 `autoInstallPeers: false`,再加上启动器指回安装自身模块的符号链接兜底)。标成 optional 是为了让裸的 `npm install dsh-filesnap` 表现一致,而不是去试图具现一组解析不出来的依赖 —— harness 的几条发布线并不同步,所以 npm 的 peer 自动安装会撞上一个真实的冲突。

## 开发

harness 那些包是 `peerDependencies` —— 部署方本来就有它们,在这里锁版本只会和它实际运行的那份打架。要在本地做类型检查和跑测试,链接一份**已构建**的同级 checkout:

```console
$ git clone https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
$ ( cd ../deepseek-harness && pnpm install && pnpm run build )
$ npm install
$ npm run harness:link
$ npm run typecheck && npm test
```

`harness:link` 把 harness **构建产物**里的包软链进 `node_modules`,而不写进 `package.json` —— 这样对没有 checkout 的人来说 `npm install` 依然可复现。"已构建"这点很重要:消费者解析到的是 `lib/types/*.d.ts`,而对着 `src` 检查等于用本项目的编译器设置去类型检查 harness 自己的源码,而不是在检查这个插件。

`harness:link` 在**任何一次 `npm install` 之后都要重跑**:npm 会清理 `package.json` 里没有写明的东西,而这些链接正是刻意不写在那里的。

测试分四层。`npm run test:standalone` 既不需要 harness 也不需要二进制。engine、service 和 wiring 三层驱动真实的 `filesnap` 命令,而 `npm install` 已经把它带进来了 —— 所以直接就能跑。`FILESNAP_BIN` 可以让它们指向另一个构建,同级 `filesnap` checkout 的 cargo 产物是最后的兜底。

两个构建面:

```console
$ npm run build          # host 半边 —— 纯 tsc,不需要 harness
$ npm run build:client   # lib/client.js —— 需要 harness checkout
```

浏览器产物是 harness 自己的 closure-factory 格式,由它的 tsdown preset 生成。那个 preset 是仓库里的一个文件而不是已发布的入口,并且它通过 glob harness 的 `packages/` 目录树来解析一个包的 externals —— 所以 `build:client` 会在构建期间把本包的 manifest 暂存到那里,构建完再删掉。源码、配置和产物全都留在本仓库。这没有看上去那么苛刻:web 应用本身就是从 harness 仓库构建的,所以任何要组装一个包含本插件的 web 构建的人,手上本来就有一份 checkout。

## 已知限制

- **在 web 输入框里直接敲 `/rewind`,只会报出新会话的 id 而不会跳过去。** host 的命令注册表返回的是文本,所以那条路径只能点名那个 fork、由用户自己打开。header 里的入口没有这个问题:它自己 fork 并跳转。
- **插件自行 fork 时会继承父会话的模型路由和 preset,但不包括按 agent 的模型*选择*和 workspace 挂载。** 那些在部署自己的 fork 路径(`sessions.fork`)里,而 `--into` 存在的意义就是把这件事让给它 —— 所以带着这个缺口的是 headless 那条 fork。
- **卸载插件会让它抓过快照的会话变成读不了。** 见"它记录什么" —— 事件类型声明无法在不重新破坏那些日志的前提下撤销,所以移除插件会让那条拒绝重新生效。
- **浏览器半边只做过类型检查和构建验证,没有做过浏览器内测试。** 产物是 shell 自己的格式,两个面都对着 harness 的声明编译通过,但没有任何测试驱动过渲染出来的界面。
- **一个把未声明的服务当属性读的插件会被静默拆除。** Cordis 拒绝这次读取,异常从 service 构造函数里冲出去,fiber 被销毁且没有任何日志 —— 于是插件就那样不存在了。本插件通过 `ctx.get` 获取 `commands`、`fs`、`agentPresets` 和 logger,而 `tests/wiring.spec.ts` 的存在就是为了让它保持如此:它断言启动后服务仍然可达,以及一个被派发的轮次确实到达了引擎。service 层的测试看不见这种失败,因为直接调一个方法完全不能证明轮次会不会到达它。
- **抓取失败的那一轮不提供回退点。** 失败信息在 stderr;那个点是缺席,而不是被列出来然后在使用时被拒绝。
- **shell 写出的文件,其覆盖范围跟随扫描。** shell 命令在工作区外创建的文件、超过大小上限的、或超出最近性预算的,只有在它同时经过文件系统 seam 时才被覆盖。

## 许可

Apache-2.0,见 [LICENSE](LICENSE)。它驱动的引擎 [filesnap](https://github.com/extracurricular-ai/filesnap) 使用同一许可。
