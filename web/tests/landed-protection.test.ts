import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import { CHECKOUT_URL, PRICE_USD } from '../src/app/ebook/landed/config'
import { PUBLIC_SITE_PATHS, isPublicSitePath } from '../src/proxy'
import sitemap from '../src/app/sitemap'

// LANDED is a live product with real Shopify buyers. These values must only change on the
// owner's instruction, together with the Shopify store (docs/PLATFORM_CONSOLIDATION_PLAN.md).
const SHOP_DOMAIN = '8kjjz9-ei.myshopify.com'
const buyButton = readFileSync(new URL('../src/app/components/ShopifyBuyButton.tsx', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const nextConfig = require('../next.config.js')

async function csp(): Promise<string> {
  const rules = await nextConfig.headers()
  const header = rules[0].headers.find((h: { key: string }) => h.key === 'Content-Security-Policy')
  return header.value
}

describe('LANDED checkout protection', () => {
  it('keeps the Shopify Buy Button wiring unchanged', () => {
    expect(buyButton).toContain("const SDK_URL = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js'")
    expect(buyButton).toContain(`const SHOP_DOMAIN = '${SHOP_DOMAIN}'`)
    expect(buyButton).toContain("const STOREFRONT_TOKEN = 'ce77cfb8601f2c938066390f0fe3e51e'")
    expect(buyButton).toContain("const PRODUCT_ID = '11224254382422'")
    expect(buyButton).toContain("buttonDestination: 'checkout'")
    expect(buyButton).toContain('href={fallbackUrl}')
  })

  it('keeps the checkout link and price', () => {
    expect(CHECKOUT_URL).toBe(`https://${SHOP_DOMAIN}/products/landed`)
    expect(PRICE_USD).toBe(99)
  })

  it('allows every Shopify origin the button needs in the Content Security Policy', async () => {
    const policy = await csp()
    const directive = (name: string) => policy.split('; ').find((part) => part.startsWith(name + ' ')) ?? ''
    expect(directive('script-src')).toContain('https://sdks.shopifycdn.com')
    expect(directive('connect-src')).toContain(`https://${SHOP_DOMAIN}`)
    expect(directive('connect-src')).toContain('https://monorail-edge.shopifysvc.com')
    expect(directive('frame-src')).toContain(`https://${SHOP_DOMAIN}`)
    expect(directive('img-src')).toContain('https://cdn.shopify.com')
    expect(directive('form-action')).toContain(`https://${SHOP_DOMAIN}`)
  })

  it('keeps the LANDED page and the legal pages buyers rely on public and listed', () => {
    for (const path of ['/ebook/landed', '/terms-ebooks', '/terms']) {
      expect(PUBLIC_SITE_PATHS).toContain(path)
      expect(isPublicSitePath(path)).toBe(true)
    }
    expect(isPublicSitePath('/ebook/landed/anything')).toBe(true)
    expect(isPublicSitePath('/login')).toBe(false)
    const urls = sitemap().map((entry) => entry.url)
    expect(urls).toEqual(expect.arrayContaining([
      'https://www.fayfort.com/ebook/landed', 'https://www.fayfort.com/terms-ebooks', 'https://www.fayfort.com/terms',
    ]))
  })

  it('keeps the refund anchor that the LANDED page links to', () => {
    const terms = readFileSync(new URL('../src/app/(site)/terms-ebooks/page.tsx', import.meta.url), 'utf8')
    expect(terms).toMatch(/id=["']refunds["']/)
  })
})
