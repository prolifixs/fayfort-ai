import type { Metadata } from 'next'
import { GO_LINKS, getGoData, money } from '../data'
import { GoHeader, GoPageHead } from '../GoParts'

export const revalidate = 300
export const metadata: Metadata = {
  title: 'Book a consultation',
  description: 'A one-to-one video call with the FayFort team about suppliers, markets, trips and shipping from China.',
  alternates: { canonical: '/go/consultation' },
}

export default async function ConsultationPage() {
  const { consultation: c } = await getGoData()
  return (
    <>
      <GoHeader back />
      <GoPageHead
        kicker="Virtual consultation"
        title="Talk it through with someone who lives in China"
        lede="Bring your product idea, budget or trip plans. We tell you where to buy, what it should cost and how to ship it."
      />
      <section className="go-panel" aria-labelledby="go-consult-price">
        <h2 id="go-consult-price">Price by plan</h2>
        <dl className="go-prices">
          <div>
            <dt>Free plan</dt>
            <dd>{money(c.free, c.currency)}</dd>
          </div>
          <div>
            <dt>Standard plan</dt>
            <dd>{money(c.standard, c.currency)}</dd>
          </div>
          <div>
            <dt>Pro plan</dt>
            <dd>
              {c.pro_included} included a month
              <small>then {money(c.pro_after, c.currency)}</small>
            </dd>
          </div>
        </dl>
      </section>
      <section className="go-panel" aria-labelledby="go-consult-how">
        <h2 id="go-consult-how">How it works</h2>
        <ol className="go-steps">
          <li>
            <strong>Tell us what you need</strong>
            <span>A line or two is enough: the product, the market or the trip.</span>
          </li>
          <li>
            <strong>Pay the invoice</strong>
            <span>You get a secure payment link. Pro members skip this for their included call.</span>
          </li>
          <li>
            <strong>Agree a time in the chat</strong>
            <span>A FayFort specialist replies in your consultation chat to set the call.</span>
          </li>
        </ol>
      </section>
      <a className="go-cta" href={GO_LINKS.consultation}>
        Book a consultation
      </a>
      <p className="go-cta-note">Opens Tools in the FayFort app. Join free or sign in first.</p>
    </>
  )
}
