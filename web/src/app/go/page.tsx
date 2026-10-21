import Image from 'next/image'
import { FAYFAY_SOCIAL_HANDLE } from '@/config/contact'
import { PRICE_USD, PRICE_WAS_USD, formatPrice } from '../ebook/landed/config'
import { Countdown } from './Countdown'
import { getGoData, money } from './data'
import { GoHeader, ICONS, RouteStrip, SocialLinks, Ticket } from './GoParts'

export const revalidate = 300

export default async function GoPage() {
  const data = await getGoData()
  const { giveaway, picks, consultation } = data
  return (
    <>
      <GoHeader />
      <section className="go-hero">
        <div className="go-founder">
          <Image src="/images/landed/fayfay.jpg" alt="FayFay" width={88} height={88} priority />
          <span>
            <strong>FayFay</strong>
            <small>Founder, based in Guangzhou</small>
            <a href={`https://instagram.com/${FAYFAY_SOCIAL_HANDLE}`} target="_blank" rel="noreferrer">
              @{FAYFAY_SOCIAL_HANDLE}
            </a>
          </span>
        </div>
        <h1>Buy from China without the guesswork.</h1>
        <p className="go-lede">Products we source, people on the ground and straight answers. Pick where you want to go.</p>
        <RouteStrip />
      </section>

      <nav className="go-tickets" aria-label="FayFort links">
        {giveaway && (
          <Ticket
            href="/go/giveaway"
            tone="pink"
            icon={ICONS.gift}
            title={giveaway.title}
            line={giveaway.prize_text ? `Win ${giveaway.prize_text}` : 'Enter for free'}
            stubLabel="Ends in"
            stub={<Countdown endsAt={giveaway.ends_at} />}
          />
        )}
        <Ticket
          href="/ebook/landed"
          external
          variant="book"
          icon={<Image src="/images/landed/landed-front.jpg" alt="" width={66} height={99} />}
          title="LANDED, by FayFay"
          line="The Guangzhou sourcing directory: how buying in China really works, plus live supplier contacts."
          stubLabel="Ebook"
          stub={
            <>
              {PRICE_WAS_USD && <s>{formatPrice(PRICE_WAS_USD)}</s>}
              {formatPrice(PRICE_USD)}
            </>
          }
        />
        <Ticket
          href="/go/shop"
          icon={ICONS.bag}
          title="Shop products from China"
          line={data.product_count ? `${data.product_count} items, from furniture to phones` : 'Furniture, home, kids, phones and more'}
        >
          {picks.length > 0 && (
            <span className="go-thumbs" aria-hidden="true">
              {picks.slice(0, 4).map((pick) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img key={pick.image_url} src={pick.image_url} alt="" loading="lazy" />
              ))}
            </span>
          )}
        </Ticket>
        <Ticket
          href="/go/request"
          icon={ICONS.search}
          title="Find me a product"
          line="Send a photo, a link or a description. We find it at the source."
          stubLabel="To start"
          stub="Free"
        />
        <Ticket
          href="/go/consultation"
          icon={ICONS.video}
          title="Book a consultation"
          line="One-to-one video call with the FayFort team."
          stubLabel="From"
          stub={money(Math.min(consultation.standard, consultation.free), consultation.currency)}
        />
        <Ticket
          href="/go/tour-guide"
          icon={ICONS.pin}
          title="Tour guide in China"
          line="Someone from our team meets you in Guangzhou, Yiwu, Shenzhen or Shanghai."
          stubLabel="Price"
          stub="Quoted"
        />
      </nav>

      <SocialLinks />
    </>
  )
}
