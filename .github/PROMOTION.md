# dsh-filesnap promotion kit

[中文](PROMOTION.zh.md)

This is a maintainer-facing source of truth for repository metadata, demos and
launch copy. Keep public claims aligned with the current README and dated audit.

## GitHub repository metadata

**About description**

> Rewind a DeepSeek Harness conversation and its workspace together — without touching Git. Every rewind happens in a fork, so /redo can take you back if you change your mind. Powered by a blazing-fast Rust 🦀 engine.

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

Upload [`assets/social-preview.png`](../assets/social-preview.png) in repository
Settings → Social preview. The source asset is 1280×640 and below 1 MB. It stays
in the repository but is intentionally excluded from the npm tarball.

## Message hierarchy

Use these ideas in order:

1. **Outcome:** rewind the conversation and its files together.
2. **Safety:** the user's Git state is untouched; every rewind is undoable.
3. **Proof:** binary/ignored/outside-project coverage, status inspection and
   measured native-engine latency.
4. **Implementation:** Rust and content addressing explain the proof; they are
   not the headline.
5. **Limitation:** uninstalling temporarily strands sessions until reinstall.

Lead with a concrete user moment. Do not lead with competitor failures.

## 20-second feature demo

Record at 1280×720 or higher with a disposable workspace and no private session
content.

| Time | Shot | On-screen point |
|---:|---|---|
| 0–3 s | Show a three-turn conversation and a small workspace | “The agent took a wrong turn.” |
| 3–7 s | Open the files changed by the latest turn | Conversation and disk have diverged from the desired point. |
| 7–11 s | Click the rewind action for turn 2 | One action targets an explicit turn. |
| 11–15 s | Show the child conversation and restored files | Conversation + files move together. |
| 15–20 s | Trigger `/redo` and return | The rewind itself is reversible. |

Export an MP4 for social posts and a short, optimized GIF/WebP for the README.
Keep terminal text large enough to read on mobile. The visual proof should not
depend on narration.

## Short launch post

> Your coding agent took a wrong turn three edits ago. dsh-filesnap rewinds the
> DeepSeek Harness conversation and workspace together—without touching commits,
> stash or worktree state. Every rewind happens in a fork, so `/redo` can undo it.
> Native Rust engine; Git not required.

Link to the repository, then attach the feature demo instead of a static card
when the platform supports video.

## Longer launch post

> A coding-agent rewind has two halves: the conversation and the files it
> changed. Restoring only one leaves you in a state that never existed.
>
> dsh-filesnap captures the workspace before each DeepSeek Harness turn, forks
> the conversation at an explicit point, restores the files into that fork and
> records a rescue point first. `/redo` reverses the rewind. It works without a
> Git repository and does not modify commits, branches, stash or worktree state.
>
> The snapshot engine is filesnap, a content-addressed Rust binary. Preliminary
> warm-cache repeats measured 8 ms on the plugin repository and 268 ms while
> capturing 7,995 relevant files from a 70,918-file harness checkout. Method and
> caveats are published in the repository.
>
> Important current limitation: uninstalling the plugin makes sessions that
> contain its events unreadable until it is reinstalled; their data remains on
> disk.

## Release-note template

```md
## What changed

<One sentence describing the user-visible outcome.>

## Why it matters

- <Problem removed or workflow shortened>
- <Safety/performance effect, with evidence when relevant>

## Upgrade

<No action required, or exact steps.>

## Known limits

<Only limits affected by this release; link to the full list.>

## Verification

- tests: <count/result>
- supported profiles/platforms exercised: <list>
```

Attach one screenshot or short clip that demonstrates the release's main change.

## Claim discipline

- Date competitor comparisons and name exact package versions.
- Link performance claims to machine metadata and reproduction steps.
- Distinguish “supported by design/tests” from “observed on this deployment.”
- Keep the uninstall limitation adjacent to installation.
- Do not say “zero config” while a profile row is still required.
- Update the comparison audit before repeating “only” or “fastest” claims.
