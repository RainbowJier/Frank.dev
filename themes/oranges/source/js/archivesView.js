// 归档页视图切换：按时间 / 按分组
// - localStorage 记忆用户上次选择
// - URL hash 直达：#time / #group
// - 切换时对目标列表重放错落入场动画
(() => {
  const container = document.querySelector('.container.archives')
  if (!container) return

  const views = Array.from(container.querySelectorAll('.archives-view'))
  const buttons = Array.from(container.querySelectorAll('.archives-switch-item'))
  const STORAGE_KEY = 'archives-view-mode'
  const MODES = ['time', 'group']

  const readStored = () => {
    try {
      return localStorage.getItem(STORAGE_KEY)
    } catch (error) {
      return null
    }
  }

  const apply = (mode, replay) => {
    if (!MODES.includes(mode)) mode = 'time'
    views.forEach(view => {
      const show = view.dataset.view === mode
      view.classList.toggle('hidden', !show)
      if (show && replay) {
        view.classList.remove('replay')
        void view.offsetWidth
        view.classList.add('replay')
      }
    })
    buttons.forEach(button => {
      const active = button.dataset.view === mode
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
  }

  buttons.forEach(button => {
    button.addEventListener('click', () => {
      if (button.classList.contains('active')) return
      const mode = button.dataset.view
      apply(mode, true)
      try {
        localStorage.setItem(STORAGE_KEY, mode)
      } catch (error) {
        /* 隐私模式下静默降级 */
      }
      const hash = '#' + mode
      if (location.hash !== hash) history.replaceState(null, '', hash)
    })
  })

  const hash = location.hash.slice(1)
  apply(MODES.includes(hash) ? hash : (readStored() || 'time'), false)
})()
