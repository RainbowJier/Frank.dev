// Todo 页：本地待办清单
// - 数据仅存当前浏览器（localStorage），隐私模式下静默降级为仅本次会话有效
// - 支持：新增 / 勾选完成 / 行内编辑（标题、截止日期、优先级）/ 删除 / 筛选 / 清除已完成 / 导出导入 JSON
// - 动效：行入场（fade-up）、删除离场（WAAPI 折叠）、打勾弹跳、计数脉冲；respect prefers-reduced-motion
(() => {
  const root = document.querySelector('.todo-index')
  if (!root) return

  const STORAGE_KEY = 'todo-items'
  const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const form = root.querySelector('#todo-form')
  const inputEl = root.querySelector('#todo-input')
  const dateEl = root.querySelector('#todo-date')
  const priorityEl = root.querySelector('#todo-priority')
  const listEl = root.querySelector('#todo-list')
  const emptyEl = root.querySelector('#todo-empty')
  const switchEl = root.querySelector('#todo-switch')
  const clearDoneEl = root.querySelector('#todo-clear-done')
  const exportEl = root.querySelector('#todo-export')
  const importTriggerEl = root.querySelector('#todo-import-trigger')
  const importEl = root.querySelector('#todo-import')
  const tipsEl = root.querySelector('#todo-tips')

  let items = []
  let filter = 'all'
  let tipsTimer = null
  let storageWarned = false
  let removing = false
  let prevCounts = null

  const pad = value => String(value).padStart(2, '0')
  const todayStr = () => {
    const now = new Date()
    return now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate())
  }
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

  const showTips = message => {
    tipsEl.textContent = message
    tipsEl.hidden = false
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
    // id 会被拼进选择器，白名单外的直接换新，避免注入
    const id = typeof raw.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) ? raw.id : uid()
    return {
      id: id,
      title: title.slice(0, 200),
      done: raw.done === true,
      deadline: deadline,
      priority: PRIORITY_LABELS[raw.priority] ? raw.priority : 'medium',
      createdAt: Number(raw.createdAt) || Date.now(),
      updatedAt: Number(raw.updatedAt) || Date.now()
    }
  }

  const load = () => {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY))
      return Array.isArray(parsed) ? parsed.map(normalize).filter(Boolean) : []
    } catch (error) {
      return []
    }
  }

  const save = () => {
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

  const dueInfo = item => {
    if (!item.deadline) return null
    if (item.done) return { text: '截止 ' + item.deadline, overdue: false }
    const today = todayStr()
    if (item.deadline < today) return { text: '已逾期 · ' + item.deadline, overdue: true }
    if (item.deadline === today) return { text: '今天截止', overdue: false }
    return { text: '截止 ' + item.deadline, overdue: false }
  }

  const filtered = () => {
    if (filter === 'active') return items.filter(item => !item.done)
    if (filter === 'done') return items.filter(item => item.done)
    return items
  }

  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text != null) node.textContent = text
    return node
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
    span.classList.remove('todo-count-pulse')
    void span.offsetWidth
    span.classList.add('todo-count-pulse')
  }

  // 只更新计数、空态与批量按钮，不动列表（勾选/局部刷新时用）
  const syncChrome = () => {
    const activeCount = items.filter(item => !item.done).length
    const counts = { all: items.length, active: activeCount, done: items.length - activeCount }
    switchEl.querySelectorAll('[data-count]').forEach(span => {
      const key = span.dataset.count
      const value = String(counts[key])
      if (span.textContent !== value) {
        span.textContent = value
        if (prevCounts && prevCounts[key] !== counts[key]) pulse(span)
      }
    })
    prevCounts = counts
    clearDoneEl.disabled = counts.done === 0
    const visible = filtered()
    emptyEl.hidden = visible.length > 0
    listEl.hidden = visible.length === 0
    if (!visible.length) {
      emptyEl.textContent = items.length
        ? (filter === 'done' ? '还没有已完成的任务。' : '没有进行中的任务，休息一下吧。')
        : '还没有待办事项，从上方输入框添加第一条吧。'
    }
  }

  const render = () => {
    listEl.textContent = ''
    filtered().forEach(item => listEl.appendChild(renderRow(item)))
    syncChrome()
  }

  const applyFilter = next => {
    filter = next
    switchEl.querySelectorAll('.todo-switch-item').forEach(button => {
      const active = button.dataset.filter === filter
      button.classList.toggle('active', active)
      button.setAttribute('aria-pressed', String(active))
    })
    render()
  }

  // 新行入场动画（复用全局 fade-up），仅在首屏/新增时挂上，避免每次全量重渲染都闪
  const enterAnimation = (ids, stagger) => {
    if (reduceMotion) return
    ids.forEach((id, index) => {
      const li = rowById(id)
      if (!li) return
      li.classList.add('todo-enter')
      if (stagger) li.style.animationDelay = Math.min(index * 45, 360) + 'ms'
    })
  }

  // 删除离场：折叠 + 右滑，结束后由调用方更新状态重渲染
  const animateOut = rows => {
    const gap = parseFloat(getComputedStyle(listEl).gap) || 10
    return Promise.all(rows.filter(Boolean).map((li, index) => {
      li.style.pointerEvents = 'none'
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

  // 行内编辑：把该行切换为 标题输入 + 日期 + 优先级 + 保存/取消
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
    const dateInput = el('input', 'todo-edit-date')
    dateInput.type = 'date'
    dateInput.value = item.deadline
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
    editor.append(titleInput, dateInput, prioritySelect, saveBtn, cancelBtn)
    li.appendChild(editor)
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
    priorityEl.value = 'medium'
    if (filter === 'done') applyFilter('all')
    else render()
    enterAnimation([added.id], false)
    inputEl.focus()
  })

  switchEl.addEventListener('click', event => {
    const button = event.target.closest('.todo-switch-item')
    if (button) applyFilter(button.dataset.filter)
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
    if (showsItem) {
      listEl.replaceChild(renderRow(item), li)
    } else {
      li.remove()
    }
    syncChrome()
  })

  listEl.addEventListener('click', event => {
    const button = event.target.closest('.todo-item-btn')
    if (!button || removing) return
    const li = event.target.closest('.todo-item')
    if (button.dataset.action === 'edit') {
      startEdit(li)
    } else if (button.dataset.action === 'delete') {
      const id = li.dataset.id
      if (!reduceMotion) {
        removing = true
        animateOut([li]).then(() => {
          removing = false
          items = items.filter(entry => entry.id !== id)
          save()
          render()
        })
      } else {
        items = items.filter(entry => entry.id !== id)
        save()
        render()
      }
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
    const remove = () => {
      items = items.filter(item => !item.done)
      save()
      render()
    }
    if (reduceMotion) {
      remove()
      return
    }
    removing = true
    animateOut(doneItems.map(item => rowById(item.id))).then(() => {
      removing = false
      remove()
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
      render()
      enterAnimation(items.map(item => item.id), true)
      showTips('已导入 ' + imported.length + ' 条任务')
    }
    reader.onerror = () => showTips('导入失败：文件读取错误')
    reader.readAsText(file)
  })

  items = load()
  applyFilter('all')
  enterAnimation(items.map(item => item.id), true)
})()
