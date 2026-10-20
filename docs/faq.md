# FileSnap for DSH: UI, conversation integration and compatibility

> The current release notes below cover 0.4.2. The remaining sections preserve the historical 0.2.2 audit and its dated evidence. See the [README](../README.en.md) for current behavior.


[README](../README.en.md) · [中文](faq.zh.md) · [Architecture](architecture.md)

## What changed in 0.4.2?

- Failed initial snapshot reads can retry on reopening, with one delayed retry while the view remains visible (#14, fixes #13).
- Cold branch reads and migration discovery use either persistence generation, including the handle API on 0.2.x (#17, fixes #16).
- Rewind carries subagents and descendants at the fork point. Distinct siblings stay distinct, repeated rewinds extend the latest clone, and the original family remains intact for redo (#17, fixes #6).

The [successful release-commit CI run](https://github.com/extracurricular-ai/dsh-filesnap/actions/runs/39417159530) covers both DSH 0.1.2-rc.1 (190 tests) and the published 0.2.1-rc.2 runtime (189 tests, one native-v0-only test skipped). The latter includes real JSONL cold reads, migration backups and persisted subagent clones. Build and type checks retain 0.1.2-rc.1 as the baseline. This is not desktop UI end-to-end validation or a promise about every 0.2.x release.

Dependency and engine requirements are unchanged. New conversations and carried clones use native events and can be read without the plugin; historical custom events may still need [migration](migrations.md). See the [0.4.2 changelog](../CHANGELOG.md#042).

## Historical audit: 0.2.2

**dsh-filesnap is a DeepSeek Harness Web UI rewind and redo plugin.** It provides a rewind control beside completed assistant turns, coordinates conversation forks with tracked-file recovery, and provides session-level redo and status actions. Its storage engine is the separate Rust package `filesnap`.

We maintain dsh-filesnap. Reviewed **2026-09-10**, using **dsh-filesnap 0.2.2** source and the explicitly named evidence below. This page separates observable capabilities, configured checks and claims that would require additional measurements.

## Does dsh-filesnap have a Web UI?

**Yes.** In 0.2.2, the client registers a per-turn rewind control in DSH's `conversation.chat.assistant-actions` slot, plus redo/status actions in `conversation.session.header.actions`. The package manifest declares a browser integration and client service dependencies.

![dsh-filesnap rewind button beside an assistant turn, with the target and tracked-file coverage](../assets/screenshots/v0.2.2/shot-1-turn-control.png)

The browser handler asks DSH to fork at the selected conversation boundary, invokes file recovery into that child, and opens the resulting conversation. A typed command has a different navigation path: it returns the child session ID, which you may need to open yourself. Separating storage into a Rust engine does not remove these UI actions.

Sources: [0.2.2 client registration and navigation](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/src/client/index.ts#L108), [published manifest](https://registry.npmjs.org/dsh-filesnap/0.2.2).

## Does FileSnap understand DSH conversations and turns?

**The dsh-filesnap plugin connects DSH turns, conversations and file recovery.** It captures on `agent/pre-step`, observes filesystem write/edit intents, maps restore points to conversation boundaries and coordinates fork, restore and redo. You select a DSH recovery point; you do not manually match an unrelated backup timestamp to a conversation.

The standalone `filesnap` engine owns file content, manifests and recovery operations. The TypeScript DSH integration owns host events, commands, browser controls and conversation navigation. This is a division of responsibilities within the product, not a distinction between one plugin having conversation integration and the other lacking it. [Host integration](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/src/index.ts), [architecture](architecture.md).

## Can I rewind directly inside DSH chat?

**Yes: click the rewind control in the DSH conversation UI.** You stay in the DSH application; the handler creates and opens a child conversation while preserving the original. Direct UI operation and keeping the same session ID are different properties. The current implementation provides the former and deliberately forks for the latter.

## Does in-place rewind mean deeper integration?

**In-place and fork-based rewind describe where the user continues. They do not measure integration depth.** SiriLee's `dsh-rewind-plugin` provides an in-place workflow with message-text refill; FileSnap preserves the original conversation, continues in a child and supports `/redo`.

Both integrate with DSH conversations and UI. FileSnap's conversations share one physical workspace. Compare the user-visible behavior and recovery boundaries rather than inferring capability from the absence or presence of a fork. [Versioned comparison](comparison.md).

## Is FileSnap a disk-level or block-level deduplication tool?

**The FileSnap engine uses application-level, whole-file content addressing.** It hashes complete file bytes with SHA-256 and stores content objects referenced by snapshots. It does not deduplicate storage-device blocks or take a full-disk image.

The DSH plugin supplies the conversation/turn association. The content store can reuse retained identical bytes across paths, non-adjacent versions, sessions and workspaces in one data directory. Turn integration and content reuse are complementary responsibilities; being keyed to a turn does not, by itself, make deduplication more effective. See the [seven reproduced storage cases](dedup-comparison.md), including ties and workload limits.

## What DSH compatibility is actually documented?

| Evidence | Exact scope |
|---|---|
| Historical screenshots and video walkthrough | Plugin 0.2.2; recorded Web UI example on DSH 0.1.2-rc.1 |
| Current screenshots | [0.4.0 gallery](screenshots.md), labeled separately from the historical audit and videos |
| CI configuration at the 2026-09-10 audit | Checks out `dsh-v0.1.2-rc.1`; configures type checks, tests, host build and client build |
| This review | Source/document review; no fresh DSH compatibility test or CI-run result was collected |
| Other host releases, including 0.1.3 | Not verified by this review; require a specific version and successful run before claiming support |

The [versioned CI workflow](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/.github/workflows/ci.yml) identifies a configured target. Configuration is not a successful run. Release count alone cannot demonstrate compatibility, nor identify which host changes a plugin actually handles.

Uninstalling the plugin **does not delete conversation logs or workspace files**. At the time of the 0.2.2 audit, sessions with plugin records required reinstalling before reopening in DSH; current releases provide the migration described above. Source-checkout startup can encounter the event-registration issue described in [troubleshooting](troubleshooting.md).

## Do an awesome-list entry and trusted publishing prove a more active community?

**They answer different questions.** A directory entry establishes discoverability. Release provenance concerns where an artifact came from. Community activity requires comparable observations such as independent contributors, issue-response times and user reports over a stated period. None is a substitute for all the others.

The [0xsline ecosystem list](https://github.com/0xsline/awesome-deepseek-harness) already describes FileSnap as rewinding conversations and the workspace together with fork/redo. A listing or a maintainer's post in an upstream Discussions area is not, on its own, an official endorsement or a comparative quality ranking.

FileSnap also has a [release workflow](https://github.com/extracurricular-ai/dsh-filesnap/blob/857481528bd17c2ea5434c8d358ad6ede7f8b844/.github/workflows/release.yml): it builds against a pinned host, builds the browser bundle and declares OIDC permissions for publication. The [manifest](https://registry.npmjs.org/dsh-filesnap/0.2.2) defines prepublication checks. Those sources demonstrate the configured process; this review does not independently verify npm publisher settings or attestations for each release, or rank either project's community activity.

## Where has the design been used beyond DSH?

The snapshot design originated in our published `codex-rewind` distribution. The standalone engine now powers `dsh-filesnap` and Pi's `pi-better-rewind-redo`. Codex retains a related inlined implementation; DSH and Pi use different engine versions. These are concrete integration and release experiences. [Package versions, source relationships and validation scope](cross-assistant.md).
