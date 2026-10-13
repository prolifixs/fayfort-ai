'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

declare global {
  interface Window { __revealStarted?: boolean }
}

// Runs before the page content is parsed: hides [data-reveal] elements until they are
// revealed, and un-hides everything if this component never starts (script failed).
export const REVEAL_BOOT_SCRIPT =
  "document.documentElement.classList.add('reveal-on');" +
  "setTimeout(function(){if(!window.__revealStarted)document.documentElement.classList.remove('reveal-on')},3000)"

// Adds .is-visible to each [data-reveal] element the first time it scrolls into view.
export default function RevealOnScroll() {
  const pathname = usePathname()

  useEffect(() => {
    window.__revealStarted = true
    const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-visible)'))
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduceMotion || !('IntersectionObserver' in window)) {
      targets.forEach((el) => el.classList.add('is-visible'))
      return
    }

    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      }
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0 })
    targets.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [pathname])

  return null
}
