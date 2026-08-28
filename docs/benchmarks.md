# Benchmarks

[README](../README.md) · [中文](benchmarks.zh.md)

The timings in the project README are product evidence, not a portable
performance guarantee. This document records what they currently establish,
what metadata is still missing and how to produce a comparable run.

## Current preliminary results

The original measurements used `filesnap capture` with a warm page cache:

| Workspace | Files on disk | Files captured | First capture | Repeat capture |
|---|---:|---:|---:|---:|
| dsh-filesnap repository | not recorded | 84 | 20 ms | **8 ms** |
| DeepSeek Harness monorepo | 70,918 | 7,995 | 1.75 s | **268 ms** |

The repeat capture of this repository hashed no file contents and reused all 84
files. The larger repository illustrates the bounded scan: the engine did not
capture all 70,918 entries.

## What is missing

The original note did not record:

- CPU model and core count;
- operating system, filesystem and storage device;
- available memory;
- exact repository commits;
- filesnap version and complete command line;
- whether antivirus/indexing was active;
- multiple samples or distribution statistics.

Until a new run records these fields, treat the table as an order-of-magnitude
observation from one machine. It supports the shape of the design — bounded
scan plus content reuse — more strongly than an absolute millisecond claim.

## Reproduction sequence

Run from the workspace being measured. Use a unique session id so the run does
not mix with real snapshots:

```console
$ filesnap --version
$ git rev-parse HEAD
$ find . -type f | wc -l

$ time filesnap capture --session bench-filesnap --turn cold-1
$ time filesnap capture --session bench-filesnap --turn warm-1
$ time filesnap capture --session bench-filesnap --turn warm-2
```

Capture stdout as well as elapsed time. `capture.done` reports reused, hashed
and dropped counts, which explain why two equal timings may represent different
work.

Clean up the benchmark session after retaining its output:

```console
$ filesnap delete --session bench-filesnap
$ filesnap gc
```

Those commands mutate only the filesnap data store, not the measured project.

## Recommended report format

```text
Date:
filesnap version:
Repository + commit:
OS / kernel:
CPU:
Memory:
Filesystem / storage:
Page-cache state:
File count on disk:
files captured:
reused / hashed / dropped:
Samples (ms):
Median / p95 (ms):
```

Use at least ten repeat captures for a stable median. Report the first capture
separately because it includes reading and hashing content that later captures
can reuse.

## Reading the numbers

Three quantities answer different questions:

- **wall time** is the delay added before a model step;
- **files considered/captured** shows whether work scales with the full tree;
- **reused versus hashed** shows whether unchanged content avoids repeated I/O.

Do not compare only package size. A Git-backed design also depends on an
installed Git command; an in-process JavaScript design consumes the same Node
process that runs the session; dsh-filesnap pays for a separate native process.

## Future automation

A useful automated benchmark job should:

1. pin a filesnap build and fixture commit;
2. create a deterministic small and large tree;
3. measure first capture, unchanged repeat and one-file-changed repeat;
4. retain JSONL output and machine metadata as artifacts;
5. compare distributions without failing on a single noisy sample.

Performance regression gates should be added only after enough hosted-runner
history exists to choose thresholds that measure the code rather than runner
noise.
