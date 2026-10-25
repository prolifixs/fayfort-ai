// Product settings for LANDED. Contact details live in src/config/contact.ts.

// One price, one tier: the book plus live directory access.
export const PRICE_USD = 99
// Shown struck through beside the price. Set to null to drop the discount display.
export const PRICE_WAS_USD: number | null = 150

// Shopify product page, used as the fallback link while the Shopify Buy Button loads.
export const CHECKOUT_URL = 'https://8kjjz9-ei.myshopify.com/products/landed'

export const formatPrice = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)

// The live directory moved from the Baserow tables to FayFort (owner request, 2026-10-25).
// LANDED buyers sign up with their purchase email and the directory addresses unlock for them.
export const BASEROW_CLOSES = '30 November 2026'
export const SNAPSHOT_DATE = '25 October 2026'
