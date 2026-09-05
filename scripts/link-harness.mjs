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
 *
 * **The checkout has to be recent.** This list follows the harness's package
 * layout, which moves: `packages/client/runtime` was removed and the chat
 * slots were split into `packages/client/ui-chat`. Building against an older
 * checkout fails at the link, by design — the alternative is typechecking
 * against declarations that no longer describe what a deployment runs. The
 * *published* plugin is not affected: the imports that follow that split are
 * type-only, and the slot names they reach are the same on either side.
 *
 * Re-run it after any `npm install`: npm prunes what `package.json` does not
 * name, and these links are deliberately not named there.
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
  'packages/session/session-projection',
  // The read-back test mounts real persistence, so the marker this plugin
  // sets on its events is proven against the reader that enforces it.
  'packages/session/session-persistence',
  'packages/session/session-persistence-jsonl',
  // The browser half's inputs. Their `lib/types/client` declarations are what
  // a client bundle is checked against; the bundle itself is built by the
  // harness's own preset (see tsdown.config.ts).
  //
  // `packages/client/runtime` used to be here. The harness removed it, and
  // because this list is checked for `lib/types` the absence surfaced as
  // "the harness is not built" — a checkout that was built fine. A package
  // that goes away upstream should not read as a local mistake, so the check
  // below now separates the two.
  'packages/client/ui-renderer',
  'packages/client/ui-chat',
  'packages/client/ui-slots',
  'packages/client/ui-primitives',
  'packages/client/ui-conversation',
  'packages/client/locale',
]

/** Third-party packages the browser half compiles against, taken from the harness's install. */
const SHELL = ['react', '@types/react']

const harness = resolve(process.argv[2] ?? process.env.DSH_HARNESS ?? '../deepseek-harness')

if (!existsSync(harness)) {
  console.error(`no harness checkout at ${harness}`)
  console.error('pass a path, or set DSH_HARNESS. See the header of this script.')
  process.exit(1)
}

// Two different failures, told apart. A directory that is not there is a
// harness that moved or dropped the package, and no amount of rebuilding will
// produce it; a directory that is there without `lib/types` is a checkout
// nobody has built. Reporting both as "not built" sent this project's CI
// looking at its build for a package the harness had removed.
const absent = PACKAGES.filter(dir => !existsSync(resolve(harness, dir)))
if (absent.length > 0) {
  console.error(`${harness} does not contain:`)
  for (const dir of absent) console.error(`  ${dir}`)
  console.error('the harness moved or removed these — this list needs updating, not a rebuild.')
  process.exit(1)
}

const unbuilt = PACKAGES.filter(dir => !existsSync(resolve(harness, dir, 'lib/types')))
if (unbuilt.length > 0) {
  console.error(`${harness} is not built — no lib/types in:`)
  for (const dir of unbuilt) console.error(`  ${dir}`)
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

// React and its types come from the harness's own install rather than this
// package's: the web shell seeds React into the module table, so a browser
// half that carried its own copy would compile against one React and run
// against another.
for (const name of SHELL) {
  // pnpm links a package into the node_modules of whichever workspace member
  // depends on it, not into the root, so the client packages' own directories
  // are where these actually resolve.
  const candidates = [
    resolve(harness, 'node_modules', name),
    resolve(harness, 'packages/client/ui-slots/node_modules', name),
    resolve(harness, 'packages/client/ui-primitives/node_modules', name),
    resolve(harness, 'packages/client/runtime/node_modules', name),
  ]
  const source = candidates.find(path => existsSync(path))
  if (source === undefined) {
    console.warn(`  (skipped ${name}: not installed in the harness)`)
    continue
  }
  const target = resolve(root, name)
  mkdirSync(dirname(target), { recursive: true })
  rmSync(target, { recursive: true, force: true })
  symlinkSync(relative(dirname(target), source), target, 'dir')
  console.log(`  ${name} -> node_modules/${name}`)
}

console.log(`\nlinked ${String(PACKAGES.length)} packages from ${harness}`)
