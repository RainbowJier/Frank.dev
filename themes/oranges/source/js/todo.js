// Todo 页：本地待办清单
// - 支持按项目归类：录入时可选填项目，列表按项目分组树形展示（分组可折叠、状态记忆），工具栏按项目筛选
// - 数据层双层结构：localStorage 永远作镜像缓存；Chrome/Edge 桌面版可再关联磁盘 todo.json
//   （File System Access API），句柄存 IndexedDB，改动自动写入文件，重启后按 updatedAt 新者胜出对账
// - 不支持文件 API 的浏览器只走 localStorage，功能不受影响；隐私模式静默降级
// - 动效：全页统一 WAAPI 驱动（按压脉冲、行入场、打勾弹跳、计数脉冲、弹层弹入、tips/编辑器滑入、
//   删除离场折叠、分组展开收起）。CSS transition/animation 在浏览器开启“减少动态”时会被强制压成瞬时，
//   WAAPI 不受影响；这些动效为用户点名要的可见效果，故不随 prefers-reduced-motion 关闭
(() => {
  const root = document.querySelector('.todo-index')
  if (!root) return

  const STORAGE_KEY = 'todo-items'
  const COLLAPSED_KEY = 'todo-collapsed'
  const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }
  const GROUP_ANIM_MS = 240
  const PROJECT_NONE = '__none__' // 项目筛选下拉里「未分类」的哨兵值
  const FILE_DB = 'todo-storage'
  const FILE_STORE = 'handles'
  const FILE_HANDLE_KEY = 'todo-file'
  const fileApi = 'showSaveFilePicker' in window

  const form = root.querySelector('#todo-form')
  const inputEl = root.querySelector('#todo-input')
  const projectEl = root.querySelector('#todo-project')
  const dateEl = root.querySelector('#todo-date')
  const priorityEl = root.querySelector('#todo-priority')
  const projectOptionsEl = root.querySelector('#todo-project-options')
  const listEl = root.querySelector('#todo-list')
  const emptyEl = root.querySelector('#todo-empty')
  const switchEl = root.querySelector('#todo-switch')
  const projectFilterEl = root.querySelector('#todo-project-filter')
  const clearDoneEl = root.querySelector('#todo-clear-done')
  const exportEl = root.querySelector('#todo-export')
  const importTriggerEl = root.querySelector('#todo-import-trigger')
  const importEl = root.querySelector('#todo-import')
  const linkFileEl = root.querySelector('#todo-link-file')
  const storageEl = root.querySelector('#todo-storage')
  const tipsEl = root.querySelector('#todo-tips')

  let items = []
  let filter = 'all'
  let projectFilter = '' // '' = 全部；PROJECT_NONE = 未分类；其他 = 项目名
  let tipsTimer = null
  let storageWarned = false
  let removing = false
  let prevCounts = null
  let priorityDd = null
  let projectFilterDd = null
  let collapsedGroups = new Set() // 折叠的项目分组名（'' = 未分类），localStorage 持久化

  // 文件存储状态
  let fileHandle = null
  let fileReady = false

  const pad = value => String(value).padStart(2, '0')
  const todayStr = () => {
    const now = new Date()
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

  const showTips = message => {
    tipsEl.textContent = message
    tipsEl.hidden = false
    if (tipsEl.animate) {
      tipsEl.animate(
        [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'translateY(0px)' }
        ],
        { duration: 200, easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)' }
      )
    }
    clearTimeout(tipsTimer)
    tipsTimer = setTimeout(() => { tipsEl.hidden = true }, 3000)
  }

  // 单条数据白名单化，localStorage 读取与 JSON 导入共用，坏数据直接丢弃
  const normalize = raw => {
    if (!raw || typeof raw !== 'object' || typeof raw.title !== 'string') return null
    const title = raw.title.trim()
    if (!title) return null
    let deadline = ''
    if (typeof raw.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.deadline)) deadline = raw.deadline
    let project = ''
    if (typeof raw.project === 'string') project = raw.project.trim().slice(0, 30)
    // id 会被拼进选择器，白名单外的直接换新，避免注入
    const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : uid()
    return {
      id: id,
      title: title.slice(0, 200),
      project: project,
      done: raw.done === true,
      deadline: deadline,
      priority: PRIORITY_LABELS[raw.priority] ? raw.priority : 'medium',
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    }
  }

  // 日期框空值时“年/月/日”占位降为弱色（原生不响应 :placeholder-shown，切类配合 CSS）
  const syncDateEmpty = input => {
    input.classList.toggle('is-empty', !input.value)
  }

  const dueInfo = item => {
    if (!item.deadline) return null
    if (item.done) return { text: '截止 ' + item.deadline, overdue: false }
    const today = todayStr()
    if (item.deadline < today) return { text: '已逾期 · ' + item.deadline, overdue: true }
    if (item.deadline === today) return { text: '今天截止', overdue: false }
    return { text: '截止 ' + item.deadline, overdue: false }
  }

  // ---------- localStorage 镜像缓存层 ----------

  const load = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY))
      return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : []
    } catch (error) {
      return []
    }
  }

  const saveCache = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch (error) {
      /* 隐私模式静默降级：本次会话仍可正常操作 */
      if (!storageWarned) {
        storageWarned = true
        showTips('当前浏览器禁止本地存储，改动仅在本次会话内有效')
      }
    }
  }

  // 统一保存入口：镜像永远写缓存，文件可用时再落盘（失败自动降级回缓存）
  const save = () => {
    saveCache()
    if (fileReady && fileHandle) {
      writeFile(fileHandle).catch(error => {
        fileReady = false
        updateStorageStatus()
        showTips('写入磁盘文件失败，改动已暂存浏览器缓存')
      })
    }
  }

  // 折叠分组记忆：只可能是短字符串数组，坏数据整体丢弃
  const loadCollapsed = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(COLLAPSED_KEY))
      return new Set(Array.isArray(parsed) ? parsed.filter(name => typeof name === 'string' && name.length <= 30) : [])
    } catch (error) {
      return new Set()
    }
  }

  const saveCollapsed = () => {
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(collapsedGroups)))
    } catch (error) {
      /* 隐私模式静默降级：折叠状态仅本次会话有效 */
    }
  }

  // ---------- IndexedDB：持久化文件句柄 ----------

  const idbOpen = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(FILE_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(FILE_STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })

  const idbGet = key => idbOpen().then(db => new Promise((resolve, reject) => {
    const request = db.transaction(FILE_STORE, 'readonly').objectStore(FILE_STORE).get(key)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  }))

  const idbSet = (key, value) => idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite')
    tx.objectStore(FILE_STORE).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))

  const idbDelete = key => idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(FILE_STORE, 'readwrite')
    tx.objectStore(FILE_STORE).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  }))

  // ---------- 磁盘文件读写 ----------

  const readFile = handle => handle.getFile().then(file => file.text()).then(text => {
    if (!text.trim()) return []
    try {
      const parsed = JSON.parse(text)
      return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : null
    } catch (error) {
      return null // 内容损坏，调用方决定回写
    }
  })

  const writeFile = handle => handle.createWritable().then(writable =>
    writable.write(JSON.stringify(items, null, 2)).then(() => writable.close())
  )

  // 文件与缓存对账：整表级别取 updatedAt 新者胜出，个人待办够用
  const reconcileFile = () => readFile(fileHandle).then(fileItems => {
    if (!fileItems) return writeFile(fileHandle) // 文件损坏：以缓存为准回写
    const newest = list => list.reduce((max, item) => Math.max(max, item.updatedAt), 0)
    const fileNewest = newest(fileItems)
    const cacheNewest = newest(items)
    if (fileNewest > cacheNewest) {
      items = fileItems
      saveCache()
    } else if (cacheNewest > fileNewest) {
      return writeFile(fileHandle)
    }
  })

  // ---------- 项目 ----------

  const projectList = () => {
    const counts = new Map()
    items.forEach(item => {
      if (item.project) counts.set(item.project, (counts.get(item.project) || 0) + 1)
    })
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh'))
      .map(([name, count]) => ({ name, count }))
  }

  // 重建输入联想 datalist 与项目筛选下拉；当前项目已消失时回到「全部项目」
  const updateProjectOptions = () => {
    const projects = projectList()
    const hasNone = items.some(item => !item.project)

    projectOptionsEl.textContent = ''
    projects.forEach(project => {
      const option = el('option')
      option.value = project.name
      projectOptionsEl.appendChild(option)
    })

    const keep = projects.some(project => project.name === projectFilter)
      || (projectFilter === PROJECT_NONE && hasNone)
      || projectFilter === ''
    if (!keep) projectFilter = ''

    projectFilterEl.textContent = ''
    const all = el('option', null, '全部项目')
    all.value = ''
    projectFilterEl.appendChild(all)
    projects.forEach(project => {
      const option = el('option', null, project.name + '（' + project.count + '）')
      option.value = project.name
      projectFilterEl.appendChild(option)
    })
    if (hasNone) {
      const none = el('option', null, '未分类')
      none.value = PROJECT_NONE
      projectFilterEl.appendChild(none)
    }
    projectFilterEl.value = projectFilter
    if (projectFilterDd) projectFilterDd.sync()
  }

  const inProject = item => {
    if (!projectFilter) return true
    if (projectFilter === PROJECT_NONE) return !item.project
    return item.project === projectFilter
  }

  // ---------- 筛选与渲染 ----------

  const filtered = () => items.filter(item => {
    if (filter === 'active' && item.done) return false
    if (filter === 'done' && !item.done) return false
    return inProject(item)
  })

  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
  }

  // 按压反馈：页内所有按钮统一短促弹性脉冲（WAAPI；原因见文件头注释）
  const pulseButton = btn => {
    if (!btn.animate || btn.disabled) return
    btn.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(0.93)' },
        { transform: 'scale(1)' }
      ],
      { duration: 200, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
    )
  }
  root.addEventListener('click', event => {
    const btn = event.target.closest('button')
    if (btn) pulseButton(btn)
  })

  // ---------- 控件皮肤：原生 select / date 换成自定义下拉与日历 ----------
  // 原生控件保留为数据源（读写 value、监听 change 的逻辑全部不动），仅藏进皮肤内；
  // 无 JS 或脚本异常时原生控件照常显示，回退到上一节的 CSS 原生增强样式

  // 弹层统一注册全局点击关闭；编辑行销毁后的死实例在下次点击时顺带清理
  const popInstances = []
  document.addEventListener('pointerdown', event => {
    for (let i = popInstances.length - 1; i >= 0; i--) {
      const instance = popInstances[i]
      if (!instance.root.isConnected) {
        popInstances.splice(i, 1)
        continue
      }
      if (!instance.root.contains(event.target)) instance.close()
    }
  })

  const buildDropdown = (select, pill) => {
    const wrapper = el('div', 'todo-dd' + (pill ? ' pill' : ''))
    select.classList.add('todo-dd-native')
    select.parentNode.insertBefore(wrapper, select)
    wrapper.appendChild(select)

    const btn = el('button', 'todo-dd-btn')
    btn.type = 'button'
    btn.setAttribute('aria-haspopup', 'listbox')
    btn.setAttribute('aria-expanded', 'false')
    const label = el('span', 'todo-dd-label')
    const arrow = el('span', 'todo-dd-arrow')
    btn.append(label, arrow)
    const menu = el('ul', 'todo-dd-menu')
    menu.setAttribute('role', 'listbox')
    wrapper.append(btn, menu)

    let open = false
    const close = () => {
      if (!open) return
      open = false
      wrapper.classList.remove('open')
      btn.setAttribute('aria-expanded', 'false')
    }
    const renderMenu = () => {
      menu.textContent = ''
      Array.from(select.options).forEach(option => {
        const li = el('li', 'todo-dd-option', option.textContent)
        li.dataset.value = option.value
        li.tabIndex = -1
        li.setAttribute('role', 'option')
        li.setAttribute('aria-selected', String(option.value === select.value))
        if (option.value === select.value) li.classList.add('active')
        menu.appendChild(li)
      })
    }
    const cursorIndex = () => Array.prototype.findIndex.call(menu.children, li => li.classList.contains('cursor'))
    const moveCursor = index => {
      const options = menu.children
      if (!options.length) return
      index = Math.max(0, Math.min(index, options.length - 1))
      Array.prototype.forEach.call(options, (li, i) => li.classList.toggle('cursor', i === index))
      options[index].scrollIntoView({ block: 'nearest' })
      options[index].focus()
    }
    const openMenu = () => {
      open = true
      wrapper.classList.add('open')
      btn.setAttribute('aria-expanded', 'true')
      renderMenu()
      if (menu.animate) {
        menu.animate(
          [
            { opacity: 0, transform: 'translateY(-4px)' },
            { opacity: 1, transform: 'translateY(0px)' }
          ],
          { duration: 160, easing: 'ease' }
        )
      }
      const active = Array.prototype.findIndex.call(menu.children, li => li.classList.contains('active'))
      moveCursor(active === -1 ? 0 : active)
    }
    const choose = value => {
      select.value = value
      select.dispatchEvent(new Event('change', { bubbles: true }))
      sync()
      close()
      btn.focus()
    }
    const sync = () => {
      const option = select.options[select.selectedIndex]
      label.textContent = option ? option.textContent : ''
      if (open) renderMenu()
    }

    btn.addEventListener('click', () => (open ? close() : openMenu()))
    btn.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!open) openMenu()
      }
    })
    menu.addEventListener('click', event => {
      const li = event.target.closest('.todo-dd-option')
      if (li) choose(li.dataset.value)
    })
    menu.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        btn.focus()
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const current = cursorIndex()
        moveCursor((current === -1 ? 0 : current) + (event.key === 'ArrowDown' ? 1 : -1))
      } else if (event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        moveCursor(event.key === 'Home' ? 0 : menu.children.length - 1)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        const current = cursorIndex()
        if (current >= 0) choose(menu.children[current].dataset.value)
      } else if (event.key === 'Tab') {
        close()
      }
    })
    select.addEventListener('change', sync)
    popInstances.push({ root: wrapper, close })
    sync()
    return { sync }
  }

  const WEEK_LABELS = ['一', '二', '三', '四', '五', '六', '日']
  const formatDeadline = value => {
    const parts = value.split('-')
    const now = new Date()
    const text = Number(parts[1]) + '月' + Number(parts[2]) + '日'
    return Number(parts[0]) === now.getFullYear() ? text : parts[0] + '年' + text
  }

  const buildDatePicker = input => {
    const wrapper = el('div', 'todo-cal')
    input.classList.add('todo-dd-native')
    input.parentNode.insertBefore(wrapper, input)
    wrapper.appendChild(input)

    const btn = el('button', 'todo-cal-btn')
    btn.type = 'button'
    btn.setAttribute('aria-haspopup', 'dialog')
    btn.setAttribute('aria-expanded', 'false')
    const label = el('span', 'todo-cal-label')
    const icon = el('span', 'todo-cal-icon')
    btn.append(label, icon)

    const pop = el('div', 'todo-cal-pop')
    pop.setAttribute('role', 'dialog')
    pop.setAttribute('aria-label', '选择截止日期')
    const head = el('div', 'todo-cal-head')
    const prevBtn = el('button', 'todo-cal-nav', '‹')
    prevBtn.type = 'button'
    prevBtn.setAttribute('aria-label', '上一月')
    const title = el('span', 'todo-cal-title')
    const nextBtn = el('button', 'todo-cal-nav', '›')
    nextBtn.type = 'button'
    nextBtn.setAttribute('aria-label', '下一月')
    head.append(prevBtn, title, nextBtn)
    const week = el('div', 'todo-cal-week')
    WEEK_LABELS.forEach(day => week.appendChild(el('span', null, day)))
    const grid = el('div', 'todo-cal-grid')
    const foot = el('div', 'todo-cal-foot')
    const clearBtn = el('button', 'todo-cal-foot-btn', '清除')
    clearBtn.type = 'button'
    const todayBtn = el('button', 'todo-cal-foot-btn', '今天')
    todayBtn.type = 'button'
    foot.append(clearBtn, todayBtn)
    pop.append(head, week, grid, foot)
    wrapper.append(btn, pop)

    let open = false
    let view = { year: 0, month: 0 }

    const close = () => {
      if (!open) return
      open = false
      wrapper.classList.remove('open')
      btn.setAttribute('aria-expanded', 'false')
    }
    const setDate = value => {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      sync()
      close()
      btn.focus()
    }
    const renderGrid = () => {
      title.textContent = view.year + '年' + (view.month + 1) + '月'
      grid.textContent = ''
      const first = new Date(view.year, view.month, 1)
      const start = new Date(view.year, view.month, 1 - ((first.getDay() + 6) % 7))
      const today = todayStr()
      for (let i = 0; i < 42; i++) {
        const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)
        const key = date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
        const day = el('button', 'todo-cal-day', String(date.getDate()))
        day.type = 'button'
        day.dataset.date = key
        day.tabIndex = -1
        day.setAttribute('aria-label', key)
        if (date.getMonth() !== view.month) day.classList.add('muted')
        if (key === today) day.classList.add('today')
        if (key === input.value) day.classList.add('selected')
        grid.appendChild(day)
      }
    }
    const openPop = () => {
      const base = (input.value || todayStr()).split('-')
      view = { year: Number(base[0]), month: Number(base[1]) - 1 }
      renderGrid()
      open = true
      wrapper.classList.add('open')
      btn.setAttribute('aria-expanded', 'true')
      if (pop.animate) {
        pop.animate(
          [
            { opacity: 0, transform: 'translateY(-4px)' },
            { opacity: 1, transform: 'translateY(0px)' }
          ],
          { duration: 160, easing: 'ease' }
        )
      }
      const focusTarget = grid.querySelector('.selected') || grid.querySelector('.today')
      if (focusTarget) focusTarget.focus()
    }
    const shiftView = delta => {
      const date = new Date(view.year, view.month + delta, 1)
      view = { year: date.getFullYear(), month: date.getMonth() }
      renderGrid()
    }
    // 方向键在日期间移动，跨月自动翻页
    const stepFocus = delta => {
      const active = document.activeElement
      let key = active && active.dataset ? active.dataset.date : ''
      if (!key) key = input.value || todayStr()
      const parts = key.split('-')
      const next = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]) + delta)
      if (next.getMonth() !== view.month || next.getFullYear() !== view.year) {
        view = { year: next.getFullYear(), month: next.getMonth() }
        renderGrid()
      }
      const target = grid.querySelector('.todo-cal-day[data-date="' + next.getFullYear() + '-' + pad(next.getMonth() + 1) + '-' + pad(next.getDate()) + '"]')
      if (target) target.focus()
    }
    const sync = () => {
      label.textContent = input.value ? formatDeadline(input.value) : '截止日期'
    }

    btn.addEventListener('click', () => (open ? close() : openPop()))
    btn.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        if (!open) openPop()
      }
    })
    prevBtn.addEventListener('click', () => shiftView(-1))
    nextBtn.addEventListener('click', () => shiftView(1))
    todayBtn.addEventListener('click', () => setDate(todayStr()))
    clearBtn.addEventListener('click', () => setDate(''))
    grid.addEventListener('click', event => {
      const day = event.target.closest('.todo-cal-day')
      if (day) setDate(day.dataset.date)
    })
    pop.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        btn.focus()
      } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        event.preventDefault()
        stepFocus(event.key === 'ArrowLeft' ? -1 : -7)
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        event.preventDefault()
        stepFocus(event.key === 'ArrowRight' ? 1 : 7)
      }
    })
    input.addEventListener('change', sync)
    popInstances.push({ root: wrapper, close })
    sync()
    return { sync }
  }

  const rowById = id => listEl.querySelector('.todo-item[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]')

  const renderRow = item => {
    const li = el('li', 'todo-item')
    li.dataset.id = item.id
    if (item.done) li.classList.add('done')

    const check = el('input', 'todo-check')
    check.type = 'checkbox'
    check.checked = item.done
    check.setAttribute('aria-label', item.done ? '标记为未完成' : '标记为已完成')

    const main = el('div', 'todo-main')
    const title = el('span', 'todo-item-title', item.title)
    title.title = '双击编辑'
    main.appendChild(title)
    const meta = el('div', 'todo-meta')
    meta.appendChild(el('span', 'todo-badge todo-priority-' + item.priority, PRIORITY_LABELS[item.priority]))
    const due = dueInfo(item)
    if (due) {
      meta.appendChild(el('span', 'todo-due', due.text))
      if (due.overdue) li.classList.add('overdue')
    }
    main.appendChild(meta)

    const actions = el('div', 'todo-item-actions')
    const editBtn = el('button', 'todo-item-btn', '编辑')
    editBtn.type = 'button'
    editBtn.dataset.action = 'edit'
    const deleteBtn = el('button', 'todo-item-btn todo-item-delete', '删除')
    deleteBtn.type = 'button'
    deleteBtn.dataset.action = 'delete'
    actions.append(editBtn, deleteBtn)

    li.append(check, main, actions)
    return li
  }

  const pulse = span => {
    if (!span.animate) return
    span.animate(
      [
        { transform: 'scale(1)' },
        { transform: 'scale(1.35)' },
        { transform: 'scale(1)' }
      ],
      { duration: 300, easing: 'ease' }
    )
  }

  // 只更新计数、空态与批量按钮，不动列表（勾选/局部刷新时用）；页签计数跟随当前项目范围
  const syncChrome = () => {
    const scoped = items.filter(inProject)
    const activeCount = scoped.filter(item => !item.done).length
    const counts = { all: scoped.length, active: activeCount, done: scoped.length - activeCount }
    switchEl.querySelectorAll('[data-count]').forEach(span => {
      const key = span.dataset.count
      const value = String(counts[key])
      if (span.textContent !== value) {
        span.textContent = value
        if (prevCounts && prevCounts[key] !== counts[key]) pulse(span)
      }
    })
    prevCounts = counts
    clearDoneEl.disabled = !items.some(item => item.done)
    // 分组徽标跟随当前可见行数（勾选局部刷新不重渲染分组时也要跟上）
    listEl.querySelectorAll('.todo-group').forEach(group => {
      const badge = group.querySelector('.todo-group-count')
      if (!badge) return
      const value = String(group.querySelectorAll('.todo-item').length)
      if (badge.textContent !== value) badge.textContent = value
    })
    const visible = filtered()
    emptyEl.hidden = visible.length > 0
    listEl.hidden = visible.length === 0
    if (!visible.length) {
      emptyEl.textContent = !items.length
        ? '还没有待办事项，从上方输入框添加第一条吧。'
        : (filter === 'done' ? '还没有已完成的任务。' : '当前筛选范围内没有任务，换个条件试试。')
    }
  }

  // 分组树节点：分组头（箭头 + 项目名 + 计数）+ 子任务列表，折叠状态随 localStorage 记忆
  const renderGroup = (key, groupItems) => {
    const collapsed = collapsedGroups.has(key)
    const li = el('li', 'todo-group' + (collapsed ? ' collapsed' : ''))

    const head = el('button', 'todo-group-head')
    head.type = 'button'
    head.setAttribute('aria-expanded', String(!collapsed))
    const arrow = el('span', 'todo-group-arrow')
    const name = el('span', 'todo-group-name', key || '未分类')
    const count = el('span', 'todo-group-count', String(groupItems.length))
    head.append(arrow, name, count)

    const list = el('ul', 'todo-group-list')
    groupItems.forEach(item => list.appendChild(renderRow(item)))

    // 展开/收起用 WAAPI 驱动而非 CSS transition：浏览器开启“减少动态”时会把 CSS transition
    // 强制压成瞬时（观感即“一闪”），WAAPI 不受该强制影响；用户点名要这个动效，故不随开关关闭。
    // 状态（类/aria/存储）点击即落地，动画只负责视觉过渡：后台标签页动画被节流暂停也不至于悬空
    let animSeq = 0
    head.addEventListener('click', () => {
      const collapsing = !li.classList.contains('collapsed')
      const token = ++animSeq
      const commit = () => {
        li.classList.toggle('collapsed', collapsing)
        head.setAttribute('aria-expanded', String(!collapsing))
        if (collapsing) collapsedGroups.add(key)
        else collapsedGroups.delete(key)
        saveCollapsed()
      }
      if (!list.animate) {
        commit()
        return
      }
      list.getAnimations().forEach(anim => anim.cancel())
      list.style.overflow = 'hidden'
      // 收起方向：类已切换，靠 animating 暂时压过 display:none 让内容留在画面里参与动画
      list.classList.add('animating')
      commit()
      const height = list.offsetHeight
      if (arrow.animate) {
        arrow.animate(
          [
            { transform: collapsing ? 'rotate(45deg)' : 'rotate(-45deg)' },
            { transform: collapsing ? 'rotate(-45deg)' : 'rotate(45deg)' }
          ],
          { duration: GROUP_ANIM_MS, easing: 'ease' }
        )
      }
      const anim = list.animate(
        collapsing
          ? [{ height: height + 'px', opacity: 1 }, { height: '0px', opacity: 0 }]
          : [{ height: '0px', opacity: 0 }, { height: height + 'px', opacity: 1 }],
        {
          duration: GROUP_ANIM_MS,
          easing: collapsing ? 'cubic-bezier(0.4, 0, 0.2, 1)' : 'cubic-bezier(0.25, 0.8, 0.25, 1)',
          fill: collapsing ? 'forwards' : 'none'
        }
      )
      anim.finished.catch(() => {}).then(() => {
        if (token !== animSeq) return
        anim.cancel()
        list.classList.remove('animating')
        list.style.overflow = ''
      })
    })

    li.append(head, list)
    return li
  }

  // animate 为 true 时（首屏、切换页签/项目筛选、导入）对可见行做 stagger 入场
  const render = animate => {
    updateProjectOptions()
    listEl.textContent = ''
    const visible = filtered()

    // 按项目聚成分组；组间排序与项目筛选下拉一致（条数降序 + 拼音），「未分类」垫底
    const groups = new Map()
    visible.forEach(item => {
      const key = item.project || ''
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(item)
    })
    const order = projectList().map(project => project.name).filter(name => groups.has(name))
    if (groups.has('')) order.push('')
    order.forEach(key => listEl.appendChild(renderGroup(key, groups.get(key))))
    syncChrome()
    if (animate) enterAnimation(visible.map(item => item.id), true)
  }

  const applyFilter = next => {
    filter = next
    switchEl.querySelectorAll('.todo-switch-item').forEach(button => {
      const active = button.dataset.filter === filter
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    render(true)
  }

  // 新行入场：fade-up + stagger，仅在首屏/新增/切换筛选时调用，避免每次全量重渲染都闪
  const enterAnimation = (ids, stagger) => {
    ids.forEach((id, index) => {
      const li = rowById(id)
      if (!li || !li.animate) return
      li.animate(
        [
          { opacity: 0, transform: 'translateY(10px)' },
          { opacity: 1, transform: 'translateY(0px)' }
        ],
        {
          duration: 400,
          delay: stagger ? Math.min(index * 45, 360) : 0,
          easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)',
          fill: 'backwards'
        }
      )
    })
  }

  // 删除离场：折叠 + 右滑，结束后由调用方更新状态重渲染
  const animateOut = rows => {
    return Promise.all(rows.filter(Boolean).map((li, index) => {
      li.style.pointerEvents = 'none'
      // 行分属不同分组，间距从各自父级取（.todo-group-list）
      const gap = parseFloat(getComputedStyle(li.parentElement).gap) || 10
      const style = getComputedStyle(li)
      return li.animate(
        [
          { opacity: 1, height: li.offsetHeight + 'px', paddingTop: style.paddingTop, paddingBottom: style.paddingBottom, marginBottom: '0px' },
          { opacity: 0, height: '0px', paddingTop: '0px', paddingBottom: '0px', marginBottom: -gap + 'px', borderColor: 'transparent', transform: 'translateX(24px)' }
        ],
        { duration: 220, delay: index * 50, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' }
      ).finished.catch(() => {})
    }))
  }

  // 行内编辑：把该行切换为 标题输入 + 项目 + 日期 + 优先级 + 保存/取消
  const startEdit = li => {
    if (listEl.querySelector('.todo-item.editing')) return
    const item = items.find(entry => entry.id === li.dataset.id)
    if (!item) return
    li.classList.add('editing')

    const editor = el('div', 'todo-edit')
    const titleInput = el('input', 'todo-edit-input')
    titleInput.type = 'text'
    titleInput.maxLength = 200
    titleInput.value = item.title
    const projectInput = el('input', 'todo-edit-project')
    projectInput.type = 'text'
    projectInput.maxLength = 30
    projectInput.placeholder = '项目'
    projectInput.setAttribute('list', 'todo-project-options')
    projectInput.value = item.project
    const dateInput = el('input', 'todo-edit-date')
    dateInput.type = 'date'
    dateInput.value = item.deadline
    syncDateEmpty(dateInput)
    dateInput.addEventListener('input', () => syncDateEmpty(dateInput))
    const prioritySelect = el('select', 'todo-edit-priority')
    Object.keys(PRIORITY_LABELS).forEach(key => {
      const option = el('option', null, PRIORITY_LABELS[key])
      option.value = key
      prioritySelect.appendChild(option)
    })
    prioritySelect.value = item.priority
    const saveBtn = el('button', 'todo-item-btn todo-edit-save', '保存')
    saveBtn.type = 'button'
    const cancelBtn = el('button', 'todo-item-btn', '取消')
    cancelBtn.type = 'button'
    editor.append(titleInput, projectInput, dateInput, prioritySelect, saveBtn, cancelBtn)
    li.appendChild(editor)
    // 皮肤需在控件进入 DOM 后再包（insertBefore 依赖 parentNode）
    buildDatePicker(dateInput)
    buildDropdown(prioritySelect)
    if (editor.animate) {
      editor.animate(
        [
          { opacity: 0, transform: 'translateY(-6px)' },
          { opacity: 1, transform: 'translateY(0px)' }
        ],
        { duration: 200, easing: 'cubic-bezier(0.25, 0.8, 0.25, 1)' }
      )
    }
    titleInput.focus()
    titleInput.setSelectionRange(titleInput.value.length, titleInput.value.length)

    const commit = () => {
      const title = titleInput.value.trim()
      if (!title) {
        showTips('任务标题不能为空')
        titleInput.focus()
        return
      }
      item.title = title.slice(0, 200)
      item.project = projectInput.value.trim().slice(0, 30)
      item.deadline = dateInput.value
      item.priority = prioritySelect.value
      item.updatedAt = Date.now()
      save()
      render()
    }

    saveBtn.addEventListener('click', commit)
    cancelBtn.addEventListener('click', render)
    editor.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault()
        commit()
      } else if (event.key === 'Escape') {
        render()
      }
    })
  }

  // ---------- 文件关联（File System Access API） ----------

  const updateLinkButton = () => {
    linkFileEl.hidden = !fileApi
    linkFileEl.textContent = fileHandle ? '断开文件' : '关联文件'
  }

  const updateStorageStatus = () => {
    storageEl.textContent = ''
    if (!fileApi) {
      storageEl.textContent = '当前浏览器不支持文件读写，数据保存在浏览器本地；Chrome / Edge 桌面版可关联磁盘文件长期保存。'
      return
    }
    if (fileHandle && fileReady) {
      storageEl.textContent = '已关联磁盘文件「' + fileHandle.name + '」，改动自动写入；清除浏览器数据也不会丢。'
      return
    }
    if (fileHandle && !fileReady) {
      storageEl.appendChild(document.createTextNode('已关联磁盘文件「' + fileHandle.name + '」，本次会话尚未授权读写，改动暂存浏览器缓存。'))
      const btn = el('button', 'todo-storage-btn', '恢复读写')
      btn.type = 'button'
      btn.addEventListener('click', resumeFile)
      storageEl.appendChild(btn)
      return
    }
    storageEl.textContent = '数据保存在当前浏览器；点击「关联文件」可写入本地 todo.json 长期保存。'
  }

  const resumeFile = () => {
    if (!fileHandle) return
    fileHandle.requestPermission({ mode: 'readwrite' }).then(state => {
      if (state !== 'granted') {
        showTips('未获得文件授权，继续使用浏览器缓存')
        return
      }
      fileReady = true
      return reconcileFile().then(() => {
        render()
        updateStorageStatus()
        showTips('已恢复对「' + fileHandle.name + '」的读写')
      })
    }).catch(() => showTips('授权失败，继续使用浏览器缓存'))
  }

  linkFileEl.addEventListener('click', () => {
    if (!fileApi) return

    // 已关联：断开即可，localStorage 镜像仍在，数据不丢
    if (fileHandle) {
      fileHandle = null
      fileReady = false
      idbDelete(FILE_HANDLE_KEY).catch(() => {})
      updateLinkButton()
      updateStorageStatus()
      showTips('已断开磁盘文件，数据继续保存在当前浏览器')
      return
    }

    window.showSaveFilePicker({
      suggestedName: 'todo.json',
      types: [{ description: 'JSON 待办数据', accept: { 'application/json': ['.json'] } }]
    }).then(handle => {
      fileHandle = handle
      return readFile(handle).then(fileItems => {
        // 所选文件已有数据时让用户决定方向，避免误覆盖
        if (fileItems && fileItems.length
          && !window.confirm('所选文件里已有 ' + fileItems.length + ' 条任务。\n「确定」导入文件内容替换当前列表；「取消」保留当前列表并写入该文件')) {
          return writeFile(handle)
        }
        if (fileItems && fileItems.length) {
          items = fileItems
          saveCache()
          render()
        }
        return writeFile(handle)
      }).then(() => {
        fileReady = true
        return idbSet(FILE_HANDLE_KEY, fileHandle)
      }).then(() => {
        updateLinkButton()
        updateStorageStatus()
        showTips('已关联 ' + fileHandle.name + '，此后改动自动写入该文件')
      })
    }).catch(error => {
      fileHandle = null
      fileReady = false
      updateLinkButton()
      updateStorageStatus()
      if (error && error.name !== 'AbortError') showTips('关联文件失败：' + (error.message || error))
    })
  })

  // ---------- 事件 ----------

  form.addEventListener('submit', event => {
    event.preventDefault()
    const title = inputEl.value.trim()
    if (!title) {
      inputEl.focus()
      return
    }
    const now = Date.now()
    const added = {
      id: uid(),
      title: title.slice(0, 200),
      project: projectEl.value.trim().slice(0, 30),
      done: false,
      deadline: dateEl.value,
      priority: priorityEl.value,
      createdAt: now,
      updatedAt: now
    }
    items.unshift(added)
    save()
    inputEl.value = ''
    dateEl.value = ''
    syncDateEmpty(dateEl)
    priorityEl.value = 'medium'
    if (priorityDd) priorityDd.sync()
    // 连续录入同一项目：项目输入保留，其余清空
    collapsedGroups.delete(added.project || '') // 新行所在分组自动展开，避免录进折叠组看不见
    if (filter === 'done') applyFilter('all')
    else render()
    enterAnimation([added.id], false)
    inputEl.focus()
  })

  dateEl.addEventListener('input', () => syncDateEmpty(dateEl))
  syncDateEmpty(dateEl)

  switchEl.addEventListener('click', event => {
    const button = event.target.closest('.todo-switch-item')
    if (button) applyFilter(button.dataset.filter)
  })

  projectFilterEl.addEventListener('change', () => {
    projectFilter = projectFilterEl.value
    render(true)
  })

  // 勾选只替换该行，不整表重渲染，避免其他行的打勾动画重放
  listEl.addEventListener('change', event => {
    if (!event.target.classList.contains('todo-check')) return
    const li = event.target.closest('.todo-item')
    const item = items.find(entry => entry.id === li.dataset.id)
    if (!item) return
    item.done = event.target.checked
    item.updatedAt = Date.now()
    save()
    const showsItem = filter === 'all'
      || (filter === 'active' && !item.done)
      || (filter === 'done' && item.done)
    if (showsItem && inProject(item)) {
      const fresh = renderRow(item)
      li.replaceWith(fresh)
      if (item.done && fresh.querySelector('.todo-check').animate) {
        fresh.querySelector('.todo-check').animate(
          [
            { transform: 'scale(0.75)' },
            { transform: 'scale(1.12)' },
            { transform: 'scale(1)' }
          ],
          { duration: 300, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' }
        )
      }
    } else {
      const group = li.closest('.todo-group')
      li.remove()
      if (group && !group.querySelector('.todo-item')) group.remove()
    }
    syncChrome()
  })

  listEl.addEventListener('click', event => {
    const button = event.target.closest('.todo-item-btn')
    if (!button || removing || !button.dataset.action) return
    const li = event.target.closest('.todo-item')
    if (button.dataset.action === 'edit') {
      startEdit(li)
    } else if (button.dataset.action === 'delete') {
      const id = li.dataset.id
      removing = true
      animateOut([li]).then(() => {
        removing = false
        items = items.filter(entry => entry.id !== id)
        save()
        render()
      })
    }
  })

  // 双击标题进入编辑
  listEl.addEventListener('dblclick', event => {
    const title = event.target.closest('.todo-item-title')
    if (title) startEdit(title.closest('.todo-item'))
  })

  clearDoneEl.addEventListener('click', () => {
    if (removing) return
    const doneItems = items.filter(item => item.done)
    if (!doneItems.length) return
    if (!window.confirm('确定清除 ' + doneItems.length + ' 条已完成任务？')) return
    removing = true
    animateOut(doneItems.map(item => rowById(item.id))).then(() => {
      removing = false
      items = items.filter(item => !item.done)
      save()
      render()
    })
  })

  exportEl.addEventListener('click', () => {
    if (!items.length) {
      showTips('当前没有可导出的任务')
      return
    }
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const link = el('a')
    link.href = url
    link.download = 'todo-backup-' + todayStr() + '.json'
    link.click()
    URL.revokeObjectURL(url)
  })

  importTriggerEl.addEventListener('click', () => importEl.click())

  importEl.addEventListener('change', () => {
    const file = importEl.files && importEl.files[0]
    importEl.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      let imported = []
      try {
        const parsed = JSON.parse(reader.result)
        if (!Array.isArray(parsed)) throw new Error('备份格式不正确')
        imported = parsed.map(normalize).filter(Boolean)
      } catch (error) {
        showTips('导入失败：文件不是有效的待办备份')
        return
      }
      if (!imported.length) {
        showTips('导入失败：文件中没有有效任务')
        return
      }
      if (!window.confirm('将导入 ' + imported.length + ' 条任务并覆盖当前 ' + items.length + ' 条，确定？')) return
      items = imported
      save()
      render(true)
      showTips('已导入 ' + imported.length + ' 条任务')
    }
    reader.onerror = () => showTips('导入失败：文件读取错误')
    reader.readAsText(file)
  })

  // ---------- 启动 ----------

  // 重启后尝试恢复已关联的文件：授权还在则直接对账，否则展示「恢复读写」按钮
  const restoreFile = () => {
    if (!fileApi || !window.indexedDB) return
    idbGet(FILE_HANDLE_KEY).then(handle => {
      if (!handle) return
      fileHandle = handle
      updateLinkButton()
      return fileHandle.queryPermission({ mode: 'readwrite' }).then(state => {
        if (state === 'granted') {
          fileReady = true
          return reconcileFile().then(() => {
            render()
            updateStorageStatus()
          })
        }
        updateStorageStatus()
      })
    }).catch(() => updateStorageStatus())
  }

  items = load()
  collapsedGroups = loadCollapsed()
  updateLinkButton()
  priorityDd = buildDropdown(priorityEl)
  projectFilterDd = buildDropdown(projectFilterEl, true)
  buildDatePicker(dateEl)
  applyFilter('all')
  updateStorageStatus()
  restoreFile()
})()
