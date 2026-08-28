# dsh-filesnap 宣传素材包

[English](PROMOTION.md)

本文供维护者统一仓库元数据、演示和发布文案。公开结论应与当前 README 和带日期的审计一致。

## GitHub 仓库元数据

**About 描述**

> 同步回退 DeepSeek Harness 对话与工作区文件，不碰 Git；每次回退都可以用 /redo 撤销。

**Website**

> https://www.npmjs.com/package/dsh-filesnap

**Topics**

```text
deepseek-harness
dsh-plugin
coding-agent
ai-agent
rewind
redo
workspace-snapshot
agent-safety
git-free
rust
```

**Social preview**

在仓库 Settings → Social preview 上传
[`assets/social-preview.png`](../assets/social-preview.png)。源图为 1280×640、低于 1 MB；
它保留在 Git 仓库中，但刻意不进入 npm tarball。

## 信息顺序

按下面的顺序表达：

1. **结果：** 对话和文件一起回退。
2. **安全：** 不碰用户 Git 状态；回退本身也能撤销。
3. **证据：** 二进制/ignored/项目外编辑覆盖、status 可检查、原生引擎实测延迟。
4. **实现：** Rust 和内容寻址用于解释证据，不作为第一句。
5. **限制：** 卸载后 session 在重新安装前暂时无法读取。

从具体用户场景开头，不要用竞品风险作为开场。

## 20 秒功能演示

使用一次性 workspace，以 1280×720 或更高分辨率录制，不出现私人 session 内容。

| 时间 | 画面 | 要证明的事 |
|---:|---|---|
| 0–3 秒 | 展示三轮对话和一个小型 workspace | “Agent 走错方向了。” |
| 3–7 秒 | 打开最后一轮修改过的文件 | 对话和磁盘都偏离了目标 point。 |
| 7–11 秒 | 点击第 2 轮的 rewind 操作 | 一次操作明确选择目标轮次。 |
| 11–15 秒 | 展示 child 对话与恢复后的文件 | 对话和文件一起移动。 |
| 15–20 秒 | 执行 `/redo` 并返回 | 回退本身也可逆。 |

社交平台使用 MP4，README 使用短小、优化后的 GIF/WebP。终端文字要在手机上可读；即使静音，
画面也应独立证明功能。

## 短发布文案

> Coding agent 三轮之前走错了方向。dsh-filesnap 会把 DeepSeek Harness 对话和工作区一起
> 回退，不改变 commit、stash 或 worktree。每次回退都发生在 fork 中，所以后悔了还可以
> `/redo`。原生 Rust 引擎，不需要 Git。

附仓库链接；平台支持视频时优先附功能演示，而不是静态卡片。

## 长发布文案

> Coding agent 的一次回退有两半：对话，以及它改过的文件。只恢复其中一半，会留下一个
> 从未真实存在过的状态。
>
> dsh-filesnap 在每个 DeepSeek Harness 轮次前捕获工作区，在明确 point 处 fork 对话，把
> 文件还原进同一个 fork，并且在写入前先创建救援点。`/redo` 可以撤销这次回退。它不要求
> Git 仓库，也不会修改 commit、branch、stash 或 worktree 状态。
>
> 快照引擎 filesnap 是一个内容寻址 Rust 二进制。当前 warm-cache 初步测量：本插件仓库
> 重复捕获 8 ms；在拥有 70,918 个文件的 harness checkout 中捕获 7,995 个相关文件为
> 268 ms。测量方法和限制均公开在仓库中。
>
> 当前重要限制：卸载插件后，包含其事件的 session 在重新安装前无法读取；数据仍完整保留
> 在磁盘上。

## Release note 模板

```md
## 改了什么

<一句话描述用户可见的结果。>

## 为什么重要

- <移除了什么问题，或缩短了什么流程>
- <安全/性能影响；相关时附证据>

## 升级

<无需操作，或准确步骤。>

## 已知限制

<只写本次 release 影响的限制，并链接完整列表。>

## 验证

- tests：<数量/结果>
- 实际验证的 profile/platform：<列表>
```

每个 release 附一张截图或短视频，直接展示最主要的变化。

## 宣传结论规范

- 竞品对比必须带日期和准确包版本。
- 性能结论必须链接机器元数据和复现步骤。
- 区分“设计/测试支持”与“在某个部署观察到”。
- 卸载限制必须紧邻安装步骤。
- 仍需 profile row 时不要宣称“zero config”。
- 重复使用“唯一”或“最快”之前重新核对对比审计。
