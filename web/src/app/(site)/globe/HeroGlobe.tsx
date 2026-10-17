'use client'

import dynamic from 'next/dynamic'

// The globe loads after the page is interactive, so the headline paints first. The placeholder holds the space.
const Globe = dynamic(() => import('./Globe'), {
  ssr: false,
  loading: () => <div className="globe globe-placeholder" aria-hidden="true" />,
})

export default function HeroGlobe() {
  return <Globe />
}
