// Open a persisted session the way a harness that has never loaded this
// plugin does: only the session store and the JSONL backend are mounted, so
// `KNOWN_SESSION_EVENT_TYPES` is the harness's own set and nothing has added
// the `filesnap/*` names to it. Whether the reader accepts the log then rests
// entirely on the `ignorable` marker each event carries.
//
// Usage: node read-back.mjs <root> <session-id>
// Prints one JSON line: { ok: true, types, filesnap } or { ok: false, message }.
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'

const [root, id] = process.argv.slice(2)
const ctx = new Context()
const store = await ctx.plugin(SessionStore)
const backend = await ctx.plugin(JsonlSessionPersistence, { root })
try {
  const loaded = await ctx.sessionPersistence.load(SessionId(id))
  const filesnap = loaded.events
    .filter(event => event.type.startsWith('filesnap/'))
    .map(event => ({ type: event.type, seq: event.seq, ignorable: event.ignorable }))
  process.stdout.write(JSON.stringify({ ok: true, types: [...new Set(loaded.events.map(e => e.type))], filesnap }) + '\n')
} catch (error) {
  process.stdout.write(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : String(error) }) + '\n')
  process.exitCode = 1
} finally {
  await backend.dispose()
  await store.dispose()
}
