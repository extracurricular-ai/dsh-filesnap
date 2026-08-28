# 基准测试

[返回 README](../README.zh.md) · [English](benchmarks.md)

项目 README 中的时间数据是产品证据，不是可移植的性能承诺。本文记录它们目前能说明什么、
还缺哪些元数据，以及如何得到可比较的新结果。

## 当前初步结果

原始测量使用 `filesnap capture` 和 warm page cache：

| 工作区 | 磁盘文件数 | 捕获文件数 | 首次捕获 | 重复捕获 |
|---|---:|---:|---:|---:|
| dsh-filesnap 仓库 | 未记录 | 84 | 20 ms | **8 ms** |
| DeepSeek Harness monorepo | 70,918 | 7,995 | 1.75 s | **268 ms** |

本仓库的重复捕获没有重新哈希文件内容，84 个文件全部复用。较大的仓库展示的是有界扫描：
引擎没有捕获全部 70,918 个条目。

## 尚缺的信息

原始记录没有保存：

- CPU 型号和核心数；
- 操作系统、文件系统和存储设备；
- 可用内存；
- 仓库准确 commit；
- filesnap 版本和完整命令；
- 防病毒或索引服务是否活动；
- 多次样本和分布统计。

在新测量补齐这些字段之前，应把表格视作一台机器上的数量级观察。它对“有界扫描 + 内容
复用”这一设计形态的支持，比对绝对毫秒数的支持更强。

## 复现步骤

在待测 workspace 中运行。使用唯一 session id，避免与真实快照混在一起：

```console
$ filesnap --version
$ git rev-parse HEAD
$ find . -type f | wc -l

$ time filesnap capture --session bench-filesnap --turn cold-1
$ time filesnap capture --session bench-filesnap --turn warm-1
$ time filesnap capture --session bench-filesnap --turn warm-2
```

除了 elapsed time，也要保留 stdout。`capture.done` 会报告 reused、hashed 和 dropped 数量，
它们能解释为什么两次相同耗时可能代表不同工作量。

保存输出后清理 benchmark session：

```console
$ filesnap delete --session bench-filesnap
$ filesnap gc
```

这些命令只修改 filesnap 数据存储，不修改被测项目。

## 推荐的报告格式

```text
日期：
filesnap 版本：
仓库与 commit：
OS / kernel：
CPU：
内存：
文件系统 / 存储：
page-cache 状态：
磁盘文件数：
捕获文件数：
reused / hashed / dropped：
样本（ms）：
Median / p95（ms）：
```

重复捕获至少运行十次再报告稳定 median。首次捕获单独报告，因为它包含读取和哈希内容的
代价，后续捕获可以复用这些内容。

## 怎样理解数字

三个量回答不同问题：

- **wall time** 是每个模型 step 之前增加的延迟；
- **考虑/捕获的文件数** 说明工作量是否随完整目录树增长；
- **reused 与 hashed** 说明未变化内容是否避免重复 I/O。

不要只比较 npm 包体积。Git 方案还依赖机器上安装的 Git；进程内 JavaScript 方案占用运行
session 的同一个 Node 进程；dsh-filesnap 的成本是一个独立原生进程。

## 后续自动化

有效的自动 benchmark job 应该：

1. 固定 filesnap build 和 fixture commit；
2. 创建确定性的小型与大型目录树；
3. 分别测首次捕获、无变化重复捕获和单文件变化捕获；
4. 把 JSONL 输出和机器元数据保存为 artifact；
5. 比较分布，不因单次噪声样本失败。

只有积累足够 hosted runner 历史后，才适合设置性能 regression gate；否则阈值测到的会是
runner 噪声而不是代码变化。
