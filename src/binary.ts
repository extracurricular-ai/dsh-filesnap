/**
 * Finding the `filesnap` binary this plugin installs with.
 *
 * `filesnap` is an ordinary dependency, so npm puts the right prebuilt binary
 * next to this package and nobody has to install anything by hand. What it does
 * not do is put it on `PATH`: the launcher's `bin` entry lands in the profile's
 * `node_modules/.bin`, which the subprocess provider's scrubbed environment has
 * no reason to include. So the path is resolved rather than looked up.
 *
 * **The platform binary directly, not the `filesnap` launcher.** That launcher
 * is a Node script whose whole job is this same lookup; going through it would
 * add a Node startup to every invocation, and this plugin spawns per turn and
 * per newly edited path — the batching in `declare` exists precisely because
 * process startup is the cost that adds up.
 *
 * @module
 */

import { existsSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * npm's own platform slug, the one the launcher's alias keys are built from.
 *
 * Android runs the Linux builds, which is the launcher's rule and not this
 * module's to disagree with.
 */
function platformSlug(): string {
  const platform = process.platform === 'android' ? 'linux' : process.platform
  return `${platform}-${process.arch}`
}

/**
 * The single `vendor/<triple>/bin/filesnap` a platform package holds.
 *
 * Read rather than derived from a table of Rust target triples. A package holds
 * exactly one, so the directory is the answer — and a table here would be a
 * second copy of the launcher's, free to drift the day filesnap adds a target.
 *
 * @param root - the platform package's directory.
 * @returns the binary path, or undefined when the package holds none.
 */
function binaryUnder(root: string): string | undefined {
  const vendor = join(root, 'vendor')
  let triples: string[]
  try {
    triples = readdirSync(vendor)
  } catch {
    return undefined
  }
  const name = process.platform === 'win32' ? 'filesnap.exe' : 'filesnap'
  for (const triple of triples) {
    const candidate = join(vendor, triple, 'bin', name)
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

/**
 * Locate the binary that came with this package's own dependency.
 *
 * Resolution starts from the `filesnap` launcher rather than from here: the
 * platform package is *its* optional dependency, not this plugin's, so a strict
 * (pnpm-style) layout puts it somewhere only a resolver anchored at the
 * launcher can answer for.
 *
 * @param from - module URL to resolve from; defaults to this module.
 * @returns an absolute path, or undefined when nothing is installed here.
 */
export function bundledBinary(from: string = import.meta.url): string | undefined {
  const requireHere = createRequire(from)
  let launcherDir: string
  try {
    launcherDir = dirname(requireHere.resolve('filesnap/package.json'))
  } catch {
    return undefined
  }
  const requireThere = createRequire(join(launcherDir, 'package.json'))
  try {
    const manifest = requireThere.resolve(`filesnap-${platformSlug()}/package.json`)
    const found = binaryUnder(dirname(manifest))
    if (found !== undefined) return found
  } catch {
    // No resolver answer — a hand-unpacked tarball, or a bundler that
    // flattened node_modules. The launcher falls back the same way.
  }
  return binaryUnder(launcherDir)
}
