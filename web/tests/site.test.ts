import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { greatCircle, project } from '../src/app/(site)/globe/geo'
import { ORIGIN, ROUTES } from '../src/app/(site)/globe/routes'
import { embedUrl } from '../src/app/(site)/instagram/posts'
import { FAQ } from '../src/app/(site)/faq'
import { PUBLIC_SITE_PATHS } from '../src/proxy'
import sitemap from '../src/app/sitemap'

const require = createRequire(import.meta.url)
const nextConfig = require('../next.config.js')

describe('globe maths', () => {
  it('shows the centre of the view and hides the far side', () => {
    const view = { lon: 50, lat: 10 }
    const centre = project(50, 10, view)
    expect(centre.visible).toBe(true)
    expect(Math.abs(centre.x)).toBeLessThan(1e-9)
    expect(centre.depth).toBeCloseTo(1)
    expect(project(-130, -10, view).visible).toBe(false)
    expect(project(110, 10, view).x).toBeGreaterThan(0) // east is to the right
  })

  it('draws a route that starts in Guangzhou, ends at the city and rises in the middle', () => {
    const lagos = ROUTES[0].to
    const points = greatCircle(ORIGIN, lagos, 40, 0.1)
    expect(points[0].lon).toBeCloseTo(ORIGIN.lon, 4)
    expect(points[40].lat).toBeCloseTo(lagos.lat, 4)
    expect(points[20].altitude).toBeCloseTo(1.1, 4)
    expect(points[0].altitude).toBeCloseTo(1, 4)
  })
})

describe('public site', () => {
  it('serves and lists the new How it works page', () => {
    expect(PUBLIC_SITE_PATHS).toContain('/how-it-works')
    expect(sitemap().map((e) => e.url)).toContain('https://www.fayfort.com/how-it-works')
  })

  it('allows Instagram frames without dropping Shopify', async () => {
    const rules = await nextConfig.headers()
    const csp = rules[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value as string
    const frame = csp.split('; ').find((part) => part.startsWith('frame-src ')) ?? ''
    expect(frame).toContain('https://www.instagram.com')
    expect(frame).toContain('https://8kjjz9-ei.myshopify.com')
    expect(embedUrl({ kind: 'reel', shortcode: 'ABC123' })).toBe('https://www.instagram.com/reel/ABC123/embed/')
  })

  it('shows no plan prices on the public site (owner decision 6)', () => {
    const text = FAQ.flat().join(' ')
    expect(text).not.toMatch(/\$\s?\d/)
    expect(text).not.toMatch(/\d+\s?%/)
  })
})

describe('FayFort AI chat help', () => {
  const { readFileSync } = require('node:fs') as typeof import('node:fs')
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8')

  it('is on every site-layout page but not on LANDED', () => {
    expect(read('../src/app/(site)/layout.tsx')).toContain('<SiteChat />')
    expect(read('../src/app/ebook/landed/page.tsx')).not.toContain('SiteChat')
  })

  it('may call the FayFort API from the browser', async () => {
    const headers = await nextConfig.headers()
    const csp = headers[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value as string
    expect(csp).toMatch(/connect-src [^;]*https:\/\/api\.fayfort\.com/)
  })

  it('offers the agreed starters and keeps the visitor token out of the address', () => {
    const source = read('../src/app/(site)/chat/SiteChat.tsx')
    expect(source).toContain("'Talk to a person'")
    expect(source).toContain("'X-Visitor-Token'")
    expect(source).not.toMatch(/\?visitor_token|visitor_token=/)
    expect(source).toContain('(min-width: 1024px) and (hover: hover)') // welcome bubble on desktop only
  })
})

describe('fayfort.com/go link-in-bio pages', () => {
  it('are public pages, every other path stays closed', async () => {
    const { isPublicSitePath } = await import('../src/proxy')
    for (const path of ['/go', '/go/giveaway', '/go/shop', '/go/consultation', '/go/tour-guide', '/go/request']) expect(isPublicSitePath(path)).toBe(true)
    expect(isPublicSitePath('/go/anything-else')).toBe(false)
  })
})
