import { describe, expect, it } from 'vitest'
import { isPublicSitePath, isStaticAsset } from '../src/proxy'
import { MEMBER_BOOT_SCRIPT } from '../src/consent/consent'
import { MEMBER_HOME_URL } from '../src/config/contact'

// UI facelift phase 1 (docs/UI_FACELIFT_PLAN.md): self-hosted brand fonts and the member link on the website.
describe('facelift phase 1', () => {
  it('serves the self-hosted fonts and the pages the header now links to', () => {
    expect(isStaticAsset('/fonts/fraunces-latin-opsz-normal.woff2')).toBe(true)
    expect(isStaticAsset('/fonts/inter-latin-wght-normal.woff2')).toBe(true)
    for (const path of ['/go/shop', '/go/finds', '/go/request', '/go/consultation', '/go/tour-guide']) expect(isPublicSitePath(path)).toBe(true)
  })

  it('shows members "My dashboard" from the ff_member cookie before the first paint', () => {
    const run = (cookie: string) => {
      const classes = new Set<string>()
      const doc = { cookie, documentElement: { classList: { add: (name: string) => classes.add(name) } } }
      new Function('document', MEMBER_BOOT_SCRIPT)(doc)
      return classes.has('is-member')
    }
    expect(run('ff_consent=m0.t1; ff_member=1')).toBe(true)
    expect(run('ff_member=1; ff_popup=1')).toBe(true)
    expect(run('ff_consent=m1.t1')).toBe(false)
    expect(run('not_ff_member=1')).toBe(false)
    expect(MEMBER_HOME_URL).toMatch(/^https:\/\/app\.fayfort\.com\/member\//)
  })
})
