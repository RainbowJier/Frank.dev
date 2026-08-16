const catalog = document.querySelector('#catalog')
const tocElement = document.querySelector('.catalog-content')
const catalogButton = document.querySelector('#btn-catalog')

if (catalog && tocElement) {
  const isMobile = () => window.matchMedia('(max-width: 888px)').matches

  const updateCatalog = () => {
    if (isMobile()) {
      catalog.style.removeProperty('position')
      catalog.style.removeProperty('top')
      catalog.style.removeProperty('bottom')
        tocElement.style.removeProperty('height')
      return
    }

    catalog.style.removeProperty('position')
    catalog.style.removeProperty('top')
    catalog.style.removeProperty('bottom')
    tocElement.style.removeProperty('height')
  }

  const updateActiveHeading = () => {
    const headings = document.querySelectorAll('.headerlink')
    const links = document.querySelectorAll('.toc-link')
    if (!headings.length || !links.length) return

    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop
    let activeIndex = 0
    headings.forEach((heading, index) => {
      if (heading.offsetTop - 20 <= scrollTop) activeIndex = index
    })

    links.forEach((link, index) => {
      link.classList.toggle('active', index === activeIndex)
    })

    const activeLink = links[activeIndex]
    if (activeLink && !isMobile()) {
      tocElement.scrollTop = Math.max(0, activeLink.offsetTop - 32)
    }
  }

  const toggleCatalog = () => catalog.classList.toggle('hidden')

  updateCatalog()
  updateActiveHeading()
  window.addEventListener('resize', updateCatalog)
  document.addEventListener('scroll', updateActiveHeading, { passive: true })
  catalogButton && catalogButton.addEventListener('click', toggleCatalog)
}
