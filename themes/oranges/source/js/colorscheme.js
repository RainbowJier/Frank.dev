// colorscheme.js
let switchHandle = document.querySelector('#switch-color-scheme')
let themeIcon = document.querySelector('#theme-icon')
var html = document.documentElement

const applyMode = (colorMode) => {
    html.setAttribute('color-mode', colorMode)
    themeIcon.classList = colorMode === 'dark' ? 'iconfont icon-sun' : 'iconfont icon-moon'
    localStorage.setItem('color-mode', colorMode)
}

const switchMode = () => {
    const next = html.getAttribute('color-mode') === 'light' ? 'dark' : 'light'
    if (!document.startViewTransition) {
        applyMode(next)
        return
    }
    // 新配色沿对角线从左下角扫向右上角（动画定义在 base.css 的 html.theme-switching 段）。
    // 此效果为用户明确要求：不受 prefers-reduced-motion 抑制（用户系统关闭了动画效果）
    html.classList.add('theme-switching')
    const transition = document.startViewTransition(() => applyMode(next))
    transition.finished.finally(() => html.classList.remove('theme-switching'))
}

switchHandle.addEventListener('click', switchMode, false)

const currColorMode = localStorage.getItem('color-mode')
if (currColorMode === 'light') {
    themeIcon.classList = 'iconfont icon-moon'
} else {
    themeIcon.classList = 'iconfont icon-sun'
}
