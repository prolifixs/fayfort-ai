const SHOPIFY_STORE = 'https://8kjjz9-ei.myshopify.com'
const CHAT_API = new URL(process.env.NEXT_PUBLIC_FAYFORT_API_URL || 'https://api.fayfort.com').origin
// Product and giveaway photos on fayfort.com/go are served from FayFort's public product-media storage.
const PRODUCT_MEDIA = 'https://lirauxdhnknfiqjnulxb.supabase.co'

// Allowlist of what the public pages load: the site itself, Shopify for LANDED and Instagram embeds. The old
// enterprise app's Supabase, Stripe and video hosts were dropped with it (owner decision D11).
// Next.js injects inline bootstrap scripts, so
// script-src needs 'unsafe-inline' until a nonce-based CSP is set up; dev mode
// also needs 'unsafe-eval' for fast refresh.
const contentSecurityPolicy = [
  "default-src 'self'",
  // Meta Pixel and TikTok Pixel load only after the visitor accepts marketing cookies (src/consent).
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://sdks.shopifycdn.com https://connect.facebook.net https://analytics.tiktok.com https://challenges.cloudflare.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://cdn.shopify.com ${PRODUCT_MEDIA} https://www.facebook.com`,
  "font-src 'self' data:",
  // FayFort AI chat help talks to the FayFort API from the browser.
  `connect-src 'self' ${SHOPIFY_STORE} https://monorail-edge.shopifysvc.com ${CHAT_API} https://challenges.cloudflare.com https://www.facebook.com https://connect.facebook.net https://analytics.tiktok.com https://*.tiktok.com https://*.tiktokw.us`,
  // Cloudflare Turnstile: the robot check on the careers application form.
  // Instagram's own player for the posts and reels on the home page (Control Center → Website).
  `frame-src ${SHOPIFY_STORE} https://www.instagram.com https://challenges.cloudflare.com`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  `form-action 'self' ${SHOPIFY_STORE}`,
  "frame-ancestors 'none'",
].join('; ')

const securityHeaders = [
  { key: 'Content-Security-Policy', value: contentSecurityPolicy },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  poweredByHeader: false,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
  // No remote image hosts: every image is in /public, so the optimizer fetches nothing external.
  images: { remotePatterns: [] },
  output: 'standalone',
  async redirects() {
    // FaySource is closed: anyone who reaches it goes back to the homepage (unchanged from the old site).
    const redirects = [
      { source: '/products/fay', destination: '/', permanent: false },
      { source: '/products/fay/:path*', destination: '/', permanent: false },
    ]
    // Retired enterprise URLs from the old site move to the FayFort AI app (plan Gate 7).
    // Enabled only once FAYFORT_APP_URL is set, e.g. https://app.fayfort.com.
    const app = process.env.FAYFORT_APP_URL?.replace(/\/$/, '')
    if (app) {
      redirects.push(
        { source: '/login', destination: `${app}/member/account`, permanent: false },
        { source: '/register', destination: `${app}/member/signup`, permanent: false },
        { source: '/dashboard/:path*', destination: `${app}/member/chat`, permanent: false },
        { source: '/catalog/:path*', destination: `${app}/member/products`, permanent: false },
        { source: '/request', destination: `${app}/member/products`, permanent: false },
      )
    }
    return redirects
  },
}

module.exports = nextConfig 