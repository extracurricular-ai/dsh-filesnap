#!/usr/bin/env node
/**
 * Build the browser artifact, `lib/client.js`.
 *
 * The web client loads a plugin as a closure-factory module that registers
 * itself with the shell's loader and resolves React, Cordis and the client
 * runtime through an injected `require`. That format belongs to the harness and
 * is produced by its own tsdown preset — a repository file, not a published
 * entrypoint — so this build borrows a sibling checkout.
 *
 * Two things the preset assumes about its caller, both handled here:
 *
 * - It resolves a package's externals by globbing `packages/<group>/<name>/`
 *   inside the harness for a manifest with that name, so this package's
 *   `package.json` is staged there for the length of the build and removed
 *   afterwards. Nothing else is copied: the sources, the config and the output
 *   all stay in this repository.
 * - It takes the build face from `--env.DSH_BUILD_FACE`. `client` asks for the
 *   browser artifact alone; the Node half of this package is ordinary `tsc`
 *   output, so that a host-only deployment needs none of this.
 *
 *   DSH_HARNESS=../deepseek-harness npm run build:client
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'

/** Where the preset expects to find a manifest it can read externals from. */
const STAGE_GROUP = 'extensions'

const root = resolve(import.meta.dirname, '..')
const { name } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const harness = resolve(process.env.DSH_HARNESS ?? resolve(root, '../deepseek-harness'))

const preset = resolve(harness, 'packages/client/tsdown.client.ts')
if (!existsSync(preset)) {
  console.error(`no harness client preset at ${preset}`)
  console.error('check out deepseek-harness beside this repository, or set DSH_HARNESS.')
  console.error('the host half builds without it: `npm run build`.')
  process.exit(1)
}

const tsdown = resolve(harness, 'node_modules/.bin/tsdown')
if (!existsSync(tsdown)) {
  console.error(`${harness} has no installed tsdown — run \`pnpm install\` there first.`)
  process.exit(1)
}

const stage = resolve(harness, 'packages', STAGE_GROUP, name)
mkdirSync(stage, { recursive: true })
try {
  cpSync(resolve(root, 'package.json'), resolve(stage, 'package.json'))
  execFileSync('npx', ['tsc', '-p', 'tsconfig.client.build.json'], { cwd: root, stdio: 'inherit' })
  execFileSync(tsdown, ['--env.DSH_BUILD_FACE', 'client'], { cwd: root, stdio: 'inherit' })
} finally {
  rmSync(stage, { recursive: true, force: true })
}

console.log(`\nbuilt lib/client.js with the preset from ${harness}`)
