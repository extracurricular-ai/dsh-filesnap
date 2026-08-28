# Comparing dsh rewind plugins

[README](../README.md) · [中文](comparison.zh.md)

> [!NOTE]
> This audit was checked against published package artifacts on **2026-08-27**.
> Package behavior changes. Verify the current release before relying on a row,
> and open an issue when a claim is stale or incomplete.

This document separates product discovery from a technical comparison that
necessarily carries versions, caveats and evidence. The question is not merely
whether a plugin has a command named “rewind,” but which state it can restore
and what happens to the work around that restore.

## Capability matrix

| | engine | files | conversation | undo | shell writes | binary files | Git-ignored | outside project | original intact |
|---|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|:--:|
| **dsh-filesnap** | **🦀 Rust** | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | **✅** | ✅ |
| [dsh-rewind](https://www.npmjs.com/package/dsh-rewind) 0.11.12 | JS | ✅ | ✅ | ⚠️ latest only | ✅ | ✅ | ❌ | ❌ | ❌ masked |
| [dsh-checkpoint-rewind](https://www.npmjs.com/package/dsh-checkpoint-rewind) 0.6.1 | JS | ✅ | ✅ | ⚠️ guard point | ✅ | ✅ | ⚠️ | ❌ | ✅ |
| [dsh-rewind-plugin](https://www.npmjs.com/package/dsh-rewind-plugin) 0.4.2 | JS | ✅ | ✅ | ❌ | ❌ | ☠️ | ✅ | ⚠️ | ❌ masked |
| [@anionex/dsh-turn-rewind](https://www.npmjs.com/package/@anionex/dsh-turn-rewind) 0.1.2 | JS | ✅ | ⚠️ optional | ⚠️ via API | ✅ | ✅ | ❌ | ❌ | ✅ |
| [dsh-recall-plugin](https://www.npmjs.com/package/dsh-recall-plugin) 2.0.0 | JS | ✅ | ✅ | ❌ | ✅ | ✅ | ⚠️ | ❌ | ⚠️ archived |
| [@zoytown/dsh-rewind](https://www.npmjs.com/package/@zoytown/dsh-rewind) 0.1.0 | JS | ✅ | ❌ | ✅ files only | ✅ | ✅ | ❌ | ❌ | ✅ |
| [@flow2dream/dsh-msg-rewind](https://www.npmjs.com/package/@flow2dream/dsh-msg-rewind) 0.1.6 | JS | ❌ | ✅ | ❌ | ❌ | — | ❌ | ❌ | ❌ truncated |

Legend: ✅ fully supported; ⚠️ conditional or partial; ❌ unsupported;
☠️ observed data-loss risk in the audited version; — not applicable.

## Storage and repository risk

| | no Git needed | repository untouched | survives `git gc` | retention bound | capture cost grows with |
|---|:--:|:--:|:--:|---|---|
| **dsh-filesnap** | ✅ | ✅ | ✅ — nothing is stored in Git | reachability | a bounded union per turn |
| dsh-rewind 0.11.12 | ❌ creates one | ☠️ `git init`, `reset --hard` | ☠️ unreferenced stash objects | repository GC | worktree size |
| dsh-checkpoint-rewind 0.6.1 | ⚠️ copy fallback | ☠️ writes `.git/objects` | ☠️ unreferenced objects | 50 points + 512 MiB/session | worktree size |
| dsh-rewind-plugin 0.4.2 | ✅ | ✅ | ✅ | 100 anchor groups/session | session length |
| @anionex/dsh-turn-rewind 0.1.2 | ❌ Git worktree only | ✅ | ✅ | 50 points + 30 automatic/session | worktree size |
| dsh-recall-plugin 2.0.0 | ❌ Git CLI | ✅ shadow repo | ✅ | no automatic pruning found | worktree size |
| @zoytown/dsh-rewind 0.1.0 | ❌ Git CLI | ✅ shadow repo | ✅ | 30 days, 50 sessions/workspace | worktree size |
| @flow2dream/dsh-msg-rewind 0.1.6 | ✅ | ✅ | — | — | — |

“Capture cost grows with” is operationally important. Full worktree designs
scale with the project tree. Whole-file backup designs can scale with session
length. dsh-filesnap scans a bounded union and content-addresses unchanged bytes.

## Three high-risk findings in the audited versions

### Unreferenced Git objects

`dsh-rewind` and `dsh-checkpoint-rewind` stored their only snapshot in Git
objects without a durable reference. `git stash create` does not create a stash
reflog entry, and no `update-ref` call was found in dsh-checkpoint-rewind 0.6.1.
Unreferenced objects are eligible for Git garbage collection, immediately under
`git gc --prune=now`.

### Binary data decoded as UTF-8

dsh-rewind-plugin 0.4.2 read pre-images with `readFile(path, "utf8")` and wrote
them with `writeFile(path, content, "utf8")` (`lib/index.js:207` and `:607` in
the published package). No Buffer/base64 path or binary detection was present.
Bytes that are not valid UTF-8 therefore cannot round-trip unchanged.

### Whole-worktree destructive restore

dsh-rewind used `git reset --hard`. Its own limitations described that restore
as affecting the complete worktree, including changes made outside dsh tools.
That means unrelated uncommitted work and the current branch pointer may change.

These findings argue for keeping an agent snapshot store independent from the
user's version-control state. They are not claims about versions published after
the audit date.

## Differences that follow from the design

### Edits outside the project

A Git worktree cannot represent a file under `~/.config`, in a sibling checkout
or elsewhere outside its root. dsh-filesnap observes pre-images through the
filesystem seam and can declare an absolute path wherever the agent writes.

Shell writes outside the workspace are a limit: they are covered only if the
same path is also observed through the filesystem seam.

### Newly created files

A snapshot that excludes untracked files cannot necessarily remove a file the
agent created after the selected point. dsh-filesnap records positive absence
tombstones for paths it checked, which authorize restore-time deletion without
interpreting every missing snapshot entry as “delete this file.”

### Reversing the rewind

An in-place conversation mask leaves no original conversation to return to.
dsh-filesnap forks first and captures a rescue point before restoring files, so
`/redo` has both the original transcript and the pre-restore workspace state.

### Interrupted restore

The most dangerous failure is a restore that stops halfway. dsh-filesnap creates
its rescue point before the first write, reports file-level failures and deletes
only against verified tombstones. See [Architecture](architecture.md) for the
full invariants.

## Size and performance snapshot

| Design | Snapshot engine | Additional install | Published 70,918-file measurement |
|---|---|---|---|
| **dsh-filesnap** | compiled **🦀 Rust** process | about 0.23 MB plugin + 4 MB engine | **268 ms** repeat capture on the original machine |
| five Git-based packages | JavaScript spawning Git | package plus a Git installation | none found in the audited READMEs |
| two non-Git JavaScript packages | JavaScript in the session process | package dependencies | none found in the audited READMEs |

The dsh-filesnap value is a preliminary warm-cache result, not a cross-machine
benchmark. Method and reproduction notes are in [Benchmarks](benchmarks.md).

## What dsh-filesnap does not have yet

- a diff view between two points;
- per-file restore;
- `/rewind gc`, `/rewind doctor` and `/rewind delete` wrappers;
- automated in-browser coverage for its client controls;
- an upstream-supported event-type registration path.

The first two were present in the checkpoint-oriented alternatives during the
audit. A useful comparison should name those advantages as well as the risks.

## Audit method

The comparison used the published npm artifacts, not only repository main
branches or marketing copy:

1. record the exact package version;
2. inspect its shipped README and compiled JavaScript;
3. identify capture, retention and restore code paths;
4. distinguish missing features from data-integrity risks;
5. date every conclusion.

To request a correction, open an
[issue](https://github.com/extracurricular-ai/dsh-filesnap/issues) with the new
package version and the relevant shipped code path.
