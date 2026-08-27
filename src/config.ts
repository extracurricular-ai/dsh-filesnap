/**
 * Deployment-owned configuration, validated at load.
 *
 * Every field here varies by deployment: where the binary is, where the store
 * lives, how long a scan of *this* project may take. None of them is a tuning
 * knob a user has to find — each has a default that is correct on an ordinary
 * machine, and the defaults are the whole configuration for most deployments.
 *
 * What is deliberately **not** configurable is filesnap's own scan bound. The
 * engine takes it as a library parameter with a correct default and does not
 * expose it on the command line (filesnap D14), because a bound a user has to
 * discover is not a bound. `filesnap status` answers the question that setting
 * would have been reached for — which files in this project are not protected,
 * and why.
 *
 * A bad value fails at load rather than at the first turn: the plugin is
 * self-contained enough to check itself, and a misconfiguration that surfaces
 * as a missing snapshot an hour later is indistinguishable from a bug.
 *
 * @module
 */

/** What a deployment may set. */
export interface FilesnapConfig {
  /**
   * The `filesnap` command. A bare name is resolved through the subprocess
   * provider's own PATH, so it follows the execution world the filesystem
   * provider is mounted in rather than this process's environment.
   */
  readonly command: string
  /**
   * Where the store lives. Omitted lets the engine use the platform data
   * directory — `$XDG_DATA_HOME` or `~/.local/share` on Unix, `%LOCALAPPDATA%`
   * on Windows — which is never inside the user's project.
   */
  readonly dataDir?: string
  /**
   * Wall-clock bound for one invocation. The expensive one is `capture`: a stat
   * walk measured in hundreds of milliseconds on an ordinary project, and
   * longer on a large one over a network filesystem.
   */
  readonly timeoutMs: number
  /** SIGTERM-to-SIGKILL grace when a deadline or a cancelled turn ends a run. */
  readonly graceMs: number
  /**
   * In-memory cap per collected stream. A restore names every file it wrote on
   * its own line, so this scales with the size of the largest rewind rather
   * than with the project.
   */
  readonly maxOutputBytes: number
  /**
   * Whether an edit declares its pre-image before it lands. Leaving this off
   * narrows coverage to what the per-turn scan sees: a file outside the
   * workspace, over the size limit, or beyond the recency budget stops being
   * restorable. It exists for a deployment whose filesystem seam is remote,
   * where the engine cannot read the path it is handed.
   */
  readonly declareEdits: boolean
}

/** The configuration of a deployment that sets nothing. */
export const DEFAULTS = {
  command: 'filesnap',
  timeoutMs: 120_000,
  graceMs: 2_000,
  maxOutputBytes: 1 << 20,
  declareEdits: true,
} as const satisfies Omit<FilesnapConfig, 'dataDir'>

/** Fields a deployment may name; anything else is a typo worth failing on. */
const KNOWN = new Set<string>([...Object.keys(DEFAULTS), 'dataDir'])

/**
 * Read one optional positive-integer field.
 *
 * @param raw - the caller's configuration object.
 * @param key - the field name.
 * @param fallback - the default when the field is absent.
 * @returns the validated value.
 * @throws when the field is present and is not a positive safe integer.
 */
function positiveInteger(raw: Record<string, unknown>, key: string, fallback: number): number {
  const value = raw[key]
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`filesnap: \`${key}\` must be a positive integer, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Read one optional non-empty-string field.
 *
 * @param raw - the caller's configuration object.
 * @param key - the field name.
 * @returns the validated value, or undefined when absent.
 * @throws when the field is present and is not a non-empty string.
 */
function nonEmptyString(raw: Record<string, unknown>, key: string): string | undefined {
  const value = raw[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`filesnap: \`${key}\` must be a non-empty string, got ${JSON.stringify(value)}`)
  }
  return value
}

/**
 * Validate a deployment's configuration and fill in what it left out.
 *
 * @param config - the raw `config` block from the Cordis entry, or nothing.
 * @returns a detached, complete configuration.
 * @throws when a field is unknown or holds a value the plugin cannot use.
 */
export function resolveConfig(config: unknown = {}): FilesnapConfig {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    throw new TypeError(`filesnap: config must be an object, got ${JSON.stringify(config)}`)
  }
  const raw = config as Record<string, unknown>
  const unknown = Object.keys(raw).filter(key => !KNOWN.has(key))
  if (unknown.length > 0) {
    throw new TypeError(
      `filesnap: unknown config key(s) ${unknown.join(', ')} — `
      + `the fields are ${[...KNOWN].sort().join(', ')}`,
    )
  }
  const declareEdits = raw['declareEdits']
  if (declareEdits !== undefined && typeof declareEdits !== 'boolean') {
    throw new TypeError(`filesnap: \`declareEdits\` must be a boolean, got ${JSON.stringify(declareEdits)}`)
  }
  const dataDir = nonEmptyString(raw, 'dataDir')
  return {
    command: nonEmptyString(raw, 'command') ?? DEFAULTS.command,
    ...dataDir === undefined ? {} : { dataDir },
    timeoutMs: positiveInteger(raw, 'timeoutMs', DEFAULTS.timeoutMs),
    graceMs: positiveInteger(raw, 'graceMs', DEFAULTS.graceMs),
    maxOutputBytes: positiveInteger(raw, 'maxOutputBytes', DEFAULTS.maxOutputBytes),
    declareEdits: declareEdits ?? DEFAULTS.declareEdits,
  }
}
