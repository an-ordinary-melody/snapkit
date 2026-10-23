// Measure hotkey -> dim -> frozen image timings over several captures.
import { _electron as electron } from 'playwright-core'
const app = await electron.launch({ args: ['.', '--no-sandbox'] })
app.process().stdout.on('data', (d) => process.stdout.write(String(d).split('\n').filter((l) => /shown|painted|grabbed|timeout/.test(l)).map((l) => l + '\n').join('')))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
await sleep(2500)
for (let i = 0; i < 4; i++) {
  console.log(`--- capture ${i + 1}`)
  await app.evaluate(({ app }) => app.emit('second-instance'))
  await sleep(1200)
  await app.windows()[0].keyboard.press('Escape')
  await sleep(600)
}
await app.close()
