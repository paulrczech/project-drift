// Offline-render journeys to WAV through the real engine + sampler, in headless Chromium.
//   Needs: npm i --no-save playwright-core   (Chromium from Playwright's cache, or set CHROME=...)
//   node scripts/render/run.mjs timelines '[["film",{"waypoints":[{"rung":5,"hold":6},{"rung":3,"hold":4},{"rung":0,"hold":6}],"walk":[6,8],"tonic":2,"seed":3}]]'
//   (add "tonic": 0-11 and "voice": "pad" | "choir" to either plan; defaults D and pad)
//   node scripts/render/run.mjs export '[["name",{"waypoints":[…],"walk":20,"tonic":2,"seed":3,"voice":"orchestra"}]]'   (the app's own WAV export)
//   node scripts/render/run.mjs pitch
//   node scripts/render/run.mjs journeys '[["name",{"from":5,"to":1,"holdA":40,"shiftSeconds":40,"holdB":40,"seed":7}]]'
// Output: renders/<name>.wav (gitignored), normalised to -3 dB for listening.
import { chromium } from 'playwright-core'
import { execFileSync, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '../..')
const OUT = path.join(root, 'renders')
fs.mkdirSync(OUT, { recursive: true })
execFileSync(path.join(root, 'node_modules/.bin/esbuild'), [
  'scripts/render/harness.ts', '--bundle', '--format=iife', '--outfile=scripts/render/harness.js', '--log-level=warning',
], { cwd: root })

const PORT = 4175
const server = spawn('python3', ['-m', 'http.server', String(PORT), '-d', root], { stdio: 'ignore' })
await new Promise((r) => setTimeout(r, 800))

const chrome = process.env.CHROME ?? `${homedir()}/Library/Caches/ms-playwright/chromium-1243/chrome-mac-x64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`
const browser = await chromium.launch({ executablePath: chrome, args: ['--autoplay-policy=no-user-gesture-required'] })
try {
  const page = await browser.newPage()
  page.on('pageerror', (e) => console.log('PAGEERROR', e.message))
  page.on('console', (m) => m.text().startsWith('renderExport') && console.log(m.text()))
  await page.goto(`http://localhost:${PORT}/scripts/render/index.html`)
  if (process.argv[2] === 'pitch') {
    for (const note of [50, 57, 69, 76]) {
      const r = await page.evaluate((n) => window.renderNote(n), note)
      fs.writeFileSync(`${OUT}/_pitch-${note}.wav`, Buffer.from(r.wav, 'base64'))
      console.log('note', note, 'raw peak', r.peak.toFixed(3))
    }
  } else {
    const fn = process.argv[2] === 'timelines' ? 'renderTimeline' : process.argv[2] === 'export' ? 'renderExport' : 'renderJourney'
    for (const [name, plan] of JSON.parse(process.argv[3])) {
      const t = Date.now()
      const r = await page.evaluate(([f, p]) => window[f](p), [fn, plan])
      fs.writeFileSync(`${OUT}/${name}.wav`, Buffer.from(r.wav, 'base64'))
      console.log(name, `${((Date.now() - t) / 1000).toFixed(1)}s, events ${r.events}, raw peak ${r.peak.toFixed(3)}, raw rms ${r.rms.toFixed(4)}, gain ${r.gain.toFixed(4)}, shifts at`, r.marks.map((m) => m.time.toFixed(0) + 's').join(','))
    }
  }
} finally {
  await browser.close()
  server.kill()
}
