# dsh-filesnap

[![npm](https://img.shields.io/npm/v/dsh-filesnap?color=cb3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/dsh-filesnap)
[![CI](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml/badge.svg)](https://github.com/extracurricular-ai/dsh-filesnap/actions/workflows/ci.yml)
[![licence](https://img.shields.io/npm/l/dsh-filesnap?color=1f6feb)](LICENSE)
[![engine: Rust](https://img.shields.io/badge/engine-Rust-b7410e?logo=rust&logoColor=white)](https://github.com/extracurricular-ai/filesnap)
[![git not required](https://img.shields.io/badge/git-not%20required-2ea44f)](#what-each-one-risks)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-2ea44f)](CONTRIBUTING.md)
[![Discussions](https://img.shields.io/badge/discussions-join-5865f2?logo=github&logoColor=white)](https://github.com/extracurricular-ai/dsh-filesnap/discussions)

English | [中文](README.zh.md)

A blazing-fast rewind and redo plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness), powered by a **🦀 Rust** core.

Go back to the start of an earlier turn — the conversation *and* the files it
changed — in a project that has never seen `git init`, and in one that has.
Your commits, your stash, your worktree state: untouched. Nothing is stored
inside your repository.

```console
> /rewind
Rewind points — the workspace as it stood before each turn:

  turn  when                 opened by
     1  2026-08-27 09:12:04  add a rate limiter to the upload endpoint
     2  2026-08-27 09:18:41  actually make it per-tenant
     3  2026-08-27 09:31:10  now cache the tenant lookup

Rewind with /rewind <turn>. The conversation forks at that point and the files go back with it.

> /rewind 2
Rewound to turn 2 (actually make it per-tenant).
Files: 7 written, 1 deleted.

The conversation continues in session-9f3c1a04-….
Run /redo there to reverse this rewind.
```

## The engine is [filesnap](https://github.com/extracurricular-ai/filesnap)

**The load-bearing logic is not in this repository.** Snapshotting and restoring
is [filesnap](https://github.com/extracurricular-ai/filesnap) — a
content-addressed store, written in Rust, that puts a directory back the way it
was at an earlier moment. The bounded scan, the content addressing, the atomic
restore and the store format all live there, and that is the repository to read
if you want to know how the files actually move.

It ships as one 4 MB static binary with no runtime to install, and it runs once
per turn in front of a model request that takes seconds:

| | files captured | first capture | every capture after |
|---|---|---|---|
| this repository | 84 | 20 ms | **8 ms** |
| the harness monorepo | 7,995 of 70,918 on disk | 1.75 s | **268 ms** |

The second column is the bounded scan: a snapshot covers what a turn can
plausibly touch rather than everything under the root, which is why a
70,000-file checkout does not cost 70,000 files of work. The last column is
content addressing — the second capture of this repository hashed nothing and
reused all 84 files, so ten turns that change one file cost one file of storage,
not ten copies.

*(Measured on this machine with `filesnap capture`, warm page cache. Your
numbers will differ; the shape won't.)*

This package is the harness half: it decides *when* to snapshot, what a rewind
point means in a conversation, and how the two halves of a rewind are sequenced.

### Using it for a different agent

**The engine knows nothing about its host.** Its own documentation is explicit
about it — it takes opaque string ids and absolute paths, never reads or writes
your git state, and treats a directory that has never seen `git init` as a
first-class workspace. Nothing in it is aware that dsh exists. That is a design
commitment, not a coincidence, and it is what makes it portable to an agent that
is not this one.

Two ways in:

- **Rust** — `cargo add filesnap`. `capture`, `restore`, `scan_report` and the
  store types are the public API.
- **Anything else** — drive the binary. Every command writes versioned JSON
  Lines to stdout and keeps human text on stderr, so a subprocess and a line
  parser are the whole integration. The npm package ships the binary with no JS
  API, because this is the intended path rather than a fallback.

**This repository is the worked example of the second one, and the cost is
measurable.** [`src/cli.ts`](https://github.com/extracurricular-ai/dsh-filesnap/blob/main/src/cli.ts) — 116 non-comment lines — is the entire
engine interface: spawn it, parse the JSONL, map the exit codes. There is
nothing dsh-specific in that file. Copy it.

What is *not* 116 lines is the other ~1,100 in this repository, and that is the
part worth understanding before you start. Those lines decide when a turn is
worth capturing, what a rewind point means once a conversation can fork, how the
conversation and the files are sequenced so a crash between them is survivable,
and what happens to a point inherited from a parent session. **filesnap
deliberately makes none of those decisions for you** — they differ per agent,
and a library that guessed would be wrong in a way you could not override.

So the honest pitch is narrow and, we think, better for it: filesnap does not
give you a rewind feature. It makes the snapshot-and-restore half a solved
problem in about a hundred lines, so your effort goes to the half that is
actually specific to your agent.

[crates.io](https://crates.io/crates/filesnap) ·
[docs.rs](https://docs.rs/filesnap) ·
[npm](https://www.npmjs.com/package/filesnap) ·
[github](https://github.com/extracurricular-ai/filesnap)

> **Before you install:** the plugin records its rewind points as session
> events, and the harness has no supported way for an out-of-repo plugin to
> declare an event type — so it declares them by mutating a harness constant at
> load. That works, and it has one user-visible consequence worth knowing up
> front: **uninstalling the plugin leaves the conversations it captured in
> unopenable**, because the reader refuses a log holding a type it does not
> know. The data is untouched on disk; reinstalling restores access. See
> [Known limitations](#known-limitations).

## What it does

**Captures once per turn.** On `agent/pre-step`, before the model request and
before any tool runs, the workspace is snapshotted and the point is recorded in
the session log. The capture is awaited, so a snapshot is never half-taken when
the first edit lands.

**Records pre-images before edits.** `fs/write-intent` and `fs/edit-intent` run
immediately ahead of the provider's mutation — the last moment a file's
previous contents still exist. The plugin names the path and filesnap reads it,
so the stored pre-image rests on an observation rather than on a claim.

Both are **single-slot decision** waterfalls, and the deployment's own policy
takes that slot without delegating. These listeners are therefore registered
with `prepend`, which is safe precisely because they decide nothing: they
record and hand the decision on unchanged, so the policy still owns the
outcome. Appended instead, they never run at all — which is what happened
before `tests/wiring.spec.ts` grew a case that mounts a non-delegating decider
first, the order a profile patch layer actually produces.

These attachments are tool-agnostic. Coverage follows `ctx.fs`, not a list of
tool names, so a tool this plugin has never heard of is protected the moment it
writes through the seam.

**Rewinds both halves, in the one order that works.** A rewind forks the
conversation first, then restores the files *into* that fork, because filesnap
files an undo record in the session named by `--undo-for` and that has to be
the session the user ends up standing in. Get the order wrong and `/redo`
exists somewhere the user cannot reach.

## The browser half

Optional, and a separate artifact. `lib/client.js` adds two things, and the
split is the design:

- **A rewind control in each turn's own message row**, beside copy and branch.
  The transcript already *is* the list of points — one per turn — so the
  control is one icon under the assistant message that closed that turn, and
  its tooltip says what the snapshot covered. There is no panel repeating the
  list.
- **Two session-level controls in the header**: undo the rewind that landed
  here (rendered only when one did), and ask the engine what it holds. The
  status answer lands in the transcript, where a long list belongs.

Picking a turn runs the three steps in the order the web needs them:

```
sessions.fork(atSeq)             the deployment's own fork — composes the child's
                                 preset and attaches it to the workspace
/rewind <point> --into <child>   the host puts the files back and files the
                                 undo record in that fork
sessions.open(child)             the user lands where the files landed
```

The host plugin can fork by itself and does so for a headless run. In the web
it must not: a second fork beside the deployment's correct one would leave the
child out of the workspace it belongs to.

**It loads off the same row.** The web shell scans the host Loader's mounted
entries, resolves each one's `package.json`, and serves the `./client` export
of any that declares `dsh.client` — so the `- id: filesnap` row that mounts the
host half is also what puts `lib/client.js` on
`/plugins/dsh-filesnap/client.js`. There is nothing to add to a web build and
no static module table to edit.

It does need `npm run build:client` to have run. Without it the shell says so
by name at launch:

```
client-modules: client bundle not found; run `pnpm run build` before launch:
  package: dsh-filesnap
  path: …/lib/client.js
```

A deployment that wants only the commands builds the host half and never runs
`build:client`; the row still works, with no browser entry.

## Commands

| | |
|---|---|
| `/rewind` | list the points this session can return to |
| `/rewind <turn>` | fork the conversation there and put the files back with it |
| `/redo` | reverse the rewind that landed in this session, and hand back to the conversation it forked from |
| `/rewind status` | what the store holds here, and which files it does **not** protect |

`/rewind status` re-scans the tree rather than reading something a capture
stored, because the question is about the project as it stands now. That is why
nothing runs it per turn: it costs what a capture costs. The per-turn coverage
counts are free by comparison — the capture already reports them, so they ride
the log and show up in the rewind control's tooltip.

`/rewind <turn> --into <session>` files the undo record in a fork the caller
already made, which is what the browser half passes.

`/rewind` takes a turn number as listed, or a point id verbatim. There is no
"go back three" — the engine refuses relative addressing on purpose, because a
restore overwrites your files and an off-by-one in a relative index is easy to
make and easy to miss. Counting against a list you are looking at is not the
same as counting against an index you assumed.

Both dispatch without a model turn. Rewinding is something you do *to* the
conversation, so it does not go through the thing being rewound.

## Compared with the other dsh rewind plugins

**Everything a rewind has to do, only one of these does all of.**

> [!CAUTION]
> **Three of these can lose your work, and every claim here is verifiable in the
> package they ship.**
>
> 1. **`git gc` deletes your rewind points.** `dsh-rewind` and
>    `dsh-checkpoint-rewind` keep their only snapshot in git objects that nothing
>    references: `update-ref` appears nowhere in `dsh-checkpoint-rewind` 0.6.1,
>    and `git stash create` writes no reflog entry. Unreferenced objects are
>    exactly what `git gc` prunes — automatically once past `gc.pruneExpire`,
>    immediately under `git gc --prune=now`. Tidying your repository destroys
>    your safety net, and nothing tells you it is gone.
> 2. **A restore corrupts every binary file.** `dsh-rewind-plugin` 0.4.2 captures
>    pre-images with `readFile(path, "utf8")` and restores with
>    `writeFile(path, content, "utf8")` — `lib/index.js:207` and `:607`, with no
>    `Buffer`, no base64 and no binary detection anywhere in the package. Every
>    byte that is not valid UTF-8 comes back as `U+FFFD`. Images, PDFs and
>    databases do not survive its rewind.
> 3. **A rewind throws away work the agent never touched.** `dsh-rewind` restores
>    with `git reset --hard`, which its own limitations describe as covering "the
>    whole repository working tree … including changes made outside DSH tools" —
>    your uncommitted edits go with it, and your branch pointer moves.
>
> None of this is an argument against rewinding. It is an argument that the
> snapshot store must not be your version control.

### What a rewind has to do

| | engine | files | conversation | undo | shell writes | binary files | `git`-ignored | **outside the project** | original intact |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **dsh-filesnap** 0.2.0 | **🦀 Rust** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | ✅ |
| [dsh-rewind](https://www.npmjs.com/package/dsh-rewind) 0.11.12 | JS | ✅ | ✅ | ⚠️ latest only | ✅ | ✅ | ❌ | ❌ | ❌ masked |
| [dsh-checkpoint-rewind](https://www.npmjs.com/package/dsh-checkpoint-rewind) 0.6.1 | JS | ✅ | ✅ | ⚠️ guard point | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| [dsh-rewind-plugin](https://www.npmjs.com/package/dsh-rewind-plugin) 0.4.2 | JS | ✅ | ✅ | ❌ | ❌ | ☠️ | ✅ | ⚠️ | ❌ masked |
| [@anionex/dsh-turn-rewind](https://www.npmjs.com/package/@anionex/dsh-turn-rewind) 0.1.2 | JS | ✅ | ⚠️ optional | ⚠️ via API | ✅ | ✅ | ❌ | ❌ | ✅ |
| [dsh-recall-plugin](https://www.npmjs.com/package/dsh-recall-plugin) 2.0.0 | JS | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ archived |
| [@zoytown/dsh-rewind](https://www.npmjs.com/package/@zoytown/dsh-rewind) 0.1.0 | JS | ✅ | ❌ | ✅ files only | ✅ | ✅ | ❌ | ❌ | ✅ |
| [@flow2dream/dsh-msg-rewind](https://www.npmjs.com/package/@flow2dream/dsh-msg-rewind) 0.1.6 | JS | ❌ | ✅ | ❌ | ❌ | — | ❌ | ❌ | ❌ truncated |

### What each one risks

✅ is always the safe answer. ☠️ is the data-loss risk, not a missing feature.

| | no `git` needed | your repo untouched | survives `git gc` | the store is bounded by | capture cost grows with |
|---|:--:|:--:|:--:|---|---|
| **dsh-filesnap** 0.2.0 | ✅ | ✅ | ✅ nothing of ours is in git | **reachability** — live while referenced | **nothing** — a bounded union, per turn |
| [dsh-rewind](https://www.npmjs.com/package/dsh-rewind) 0.11.12 | ❌ creates one | ☠️ `git init`, `reset --hard` | ☠️ **no** — unreferenced stash objects | your repo's own `gc` | the tree |
| [dsh-checkpoint-rewind](https://www.npmjs.com/package/dsh-checkpoint-rewind) 0.6.1 | ⚠️ copy fallback | ☠️ writes `.git/objects` | ☠️ **no** — unreferenced objects | 50 points + 512 MiB, per session | the tree |
| [dsh-rewind-plugin](https://www.npmjs.com/package/dsh-rewind-plugin) 0.4.2 | ✅ | ✅ | ✅ | 100 anchor groups, per session | ☠️ **the session** — full copies, no dedup |
| [@anionex/dsh-turn-rewind](https://www.npmjs.com/package/@anionex/dsh-turn-rewind) 0.1.2 | ❌ git worktree only | ✅ | ✅ | 50 points + 30 auto, per session | the tree |
| [dsh-recall-plugin](https://www.npmjs.com/package/dsh-recall-plugin) 2.0.0 | ❌ needs the CLI | ✅ shadow repo | ✅ | ⚠️ nothing — it never prunes | the tree |
| [@zoytown/dsh-rewind](https://www.npmjs.com/package/@zoytown/dsh-rewind) 0.1.0 | ❌ needs the CLI | ✅ shadow repo | ✅ | 30 days, 50 sessions per workspace | the tree |
| [@flow2dream/dsh-msg-rewind](https://www.npmjs.com/package/@flow2dream/dsh-msg-rewind) 0.1.6 | ✅ | ✅ | — | — | — |

**"Capture cost grows with" is the column people discover last and regret first.**
`dsh-rewind-plugin` re-checks every file it has ever tracked at each message
boundary and stores each backup as a whole-file copy, so both the per-turn scan
and the disk grow with how long you have been talking. The git designs walk the
worktree, so they grow with the tree. Here the tracked set is a union of three
partitions, each bounded by something other than the size of the tree, and the
declared set ages out on a rolling window — which is why 70,918 files cost 268 ms
and why the second capture of this repository hashed nothing at all.

Three more facts behind those grids, each checkable in the shipped package:

- **Only this one follows the agent's edits outside the project directory.** A
  git design is bounded by the worktree by construction: a file the agent edits
  in `~/.config`, in a sibling checkout, or anywhere else is in nobody's tree, so
  it cannot be snapshotted and cannot come back. Here the pre-image is recorded
  at the moment of the write, wherever the path points — the edit-touched
  partition is bounded by what the agent did, not by what is under the root.
- **Files the agent created can survive its rewind:** "the snapshot does not
  include untracked files". A rewind that leaves the turn's new files on disk is
  not a rewind.
- **`dsh-rewind-plugin`, the most-installed of these, cannot undo its own
  rewind** — it says so. Masking in place leaves nothing to hand back to. Forking
  is what makes `/redo` possible.

### Size and speed

| | snapshot engine | to install | capture, 70,918-file checkout |
|---|---|---|---|
| **dsh-filesnap** | **compiled Rust**, one static binary | 0.23 MB plugin + 4 MB engine, **and nothing else** | **268 ms**, measured, in this README |
| the five git ones | JavaScript spawning the `git` CLI | 0.05–0.81 MB, **plus a `git` installation** | not published |
| the two without git | JavaScript, inside your session's Node process | 0.37–1.15 MB | not published |

**Every other plugin here snapshots in JavaScript.** They either hash and copy
files in the same Node process that is running your session, or shell out to `git`
once a turn. The work here is compiled: the bounded scan, the content hashing and
the atomic restore are native code in a separate process, which is why a
70,918-file checkout costs 268 ms and re-capturing this repository costs 8 ms.
Nobody else publishes a number.

The engine is the largest single artifact here and it is also the whole
dependency: no runtime, no `git`, no storage stack to compose. `dsh-checkpoint-rewind`
needs three more profile rows before one checkpoint exists.

A diff view and per-file restore are the one thing the checkpoint pair has that
this does not. Both are on the roadmap: every point is a content-addressed
manifest, so a diff between two points is a query rather than a redesign.

### If the rewind itself is interrupted

Every row above asks whether a rewind works. None of them asks what happens when
the rewind is the thing that breaks — the moment with the most to lose, because
half a restore is a workspace in a state that never existed.

**A restore here deletes a file only against a tombstone.** A capture records a
path as absent only when it *verified* the path was absent. A path it could not
read — a permission error, a directory it could not traverse, a transient IO
failure — is skipped, never recorded as absent, because a tombstone is the only
licence a restore has to delete. The engine carries a test named for exactly
this: `a_path_that_cannot_be_read_is_skipped_rather_than_declared_absent`.

The reason to care is that the opposite is easy to write and silent when it
fires. Any design that reads *not in my snapshot* as *delete it* will, after one
unreadable file at capture time, delete a file whose contents it never stored.
**This is not a claim about the other plugins** — we have not read every restore
path in every package, and no table here will pretend otherwise. It is worth
checking in whichever one you run.

**The rescue point exists before the first byte lands.** A restore captures one
*before* it writes, not after it finishes, so a rewind that dies partway is
still reversible — that snapshot is what `/redo` hands back.

**The store is not in your project.** It lives in the platform data directory —
`$XDG_DATA_HOME` or `~/.local/share` on Unix, `%LOCALAPPDATA%` on Windows — so
`git clean -xdf`, a fresh clone, or deleting `node_modules` costs you nothing.

**It refuses rather than guesses.** A rewind while the agent is mid-turn is
refused, not raced against the tools still writing. A turn whose capture failed
is *absent* from the list rather than listed and refused on use — a checkpoint
that cannot be honoured is worse than no checkpoint, because you plan around it.

### Nothing is deleted for being old

Every other plugin here bounds its store by age or by count, so the point you
want can be pruned by points you never asked for — `@zoytown/dsh-rewind` says
outright that its limit deletes a whole session at a time.

Nothing here is reclaimed for being old. `delete` is the only thing that makes a
point unreachable, `gc` collects only what is already orphaned and only after a
grace window, and `doctor` clears what an interrupted operation left behind.
Blobs are shared across every point that holds them, so keeping more points
costs what changed between them, not a copy of the tree per point.

> [!NOTE]
> **Those three are engine commands this plugin does not expose yet.** What is
> written above holds today — nothing prunes a point behind your back — but the
> levers for reclaiming space, or for clearing what an interrupted operation
> left, are still being wired into `/rewind`, with browser controls after that.
> Saying so here rather than letting you discover it: `/rewind status` currently
> reports a disk figure and offers no way to act on it.
>
> Until then the engine is right there, and the agent can run it for you:
>
> ```shell
> ~/.dsh/profiles/<profile>/node_modules/.bin/filesnap gc
> ~/.dsh/profiles/<profile>/node_modules/.bin/filesnap doctor --workdir .
> ~/.dsh/profiles/<profile>/node_modules/.bin/filesnap delete --session <id>
> ```
>
> See [Roadmap](#roadmap).

**And you can ask what it holds.** `/rewind status` re-scans and answers the
question nothing else answers — **which files in this project are not protected,
and why**: too large, unreadable, not a regular file. It also reports the disk in
use, split between this workspace's records and the shared blob store, and how
far back each session here can go. It is read-only, so you can look before you
decide.

### The one thing it costs you

The designs that reuse an existing event type, or keep their state outside the
session log, uninstall without a trace. This one declares three session event
types at load and cannot unwind that declaration without stranding the logs that
hold them, so **uninstalling it leaves the sessions it captured in unreadable**.
See [Known limitations](#known-limitations).

*(Versions, claims and line numbers in this section were checked against the
published packages on 2026-08-27. They are moving targets — check the current
release before relying on a row.)*

## Install

Nothing to install by hand. `filesnap` is a dependency of this package, so
installing the plugin brings the prebuilt binary for your platform with it:

```console
$ dsh plugin --profile web add dsh-filesnap
```

The binary is found by resolution, not by `PATH` — the launcher's `bin` entry
lands in the profile's `node_modules/.bin`, which the subprocess provider's
scrubbed environment has no reason to include. Set the `command` config only to
point at a different build, or to a bare name for a subprocess provider whose
execution world is not this machine.

`dsh plugin` forwards its arguments to pnpm inside the profile directory, and
warns:

```
dsh: warning: dsh-filesnap declares no dsh.bundle — installed as a plain
dependency, not a profile layer
```

That warning is expected: this is a plugin, not a bundle, so it is mounted by a
row rather than by a layer. Add one to that profile's `cordis.patch.yml`
(`~/.dsh/profiles/web/cordis.patch.yml`):

```yaml
# `insert` takes a list of rows.
- insert:
    - id: filesnap
      name: dsh-filesnap
```

`dsh --profile web --dump-config` prints the tree that actually boots, so you
can check the row landed:

```console
$ dsh --profile web --dump-config | grep -A 1 filesnap
- id: filesnap
  name: dsh-filesnap
```

## Trying it locally

From a checkout, before publishing anything:

```console
$ npm run build                                   # lib/ is what the profile loads
$ dsh plugin --profile headless add /path/to/this/repo
```

Add the same `insert` row to `~/.dsh/profiles/headless/cordis.patch.yml`,
confirm it composes with `--dump-config`, then run a task in a scratch
directory:

```console
$ cd /tmp/scratch && echo hello > notes.txt
$ dsh --profile headless "change notes.txt to say goodbye"
```

The session's working directory is wherever you run it, so run it in the
project you want snapshotted. Afterwards, ask the engine directly what it
recorded — the session id is the one in the transcript:

```console
$ filesnap log --session <session-id>
{"v":1,"type":"log.entry","turn":"<session-id>.t1","manifest":"a1b2…","at":…,"files":2,"absent":0}

$ filesnap status | jq -r 'select(.type=="status.unprotected") | "\(.reason)\t\(.path)"'
```

`pnpm dsh --profile headless "…"` runs the harness from source instead, if you
have its checkout. That launch resolves workspace packages through the
repository's own tsconfig, so it must run with the harness as the working
directory — which makes it the wrong way to snapshot some *other* directory.
Use an installed `dsh` for that.

## Configuration

Every field has a default that is right on an ordinary machine; most
deployments set none of them.

| field | default | |
|---|---|---|
| `command` | *(resolved)* | normally unset — the binary installed with this package is found automatically. Set it to use a different build, or to a bare name that the subprocess provider resolves through its own `PATH` when its execution world is not this machine. |
| `dataDir` | platform data directory | where the store lives — `$XDG_DATA_HOME` or `~/.local/share` on Unix, `%LOCALAPPDATA%` on Windows. Never inside your project. |
| `timeoutMs` | `120000` | wall-clock bound for one invocation. The expensive one is the per-turn scan. |
| `graceMs` | `2000` | SIGTERM-to-SIGKILL grace when a deadline or a cancelled turn ends a run. |
| `maxOutputBytes` | `1048576` | in-memory cap per collected stream. |
| `declareEdits` | `true` | record pre-images before edits. Turning it off narrows coverage to whatever the per-turn scan sees. |

An unknown key or an unusable value fails at load, not at the first turn: a
misconfiguration that surfaces as a missing snapshot an hour later is
indistinguishable from a bug.

filesnap's scan limits are deliberately **not** exposed. A bound you have to
discover is not a bound, and `filesnap status` answers the question that
setting would have been reached for — which files in this project are not
protected, and why.

## What it will not do

- **Touch your version control.** Git is read as one source of file *names* and
  never written.
- **Delete a file it has never observed.** A restore removes a path only when
  the capture it is restoring to looked for that path and did not find it.
- **Snapshot what you excluded.** `.filesnapignore` is symmetric — an ignored
  path is never stored, never restored, and never deleted by a restore.
- **Lose the rest of a rewind to one bad file.** A file that cannot be written
  is named, the others still land, and the result says so.
- **Rewind an agent that is mid-turn.** Stop it first. A rewind would otherwise
  write over files the turn's own tools are still using.
- **Hide the conversation you rewound out of.** It is *marked*, not archived —
  its title gains a `↩` prefix, which `/redo` removes again. `archiveSession`
  exists on `ctx.workspaceRegistry`; unarchive does not, and the harness's own
  comments call it deferred work. Archiving one half of a reversible pair would
  leave `/redo` with both conversations hidden, which is worse than the
  confusion it set out to fix.

## What it records

Three log-only session events, merged into `SessionEventMap`. None is a
`SurfaceEventType`: a rewind changes which files are on disk and which
conversation you are standing in, and neither of those is a message the model
sees.

| | |
|---|---|
| `filesnap/point` | a snapshot exists for this turn, and the id it is addressed by |
| `filesnap/rewound` | this session was rewound; the conversation continues in `child` |
| `filesnap/redone` | a rewind was reversed here |

They also drive a `filesnap` **session projection**, which is how the browser
reads the point list without re-deriving it from a transcript it renders for
other reasons. The projection registers through `ctx.inject`, so an assembly
with no projection registry is unaffected.

They live in the log rather than in a side table because a fork deep-clones the
seed: a point recorded in the log travels into every child that inherits the
turn it belongs to, so a freshly forked session can offer rewind points before
it has run a turn of its own.

**The plugin declares these three types to the persistence reader at load, and
must.** That reader refuses a log holding a type it does not know unless the
event is marked `ignorable`, and both halves of that escape are closed to a
plugin outside the harness repository: `KNOWN_SESSION_EVENT_TYPES` is generated
from in-repo declarations — downstream events are outside it "by construction",
with a registration surface "deferred until such a consumer exists" — and
`Session.append` takes no options at all for a non-surface event, so the marker
cannot be set. Undeclared, every session this plugin captured in failed to open
with `SessionFormatUnsupportedError`.

The declaration deliberately does not unwind, because removing it would strand
those logs again. That is its cost, stated plainly: **uninstalling this plugin
leaves sessions it captured in unreadable.** The fix that removes the cost
belongs upstream — a registration surface, or an `append` that can mark an
event ignorable.

## For other plugins

The service is `ctx.filesnap`.

```ts
const points = await ctx.filesnap.points(agent)
if (points.ok) {
  const outcome = await ctx.filesnap.rewind(agent, String(points.value[0].turn))
}
```

`rewind` takes an optional destination. `{ kind: 'fork' }` (the default) forks
the conversation itself; `{ kind: 'into', session }` files the undo record in a
session you already forked — which is what a deployment with its own fork
should pass, so this plugin does not build a second one beside it.

Every operation returns `{ ok: true, value }` or `{ ok: false, refusal }`
rather than throwing. Every caller has to render the reason, and an exception
would make each of them re-derive it from a message string.

## Why every `@deepseek-ai` peer is optional

They are declared so the requirement is visible, and marked optional so nothing
tries to satisfy it. A dsh plugin must **not** carry its own copy of the harness
packages: it runs inside a composed harness and uses the one already there. A
second copy is not a duplicate dependency, it is a second Cordis — different
`Service` classes, a different registry, and a plugin whose `inject` never
resolves, silently.

The profile install path already prevents this (`autoInstallPeers: false` in
the profile's pnpm settings, plus the launcher's symlink fallback into the
installation's own modules). Marking them optional is what makes a bare
`npm install dsh-filesnap` behave the same way instead of trying to materialize
a set that does not resolve — the harness's release trains are not in lockstep,
so npm's peer auto-install lands on a genuine conflict.

## Development

The harness packages are `peerDependencies` — a deployment already has them,
and pinning a version here would fight whatever it runs. For a local
typecheck and test run, link a built sibling checkout:

```console
$ git clone https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
$ ( cd ../deepseek-harness && pnpm install && pnpm run build )
$ npm install
$ npm run harness:link
$ npm run typecheck && npm test
```

`harness:link` symlinks the harness's **built** packages into `node_modules`
without writing them into `package.json`, so `npm install` stays reproducible
for anyone who has no checkout. The build matters: `lib/types/*.d.ts` is what a
consumer resolves, and checking against `src` would typecheck the harness's own
sources under this project's compiler settings rather than checking this
plugin.

`harness:link` also has to be re-run after any `npm install`: npm prunes what
`package.json` does not name, and these links are deliberately not named there.

The suite has four tiers. `npm run test:standalone` needs neither the harness
nor the binary. The engine, service and wiring suites drive the real `filesnap`
command, which `npm install` already brought in — so they just run.
`FILESNAP_BIN` points them at a different build, and a sibling `filesnap`
checkout's cargo output is the last resort.

Two build faces:

```console
$ npm run build          # the host half — plain tsc, no harness needed
$ npm run build:client   # lib/client.js — needs the harness checkout
```

The browser artifact is the harness's own closure-factory format, produced by
its tsdown preset. That preset is a repository file rather than a published
entrypoint, and it resolves a package's externals by globbing the harness's
`packages/` tree — so `build:client` stages this manifest there for the length
of the build and removes it afterwards. Sources, config and output all stay
here. It is not the imposition it looks like: the web application is itself
built from the harness repository, so anyone assembling a web build that
includes this plugin already has a checkout.

## Known limitations

- **A `/rewind` typed into the web composer reports the new session rather than
  opening it.** The host command registry returns text, so that path names the
  fork and the user opens it. The header entry does not have this problem: it
  forks and navigates itself.
- **A self-performed fork inherits the parent's model route and preset, but not
  per-agent model *selection* or workspace attachment.** Those live in the
  deployment's own fork path (`sessions.fork`), which `--into` exists to defer
  to — so the headless fork is the one that carries this gap.
- **Uninstalling the plugin strands the sessions it captured in.** See "What it
  records" — the event-type declaration cannot unwind without re-breaking those
  logs, so removing the plugin re-introduces the refusal.
- **The browser half is typecheck-verified and built, not browser-tested.** The
  artifact is the shell's own format and the two faces compile against the
  harness's declarations, but no test drives the rendered menu.
- **A plugin that reads an undeclared service as a property is torn down in
  silence.** Cordis refuses the read, the throw leaves the service constructor,
  and the fiber is disposed with no log line — so the plugin is simply absent.
  This one resolves `commands`, `fs`, `agentPresets` and the logger through
  `ctx.get`, and `tests/wiring.spec.ts` exists to keep it that way: it asserts
  the service is still reachable after boot and that a dispatched turn reaches
  the engine. The service-tier tests cannot see that failure, because calling a
  method directly proves nothing about whether a turn ever arrives.
- **A turn whose capture failed offers no rewind point.** The failure is on
  stderr; the point is absent rather than listed and refused on use.
- **Coverage of shell-written files follows the scan.** A file a shell command
  creates outside the workspace, over the size limit, or beyond the recency
  budget is covered only if it also went through the filesystem seam.

## Roadmap

Ordered by what is most in the way, not by what is quickest. Everything here is
traceable to a gap named in this README or a marker in the source.

**`/rewind gc`, `/rewind doctor`, `/rewind delete <session>`.** The engine has
all three and the plugin exposes none, which is why `/rewind status` reports a
disk figure you cannot act on from inside dsh. Commands first, browser controls
after; the interim invocation is under
[Nothing is deleted for being old](#nothing-is-deleted-for-being-old).

**A diff between two points, and per-file restore.** The one thing the
checkpoint pair has that this does not. Every point is a content-addressed
manifest, so this is a query rather than a redesign.

**Browser controls beyond rewind.** The rewind control sits in each turn's
message row and the status strip in the session header. Everything else —
status detail, reclamation, deletion — is command-only, and the browser half is
typecheck-verified and built rather than browser-tested, so that surface grows
slowly on purpose.

**Declaring session event types without mutating a harness constant.** The one
thing this costs you today: three event types are declared by writing into a
constant another package exports, which is why uninstalling strands the sessions
it captured. The fix belongs upstream — a supported declaration point for an
out-of-repo plugin, or an `ignorable` marker the reader honours. Tracked in the
source as `FIXME(upstream-event-registration)`.

**Archiving a rewound conversation, once one can be unarchived.** A rewind marks
the conversation it leaves with `↩` instead of archiving it, because
`unarchiveSession` does not exist and an archive `/redo` cannot reverse is a
trap. Feature-detected the moment it lands. Tracked as
`XXX(archive-when-reversible)`.

## Where this came from

This plugin is the dsh half of an idea that was worked out first in
**[codex-rewind](https://github.com/extracurricular-ai/codex-rewind)** — an
unofficial distribution of [OpenAI's Codex CLI](https://github.com/openai/codex)
that adds `/rewind` and `/redo` to it, from the same people as this repository
and under the same licence.

The design here is that design. What gets tracked is the same union it arrived
at — the files git already tracks, the files the agent edits wherever they live,
and a bounded sweep of recent changes for whatever a shell command touched —
along with the decisions that shape it: `.git` is never read, hidden files are
left alone because tool state is not your work, and an ignored path is never
snapshotted, never restored and never deleted. What is new here is the harness
half: when to snapshot, what a rewind point means once a conversation can fork,
and how the two halves are sequenced.

**If this is useful to you and you also use Codex, that is where to go.** It
installs as `codexr`, beside the official build rather than over it:

```shell
npm install -g codex-rewind
```

There is also a [walkthrough](https://youtu.be/OpJI8NQ-mvY) that spends most of
its length on why git is the wrong foundation for this and where the approach
stops — the reasoning behind both projects, not a feature tour.

## Contributing

**Issues and pull requests are welcome, and neither has to be polished.** A bug
report that is one sentence and a stack trace is worth more than the thorough one
that never got written.

| | |
|---|---|
| [**Discussions**](https://github.com/extracurricular-ai/dsh-filesnap/discussions) | questions, ideas, "is this supposed to work like this", showing what you built |
| [**Issues**](https://github.com/extracurricular-ai/dsh-filesnap/issues) | something is broken, or something specific should change |
| [**Pull requests**](https://github.com/extracurricular-ai/dsh-filesnap/pulls) | you already fixed it |

Picking the wrong one costs nothing — we will move it. Write in English or
Chinese, whichever is easier: 中文提 issue 完全没问题。

[CONTRIBUTING.md](CONTRIBUTING.md) has the setup, the four test tiers, and the
one thing worth knowing before you start — which of the two repositories your
change belongs in. [Security issues go privately](SECURITY.md), never as a public
issue. Everyone taking part is covered by the [Code of Conduct](CODE_OF_CONDUCT.md).

## Licence

Apache-2.0. See [LICENSE](LICENSE). The engine it drives,
[filesnap](https://github.com/extracurricular-ai/filesnap), is under the same
licence.
