# Quick start

This guide covers **dsh-filesnap 0.4.2**: preview file changes before rewinding, inspect usage and clean up in independent panels, and migrate older conversations from Settings.

Version 0.4.2 retries failed initial points reads, carries subagents and descendants into rewind branches at the fork point, and supports persistence 0.2.x cold branch reads and migration. See the [release notes](../../CHANGELOG.md).

The screenshots below show the Chinese UI in 0.4.0. [Browse the full gallery and historical versions](../../docs/screenshots.md).

## Install

```console
dsh plugin --profile web add dsh-filesnap
```

Restart the Web UI profile. The bundle and FileSnap engine install with the package; no manual loader row is needed. When upgrading from 0.2.1 or earlier, remove the old handwritten `id: filesnap` row. Runtime tests cover DSH 0.1.2-rc.1 and 0.2.1-rc.2; desktop UI end-to-end validation is not included.

## Preview and rewind

Complete at least two turns that modify files. Click rewind in an assistant action row and review files to write, restore or delete. Confirmation restores files and opens a new conversation branch, keeping the full original conversation. Cancel or Escape creates no branch.

![Review files to restore and delete before rewinding（0.4.0 · Chinese UI）](../../assets/screenshots/v0.4.0/03-rewind-preview.png)

The original prompt is offered back in an empty composer without replacing drafts or images. To reverse a mistaken rewind, use the redo button in the new branch or type `/redo`, review the affected files and confirm. The current branch is marked 🟢 Active and the branch left behind 🔴 Inactive. Branches share the workspace; switching conversations alone does not switch files.

![Confirm the files affected by redo（0.4.0 · Chinese UI）](../../assets/screenshots/v0.4.0/05-redo-preview.png)

After a successful redo with no remaining undo records, the old branch is automatically archived and the original conversation opens. Conversation content and snapshots are preserved. An absent undo record shows a normal status message; failed file restores or remaining undo records prevent automatic archiving.

## Disk usage and cleanup

Click the snapshot status icon in the session header. The independent panel separates workspace records from shared file content and lists snapshot counts per session. Cleanup explains its scope and requires confirmation. It collects unreferenced data while retaining snapshots and redo recovery data.

![Disk usage and cleanup in the independent workspace snapshot panel（0.4.0 · Chinese UI）](../../assets/screenshots/v0.4.0/06-workspace-snapshots.png)

Buttons do not write results into the conversation. Manually typing `/rewind status` still uses DSH's standard command-result presentation.

## Interrupted restores

Open **Settings → FileSnap → Interrupted restores** to preview and continue or roll back unfinished new rewinds and redo. Conflicting later edits block overwriting. Recovery state stays outside conversation history. [Workflow and limits](../../docs/recovery.md).

![Preview and confirm files in an interrupted restore（0.4.0 · Chinese UI）](../../assets/screenshots/v0.4.0/09-interrupted-restore.png)

## Migrate older data

Open **DSH Settings → FileSnap → Data migrations**. Startup migrations run automatically for unloaded old conversations, including legacy title markers. This page shows the results and lets you scan and retry any versioned task. Loaded sessions and compatible data are skipped; changed files receive original backups. [Versioned migration guide](../../docs/migrations.md).

![Select a versioned migration task and review eligible sessions（0.4.0 · Chinese UI）](../../assets/screenshots/v0.4.0/08-migrations.png)

*Automatic migration is deliberately disabled in this demo to show manual scan results; it is enabled by default in a normal installation.*

## Watch the full walkthrough

This video shows an older release. Its command-result cards have been replaced by independent panels for buttons in 0.3.1.

<!-- VIDEO -->

[English video](https://youtu.be/WPEXKesR_EM) · [中文视频](https://www.bilibili.com/video/BV1BiYT6qEjs/)

[Recovery boundaries](../../docs/architecture.md) · [Troubleshooting](../../docs/troubleshooting.md) · [Plans](../../docs/roadmap.md)
