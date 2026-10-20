# 排障指南

[返回 README](../README.md) · [English](troubleshooting.md)

先检查真正被组合进启动树的 profile，再检查引擎状态。大多数安装问题都是“包已经安装但没有
挂载”，或者修改后没有重启对应 profile。

## 安装器提示 “declares no dsh.bundle”

```text
dsh: warning: dsh-filesnap declares no dsh.bundle — installed as a plain
dependency, not a profile layer
```

说明你装的是 0.2.2 之前的版本。从 0.2.2 起本包自带 `dsh.bundle`，`dsh plugin add`
会自己完成挂载，这条提示不会再出现：

```console
$ dsh plugin --profile web add dsh-filesnap@latest
```

旧版本需要手动挂载——在 `~/.dsh/profiles/web/cordis.patch.yml`（headless 则是对应的
headless 文件）中加入：

```yaml
- insert:
    - id: filesnap
      name: dsh-filesnap
```

**升级到 0.2.2 之前先删掉那一行。** bundle 会提供同一行，而 loader 拒绝两个同 id 的
条目——见下一节。

## dsh 启动失败：`duplicate loader entry id: filesnap`

```text
dsh: plugin tree failed to load: failed to apply loader entry include
(cordis:include): duplicate loader entry id: filesnap
```

profile 里有两行 `filesnap`：一行是 0.2.2 的 bundle 现在提供的，另一行是旧版本说明让你手动
加的。loader 不会按 id 合并或覆盖——第二个带已有 id 的 `insert` 是错误，整棵插件树拒绝加载。

打开 `~/.dsh/profiles/<profile>/cordis.patch.yml`，删掉手动加的这一块：

```yaml
- insert:
    - id: filesnap
      name: dsh-filesnap
```

文件里其它行不要动。重新启动 dsh；`--dump-config` 里 `name: dsh-filesnap` 应该只出现一次，
在 `# == dsh-filesnap` 层下面。

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
[配置表](../README.md#配置)。

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

## session 拒绝打开：`unknown to this harness`

旧版写入的自定义事件可能导致卸载后无法打开。0.3.0 不再写这些事件。进入 **DSH 设置 → FileSnap → 数据迁移**，扫描旧会话并确认修复；新会话无需迁移。

如界面无法启动，可先停止 DSH，再使用独立离线工具。[迁移、备份和回滚说明](migrations.zh.md)。

## 冷分支报错：`persistence.inspect is not a function`

将插件升级到 **0.4.2 或更高版本**，再重启活动 profile。旧版读取器调用了持久化 0.2.x 已移除的 API；0.4.2 会按需改用只读句柄。这个报错本身不能证明快照已经丢失。请保留祖先会话和快照数据，继承的恢复点仍依赖它们。

## 首次快照读取失败后，回退按钮一直不显示

**0.4.2** 会在会话仍显示时延迟重试一次，重新打开会话也可发起新请求。如果仍然失败，请检查宿主错误输出，并在报告中提供插件与 harness 的确切版本。重试不能恢复已删除的快照或无法读取的祖先日志。

## 回退后的分支缺少子代理

**0.4.2** 在成功回退时携带子代理及后代。各克隆只保留切点及之前的历史，切点之后出生的后代不会带入。升级前已经创建的分支不会自动补齐。

单个子代理读取或写入失败只会告警，不会令文件回退失败。可在宿主输出中查找 `could not carry subagents` 或 `was not carried`。原会话及其子代理保持完整，包括没有带入分支的后续历史。

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

点击会话头部的快照状态按钮，在独立面板查看工作区索引和跨工作区共享内容。空间清理会先说明范围、要求确认，仅回收未引用数据，不删除仍有引用的快照或 redo 救援数据。

如果清理后占用没有减少，通常表示内容仍被保留快照引用。自动保留策略和会话快照删除 UI 尚未提供；不要把当前用量当作预计释放量。

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
