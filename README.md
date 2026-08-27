# dsh-filesnap

Rewind and redo for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness).

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

The snapshot engine is [filesnap](https://github.com/extracurricular-ai/filesnap),
a content-addressed store that puts a directory back the way it was at an
earlier moment. This package is the harness half: it decides *when* to
snapshot, what a rewind point means in a conversation, and how the two halves
of a rewind are sequenced.

## What it does

**Captures once per turn.** On `agent/pre-step`, before the model request and
before any tool runs, the workspace is snapshotted and the point is recorded in
the session log. The capture is awaited, so a snapshot is never half-taken when
the first edit lands.

**Records pre-images before edits.** `fs/write-intent` and `fs/edit-intent` are
decision waterfalls that run immediately ahead of the provider's mutation —
the last moment a file's previous contents still exist. The plugin names the
path and filesnap reads it, so the stored pre-image rests on an observation
rather than on a claim.

These attachments are tool-agnostic. Coverage follows `ctx.fs`, not a list of
tool names, so a tool this plugin has never heard of is protected the moment it
writes through the seam.

**Rewinds both halves, in the one order that works.** A rewind forks the
conversation first, then restores the files *into* that fork, because filesnap
files an undo record in the session named by `--undo-for` and that has to be
the session the user ends up standing in. Get the order wrong and `/redo`
exists somewhere the user cannot reach.

## Commands

| | |
|---|---|
| `/rewind` | list the points this session can return to |
| `/rewind <turn>` | fork the conversation there and put the files back with it |
| `/redo` | reverse the rewind that landed in this session |

`/rewind` takes a turn number as listed, or a point id verbatim. There is no
"go back three" — the engine refuses relative addressing on purpose, because a
restore overwrites your files and an off-by-one in a relative index is easy to
make and easy to miss. Counting against a list you are looking at is not the
same as counting against an index you assumed.

Both dispatch without a model turn. Rewinding is something you do *to* the
conversation, so it does not go through the thing being rewound.

## Install

The plugin spawns the `filesnap` binary, so install that first:

```console
$ cargo install filesnap-cli    # or: npm i -g filesnap
$ filesnap --version
```

Then add the plugin to a profile:

```console
$ dsh plugin --profile web add dsh-filesnap
```

and mount it in that profile's `cordis.patch.yml`:

```yaml
- insert:
    id: filesnap
    name: dsh-filesnap
    config: {}
```

`dsh --profile web --dump-config` prints the tree that actually boots, so you
can check the row landed.

## Configuration

Every field has a default that is right on an ordinary machine; most
deployments set none of them.

| field | default | |
|---|---|---|
| `command` | `filesnap` | the binary. A bare name resolves through the subprocess provider's own `PATH`, so it follows the execution world the filesystem provider is mounted in. |
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

They live in the log rather than in a side table because a fork deep-clones the
seed: a point recorded in the log travels into every child that inherits the
turn it belongs to, so a freshly forked session can offer rewind points before
it has run a turn of its own.

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

The suite has three tiers. `npm run test:standalone` needs neither the harness
nor the binary. The engine and service suites drive the real `filesnap`
command and self-skip when none is built — set `FILESNAP_BIN`, or leave a
`../filesnap` checkout with `cargo build --release -p filesnap-cli` run in it.

## Known limitations

- **A `/rewind` from the web composer reports the new session rather than
  opening it.** The host command registry returns text, so the plugin names the
  fork and the user opens it. Passing `{ kind: 'into', session }` from a client
  that has already forked is the path that avoids this.
- **A self-performed fork inherits the parent's model route and preset, but not
  per-agent model *selection* or workspace attachment.** Those live in the
  deployment's own fork path (`sessions.fork`), which `{ kind: 'into' }`
  exists to defer to.
- **A turn whose capture failed offers no rewind point.** The failure is on
  stderr; the point is absent rather than listed and refused on use.
- **Coverage of shell-written files follows the scan.** A file a shell command
  creates outside the workspace, over the size limit, or beyond the recency
  budget is covered only if it also went through the filesystem seam.

## Licence

Apache-2.0. See [LICENSE](LICENSE). The engine it drives,
[filesnap](https://github.com/extracurricular-ai/filesnap), is under the same
licence.
