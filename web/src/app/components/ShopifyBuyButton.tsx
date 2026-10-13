'use client'

import { useEffect, useRef, useState } from 'react'
import { ArrowRight } from 'lucide-react'

// Shopify Buy Button (storefront SDK). The storefront token is a public,
// read-only key meant to ship in client code.
const SDK_URL = 'https://sdks.shopifycdn.com/buy-button/latest/buy-button-storefront.min.js'
const SHOP_DOMAIN = '8kjjz9-ei.myshopify.com'
const STOREFRONT_TOKEN = 'ce77cfb8601f2c938066390f0fe3e51e'
const PRODUCT_ID = '11224254382422'

type ShopifyBuyGlobal = {
  buildClient: (config: { domain: string; storefrontAccessToken: string }) => unknown
  UI: { onReady: (client: unknown) => Promise<{ createComponent: (type: string, config: Record<string, unknown>) => Promise<unknown> }> }
}

declare global {
  interface Window { ShopifyBuy?: ShopifyBuyGlobal }
}

let sdkPromise: Promise<ShopifyBuyGlobal> | null = null

function loadSdk() {
  if (window.ShopifyBuy?.UI) return Promise.resolve(window.ShopifyBuy)
  sdkPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.async = true
    script.src = SDK_URL
    script.onload = () => (window.ShopifyBuy ? resolve(window.ShopifyBuy) : reject(new Error('Shopify Buy SDK missing')))
    script.onerror = () => { sdkPromise = null; reject(new Error('Shopify Buy SDK failed to load')) }
    document.head.appendChild(script)
  })
  return sdkPromise
}

const buttonStyles = {
  'background-color': '#f20789',
  'font-family': 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  'font-size': '13px',
  'font-weight': '700',
  'padding-top': '18px',
  'padding-bottom': '18px',
  'border-radius': '0',
  width: '100%',
  ':hover': { 'background-color': '#b10362' },
  ':focus': { 'background-color': '#b10362' },
}

export default function ShopifyBuyButton({ label, fallbackUrl }: { label: string; fallbackUrl: string }) {
  const nodeRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const node = nodeRef.current
    if (!node) return
    let cancelled = false

    // Swap out the fallback link as soon as Shopify's button iframe appears.
    const observer = new MutationObserver(() => { if (node.querySelector('iframe')) setReady(true) })
    observer.observe(node, { childList: true, subtree: true })

    loadSdk()
      .then((ShopifyBuy) => {
        // Guards React strict-mode double effects and remounts.
        if (cancelled || node.childElementCount > 0) return
        const client = ShopifyBuy.buildClient({ domain: SHOP_DOMAIN, storefrontAccessToken: STOREFRONT_TOKEN })
        return ShopifyBuy.UI.onReady(client).then((ui) => {
          if (cancelled || node.childElementCount > 0) return
          return ui.createComponent('product', {
            id: PRODUCT_ID,
            node,
            moneyFormat: '%24%7B%7Bamount%7D%7D',
            options: {
              product: {
                buttonDestination: 'checkout',
                width: '100%',
                contents: { img: false, imgWithCarousel: false, title: false, variantTitle: false, price: false, options: false, description: false, button: true },
                text: { button: label },
                styles: {
                  product: { 'max-width': '100%', 'margin-left': '0', 'margin-bottom': '0', 'text-align': 'left', '@media (min-width: 601px)': { 'max-width': '100%', 'margin-left': '0', 'margin-bottom': '0' } },
                  button: buttonStyles,
                },
              },
              cart: { styles: { button: buttonStyles }, text: { total: 'Subtotal', button: 'Checkout' } },
              toggle: { styles: { toggle: { 'background-color': '#f20789', ':hover': { 'background-color': '#b10362' }, ':focus': { 'background-color': '#b10362' } } } },
            },
          })
        })
      })
      .catch(() => { /* keep the fallback link visible */ })

    return () => { cancelled = true; observer.disconnect() }
  }, [label])

  return (
    <div className="shopify-buy">
      <div ref={nodeRef} />
      {!ready && (
        <a className="button button-primary" href={fallbackUrl} target="_blank" rel="noreferrer">
          {label} <ArrowRight size={17} />
        </a>
      )}
    </div>
  )
}
