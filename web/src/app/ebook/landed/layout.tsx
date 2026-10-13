import type { Metadata } from 'next'
import { CHECKOUT_URL, PRICE_USD } from './config'

const title = 'LANDED — The Guangzhou Sourcing Directory | Wholesale Markets and Factory Addresses'
const description = 'A working directory of Guangzhou’s wholesale markets and Guangdong’s factory towns. Addresses in English and Chinese, every entry dated, updated continuously. Written on the ground.'

export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, type: 'book', images: ['/images/landed/landed-front.jpg'] },
}

const offers = {
  '@type': 'Offer',
  price: PRICE_USD,
  priceCurrency: 'USD',
  availability: 'https://schema.org/InStock',
  url: CHECKOUT_URL,
}

const author = { '@type': 'Person', name: 'FayFay', worksFor: { '@type': 'Organization', name: 'FAYFORT International Trading' } }

const structuredData = [
  {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: 'LANDED',
    alternativeHeadline: 'The Guangzhou and Guangdong Sourcing Directory',
    author,
    publisher: { '@type': 'Organization', name: 'The Hard Way Press' },
    bookFormat: 'https://schema.org/EBook',
    numberOfPages: 66,
    inLanguage: 'en',
    image: '/images/landed/landed-front.jpg',
    description,
  },
  {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: 'LANDED — The Guangzhou Sourcing Directory',
    brand: { '@type': 'Brand', name: 'FAYFORT International Trading' },
    image: '/images/landed/landed-front.jpg',
    description,
    offers,
  },
]

export default function EbookLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Escape "<" so no value can close the script tag early. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }} />
      {children}
    </>
  )
}
