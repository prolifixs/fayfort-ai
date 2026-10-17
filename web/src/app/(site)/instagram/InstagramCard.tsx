'use client'

import { useEffect, useRef, useState } from 'react'
import { Instagram } from 'lucide-react'
import { embedUrl, postUrl, type InstagramPost } from './posts'

/** One post or reel in a FAYFORT frame. Instagram's player loads only when the card comes near the screen. */
export default function InstagramCard({ post }: { post: InstagramPost }) {
  const ref = useRef<HTMLElement | null>(null)
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!('IntersectionObserver' in window)) return setNear(true)
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNear(true)
        observer.disconnect()
      }
    }, { rootMargin: '300px' })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <article ref={ref} className={post.kind === 'reel' ? 'ig-card is-reel' : 'ig-card'}>
      <div className="ig-frame">
        {near ? (
          <iframe
            src={embedUrl(post)}
            title={post.label ? `Instagram: ${post.label}` : 'FAYFORT on Instagram'}
            loading="lazy"
            allow="encrypted-media; picture-in-picture"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="ig-placeholder" aria-hidden="true"><Instagram size={28} /></div>
        )}
      </div>
      <a className="ig-caption" href={postUrl(post)} target="_blank" rel="noreferrer">
        <span>{post.label || (post.kind === 'reel' ? 'Watch the reel' : 'See the post')}</span>
        <Instagram size={15} aria-hidden="true" />
      </a>
    </article>
  )
}
