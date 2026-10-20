// Characterization of the field UI: drives the built app in headless Chromium and records everything
// a refactor must not change — announcements, the readout, every exported file (hashed), saved
// projects. Run it on the code before a change and after, then diff the two JSON files.
//
//   npm run build && npx vite preview --port 4173 &
//   node scripts/characterize/run.mjs http://localhost:4173 renders/characterize-before.json
//   (change code, rebuild)
//   node scripts/characterize/run.mjs http://localhost:4173 renders/characterize-after.json
//   diff renders/characterize-before.json renders/characterize-after.json
//
// Needs `npm i --no-save playwright-core`. Math.random is controlled only around Begin, so keys and
// seeds are the same each run; The WAV is compared by name and size only (its bytes differ from run to run).

import { chromium } from 'playwright-core'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

const [base = 'http://localhost:4173', out = 'renders/characterize.json'] = process.argv.slice(2)
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16)
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// a stored zip: names and content hashes
function zipEntries(buf) {
  const entries = []
  let p = 0
  while (p + 30 <= buf.length && buf.readUInt32LE(p) === 0x04034b50) {
    const size = buf.readUInt32LE(p + 18)
    const nameLen = buf.readUInt16LE(p + 26)
    const extraLen = buf.readUInt16LE(p + 28)
    const name = buf.toString('utf8', p + 30, p + 30 + nameLen)
    const start = p + 30 + nameLen + extraLen
    entries.push({ name, bytes: size, sha: sha(buf.subarray(start, start + size)) })
    p = start + size
  }
  return entries
}
function summarize(name, buf) {
  if (name.endsWith('.zip')) return { name, files: zipEntries(buf) }
  if (name.endsWith('.json')) return { name, json: JSON.parse(buf.toString('utf8')) }
  if (name.endsWith('.wav')) return { name, bytes: buf.length }
  return { name, bytes: buf.length, sha: sha(buf) }
}

// CHROMIUM=/path/to/chrome-headless-shell when playwright-core wants a newer build than is installed
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: ['--autoplay-policy=no-user-gesture-required'],
})

async function fresh(viewport = { width: 1280, height: 800 }) {
  const context = await browser.newContext({ viewport, acceptDownloads: true })
  await context.addInitScript(() => {
    const real = Math.random
    window.__rnd = []
    Math.random = () => (window.__rnd.length ? window.__rnd.shift() : real())
    window.__say = []
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.goto(base)
  await page.waitForSelector('main.field-app', { state: 'attached' })
  await page.evaluate(() => {
    const el = document.querySelector('[role=status]')
    new MutationObserver(() => {
      const t = el.textContent.trim()
      if (t) window.__say.push(t)
    }).observe(el, { childList: true, characterData: true, subtree: true })
  })
  return { context, page, errors }
}

async function said(page) {
  return page.evaluate(() => {
    const a = window.__say
    window.__say = []
    return a
  })
}
const readout = (page) =>
  page.evaluate(() => {
    const line = document.querySelector('.hint .line')?.textContent.replace(/\s+/g, ' ').trim() ?? ''
    const seed = document.querySelector('.hint .seed.keep')
    return { line, seed: seed?.textContent.replace(/\s+/g, ' ').trim() ?? '', pressed: seed?.getAttribute('aria-pressed') ?? null }
  })

async function grab(page, click) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 180000 }), click()])
  const path = await dl.path()
  return summarize(dl.suggestedFilename(), readFileSync(path))
}

async function openFile(page) {
  const open = await page.getByRole('button', { name: /^(file|rendering|saving|loading)/ }).getAttribute('aria-expanded')
  if (open !== 'true') await page.getByRole('button', { name: 'file', exact: true }).click()
}
async function closeFile(page) {
  if ((await page.locator('#export-list').isVisible())) await page.keyboard.press('Escape')
}
async function exportAs(page, { format, scope = 'this drift', count }) {
  await openFile(page)
  await page.getByRole('radio', { name: format, exact: true }).click()
  await page.getByRole('radio', { name: scope, exact: true }).click()
  if (scope === 'seeds') await page.getByRole('radio', { name: String(count), exact: true }).click()
  const label = await page.locator('#export-list .save').textContent()
  const note = (await page.locator('#export-list .note').allTextContents()).join('|')
  const file = await grab(page, () => page.locator('#export-list .save').click())
  return { label: label.trim(), note, file, said: await said(page) }
}
async function saveProject(page) {
  await openFile(page)
  const file = await grab(page, () => page.getByRole('button', { name: 'Save project, to reopen' }).click())
  return { file, said: await said(page) }
}
async function openProject(page, project) {
  await openFile(page)
  await page.locator('#export-list input[type=file]').setInputFiles({
    name: 'p.drift.json',
    mimeType: 'application/json',
    buffer: Buffer.from(typeof project === 'string' ? project : JSON.stringify(project)),
  })
  await wait(300)
  await closeFile(page)
  return said(page)
}
async function chooseSound(page, id) {
  await page.getByRole('button', { name: 'sound', exact: true }).click()
  await page.locator('#sound-list [role=radio]').filter({ hasText: new RegExp(`^${id}`) }).first().click()
  await page.keyboard.press('Escape')
  return said(page)
}
async function soundRow(page, label, index) {
  await page.getByRole('button', { name: 'sound', exact: true }).click()
  await page.locator(`#sound-list .tempo:has(.tempo-label:text-is("${label}")) button`).nth(index).click()
  await page.keyboard.press('Escape')
  return said(page)
}
async function begin(page, rnd = [0.5, 0.123456]) {
  await page.evaluate((r) => (window.__rnd = r), rnd)
  await page.getByRole('button', { name: 'Begin drift' }).click()
  await wait(1500)
  const r = await readout(page)
  const s = await said(page)
  await page.evaluate(() => (window.__rnd = []))
  return { readout: r, said: s }
}
async function end(page) {
  await page.getByRole('button', { name: 'End drift' }).click()
  await wait(3600)
  return said(page)
}

const result = {}

// ── A: the interface, stop by stop ──────────────────────────────────────────────────────
{
  const { context, page, errors } = await fresh()
  const A = (result.interface = {})
  A.initial = await readout(page)
  await page.getByRole('button', { name: 'words', exact: true }).click()
  const sel = (i) => page.locator('#words-panel .stop').nth(i).locator('select').first()
  A.words = []
  for (const [i, w] of [[0, 'nostalgic'], [1, 'joyful'], [2, 'serene']]) {
    await sel(i).selectOption(w)
    A.words.push(await said(page))
  }
  const named = (name) => page.getByLabel(name, { exact: true })
  A.edits = []
  const edit = async (label, how) => {
    await named(label).selectOption(how)
    A.edits.push({ label, how, said: await said(page) })
  }
  await edit('Key for stop 2', { index: 8 })
  await edit('Key for stop 3', { index: 4 })
  await edit('Key for stop 3', { index: 0 })
  await edit('Variation for stop 2', 'flowing')
  await edit('Variation for where you are', 'still')
  await edit('Chords for stop 2', '4')
  await edit('Chords for stop 3', '2')
  await edit('Chords for where you are', '1')
  await edit('Key for where you are', { index: 4 })
  await edit('Key for where you are', { index: 0 })
  // remove the middle stop, add it back, add a fourth
  await sel(1).selectOption('')
  A.edits.push({ label: 'remove stop 2', said: await said(page) })
  await sel(1).selectOption('happy')
  A.edits.push({ label: 'set stop 2', said: await said(page) })
  await sel(2).selectOption('sad')
  A.edits.push({ label: 'add stop 3', said: await said(page) })
  await sel(3).selectOption('cheerful')
  A.edits.push({ label: 'add stop 4', said: await said(page) })
  A.words_state = await page.evaluate(() => [...document.querySelectorAll('#words-panel select')].map((s) => `${s.getAttribute('aria-label') ?? ''}=${s.value}`))
  await page.getByRole('button', { name: 'words', exact: true }).click()
  // a place on the field, then clear and start again
  await page.mouse.click(640, 330)
  A.field = await said(page)
  await page.getByRole('button', { name: 'clear', exact: true }).click()
  A.clear = await said(page)
  await page.getByRole('button', { name: 'words', exact: true }).click()
  for (const [i, w] of [[0, 'nostalgic'], [1, 'joyful'], [2, 'serene']]) await sel(i).selectOption(w)
  await named('Key for stop 2').selectOption({ index: 8 })
  await named('Variation for stop 2').selectOption('flowing')
  await named('Chords for stop 2').selectOption('4')
  await named('Chords for stop 3').selectOption('2')
  await said(page)
  await page.getByRole('button', { name: 'words', exact: true }).click()

  // length 4 minutes, a tempo and chords every 2 bars from the sound menu
  await page.locator('[aria-label="How long the drift lasts"] button').nth(1).click()
  A.menu = [await soundRow(page, 'tempo', 2), await soundRow(page, 'chords', 2), await soundRow(page, 'change', 0)]
  A.chooseVoice = await chooseSound(page, 'pad')

  A.begin = await begin(page)
  A.ended = await end(page)
  A.afterEnd = await readout(page)

  A.exports = {}
  A.exports.midi = await exportAs(page, { format: 'MIDI' })
  A.exports.clips = await exportAs(page, { format: 'clips' })
  A.exports.midiSeeds = await exportAs(page, { format: 'MIDI', scope: 'seeds', count: 2 })
  A.exports.clipsSeeds = await exportAs(page, { format: 'clips', scope: 'seeds', count: 2 })
  A.exports.midiSounds = await exportAs(page, { format: 'MIDI', scope: 'sounds' })
  A.exports.clipsSounds = await exportAs(page, { format: 'clips', scope: 'sounds' })
  A.project = await saveProject(page)

  // keep the seed, begin again with different chance: same seed and key
  await page.locator('.hint .seed.keep').click()
  A.kept = { readout: await readout(page), said: await said(page) }
  A.keptBegin = await begin(page, [0.9, 0.9])
  A.keptEnded = await end(page)
  A.keptProject = await saveProject(page)
  await page.locator('.hint .seed.keep').click()
  A.released = { readout: await readout(page), said: await said(page) }

  // the same drift on the pulse
  A.pulse = await chooseSound(page, 'pulse')
  A.pulseMenu = [await soundRow(page, 'grid', 3).catch(() => 'no grid row'), await soundRow(page, 'notes', 3).catch(() => 'no notes row')]
  A.pulseBegin = await begin(page, [0.25, 0.654321])
  A.pulseEnded = await end(page)
  A.exports.pulseMidi = await exportAs(page, { format: 'MIDI' })
  A.exports.pulseClips = await exportAs(page, { format: 'clips' })
  A.exports.pulseWav = await exportAs(page, { format: 'WAV' })
  A.pulseProject = await saveProject(page)
  A.errors = errors
  await context.close()
}

// ── B: projects opened, begun, saved again ───────────────────────────────────────────────
const stop = (valence, arousal, word, extra = {}) => ({ valence, arousal, word, root: null, grid: null, density: null, variation: null, bars: null, ...extra })
const projects = {
  padFree: {
    drift: 4, minutes: 4, key: 'D#', root: 3, voice: 'pad', bpm: null, grid: null, density: null, seed: 12345, modes: [],
    stops: [stop(0.4, 0.3, 'nostalgic', { variation: 'gentle', bars: 0 }), stop(0.7, 0.45, 'hopeful'), stop(0.95, 0.75, 'joyful', { root: 7 })],
  },
  padBars: {
    drift: 4, minutes: 7, key: 'A', root: 9, voice: 'choir', bpm: 96, grid: null, density: null, seed: 777, modes: [],
    stops: [stop(0.3, 0.2, 'sad', { variation: 'still', bars: 2 }), stop(0.5, 0.3, 'neutral', { bars: 4, variation: 'flowing' }), stop(0.83, 0.58, 'happy', { root: 2 }), stop(0.88, 0.7, 'cheerful', { bars: 1 })],
  },
  pulse: {
    drift: 4, minutes: 4, key: 'F#', root: 6, voice: 'pulse', bpm: 88, grid: 4, density: 'full', seed: 4242, modes: [],
    stops: [stop(0.46, 0.22, 'reflective', { variation: 'flowing', bars: 2 }), stop(0.7, 0.45, 'hopeful', { grid: 2, density: 'sparse' }), stop(0.95, 0.75, 'joyful', { grid: 3, root: 11, bars: 4 })],
  },
  orchestraEndless: {
    drift: 4, minutes: 'endless', key: 'C', root: 0, voice: 'orchestra', bpm: null, grid: null, density: null, seed: 9, modes: [],
    stops: [stop(0.66, 0.14, 'peaceful', { variation: 'gentle', bars: 0 })],
  },
  oldV1Pulse: {
    drift: 1, minutes: 10, key: 'E', root: 4, voice: 'pulse', bpm: 70, seed: 31337, modes: [],
    stops: [{ valence: 0.5, arousal: 0.3, word: 'neutral', root: null }, { valence: 0.9, arousal: 0.7, word: 'joyful', root: null }],
  },
}
result.projects = {}
for (const [name, project] of Object.entries(projects)) {
  const { context, page, errors } = await fresh()
  const P = (result.projects[name] = {})
  P.opened = await openProject(page, project)
  P.readoutBefore = await readout(page)
  P.begin = await begin(page)
  P.ended = await end(page)
  P.exportMidi = await exportAs(page, { format: 'MIDI' })
  P.saved = await saveProject(page)
  if (name === 'padBars' || name === 'pulse') P.exportClips = await exportAs(page, { format: 'clips' })
  if (name === 'pulse') P.exportSeeds = await exportAs(page, { format: 'MIDI', scope: 'seeds', count: 3 })
  P.errors = errors
  await context.close()
}

// ── C: files that are not projects ───────────────────────────────────────────────────────
{
  const { context, page } = await fresh()
  result.rejected = {
    notJson: await openProject(page, 'hello'),
    newer: await openProject(page, '{"drift":99,"stops":[{}]}'),
    notDrift: await openProject(page, '{"a":1}'),
    noStops: await openProject(page, '{"drift":4,"stops":[]}'),
    offField: await openProject(page, { ...projects.padFree, stops: [stop(2, 0.3, 'x')] }),
  }
  await context.close()
}

await browser.close()
mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(result, null, 2) + '\n')
console.log(`wrote ${out}`)
