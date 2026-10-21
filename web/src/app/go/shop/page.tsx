import type { Metadata } from 'next'
import { GO_LINKS, getGoData, priceLine } from '../data'
import { GoHeader, GoPageHead } from '../GoParts'

export const revalidate = 300
export const metadata: Metadata = {
  title: 'Shop',
  description: 'Products sourced by FayFort in China: furniture, home, kids, phones and more.',
  alternates: { canonical: '/go/shop' },
}

export default async function ShopPage() {
  const { picks, categories, product_count } = await getGoData()
  return (
    <>
      <GoHeader back />
      <GoPageHead
        kicker="Shop"
        title="Sourced in China, checked by our team"
        lede={`${product_count ? `${product_count} products` : 'Products'} from the markets and factories we work with. Prices marked "From" are rough estimates; our team confirms yours.`}
      />
      {picks.length > 0 && (
        <>
          <h2 className="go-section-title">Popular picks</h2>
          <div className="go-grid">
            {picks.map((pick) => (
              <a key={pick.image_url} className="go-card" href={GO_LINKS.shop}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pick.image_url} alt="" loading="lazy" />
                <span>
                  <small>{pick.category}</small>
                  <strong>{pick.name}</strong>
                  <em>{priceLine(pick)}</em>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
      {categories.length > 0 && (
        <>
          <h2 className="go-section-title">Shop by category</h2>
          <div className="go-cats">
            {categories.map((category) => (
              <a key={category.key} className="go-cat" href={GO_LINKS.shopCategory(category.key)}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={category.image_url} alt="" loading="lazy" />
                <span>
                  <strong>{category.label}</strong>
                  <small>{category.count} items</small>
                </span>
              </a>
            ))}
          </div>
        </>
      )}
      <a className="go-cta" href={GO_LINKS.shop}>
        See all products
      </a>
      <p className="go-cta-note">Opens the FayFort app. Join free to save products and ask for prices.</p>
    </>
  )
}
