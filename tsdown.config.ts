/**
 * The browser bundle.
 *
 * The web client loads a plugin as a closure-factory artifact that registers
 * itself with the shell's module loader and resolves shared modules — React,
 * Cordis, the client runtime — through an injected `require` rather than an
 * import. That format is the harness's, produced by its own tsdown preset, and
 * the preset is a repository file rather than a published entrypoint. So this
 * config reaches into a sibling checkout for it.
 *
 * That is not the imposition it looks like: the web application is itself
 * built from the harness repository, so anyone assembling a web build that
 * includes this plugin already has one. A host-only deployment — headless, ACP,
 * or the web app with the commands alone — needs none of this and does not run
 * this config.
 *
 *   DSH_HARNESS=../deepseek-harness npm run build:client
 *
 * The bundle is built from the emitted client JavaScript, so `build:client`
 * compiles that first.
 */

import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const harness = resolve(process.env['DSH_HARNESS'] ?? '../deepseek-harness')
const preset = resolve(harness, 'packages/client/tsdown.client.ts')

if (!existsSync(preset)) {
  throw new Error(
    `dsh-filesnap: the browser bundle needs the harness's client preset at ${preset}.\n`
    + 'Check out https://github.com/deepseek-ai/deepseek-harness beside this repository, '
    + 'or point DSH_HARNESS at your checkout. The host half builds without it.',
  )
}

const { clientBundle } = await import(pathToFileURL(preset).href) as {
  clientBundle: (
    id: string,
    entries: readonly string[],
    options?: { hostPhase?: boolean },
  ) => unknown
}

// `hostPhase` with `DSH_BUILD_FACE=client` asks the preset for the browser
// artifact alone. The Node half of this package is ordinary `tsc` output —
// bundling it would inline the harness packages it declares as peers, and
// would make a host-only deployment depend on this preset to build at all.
// The listed entry is therefore never built; the preset requires one.
export default clientBundle('dsh-filesnap', ['lib/types/index.js'], { hostPhase: true })
