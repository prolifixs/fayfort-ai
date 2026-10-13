import Image from 'next/image'
import Link from 'next/link'

export default function NotFound() {
  return (
    <main className="not-found">
      <div className="not-found-card">
        <Link href="/" aria-label="FAYFORT home"><Image src="/images/brand/fayfort-logo.png" alt="" width={57} height={60} priority /></Link>
        <p className="overline"><span /> Page not found</p>
        <h1>This page has moved, or it never existed.</h1>
        <p className="page-lede">Markets move too. Here is where to go instead.</p>
        <nav className="not-found-links" aria-label="Main pages">
          <Link className="button button-blue" href="/">FayFay and FAYFORT</Link>
          <Link className="text-button" href="/ebook/landed">LANDED, the directory</Link>
          <Link className="text-button" href="/services">Services</Link>
        </nav>
      </div>
    </main>
  )
}
