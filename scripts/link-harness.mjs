#!/usr/bin/env node
/**
 * Point this checkout at a local DeepSeek Harness for development.
 *
 * The harness packages are `peerDependencies`: a deployment already has them,
 * and pinning a version here would fight whatever it runs. That leaves nothing
 * to typecheck or test against, so this links a sibling checkout's **built**
 * packages into `node_modules` without writing them into `package.json` —
 * `npm install` and CI stay reproducible for anyone who does not have one.
 *
 * The build matters: `lib/types/*.d.ts` is what a consumer resolves, and
 * checking against `src` instead would typecheck the harness's own sources
 * under this project's compiler settings rather than checking this plugin.
 *
 *   git clone https://github.com/deepseek-ai/deepseek-harness ../deepseek-harness
 *   ( cd ../deepseek-harness && pnpm install && pnpm run build )
 *   npm run harness:link
 *
 * Pass a path, or set `DSH_HARNESS`, when the checkout is somewhere else.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'

/** Workspace directories, relative to the harness root, this plugin builds against. */
const PACKAGES = [
  'vendor/cordis',
  'packages/core/agent',
  'packages/core/session',
  'packages/llm/llm',
  'packages/subprocess/subprocess',
  'packages/fs/fs',
  'packages/interaction/commands',
  'packages/preset/agent-presets',
]

const harness = resolve(process.argv[2] ?? process.env.DSH_HARNESS ?? '../deepseek-harness')

if (!existsSync(harness)) {
  console.error(`no harness checkout at ${harness}`)
  console.error('pass a path, or set DSH_HARNESS. See the header of this script.')
  process.exit(1)
}

const missing = PACKAGES.filter(dir => !existsSync(resolve(harness, dir, 'lib/types')))
if (missing.length > 0) {
  console.error(`${harness} is not built — no lib/types in:`)
  for (const dir of missing) console.error(`  ${dir}`)
  console.error('run `pnpm install && pnpm run build` there first.')
  process.exit(1)
}

// Symlinks rather than `npm install file:…`: these packages are peers and must
// stay out of the manifest, and npm prunes anything installed with --no-save
// that package.json does not name — including the links it just made. Node and
// TypeScript both resolve through the link's realpath, so each package finds
// its own dependencies in the harness's node_modules, exactly as it would
// inside that workspace.
const root = resolve(import.meta.dirname, '..', 'node_modules')
for (const dir of PACKAGES) {
  const source = resolve(harness, dir)
  const { name } = JSON.parse(readFileSync(resolve(source, 'package.json'), 'utf8'))
  const target = resolve(root, name)
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  symlinkSync(relative(dirname(target), source), target, 'dir')
  console.log(`  ${name} -> ${dir}`)
}

console.log(`\nlinked ${String(PACKAGES.length)} packages from ${harness}`)
