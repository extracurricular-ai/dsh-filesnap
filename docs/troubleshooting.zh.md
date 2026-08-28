# 排障指南

[返回 README](../README.zh.md) · [English](troubleshooting.md)

先检查真正被组合进启动树的 profile，再检查引擎状态。大多数安装问题都是“包已经安装但没有
挂载”，或者修改后没有重启对应 profile。

## 安装器提示 “declares no dsh.bundle”

这是预期提示：

```text
dsh: warning: dsh-filesnap declares no dsh.bundle — installed as a plain
dependency, not a profile layer
```

dsh-filesnap 当前通过 Cordis patch row 挂载。把它加入安装命令所用的同一个 profile：

```yaml
- insert:
    - id: filesnap
      name: dsh-filesnap
```

如果使用 `--profile web`，编辑 `~/.dsh/profiles/web/cordis.patch.yml`；headless 则编辑
对应的 headless 文件。

## 插件似乎没有加载

检查实际启动的配置：

```console
$ dsh --profile web --dump-config | grep -A 2 filesnap
```

应该能看到 `id` 和 package `name`。如果没有：

1. 确认 package 安装进了同一个 profile；
2. 确认 `insert` 的值是 row 列表，并保留示例中的两层缩进；
3. 修改 patch 后重启 profile；
4. 查看启动 stderr 中是否有配置校验错误。

未知 config key 和无效值会在加载时失败。删除无效字段，或对照
[配置表](../README.zh.md#配置)。

## filesnap 命令不可用

平台二进制通过 `filesnap` npm 包的 optional dependency 安装。检查活动 profile 中的副本：

```console
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap --version
```

预编译包覆盖 Linux、macOS、Windows 的 x64 和 arm64。如果 launcher 不存在：

1. 检查 package manager 是否禁用了 optional dependency；
2. 在 profile 中重新安装 `dsh-filesnap`；
3. 确认 Node 版本满足 `^22.19` 或 `>=24`；
4. 其他平台可以用 Cargo 构建/安装 `filesnap-cli`，再把插件 `command` 指向该 executable。

如果 subprocess provider 的执行环境位于另一台机器，把 `command` 设为能由 provider 自己
通过 `PATH` 解析的裸命令名。

## `/rewind` 没有列出 point

只有轮次已经进入且捕获成功后，point 才存在。

- 至少完成一轮 agent 任务后再列出。
- 部署决策拒绝的 step 不会捕获，这是刻意行为。
- 捕获失败的轮次会被省略，不会展示成一个无法兑现的 point；检查 stderr 中的 filesnap 错误。
- 确认 session 有真实工作目录；没有 workspace 的 agent 无法把 filesnap session 绑定到目录。

知道 session id 时，可以查看引擎日志：

```console
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap log --session <session-id>
```

## 浏览器操作没有出现

同一条 profile row 会挂载 host 并暴露 `./client` bundle。检查：

1. `--dump-config` 中存在插件；
2. 安装包中存在 `lib/client.js`；
3. `package.json` 中存在 `exports["./client"]` 和 `dsh.client`；
4. 安装后已经重启 web profile；
5. 启动日志中没有 `client-modules: client bundle not found`。

从 checkout 开发时，需要构建两个面：

```console
$ npm run build
$ npm run build:client
```

`build:client` 需要一份已经构建的 DeepSeek Harness checkout。链接步骤见
[CONTRIBUTING.zh.md](../CONTRIBUTING.zh.md)。

## 在 web 输入框中执行 `/rewind` 后没有跳转

这是当前 host command 的限制。命令会报告新的 child session id，需要手动打开。逐轮浏览器
操作会使用部署的 fork API，并自动跳转。

## 卸载后某个 session 无法打开

在负责打开该 session 的 profile 中重新安装并挂载 dsh-filesnap。session 日志包含插件事件
类型，dsh reader 必须认识它们；卸载不会删除日志或快照数据。

该限制会持续到 dsh 提供运行时事件注册或 ignorable non-surface event 路径。详见
[架构说明](architecture.zh.md#上游事件注册缺口)。

## 有些文件没有被保护

直接询问当前 workspace：

```text
/rewind status
```

报告会列出未保护路径，以及大小、可读性或文件类型等原因。也要检查 `.filesnapignore`；
它的排除规则对捕获、还原和删除对称生效。

workspace 之外或超出近期变化有界扫描的 shell 写入，只有同一路径也通过 `ctx.fs` 被观察到
时才会覆盖。

## 存储占用高于预期

`/rewind status` 会区分 workspace record 和共享 blob。未变化的 blob 会在 point 和 session
之间共享，因此总量不是完整副本之和。

插件还没有包装引擎的生命周期命令，但可以在 profile 中直接使用：

```console
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap doctor --workdir .
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap delete --session <session-id>
$ ~/.dsh/profiles/web/node_modules/.bin/filesnap gc
```

`doctor` 清理中断操作留下的残骸。`delete` 会从 filesnap store 中永久删除所选 session 的
快照记录，只应在不再需要这些 rewind point 时运行。`gc` 回收已经不可达的 blob。这些命令
都不会修改项目或 Git 仓库。

## 提交有效 bug report

请包含：

- dsh-filesnap 和 dsh 版本；
- 操作系统和架构；
- 活动 profile 名称；
- 删除 secret 后的 `--dump-config` row；
- 启动 stderr 和失败命令的输出；
- 如果问题涉及覆盖或存储，附 `/rewind status` 输出；
- 问题发生在 web、headless 还是两者。

附加源码或 session log 前请先检查其中是否有隐私内容。安全问题通过
[SECURITY.md](../SECURITY.md) 报告。
