// 列表分页局部刷新：拦截 .post-navigation 的上一页/下一页链接，
// fetch 目标页后只替换文章列表与分页条，URL 用 pushState 同步；
// 浏览器前进/后退走 popstate 同样局部替换；任何异常降级为整页跳转。
(() => {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
  let controller = null

  const bindNavLinks = () => {
    document.querySelectorAll('.post-navigation a').forEach(link => {
      if (link.dataset.paginationBound) return
      link.dataset.paginationBound = '1'
      link.addEventListener('click', event => {
        // 仅拦截普通左键点击，修饰键/中键点击保留浏览器默认行为
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
        event.preventDefault()
        loadPage(link.href, true)
      })
    })
  }

  const loadPage = async (url, push) => {
    const nav = document.querySelector('.post-navigation')
    const list = nav ? nav.closest('.container').querySelector('.post-list') : null
    if (!nav || !list) {
      window.location.href = url
      return
    }

    if (controller) controller.abort()
    controller = new AbortController()

    nav.classList.add('is-loading')
    list.classList.add('is-loading')

    try {
      const response = await fetch(url, { signal: controller.signal })
      if (!response.ok) throw new Error('page-fetch')
      const doc = new DOMParser().parseFromString(await response.text(), 'text/html')
      const newList = doc.querySelector('.post-list')
      const newNav = doc.querySelector('.post-navigation')
      if (!newList) throw new Error('page-parse')

      list.replaceWith(newList)
      nav.replaceWith(newNav || document.createComment(''))
      if (doc.title) document.title = doc.title
      if (push) history.pushState({ paginated: true }, '', url)
      bindNavLinks()
      // 新节点插入 DOM 时会自动重放列表错落入场动画
      newList.scrollIntoView({
        behavior: reduceMotion.matches ? 'auto' : 'smooth',
        block: 'start'
      })
    } catch (error) {
      if (error.name === 'AbortError') return
      window.location.href = url
    } finally {
      nav.classList.remove('is-loading')
      list.classList.remove('is-loading')
    }
  }

  window.addEventListener('popstate', () => {
    if (document.querySelector('.post-navigation')) {
      loadPage(window.location.href, false)
    }
  })

  bindNavLinks()
})()
