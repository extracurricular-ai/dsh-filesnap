# dsh-filesnap architecture

[README](../README.md) · [中文](architecture.zh.md)

dsh-filesnap is the host-specific half of a rewind system. The
[filesnap](https://github.com/extracurricular-ai/filesnap) engine captures and
restores files; this plugin decides when to capture, what a point means in a
forkable conversation, and how the transcript and filesystem operations are
sequenced.

## The two layers

| Layer | Owns | Does not own |
|---|---|---|
| `filesnap` engine | bounded scan, content-addressed blobs, manifests, restore, undo records, garbage collection | conversations, dsh sessions, browser navigation |
| `dsh-filesnap` plugin | turn lifecycle, pre-edit observations, session events, fork/restore order, commands, browser projection | the store format and file-moving implementation |

The engine is a static Rust binary with versioned JSON Lines on stdout, human
diagnostics on stderr and meaningful exit codes. The plugin's complete process
adapter is [`src/cli.ts`](../src/cli.ts); it contains no rewind policy.

## Capture lifecycle

Three host attachments cover different mutation paths:

1. `agent/pre-step` waits for the deployment's decision. If the step enters,
   the workspace is captured before the model request and before any tool runs.
2. `fs/write-intent` records the target's pre-image immediately before a write.
3. `fs/edit-intent` does the same immediately before an edit.

The filesystem listeners use `{ prepend: true }`. Those hooks are single-slot
decision waterfalls, and a deployment policy may take the slot without calling
the next listener. dsh-filesnap observes the target and delegates unchanged, so
the deployment still owns the decision while the pre-image is read before it
disappears.

Coverage follows the `ctx.fs` seam rather than a list of tool names. A new tool
is covered as soon as it writes through that seam. Shell writes do not pass
through it, so they rely on the bounded scan at the next turn boundary.

## The tracked set

Each capture uses a bounded union rather than a full recursive copy:

- file names already known to the workspace, including Git-tracked files;
- paths declared by observed writes and edits, wherever those paths are;
- a bounded recent-change scan for shell writes and other mutations outside the
  filesystem seam.

Unchanged bytes are stored once and referenced by multiple manifests. An
ignored path is excluded symmetrically: no capture, no restore and no deletion.

## Rewind sequence

The order is fixed:

```text
1. select an explicit rewind point
2. fork the conversation at that point
3. capture a rescue point before changing files
4. restore the target manifest into the fork
5. record the rewind and its undo information in that fork
6. open the fork (browser) or return its id (headless command)
```

The fork must exist before restore. The engine files its undo record under the
session named by `--undo-for`; that session must be the one in which the user
lands, otherwise `/redo` would exist somewhere inaccessible.

The browser already has a deployment-aware fork path that composes the child's
preset and workspace attachment. It therefore creates the child and calls
`/rewind <point> --into <child>`. Headless use asks the host plugin to create
the fork itself.

## Restore safety invariants

- A restore captures a rescue point before its first write.
- A path is deleted only when the target manifest contains a positive tombstone
  saying the path was absent.
- Capture errors do not become tombstones. An unreadable path is skipped rather
  than later interpreted as permission to delete it.
- Per-file restore failures are reported individually; the remaining files are
  still attempted.
- Rewind is refused while the agent is in an active turn.
- A capture that failed does not create a selectable rewind point.

## Session events and projection

The plugin records three log-only events:

| Event | Meaning |
|---|---|
| `filesnap/point` | a snapshot exists before this turn |
| `filesnap/rewound` | this session was rewound and continues in a child |
| `filesnap/redone` | the rewind that landed here was reversed |

Keeping these records in the session log matters because a fork deep-copies its
seed. A child therefore inherits the points belonging to the turns it keeps,
even before it runs a new turn of its own.

The browser does not parse the transcript. A `filesnap` session projection folds
committed events into a client-safe value containing points and the most recent
rewind record. The projection is optional, so a headless assembly without a
projection registry still captures and exposes commands.

## Browser/host boundary

The host and browser code use different Cordis `Context` declarations. Values
cross the boundary through plain types in [`src/wire.ts`](../src/wire.ts),
preventing host-only context merges from changing the browser API's types.

The same profile row mounts the host and makes the `./client` export available.
The web shell serves the built `lib/client.js`; no static module table is
modified.

## Service API

Other plugins can use `ctx.filesnap`:

```ts
const points = await ctx.filesnap.points(agent)
if (points.ok) {
  const outcome = await ctx.filesnap.rewind(
    agent,
    String(points.value[0].turn),
  )
}
```

`rewind` accepts `{ kind: 'fork' }` or `{ kind: 'into', session }`. Operations
return `{ ok: true, value }` or `{ ok: false, refusal }`; callers receive a
structured reason instead of having to parse an exception message.

## Why the harness peers are optional

The `@deepseek-ai/*` packages are peer dependencies because the plugin runs
inside an already-composed harness. Bundling another Cordis or session package
would create incompatible service classes and registries.

They are marked optional so a plain `npm install dsh-filesnap` does not try to
materialize a second, potentially conflicting harness release line. The dsh
profile installer already supplies the packages from the active deployment.

## The upstream event-registration gap

dsh's persistence reader rejects unknown non-surface event types. Today, an
out-of-repository plugin cannot register a type through a supported runtime API,
and `Session.append` cannot mark such an event `ignorable`.

dsh-filesnap therefore adds its three event types to the reader's known set at
load. Removing the plugin removes that declaration on the next process start,
so sessions containing those events fail to open until the plugin is installed
again. The log and snapshot data are not deleted.

The durable fix belongs upstream: either a supported runtime registration point
or an `ignorable` option honored by the persistence reader. The source tracks
this as `FIXME(upstream-event-registration)`.

## Storage lifecycle

The store lives in the platform data directory by default, never inside the
project. Content remains reachable while a point references it; nothing is
deleted merely for being old.

The engine already provides `delete`, `gc` and `doctor`, but the plugin does not
yet expose them as `/rewind` subcommands. Until it does, use the binary installed
inside the profile:

```shell
~/.dsh/profiles/<profile>/node_modules/.bin/filesnap gc
~/.dsh/profiles/<profile>/node_modules/.bin/filesnap doctor --workdir .
~/.dsh/profiles/<profile>/node_modules/.bin/filesnap delete --session <id>
```

Run `/rewind status` first to inspect the workspace records, shared blob usage
and unprotected paths.
