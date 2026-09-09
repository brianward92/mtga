// Usage: npx tsx scripts/dev/read-region.ts X Y WIDTH HEIGHT
// Print the text Apple Vision reads in a screen region, one line per row.
// Coordinates are screen POINTS. See scripts/dev/lib/desktop.ts.
import { readTextLines } from './lib/desktop'

const [x, y, width, height] = process.argv.slice(2).map(Number)
if ([x, y, width, height].some(n => !Number.isFinite(n))) {
  console.error('usage: read-region.ts X Y WIDTH HEIGHT'); process.exit(2)
}
for (const line of readTextLines({ x, y, width, height })) console.log(`${line.y} ${line.text}`)
