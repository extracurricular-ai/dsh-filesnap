import { describe, expect, it } from 'vitest'
import { DEFAULTS, resolveConfig } from '../src/config.ts'

describe('resolveConfig', () => {
  it('is complete for a deployment that sets nothing', () => {
    expect(resolveConfig()).toEqual({ ...DEFAULTS })
    expect(resolveConfig({})).toEqual({ ...DEFAULTS })
  })

  it('keeps `dataDir` absent rather than undefined, so the engine picks the platform directory', () => {
    expect('dataDir' in resolveConfig({})).toBe(false)
    expect(resolveConfig({ dataDir: '/srv/snapshots' }).dataDir).toBe('/srv/snapshots')
  })

  it('takes every field a deployment may set', () => {
    expect(resolveConfig({
      command: '/opt/bin/filesnap',
      dataDir: '/srv/snapshots',
      timeoutMs: 5_000,
      graceMs: 100,
      maxOutputBytes: 4096,
      declareEdits: false,
    })).toEqual({
      command: '/opt/bin/filesnap',
      dataDir: '/srv/snapshots',
      timeoutMs: 5_000,
      graceMs: 100,
      maxOutputBytes: 4096,
      declareEdits: false,
    })
  })

  it('fails at load on a typo rather than ignoring it', () => {
    // A misconfiguration that surfaces as a missing snapshot an hour later is
    // indistinguishable from a bug.
    expect(() => resolveConfig({ dataDirectory: '/srv' })).toThrow(/unknown config key\(s\) dataDirectory/u)
  })

  it('refuses a bound that is not a bound', () => {
    expect(() => resolveConfig({ timeoutMs: 0 })).toThrow(TypeError)
    expect(() => resolveConfig({ timeoutMs: -1 })).toThrow(TypeError)
    expect(() => resolveConfig({ graceMs: 1.5 })).toThrow(TypeError)
    expect(() => resolveConfig({ maxOutputBytes: '4096' })).toThrow(TypeError)
  })

  it('refuses a command that would resolve to nothing', () => {
    expect(() => resolveConfig({ command: '' })).toThrow(TypeError)
    expect(() => resolveConfig({ command: '   ' })).toThrow(TypeError)
    expect(() => resolveConfig({ command: 7 })).toThrow(TypeError)
  })

  it('refuses a non-boolean switch rather than reading it for truthiness', () => {
    expect(() => resolveConfig({ declareEdits: 'no' })).toThrow(/must be a boolean/u)
    expect(resolveConfig({ declareEdits: false }).declareEdits).toBe(false)
  })

  it('refuses a config that is not a config', () => {
    expect(() => resolveConfig(null)).toThrow(TypeError)
    expect(() => resolveConfig([])).toThrow(TypeError)
    expect(() => resolveConfig('command=filesnap')).toThrow(TypeError)
  })
})
