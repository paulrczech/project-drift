// axe-core on the field at 1280, 390 and 320 px: idle, with the words and file menus open, and with a
// journey on the readout. Needs `npm i --no-save playwright-core axe-core` and a preview on 4173.
//   node scripts/characterize/axe.mjs [url]

import { chromium } from 'playwright-core'
import { readFileSync } from 'node:fs'

const base = process.argv[2] ?? 'http://localhost:4173'
const axeSource = readFileSync('node_modules/axe-core/axe.min.js', 'utf8')
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--autoplay-policy=no-user-gesture-required'] })
const project = {
  drift: 4, minutes: 4, key: 'D#', root: 3, voice: 'pad', bpm: null, grid: null, density: null, seed: 12345, modes: [],
  stops: [
    { valence: 0.4, arousal: 0.3, word: 'nostalgic', root: null, grid: null, density: null, variation: 'gentle', bars: 2 },
    { valence: 0.95, arousal: 0.75, word: 'joyful', root: 7, grid: null, density: null, variation: null, bars: null },
  ],
}
let bad = 0
for (const width of [1280, 390, 320]) {
  const context = await browser.newContext({ viewport: { width, height: width > 500 ? 800 : 700 }, hasTouch: width < 500 })
  const page = await context.newPage()
  await page.goto(base)
  await page.waitForSelector('main.field-app', { state: 'attached' })
  const run = async (what) => {
    await page.evaluate(axeSource)
    const r = await page.evaluate(() => axe.run(document, { runOnly: ['wcag2a', 'wcag2aa', 'best-practice'] }))
    bad += r.violations.length
    console.log(`${width}px ${what}: ${r.violations.length} violations`, r.violations.map((v) => v.id))
  }
  await run('idle')
  await page.getByRole('button', { name: 'words', exact: true }).click()
  await run('words open')
  await page.getByRole('button', { name: 'words', exact: true }).click()
  await page.getByRole('button', { name: 'file', exact: true }).click()
  await page.locator('#export-list input[type=file]').setInputFiles({ name: 'p.drift.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(project)) })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Begin drift' }).click()
  await page.waitForTimeout(800)
  await page.getByRole('button', { name: 'End drift' }).click()
  await page.waitForTimeout(3500)
  await run('journey on the readout')
  await page.getByRole('button', { name: 'file', exact: true }).click()
  await run('file menu open')
  await context.close()
}
await browser.close()
process.exit(bad ? 1 : 0)
