import { ArrowRight } from 'lucide-react'
import { FAYFORT_INSTAGRAM } from '@/config/contact'
import InstagramCard from './InstagramCard'
import { getInstagramPosts } from './posts'

/** "From the market floor": the posts and reels staff picked in Control Center → Website. Hidden when there are none. */
export default async function InstagramRail() {
  const posts = await getInstagramPosts()
  if (!posts.length) return null
  return (
    <section className="ig-section" aria-labelledby="ig-title"><div className="shell section-space">
      <div className="section-head" data-reveal>
        <p className="overline"><span /> From the market floor</p>
        <h2 id="ig-title">Real buys, real inspections, <em>real shipments.</em></h2>
        <p className="section-lede">Straight from our Instagram: markets we walk, goods we check and containers we load.</p>
      </div>
      <div className="ig-rail" role="list">
        {posts.map((post) => <div role="listitem" key={post.id}><InstagramCard post={post} /></div>)}
      </div>
      <a className="text-button ig-follow" href={`https://instagram.com/${FAYFORT_INSTAGRAM}`} target="_blank" rel="noreferrer">
        Follow @{FAYFORT_INSTAGRAM} <ArrowRight size={15} />
      </a>
    </div></section>
  )
}
