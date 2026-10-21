import type { Metadata } from 'next'
import { GO_LINKS } from '../data'
import { GoHeader, GoPageHead } from '../GoParts'

export const metadata: Metadata = {
  title: 'Find me a product',
  description: 'Send FayFort a photo, a link or a description and we find the product at the source in China.',
  alternates: { canonical: '/go/request' },
}

export default function RequestPage() {
  return (
    <>
      <GoHeader back />
      <GoPageHead
        kicker="Sourcing request"
        title="Saw it somewhere? We'll find it at the source"
        lede="Send a TikTok, an Instagram post, a shop link or just a photo. Our team in Guangzhou finds the factory and sends you a price."
      />
      <section className="go-panel" aria-labelledby="go-request-how">
        <h2 id="go-request-how">How it works</h2>
        <ol className="go-steps">
          <li>
            <strong>Send what you want</strong>
            <span>A link, a photo or a few words, plus how many you need.</span>
          </li>
          <li>
            <strong>We find it and quote you</strong>
            <span>We compare suppliers and send the best price with shipping.</span>
          </li>
          <li>
            <strong>Pay and track it</strong>
            <span>Follow your order from the factory to your door in the app.</span>
          </li>
        </ol>
      </section>
      <section className="go-panel" aria-labelledby="go-request-tips">
        <h2 id="go-request-tips">A good request has</h2>
        <ul className="go-chips">
          <li>A clear photo or link</li>
          <li>Size or colour</li>
          <li>Quantity</li>
          <li>Your budget</li>
          <li>Where it ships to</li>
        </ul>
      </section>
      <a className="go-cta" href={GO_LINKS.request}>
        Send a request
      </a>
      <a className="go-cta is-quiet" href={GO_LINKS.chat}>
        Or paste a link in the chat
      </a>
      <p className="go-cta-note">Opens the FayFort app. Joining is free.</p>
    </>
  )
}
