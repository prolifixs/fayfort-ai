import type { MetadataRoute } from 'next'

const SITE = 'https://www.fayfort.com'

// Public pages only; the enterprise app is closed (see src/middleware.ts).
export default function sitemap(): MetadataRoute.Sitemap {
  const pages: [string, number][] = [
    ['/', 1],
    ['/ebook/landed', 0.9],
    ['/services', 0.8],
    ['/about-us', 0.7],
    ['/terms', 0.3],
    ['/terms-ebooks', 0.3],
  ]
  return pages.map(([path, priority]) => ({ url: `${SITE}${path}`, changeFrequency: 'monthly', priority }))
}
