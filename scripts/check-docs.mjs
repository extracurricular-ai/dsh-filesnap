import { readFile, readdir, stat } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const failures = []

// A harness checkout is a build input, not this project's documentation. CI and
// the release place it INSIDE the workspace (`actions/checkout` refuses a path
// outside it), so without this the walk descends into the harness's own notes
// and fails on links that were never ours to keep. `.harness` is the name both
// workflows use; DSH_HARNESS covers a checkout placed anywhere else under root.
const harness = process.env.DSH_HARNESS === undefined ? undefined : path.resolve(root, process.env.DSH_HARNESS)
const skippedDirectories = new Set(['.git', 'node_modules', 'lib', '.harness'])

async function markdownFiles(directory = root) {
  const found = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (skippedDirectories.has(entry.name)) continue
    if (harness !== undefined && path.join(directory, entry.name) === harness) continue
    const absolute = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await markdownFiles(absolute))
    else if (entry.isFile() && entry.name.endsWith('.md')) found.push(absolute)
  }
  return found
}

function localTarget(raw) {
  const unwrapped = raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw
  const target = unwrapped.split(/\s+["']/u, 1)[0]
  if (target === undefined || target === '' || target.startsWith('#')) return undefined
  if (/^(?:[a-z]+:|\/\/)/iu.test(target)) return undefined
  return decodeURIComponent(target.split('#', 1)[0] ?? '')
}

async function exists(absolute) {
  try {
    await stat(absolute)
    return true
  } catch {
    return false
  }
}

const files = await markdownFiles()
for (const file of files) {
  const source = await readFile(file, 'utf8')
  const relative = path.relative(root, file)

  for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/gu)) {
    const target = localTarget(match[1] ?? '')
    if (target === undefined || target === '') continue
    const absolute = path.resolve(path.dirname(file), target)
    if (!await exists(absolute)) failures.push(`${relative}: missing local link ${target}`)
  }

  for (const match of source.matchAll(/dsh-filesnap.{0,40}?(\d+\.\d+\.\d+)/giu)) {
    const documented = match[1]
    if (documented !== manifest.version) {
      failures.push(`${relative}: dsh-filesnap ${documented} does not match package ${manifest.version}`)
    }
  }
}

const pairedDocs = ['architecture', 'comparison', 'benchmarks', 'troubleshooting']
for (const name of pairedDocs) {
  for (const suffix of ['.md', '.zh.md']) {
    const relative = path.join('docs', `${name}${suffix}`)
    if (!await exists(path.join(root, relative))) failures.push(`missing bilingual document ${relative}`)
  }
}

for (const [name, limit] of [['README.md', 350], ['README.zh.md', 350]]) {
  const lines = (await readFile(path.join(root, name), 'utf8')).split('\n').length
  if (lines > limit) failures.push(`${name}: ${lines} lines exceeds the ${limit}-line product-page budget`)
}

if (failures.length > 0) {
  console.error(failures.join('\n'))
  process.exitCode = 1
} else {
  console.log(`documentation checks passed (${files.length} Markdown files)`)
}
