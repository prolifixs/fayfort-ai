import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const trackerPath = resolve(here, '../LAYER7_COMPLETION_TRACKER.md');
const tracker = readFileSync(trackerPath, 'utf8');
const required = tracker.split('### P0 — Required before Layer 7 publication')[1]?.split('### P2 — Track for Layer 8')[0];
if (!required) {
  console.error('Layer 7 release blocked: P0/P1 sections could not be read from the completion tracker.');
  process.exit(2);
}
const open = [...required.matchAll(/- \[ \] \*\*(L7-\d+)/g)].map(match => match[1]);
if (open.length) {
  console.error(`Layer 7 release blocked: ${open.length} required task(s) remain open:`);
  for (const id of open) console.error(`- ${id}`);
  process.exit(1);
}
console.log('Layer 7 P0/P1 completion gate passed.');
