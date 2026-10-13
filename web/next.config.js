const SUPABASE_HOST = 'uxbakpeeqydatgvvdyaa.supabase.co'
const SHOPIFY_STORE = 'https://8kjjz9-ei.myshopify.com'

// Allowlist of what the pages load. Next.js injects inline bootstrap scripts, so
// script-src needs 'unsafe-inline' until a nonce-based CSP is set up; dev mode
// also needs 'unsafe-eval' for fast refresh.
const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''} https://sdks.shopifycdn.com https://js.stripe.com`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: https://cdn.shopify.com https://${SUPABASE_HOST} https://img.youtube.com https://i.vimeocdn.com`,
  "font-src 'self' data:",
  `connect-src 'self' ${SHOPIFY_STORE} https://monorail-edge.shopifysvc.com https://${SUPABASE_HOST} wss://${SUPABASE_HOST} https://api.stripe.com`,
  `frame-src ${SHOPIFY_STORE} https://js.stripe.com https://hooks.stripe.com https://www.youtube.com https://player.vimeo.com`,
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
  images: {
    // Exact hosts only: the image optimizer fetches whatever these patterns allow.
    remotePatterns: [
      { protocol: 'https', hostname: SUPABASE_HOST },
      { protocol: 'https', hostname: 'img.youtube.com' },
      { protocol: 'https', hostname: 'i.vimeocdn.com' },
    ],
  },
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