/**
 * Shared fixtures: a real `filesnap` process behind the narrow slice of
 * `ctx.subprocess` this plugin uses, plus temp workspaces.
 *
 * The subprocess service is a stand-in rather than the real provider, and the
 * engine behind it is the real binary. That is the split the suite wants: the
 * harness's process lifecycle is not what these tests are about, and the
 * engine's behaviour is exactly what they are about.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { SubprocessHandle, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'

/** Candidate locations for a built `filesnap`, nearest first. */
const CANDIDATES = [
  process.env['FILESNAP_BIN'],
  resolve(import.meta.dirname, '../../filesnap/target/release/filesnap'),
  resolve(import.meta.dirname, '../../filesnap/target/debug/filesnap'),
].filter((path): path is string => path !== undefined)

/** The binary these tests drive, or undefined when none was built. */
export const BINARY = CANDIDATES.find(path => existsSync(path))

/** A `ctx.subprocess`-shaped object backed by `node:child_process`. */
export interface SubprocessStandIn {
  resolveExecutable(command: string): Promise<string>
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle
}

/**
 * Run real child processes through the seam's collected-output contract.
 *
 * @returns the stand-in service.
 */
export function nodeSubprocess(): SubprocessStandIn {
  return {
    // The tests pass an absolute path to a binary they have already located,
    // so lookup is the identity. PATH resolution belongs to the real provider.
    resolveExecutable(command: string): Promise<string> {
      return existsSync(command)
        ? Promise.resolve(command)
        : Promise.reject(new Error(`no such executable: ${command}`))
    },
    spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
      const [program, ...args] = spec.argv
      /* v8 ignore next -- every caller in this plugin passes a program */
      if (program === undefined) throw new TypeError('argv is empty')
      const child = spawn(program, args, { cwd: spec.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString('utf8') })
      child.stderr.on('data', (chunk: Buffer) => { err += chunk.toString('utf8') })
      const done = new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((settle, fail) => {
        child.on('error', fail)
        child.on('close', (exitCode, signal) => void settle({ exitCode, signal }))
      })
      return {
        pid: child.pid ?? -1,
        stdin: undefined,
        stdout: undefined,
        stderr: undefined,
        collected: {
          stdout: { readFrom: () => ({ text: out, nextOffset: out.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: err, nextOffset: err.length, lossy: false }) },
        },
        done,
        terminate: () => void child.kill(),
        waitForExit: async () => { await done; return true },
      } as unknown as SubprocessHandle
    },
  }
}

/** A temp directory that removes itself. */
export interface Scratch {
  readonly path: string
  remove(): void
}

/**
 * Make a temp directory for one test.
 *
 * @param prefix - a name fragment that says which fixture made it.
 * @returns the directory and its cleanup.
 */
export function scratch(prefix: string): Scratch {
  const path = mkdtempSync(join(tmpdir(), `${prefix}-`))
  return { path, remove: () => void rmSync(path, { recursive: true, force: true }) }
}
