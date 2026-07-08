import Lenis from 'lenis'
import { updateScroll } from './three-scene.js'

export function init() {
  const lenis = new Lenis({
    duration: 1.2,
    smoothWheel: true,
    content: document.querySelector('.lenis-content'),
  })

  lenis.on('scroll', () => updateScroll(lenis.progress))

  function raf(time) { lenis.raf(time); requestAnimationFrame(raf) }
  requestAnimationFrame(raf)
}
