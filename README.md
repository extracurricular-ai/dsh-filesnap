# dsh-filesnap — rewind DSH conversations and files together

[![npm](https://img.shields.io/npm/v/dsh-filesnap?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-filesnap)
[![CI](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml/badge.svg)](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/dsh-filesnap?color=1f6feb)](LICENSE)
[![powered by 🦀 Rust](https://img.shields.io/badge/powered%20by-%F0%9F%A6%80%20Rust-b7410e?logo=rust&logoColor=white)](https://github.com/extracurricular-ai/filesnap)
[![git not required](https://img.shields.io/badge/git-not%20required-2ea44f)](#why-dsh-filesnap)

English | [中文](README.zh.md)

[Join the discussion](https://github.com/extracurricular-ai/dsh-filesnap/discussions) ·
[Report a bug](https://github.com/extracurricular-ai/dsh-filesnap/issues/new?template=bug_report.yml)

Rewind a [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
conversation and its workspace together — without touching Git. Every rewind
happens in a fork, so `/redo` can take you back if you change your mind.
Powered by a blazing-fast **Rust 🦀** engine.

![dsh-filesnap: conversation and workspace rewind together](assets/social-preview.png)

```console
> /rewind 2
Rewound to turn 2 (make the rate limit per-tenant).
Files: 7 written, 1 deleted.

The conversation continues in session-9f3c1a04-….
Run /redo there to reverse this rewind.
```

## Quick start

### Requirements

- DeepSeek Harness with a `web` or `headless` profile
- Node.js `^22.19` or `>=24`
- Linux, macOS or Windows on x64 or arm64

The native [filesnap](https://github.com/extracurricular-ai/filesnap) binary is
installed with this package. You do not need Rust, Git or a separate runtime.

> [!IMPORTANT]
> dsh does not yet provide a supported registration API for event types declared
> by out-of-repository plugins. dsh-filesnap therefore registers its session
> events at load time. **If you uninstall the plugin, sessions it captured will
> not open until you reinstall it.** Their data remains intact on disk. The same
> refusal appears with the plugin installed if dsh is started with `pnpm dsh`
> from a source checkout — use the built CLI or an npm-installed dsh; see
> [troubleshooting](docs/troubleshooting.md#a-session-refuses-to-open-contains-event-type-filesnappoint--unknown-to-this-harness)
> and [the architectural limitation](docs/architecture.md#the-upstream-event-registration-gap).

### 1. Install

```console
$ dsh plugin --profile web add dsh-filesnap
```

That is the whole install: the package declares a `dsh.bundle`, so the launcher
mounts it into the profile itself. For headless use, replace `web` with
`headless`.

> [!WARNING]
> **Upgrading from 0.2.1 or earlier?** Those versions asked you to add an
> `id: filesnap` row to `~/.dsh/profiles/<profile>/cordis.patch.yml` by hand.
> **Delete that row before you start dsh on 0.2.2.** The bundle now supplies
> the same row, the loader refuses two entries with one id, and dsh will not
> boot: `plugin tree failed to load: … duplicate loader entry id: filesnap`.

### 2. Verify and use

```console
$ dsh --profile web --dump-config | grep -A 1 filesnap
- id: filesnap
  name: dsh-filesnap
```

Restart the profile, run one agent turn, then enter `/rewind`. If the plugin is
not listed in the composed profile or the browser control is missing, follow the
[troubleshooting guide](docs/troubleshooting.md).

## Why dsh-filesnap

| | What it means |
|---|---|
| **Conversation + files** | A rewind forks the transcript at the selected turn and restores the workspace into that fork. |
| **Git-independent** | Works in repositories and ordinary directories. Commits, branches, stash and worktree state are never changed. |
| **Undoable rewind** | A rescue point is captured before restore writes begin; `/redo` reverses the rewind. |
| **Broad file coverage** | Handles binary files, ignored files and edits made through `ctx.fs` outside the project root. |
| **Native engine** | Bounded scanning, content addressing and restore run in a small **🦀 Rust** binary outside the session's Node process. |
| **Inspectable** | `/rewind status` reports storage use and files that are not protected, with the reason for each exclusion. |

The design does not treat version control as a snapshot store. For a
version-stamped, source-audited comparison with other dsh rewind plugins, see
[Comparison](docs/comparison.md).

## Commands

| Command | Result |
|---|---|
| `/rewind` | List the workspace state captured before each turn. |
| `/rewind <turn>` | Fork the conversation at that turn and restore its files. |
| `/redo` | Reverse the rewind that landed in the current session. |
| `/rewind status` | Report stored data and files that are currently unprotected. |

`/rewind` accepts the displayed turn number or a point id. Relative addressing
such as “go back three” is deliberately not supported: a restore overwrites
files, so the target must be explicit.

Both commands dispatch without a model turn. Rewinding is something you do to a
conversation, not a request that should pass through the conversation being
rewound.

## What gets protected

Before every model step, dsh-filesnap captures a bounded union of:

- files already known to the workspace, including Git-tracked names;
- paths observed immediately before a `ctx.fs` write or edit, even outside the
  project root;
- a bounded scan of recent workspace changes, which covers writes made by shell
  commands.

Content is addressed by hash, so unchanged files are reused rather than copied
once per turn. `.filesnapignore` is symmetric: an ignored path is never stored,
restored or deleted by a restore. A restore deletes a path only when the target
snapshot positively recorded that the path was absent.

`/rewind status` re-scans the current tree and names anything outside coverage,
such as an unreadable path, an oversized file or a non-regular file. Coverage
details and restore invariants live in [Architecture](docs/architecture.md).

## Performance

The engine runs once before a model request that normally takes seconds. The
current preliminary measurements, taken with a warm page cache, are:

| Workspace | Files captured | First capture | Repeat capture |
|---|---:|---:|---:|
| this repository | 84 | 20 ms | **8 ms** |
| DeepSeek Harness monorepo | 7,995 of 70,918 on disk | 1.75 s | **268 ms** |

These numbers describe their original machine, not a universal promise. The
tracked set is bounded instead of walking all 70,918 files every turn, and the
repeat capture reuses unchanged content. See [Benchmarks](docs/benchmarks.md)
for the method, missing metadata and a reproducible command sequence.

## Browser experience

The optional `./client` export adds:

- a rewind action beside the existing actions on each completed assistant turn;
- header actions for redo and store status.

The transcript is already the list of turns, so the plugin does not add a
second checkpoint panel. In the browser, the deployment creates the correctly
composed child session, the host restores files into it, and the client opens
that child. Headless use performs the fork in the host plugin.

The browser bundle is typechecked and built during release. It does not yet have
an automated in-browser test; that remains a tracked limitation.

## Configuration

Defaults are intended to work on an ordinary local deployment.

| Field | Default | Purpose |
|---|---|---|
| `command` | resolved automatically | Use another engine build, or a bare command resolved by a remote subprocess provider. |
| `dataDir` | platform data directory | Store location; never inside the project. |
| `timeoutMs` | `120000` | Wall-clock limit for one engine invocation. |
| `graceMs` | `2000` | SIGTERM-to-SIGKILL grace period after cancellation or timeout. |
| `maxOutputBytes` | `1048576` | In-memory limit for each collected output stream. |
| `declareEdits` | `true` | Record file pre-images immediately before edits. |

Unknown keys and unusable values fail at plugin load rather than silently
removing a later rewind point.

## Current limits

- Uninstalling the plugin makes sessions containing its event types unreadable
  until it is reinstalled; no session data is deleted.
- Typing `/rewind` into the web composer reports the child session id instead of
  navigating to it. The per-turn browser action performs the navigation.
- A host-performed headless fork inherits the model route and preset, but not the
  deployment's per-agent model selection or workspace attachment.
- Shell-created files outside the workspace, above the engine size bound or
  outside the recent-change budget require an observed filesystem write to be
  covered.
- `gc`, `doctor` and session deletion exist in the engine but are not yet exposed
  as `/rewind` subcommands.

See [Architecture](docs/architecture.md) for the event-registration constraint
and [Troubleshooting](docs/troubleshooting.md) for operational workarounds.

## Documentation

| Document | What it answers |
|---|---|
| [Architecture](docs/architecture.md) | When captures happen, how forks and restores are ordered, and what is recorded. |
| [Comparison](docs/comparison.md) | How the available dsh rewind designs differ, with dated package versions. |
| [Benchmarks](docs/benchmarks.md) | What the published timings mean and how to reproduce them. |
| [Troubleshooting](docs/troubleshooting.md) | Installation, profile, client bundle and storage diagnostics. |
| [Contributing](CONTRIBUTING.md) | Local development, builds and the four test tiers. |

The snapshot engine is also usable outside dsh through Rust
(`cargo add filesnap`) or its versioned JSON Lines CLI. The complete subprocess
adapter in this repository is [`src/cli.ts`](src/cli.ts).

## Contributing

Issues, discussions and pull requests are welcome in English or Chinese:

- [Discussions](https://github.com/extracurricular-ai/dsh-filesnap/discussions)
  for questions, ideas and examples;
- [Issues](https://github.com/extracurricular-ai/dsh-filesnap/issues) for bugs and
  concrete changes;
- [Pull requests](https://github.com/extracurricular-ai/dsh-filesnap/pulls) for
  proposed fixes.

Read [CONTRIBUTING.md](CONTRIBUTING.md) before changing the host/engine boundary.
Report security problems through [SECURITY.md](SECURITY.md), not a public issue.

## Licence

Apache-2.0. See [LICENSE](LICENSE). The
[filesnap](https://github.com/extracurricular-ai/filesnap) engine uses the same
licence.
