import type { Metadata } from 'next'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/config/contact'
import { PRICE_USD, PRICE_WAS_USD, formatPrice } from '../../ebook/landed/config'
import { PageHero, revealDelay } from '../components'

// The one offer: listed at the standard price, with the current launch price when a discount is running.
const price = PRICE_WAS_USD !== null
  ? <>{formatPrice(PRICE_WAS_USD)}<br /><small>currently {formatPrice(PRICE_USD)}</small></>
  : formatPrice(PRICE_USD)

export const metadata: Metadata = {
  title: 'Ebook and Directory Terms | LANDED',
  description: 'Licence, access and refund terms for LANDED and FaySource directory access.',
}

const email = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>

export default function EbookTermsPage() {
  return (
    <>
      <PageHero kicker="Legal" title="Ebook and Directory Terms" lede="Last updated: 15 August 2026" />
      <div className="shell prose-page legal">
        <article className="prose" data-reveal="fade" style={revealDelay(3)}>
          <p>These terms apply to our books and directory access — <strong>LANDED</strong>, and access to the <strong>FaySource</strong> directory. They apply alongside our <Link href="/terms">general Terms and Conditions</Link>. Where the two differ on anything to do with our books or directory, these terms apply.</p>

          <h2 id="licence">1. What you are buying</h2>
          <p><strong>You are buying a licence to use the material, not ownership of it.</strong></p>
          <p>All content — text, directory entries, compiled addresses, organisation and design — remains the property of FAYFORT International Trading and The Hard Way Press.</p>
          <p>Your licence is <strong>personal and non-transferable</strong>. It is issued to one named subscriber.</p>

          <h2 id="restrictions">2. What you may not do</h2>
          <p>You may not:</p>
          <ul>
            <li>Share, forward, resell, lend or otherwise make your access available to anyone else — <strong>including colleagues in the same business, who need their own access</strong></li>
            <li>Share your password or login credentials</li>
            <li>Reproduce, republish or redistribute the content, in whole or in part</li>
            <li>Copy or export the directory data into another list, database, spreadsheet or product</li>
            <li>Create derivative works from the content, including your own directory or guide built on ours</li>
            <li>Take and distribute screenshots or photographs of the material</li>
          </ul>
          <p><strong>Access is monitored.</strong> Shared or duplicated credentials will be withdrawn without refund.</p>

          <h2 id="what-you-get">3. What you get</h2>
          <p>LANDED is sold as <strong>one product at one price</strong>. There are no tiers and no subscription.</p>
          <div className="terms-table-wrap">
            <table className="terms-table">
              <thead><tr><th>Product</th><th>What it includes</th><th>Price</th></tr></thead>
              <tbody>
                <tr>
                  <td><strong>LANDED + FaySource Access</strong></td>
                  <td>The book as a downloadable PDF, plus live access to the market and factory, hotel, restaurant and services directories</td>
                  <td>{price}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>All prices are in <strong>US dollars</strong>. Our buyers are spread across several countries, so we quote in a single currency rather than converting.</p>
          <p>Payment is processed through Shopify’s checkout. We do not store your card details.</p>

          <h2 id="access">4. How live access is delivered</h2>
          <p>Live access is delivered as <strong>password-protected online views of the directory</strong>.</p>
          <ul>
            <li>The links and passwords are sent to the email address used at purchase</li>
            <li>If a password changes, the new one is sent to that same address</li>
            <li>You do not need an account with any third-party service to use it</li>
          </ul>
          <p><strong>Keep your purchase email address current.</strong> If we can’t reach you, we can’t send you a new password. Tell us at {email} if it changes.</p>

          <h2 id="updates">5. Updates</h2>
          <p>The directory is <strong>continuously updated</strong>. Entries are corrected, added and dated as markets change.</p>
          <p>We don’t promise a particular number of entries, a rate of additions, or that any specific category will be filled by a given date. Some categories are named in the book as not yet covered; those are listed honestly and are being worked on.</p>
          <p><strong>Your access includes the updates we publish to the directory.</strong> The downloadable book is a snapshot of the date it was issued.</p>

          <h2 id="refunds">6. Refunds</h2>
          <p><strong>Downloaded files are not refundable.</strong> Once a file has been downloaded, it cannot be returned, and no refund is given. This is normal for digital goods and it is the only workable position for a product that can be copied.</p>
          <p>Every purchase includes the book as an instant download, so <strong>a purchase is not refundable once the file has been downloaded</strong>.</p>
          <p><strong>No refund is given</strong> where access is withdrawn for breach of Section 2.</p>

          <h2 id="accuracy">7. Accuracy — please read this one</h2>
          <p>We compile this directory by walking the streets. We work hard to keep it accurate, and we are straightforward about where it isn’t.</p>
          <p><strong>Confirm before you travel.</strong> Every entry carries the date it was compiled. Markets move, stalls change hands, buildings are redeveloped and whole trades relocate across a city. Do not book a flight or commit money on the strength of an entry without checking it first.</p>
          <p><strong>Where something could not be confirmed, the entry says so.</strong> You will find addresses flagged as unconfirmed, and occasionally two candidate addresses where sources disagree. That is deliberate — a gap you can see is more useful than a number you can’t trust.</p>
          <p><strong>Listings are not endorsements.</strong> Inclusion means a place exists and is relevant to a category. It is not a recommendation, a guarantee of quality, or any assurance about the conduct, solvency or reliability of any business listed.</p>
          <p><strong>Verify your own suppliers.</strong> You remain responsible for checking any business before trading with it, for the quality and compliance of anything you order, and for meeting the legal and regulatory requirements of your own country.</p>
          <p><strong>This is not professional advice.</strong> Not legal, immigration, customs, tax or financial advice. Where regulatory processes are described, they are described to help you ask better questions of the people who can advise you properly.</p>
          <p><strong>No affiliation.</strong> This publication is independent. It is not affiliated with, endorsed by or connected to the China Import and Export Fair, the China Foreign Trade Centre, any government body, or any market or business named in it.</p>

          <h2 id="corrections">8. Corrections</h2>
          <p>If you go somewhere in the directory and find it moved, closed, renamed or nothing like the description — <strong>tell us</strong> at {email}.</p>
          <p>Say which entry, what you found, and roughly when you were there. It gets checked, logged and published, and the next reader doesn’t lose the morning you lost.</p>

          <h2 id="liability">9. Liability</h2>
          <p>To the fullest extent permitted by law, we accept no liability for loss or damage — financial, commercial, or arising from travel — caused by reliance on any information in the book or directory, whether that information was inaccurate, incomplete, or accurate when published and since changed.</p>
          <p>Our total liability in connection with your purchase is limited to the amount you paid for it.</p>
          <p>Nothing here excludes liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be excluded.</p>

          <h2 id="termination">10. Suspension and termination</h2>
          <p>We may suspend or withdraw access without refund where these terms are breached — in particular Section 2.</p>
          <p>We may retire the directory or change how access is delivered. If we do, we will either provide equivalent access or refund your purchase.</p>

          <h2 id="changes">11. Changes to prices and terms</h2>
          <p>Prices may change. A price change never affects a purchase you have already made.</p>
          <p>We may update these terms; the version published when you purchase is the version that applies to that purchase. Material changes will be dated at the top of this page.</p>

          <h2 id="contact">12. Contact</h2>
          <p>FAYFORT International · The Hard Way Press<br />{email}</p>
        </article>
      </div>
    </>
  )
}
