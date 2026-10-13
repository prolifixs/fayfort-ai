// Product settings for LANDED. Contact details live in src/config/contact.ts.

// One price, one tier: the book plus live directory access.
export const PRICE_USD = 99
// Shown struck through beside the price. Set to null to drop the discount display.
export const PRICE_WAS_USD: number | null = 150

// Shopify product page, used as the fallback link while the Shopify Buy Button loads.
export const CHECKOUT_URL = 'https://8kjjz9-ei.myshopify.com/products/landed'

export const formatPrice = (amount: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(amount)
