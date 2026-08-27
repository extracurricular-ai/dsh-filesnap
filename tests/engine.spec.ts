/**
 * The adapter against the real engine.
 *
 * Everything else in this suite is a unit test over parsed text. This one
 * spawns the actual `filesnap` command, so it is the only place that proves the
 * argv this plugin builds is the argv the engine accepts — a renamed flag or a
 * reordered argument is invisible to a test that parses a fixture.
 *
 * It self-skips when the binary is absent, the way the repository's real-API
 * tests self-skip without a key: a contributor without a Rust toolchain should
 * still be able to run the suite.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { FilesnapCli } from '../src/cli.ts'
import { createFilesnapCli, eventsOfType, lastEvent, numberField, stringField } from '../src/cli.ts'
import { BINARY, nodeSubprocess, scratch } from './support.ts'

describe.skipIf(BINARY === undefined)('filesnap, end to end', () => {
  let ws: ReturnType<typeof scratch>
  let store: ReturnType<typeof scratch>
  let cli: FilesnapCli
  let workspace: string

  beforeEach(() => {
    ws = scratch('filesnap-ws')
    store = scratch('filesnap-store')
    workspace = ws.path
    cli = createFilesnapCli({ subprocess: nodeSubprocess() } as unknown as Context, {
      /* v8 ignore next -- the suite is skipped when the binary is absent */
      executable: BINARY ?? '',
      dataDir: store.path,
      timeoutMs: 60_000,
      graceMs: 2_000,
      maxOutputBytes: 1 << 20,
    })
  })

  afterEach(() => {
    ws.remove()
    store.remove()
  })

  /** Run one command in the temp workspace. */
  const run = (...argv: string[]) => cli.run(argv, workspace)

  it('speaks the argv this plugin builds', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'original\n')
    const capture = await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)
    expect(capture.exit).toBe('ok')
    expect(capture.refused).toBe(0)
    expect(stringField(lastEvent(capture, 'capture.done'), 'manifest', '')).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('puts a changed file back, and hands out the point that reverses it', async () => {
    const file = join(workspace, 'a.txt')
    writeFileSync(file, 'original\n')
    await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)

    writeFileSync(file, 'something regrettable\n')

    const restore = await run(
      'restore', '--session', 'session-1', '--turn', 'session-1.t1',
      '--undo-for', 'session-2', '--cwd', workspace,
    )
    expect(restore.exit).toBe('ok')
    expect(readFileSync(file, 'utf8')).toBe('original\n')

    const done = lastEvent(restore, 'restore.done')
    expect(numberField(done, 'written', -1)).toBe(1)
    expect(numberField(done, 'failed', -1)).toBe(0)
    // Every restore captures one before it writes anything, and that id is what
    // makes the rewind itself reversible.
    expect(stringField(done, 'safety', '')).toMatch(/^[0-9a-f]{64}$/u)
  })

  it('files the undo record under the session the rewind handed the workspace to', async () => {
    const file = join(workspace, 'a.txt')
    writeFileSync(file, 'original\n')
    await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)
    writeFileSync(file, 'later work\n')
    await run(
      'restore', '--session', 'session-1', '--turn', 'session-1.t1',
      '--undo-for', 'session-2', '--cwd', workspace,
    )
    expect(readFileSync(file, 'utf8')).toBe('original\n')

    // The performing session holds no undo: the record went where the user is.
    const wrongSession = await run('undo', '--session', 'session-1', '--cwd', workspace)
    expect(wrongSession.exit).toBe('usage')

    const redo = await run('undo', '--session', 'session-2', '--cwd', workspace)
    expect(redo.exit).toBe('ok')
    expect(readFileSync(file, 'utf8')).toBe('later work\n')
  })

  it('records a pre-edit image for a file the scan never saw', async () => {
    // A path outside the scanned scope is exactly what `declare` is for: the
    // per-turn scan will not find it, so the pre-image is the only record.
    const outside = scratch('filesnap-outside')
    try {
      const file = join(outside.path, 'config.toml')
      writeFileSync(file, 'before\n')
      await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)

      const declared = await run(
        'declare', '--session', 'session-1', '--turn', 'session-1.t1',
        '--cwd', workspace, '--path', file,
      )
      expect(declared.exit).toBe('ok')
      expect(numberField(lastEvent(declared, 'declare.done'), 'recorded', -1)).toBe(1)

      writeFileSync(file, 'after\n')
      await run(
        'restore', '--session', 'session-1', '--turn', 'session-1.t1',
        '--undo-for', 'session-2', '--cwd', workspace,
      )
      expect(readFileSync(file, 'utf8')).toBe('before\n')
    } finally {
      outside.remove()
    }
  })

  it('removes a file the turn created, because the tombstone licenses it', async () => {
    const created = join(workspace, 'new.txt')
    await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)
    await run(
      'declare', '--session', 'session-1', '--turn', 'session-1.t1',
      '--cwd', workspace, '--path', created,
    )
    writeFileSync(created, 'brand new\n')

    const restore = await run(
      'restore', '--session', 'session-1', '--turn', 'session-1.t1',
      '--undo-for', 'session-2', '--cwd', workspace,
    )
    expect(restore.exit).toBe('ok')
    expect(existsSync(created)).toBe(false)
    expect(numberField(lastEvent(restore, 'restore.done'), 'deleted', -1)).toBe(1)
  })

  it('lists one entry per turn, which is what selection is offered from', async () => {
    writeFileSync(join(workspace, 'a.txt'), 'v1\n')
    await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)
    writeFileSync(join(workspace, 'a.txt'), 'v2\n')
    await run('capture', '--session', 'session-1', '--turn', 'session-1.t2', '--cwd', workspace)
    // A pre-edit attach is a second log entry for a turn that already has one;
    // the listing must still show that turn once.
    await run(
      'declare', '--session', 'session-1', '--turn', 'session-1.t2',
      '--cwd', workspace, '--path', join(workspace, 'b.txt'),
    )

    const listed = await run('log', '--session', 'session-1', '--cwd', workspace)
    expect(listed.exit).toBe('ok')
    expect(eventsOfType(listed, 'log.entry').map(event => stringField(event, 'turn', '')))
      .toEqual(['session-1.t1', 'session-1.t2'])
  })

  it('keeps two sessions in one workspace apart, which is why a point carries its session', async () => {
    // Both conversations reach turn 1. Under a bare turn number the second
    // would resolve the first's manifest, because filesnap partitions records
    // per workspace rather than per session.
    const file = join(workspace, 'a.txt')
    writeFileSync(file, 'from session one\n')
    await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)
    writeFileSync(file, 'from session two\n')
    await run('capture', '--session', 'session-2', '--turn', 'session-2.t1', '--cwd', workspace)

    writeFileSync(file, 'scratch\n')
    await run(
      'restore', '--session', 'session-2', '--turn', 'session-2.t1',
      '--undo-for', 'session-3', '--cwd', workspace,
    )
    expect(readFileSync(file, 'utf8')).toBe('from session two\n')
  })

  it('reports a turn it cannot resolve as a usage error, not a failure', async () => {
    const missing = await run(
      'restore', '--session', 'session-1', '--turn', 'session-1.t99',
      '--undo-for', 'session-2', '--cwd', workspace,
    )
    // "Nothing was attempted, and the fix is to the call" — distinct from the
    // code that means the store needs investigating.
    expect(missing.exit).toBe('usage')
    expect(missing.stderr).toContain('session-1.t99')
  })

  it('refuses an id the plugin should never have minted', async () => {
    const reserved = await run('capture', '--session', '_internal', '--turn', 't1', '--cwd', workspace)
    expect(reserved.exit).toBe('failed')
  })

  it('never stores what .filesnapignore excludes', async () => {
    mkdirSync(join(workspace, 'secret'))
    writeFileSync(join(workspace, '.filesnapignore'), '/secret/**\n')
    writeFileSync(join(workspace, 'secret', 'key.txt'), 'do not touch\n')
    await run('capture', '--session', 'session-1', '--turn', 'session-1.t1', '--cwd', workspace)

    writeFileSync(join(workspace, 'secret', 'key.txt'), 'changed by hand\n')
    await run(
      'restore', '--session', 'session-1', '--turn', 'session-1.t1',
      '--undo-for', 'session-2', '--cwd', workspace,
    )
    // Symmetric: an ignored path is never stored, so a restore has nothing to
    // put back and leaves the user's own change alone.
    expect(readFileSync(join(workspace, 'secret', 'key.txt'), 'utf8')).toBe('changed by hand\n')
  })
})
