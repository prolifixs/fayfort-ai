// Precomputes the dotted land for the home page globe (docs/PUBLIC_SITE_REBUILD_PLAN.md section 5).
// Run once after changing the density: `node scripts/build-land-dots.mjs`. The page ships only the result,
// so no map library reaches visitors.
import { readFileSync, writeFileSync } from 'node:fs'
import { geoContains } from 'd3-geo'
import { feature } from 'topojson-client'

const STEP = 1.7 // degrees between rows; columns widen with latitude so dots stay evenly spaced on the sphere
const topology = JSON.parse(readFileSync(new URL('../node_modules/world-atlas/land-50m.json', import.meta.url), 'utf8'))
const land = feature(topology, topology.objects.land)

const dots = []
for (let lat = -56; lat <= 78; lat += STEP) {
  const step = STEP / Math.max(Math.cos((lat * Math.PI) / 180), 0.2)
  for (let lon = -180; lon < 180; lon += step) {
    if (geoContains(land, [lon, lat])) dots.push(Math.round(lon * 10) / 10, Math.round(lat * 10) / 10)
  }
}
const out = new URL('../src/app/(site)/globe/land-dots.json', import.meta.url)
writeFileSync(out, JSON.stringify(dots))
console.log(`${dots.length / 2} dots written to ${out.pathname}`)
