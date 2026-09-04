# 参与贡献

[English](CONTRIBUTING.md) | 中文

**欢迎提 issue 和 PR,而且两者都不需要打磨得很完整。** 一句话加一段堆栈的 bug 报告,比那份始终没写出来的详尽报告有价值得多。如果你不确定某件事是 bug、是缺口还是自己理解错了 —— 照提,我们在 issue 里一起弄清楚。

用中文或英文都行,哪个顺手用哪个。

三个去处,选错了也没有任何代价:

| | |
|---|---|
| [Discussions](https://github.com/extracurricular-ai/dsh-filesnap/discussions) | 提问、想法、"这样是不是本来就该这样"、展示你做的东西 |
| [Issues](https://github.com/extracurricular-ai/dsh-filesnap/issues) | 有东西坏了,或者某个具体的地方该改 |
| [Pull requests](https://github.com/extracurricular-ai/dsh-filesnap/pulls) | 你已经把它修好了 |

## 报告 bug

**如果发生了文件丢失或者恢复回来的内容不对,请把这句放在最前面。** 其余的都可以等,这一类我们想第一时间看到。

让一个回退 bug 可复现,需要三样东西,每样一条命令:

```console
$ npm ls dsh-filesnap                 # 插件版本
$ filesnap --version                  # 引擎版本
$ dsh --profile <name> --dump-config | grep -A 1 filesnap
```

然后是引擎自己记下的东西,答案通常就在里面:

```console
$ filesnap log --session <session-id>     # 该会话持有的点
$ filesnap status                         # 这里有哪些文件没被保护,以及为什么
```

`filesnap status` 会重新扫描,所以它描述的是项目**当下**的样子,而不是出问题那一轮的样子。两者都有用,说清楚哪个是哪个就行。

提之前值得知道的一点:某一轮如果捕获失败,它就根本不会提供回退点,而失败信息在当时进了 stderr。如果你预期存在的某个点干脆不见了,那一次会话的 harness 日志就是它被记下的地方。

## 提出改动

**小而明确的 —— 错别字、写错的报错信息、漏掉的防御、给一个已知问题补测试 —— 直接开 PR。** 不需要先提 issue。

**任何改变行为的,请先提 issue。** 不是设卡,而是因为答案经常是"这个应该改在另一个仓库",而这件事最好在你动手之前就弄清楚。具体来说:

| 你想改的东西 | 它属于哪里 |
|---|---|
| 什么时候拍快照、一个回退点在对话里意味着什么、一次回退如何排序、命令、浏览器半边 | **这里** |
| 一次快照覆盖什么、文件如何存储与恢复、扫描的边界、存储格式、CLI | [filesnap](https://github.com/extracurricular-ai/filesnap) |

这个切分是刻意的:本包大约 1,100 行 harness 侧的策略,而 [`src/cli.ts`](src/cli.ts) —— 116 行非注释代码 —— 就是通往引擎的全部接口。如果你的改动会让 `src/cli.ts` 知道任何关于快照的事,那它多半属于这条线的另一侧。

## 本地开发

harness 的包是 `peerDependencies`,所以本地 checkout 需要从一个已构建的兄弟目录里链过来:

```console
$ git clone https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
$ git -C ../deepseek-harness checkout dsh-v0.1.2-rc.1
$ ( cd ../deepseek-harness && pnpm install && pnpm run build )
$ npm install
$ npm run harness:link
$ npm run typecheck && npm test
```

**检出 CI pin 住的那个 tag,而不是 harness 的 master。** `.github/workflows/` 下两份 workflow 的 `ref:` 里写的就是它:那是真正发到 npm 上的最新 harness,插件是对着它验证的,而不是对着今天早上刚进上游的东西。pin 挪的时候,你的 checkout 跟着挪。

**在 tag 之间切换 checkout 需要清理,而 `git status` 不会提醒你。** 构建产物是被忽略的,切换后会留下来;而上游在两个 tag 之间删掉的包会留下一个空目录,git 不跟踪空目录,所以永远不会报告它。tsdown 匹配的是包**目录**,在空目录里找不到 `package.json` 时会把它算到根包头上 —— 于是构建在 `@deepseek-ai/dsh-root` 上以 "Cannot find entry" 失败。每次 checkout 之后:

```console
$ git -C ../deepseek-harness clean -Xdf -e node_modules
$ find ../deepseek-harness/packages -mindepth 2 -maxdepth 2 -type d -empty -delete
$ ( cd ../deepseek-harness && pnpm run build )
```

`clean -X` 只删被忽略的文件,碰不到任何源码;那条 `find` 只删空目录。

`harness:link` 在每次 `npm install` 之后都要重跑 —— npm 会剪掉 `package.json` 没写的东西,而这些链接是刻意不写进去的。[README 的开发一节](README.zh.md#开发)解释了为什么。

测试套件有四层,最便宜的那层什么都不需要:

```console
$ npm run test:standalone   # 不需要 harness,也不需要二进制
$ npm test                  # 全部,并驱动真实的 filesnap 命令
```

`FILESNAP_BIN` 可以把面向引擎的那几层指到另一个构建上。

**改变行为的改动,需要一个"没有它就会失败"的测试。** wiring 那一层存在,是因为 service 层的测试看不见一整类失败:一个被静默卸载掉的插件,仍然能通过每一个直接调用它方法的测试。如果你的改动碰到了插件如何挂进 harness,`tests/wiring.spec.ts` 就是它被证明的地方。

## 提交

给你的 commit 签名 —— `git commit -s`。这是 [Developer Certificate of Origin](https://developercertificate.org/):你声明这份补丁是你写的,或者你有权以本项目的许可证提交它。

commit message 的写法看 `git log` 就行。这里的惯例是用一句话说清这个 commit 做了什么,以及在不明显的时候说清为什么 —— 不用 `feat:` 之类的前缀,不用 emoji。一条讲清楚推理的 message,比一个工整的标题行有价值,而正文就是放推理的地方。

## 行为准则

参与即表示你同意本项目的[行为准则](CODE_OF_CONDUCT.md)。它很短,而且就是通常那一份:讲道理,默认对方是善意的,别把这里变成一个人要鼓起勇气才敢发言的地方。

## 许可

贡献以 [Apache-2.0](LICENSE) 接收,也就是本项目及其引擎所使用的许可证。没有 CLA。
