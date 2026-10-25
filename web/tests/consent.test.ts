import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const nextConfig = require('../next.config.js')

// A tiny cookie jar standing in for the browser (the web tests run in node).
function fakeBrowser(hostname: string) {
  const jar = new Map<string, string>()
  const writes: string[] = []
  const events: string[] = []
  const reload = vi.fn()
  vi.stubGlobal('document', {
    get cookie() {
      return [...jar].map(([k, v]) => `${k}=${v}`).join('; ')
    },
    set cookie(value: string) {
      writes.push(value)
      const [pair, ...attrs] = value.split('; ')
      const [name, val] = pair.split('=')
      if (attrs.some((a) => a === 'max-age=0')) jar.delete(name)
      else jar.set(name, val)
    },
  })
  vi.stubGlobal('window', {
    location: { hostname, protocol: 'https:', reload },
    dispatchEvent: (event: Event) => events.push(event.type),
  })
  vi.stubGlobal('CustomEvent', class extends Event { detail: unknown; constructor(type: string, init?: { detail?: unknown }) { super(type); this.detail = init?.detail } })
  return { jar, writes, events, reload }
}

describe('cookie consent', () => {
  beforeEach(() => vi.resetModules())
  afterEach(() => vi.unstubAllGlobals())

  it('stores one choice for fayfort.com and app.fayfort.com', async () => {
    const browser = fakeBrowser('www.fayfort.com')
    const consent = await import('../src/consent/consent')
    expect(consent.readConsent()).toBeNull()
    consent.saveConsent(true)
    expect(consent.readConsent()?.marketing).toBe(true)
    expect(browser.writes[0]).toContain('domain=.fayfort.com')
    expect(browser.writes[0]).toContain('max-age=15552000')
    expect(browser.writes[0]).toContain('secure')
    expect(browser.events).toEqual(['ff-consent-change'])
  })

  it('switching marketing off removes the pixel cookies and reloads once', async () => {
    const browser = fakeBrowser('www.fayfort.com')
    const consent = await import('../src/consent/consent')
    consent.saveConsent(true)
    browser.jar.set('_fbp', 'fb.1.2')
    browser.jar.set('_ttp', 'abc')
    consent.saveConsent(false)
    expect(browser.jar.has('_fbp')).toBe(false)
    expect(browser.jar.has('_ttp')).toBe(false)
    expect(consent.readConsent()?.marketing).toBe(false)
    expect(browser.reload).toHaveBeenCalledTimes(1)
  })

  it('asks again after six months and ignores junk', async () => {
    const browser = fakeBrowser('localhost')
    const consent = await import('../src/consent/consent')
    browser.jar.set('ff_consent', `m1.t${Date.now() - 181 * 86400000}`)
    expect(consent.readConsent()).toBeNull()
    browser.jar.set('ff_consent', 'yes-please')
    expect(consent.readConsent()).toBeNull()
    consent.writeCookie('ff_member', '1', 365)
    expect(browser.writes.at(-1)).not.toContain('domain=')
    expect(consent.isMember()).toBe(true)
  })

  it('allows the Meta and TikTok pixel hosts and keeps the new pages public', async () => {
    const rules = await nextConfig.headers()
    const policy: string = rules[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy').value
    expect(policy).toContain('https://connect.facebook.net')
    expect(policy).toContain('https://analytics.tiktok.com')
    const { isPublicSitePath } = await import('../src/proxy')
    expect(isPublicSitePath('/cookies')).toBe(true)
    expect(isPublicSitePath('/newsletter')).toBe(true)
  })
})
