import type { Metadata } from 'next'
import Link from 'next/link'
import { SUPPORT_EMAIL } from '@/config/contact'
import { PageHero, revealDelay } from '../components'

export const metadata: Metadata = {
  title: 'Terms and Conditions | FAYFORT International Trading',
  description: 'Terms governing use of the FAYFORT website and our sourcing, inspection and shipping services.',
}

const email = <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>

export default function TermsPage() {
  return (
    <>
      <PageHero kicker="Legal" title="Terms and Conditions" lede="Last updated: 15 August 2026" />
      <div className="shell prose-page legal">
        <article className="prose" data-reveal="fade" style={revealDelay(3)}>
          <p>These terms govern your use of this website and any sourcing, inspection, consolidation or shipping services provided by FAYFORT International Trading.</p>
          <p>Separate terms apply to our book and directory access. See <Link href="/terms-ebooks">Ebook and Directory Terms</Link>.</p>

          <h2 id="who-we-are">1. Who we are</h2>
          <p>FAYFORT International Trading is the trading name of FAYFORT International.</p>
          <p>In these terms, “we”, “us” and “our” mean FAYFORT International Trading. “You” and “your” mean the person or business using our website or engaging our services.</p>
          <p>Contact: {email}</p>

          <h2 id="website">2. Using this website</h2>
          <p>The content on this website is provided for general information. We work to keep it accurate and current, but we don’t guarantee that it is complete, accurate or up to date at any given moment.</p>
          <p>Nothing on this website is an offer to sell, a price quotation, or professional advice. Prices, services and availability may change without notice.</p>
          <p>All content on this site — text, images, layout and the FAYFORT name — belongs to us or our licensors. You may not reproduce, republish or redistribute it commercially without our written permission.</p>

          <h2 id="what-we-are">3. What we do, and what we are</h2>
          <p><strong>We act on your instructions.</strong> We source, inspect, consolidate and arrange shipment of goods you choose to buy.</p>
          <p><strong>We are not the manufacturer.</strong> Goods are made by third-party factories and suppliers. We do not manufacture anything and we do not warrant the goods themselves.</p>
          <p><strong>We are not your customs broker, lawyer, or regulatory advisor.</strong> We will share what we know and tell you what to ask. Formal advice must come from qualified professionals and the relevant authorities in your own country.</p>
          <p><strong>Any contract for the goods may be between you and the supplier</strong>, depending on how a job is structured. We will tell you which arrangement applies before you commit.</p>

          <h2 id="payment">4. Quotations, commitment fees and payment</h2>
          <p><strong>Quotations are estimates</strong> until confirmed in writing, and are based on the information you give us. If your quantity, specification or destination changes, the price changes.</p>
          <p><strong>A commitment fee may be required</strong> before work begins. Where a commitment fee is charged, your quote will say whether it is deducted from your final invoice.</p>
          <p><strong>Supplier deposits.</strong> Chinese suppliers typically require a deposit before production — commonly around 30% of order value, occasionally more where materials are genuinely expensive. Deposits paid to suppliers are governed by that supplier’s terms, and may not be recoverable if you cancel.</p>
          <p><strong>Currency.</strong> Your quote states the currency of our fees. Where a supplier is paid in RMB, the applicable exchange rate is the rate at the time of payment, and we will tell you what it was.</p>
          <p><strong>Taxes and duties.</strong> Our prices exclude import duty, destination clearing charges, VAT and any other taxes or levies in your country. Those are yours.</p>
          <p><strong>Late payment.</strong> Goods and documents may be held until payment is received in full. Storage charges may apply to goods held at our facility beyond the period agreed in your quote.</p>

          <h2 id="your-responsibilities">5. Your responsibilities</h2>
          <p>You are responsible for:</p>
          <ul>
            <li><strong>Legality.</strong> Ensuring the goods you ask us to source may lawfully be imported into your country, and that you hold any licences or permits required.</li>
            <li><strong>Compliance and certification.</strong> Ensuring the goods meet the safety, labelling, electrical, certification and regulatory standards of your market. We can ask suppliers for test reports; we cannot guarantee your market will accept them.</li>
            <li><strong>Specification.</strong> Giving us accurate, complete specifications. We buy to the specification you give us.</li>
            <li><strong>Intellectual property.</strong> Ensuring that nothing you ask us to source infringes anyone’s trademark, design right, patent or copyright.</li>
            <li><strong>Your own checks.</strong> Satisfying yourself about any supplier before trading with them, whatever we report.</li>
          </ul>

          <h2 id="goods-we-wont-handle">6. Goods we will not handle</h2>
          <p>We will not source, inspect, consolidate or ship:</p>
          <ul>
            <li>Counterfeit goods, or goods bearing marks, shapes or branding that infringe a third party’s intellectual property</li>
            <li>Goods prohibited under Chinese export law or the import law of your destination country</li>
            <li>Dangerous, hazardous or restricted goods we are not licensed to handle</li>
            <li>Goods we reasonably believe are intended for an unlawful purpose</li>
          </ul>
          <p>If we discover after a job begins that goods fall into any of these categories, we may stop work immediately. Fees already incurred remain payable.</p>

          <h2 id="inspection">7. Inspection — what it does and doesn’t cover</h2>
          <p>Where we inspect goods, we check what is visible and what can reasonably be checked at that point: quantity, apparent condition, obvious defects, labelling, packing and conformity with the specification you gave us.</p>
          <p><strong>Inspection is a sample-based check at a moment in time.</strong> It is not a guarantee of the goods, a laboratory test, a certification, or a warranty of fitness for any purpose. Latent defects, component quality and performance over time cannot be established by visual inspection.</p>
          <p>Where we inspect a sample rather than every unit, the sample size is a matter of judgement and will be stated in the report.</p>

          <h2 id="shipping">8. Shipping, delivery and risk</h2>
          <p><strong>Transit times are estimates.</strong> Sea and air schedules, port congestion, customs inspection, weather and public holidays are outside our control.</p>
          <p><strong>Risk in the goods passes to you</strong> at the point agreed in your quote (the Incoterm stated there).</p>
          <p><strong>Insurance.</strong> Cargo insurance is included only where your quote says so. Unless cover has been arranged, goods travel uninsured.</p>
          <p><strong>Clearance at destination</strong> is your responsibility, including duty, clearing fees, demurrage and any storage charges arising at the destination port. We prepare documentation and can introduce you to clearing agents, but we cannot guarantee clearance or its cost.</p>
          <p><strong>Shortages, loss or damage.</strong> Any claim must be notified in writing promptly after delivery, and within any period stated in your quote, with photographs and the original packing documentation.</p>

          <h2 id="cancellation">9. Cancellation</h2>
          <p><strong>By you.</strong> You may cancel before production begins, subject to any supplier deposit already paid and any fees already incurred. Once a supplier has begun production, cancellation is a matter for that supplier’s terms.</p>
          <p><strong>By us.</strong> We may decline or stop a job where goods fall under Section 6, where payment is not made, where instructions are unlawful, or where we reasonably believe continuing would expose either of us to legal risk.</p>

          <h2 id="liability">10. Liability</h2>
          <p>Nothing in these terms excludes liability for death or personal injury caused by negligence, for fraud, or for anything else that cannot lawfully be excluded.</p>
          <p>Subject to that:</p>
          <ul>
            <li>We are not liable for the quality, safety, performance or fitness of goods manufactured by third parties</li>
            <li>We are not liable for loss of profit, loss of business, loss of contracts, or any indirect or consequential loss</li>
            <li>We are not liable for delays, seizures, refusals of entry or penalties imposed by customs or regulatory authorities in any country</li>
            <li>Our total liability in connection with any job is limited to the fees you paid us for that job</li>
          </ul>

          <h2 id="confidentiality">11. Confidentiality</h2>
          <p>We treat your product specifications, designs, supplier requirements and commercial information as confidential, and will not disclose them to third parties except as needed to carry out your instructions.</p>
          <p>We ask the same of you in respect of supplier details, pricing and other commercial information we share with you.</p>

          <h2 id="data">12. Data protection</h2>
          <p>We collect and use personal data only to carry out your instructions and to communicate with you about them. We do not sell your data.</p>

          <h2 id="changes">13. Changes to these terms</h2>
          <p>We may update these terms. The version published on this page at the time you engage us is the version that applies to that job. Material changes will be dated at the top of this page.</p>

          <h2 id="contact">14. Contact</h2>
          <p>FAYFORT International<br />{email}</p>
        </article>
      </div>
    </>
  )
}
