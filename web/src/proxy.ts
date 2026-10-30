import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Only the public site is served from fayfort.com. Every other path returns the standard 404.
// Retired enterprise URLs (/login, /dashboard, ...) are redirected to the FayFort AI app in
// next.config.js once FAYFORT_APP_URL is set; redirects run before this proxy.
export const PUBLIC_SITE_PATHS = ['/', '/how-it-works', '/services', '/about-us', '/terms', '/terms-ebooks', '/ebook/landed', '/go', '/cookies', '/newsletter', '/careers']

// Link-in-bio pages (fayfort.com/go and its sub-pages).
export const GO_PAGES = ['/go/giveaway', '/go/shop', '/go/consultation', '/go/tour-guide', '/go/request', '/go/finds']

export const isPublicSitePath = (pathname: string) =>
  PUBLIC_SITE_PATHS.includes(pathname) || GO_PAGES.includes(pathname) || pathname.startsWith('/ebook/landed/') ||
  // Careers: a role page per open job and each candidate's private status link.
  /^\/careers\/(?:[a-z0-9-]{3,80}|status\/[A-Za-z0-9_-]{20,100})$/.test(pathname)

// Build output, public images, self-hosted fonts, and single-segment files in /public (favicon, robots.txt, sitemap.xml).
export const isStaticAsset = (pathname: string) =>
  pathname.startsWith('/_next/') || pathname.startsWith('/images/') || pathname.startsWith('/fonts/') || /^\/[^/]+\.[a-z0-9]+$/i.test(pathname)

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (isPublicSitePath(pathname) || isStaticAsset(pathname)) return NextResponse.next()
  // Rewriting to a path with no route renders the standard 404 page with a 404 status.
  return NextResponse.rewrite(new URL('/__closed', req.url))
}
