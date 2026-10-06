// Todo 页：本地待办清单
// - 支持按项目归类：录入时可选填项目，工具栏按项目筛选，meta 行显示 #项目 标签
// - 数据层双层结构：localStorage 永远作镜像缓存；Chrome/Edge 桌面版可再关联磁盘 todo.json
//   （File System Access API），句柄存 IndexedDB，改动自动写入文件，重启后按 updatedAt 新者胜出对账
// - 不支持文件 API 的浏览器只走 localStorage，功能不受影响；隐私模式静默降级
// - 动效：行入场（fade-up）、删除离场（WAAPI 折叠）、打勾弹跳、计数脉冲；respect prefers-reduced-motion
(() => {
  const root = document.querySelector('.todo-index')
  if (!root) return

  const STORAGE_KEY = 'todo-items'
  const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' }
  const PROJECT_NONE = '__none__' // 项目筛选下拉里「未分类」的哨兵值
  const FILE_DB = 'todo-storage'
  const FILE_STORE = 'handles'
  const FILE_HANDLE_KEY = 'todo-file'
  const fileApi = 'showSaveFilePicker' in window
  const reduceMotion = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

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
    if (item.project) {
      meta.appendChild(el('span', 'todo-project-tag', '#' + item.project))
    }
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
    const visible = filtered()
    emptyEl.hidden = visible.length > 0
    listEl.hidden = visible.length === 0
    if (!visible.length) {
      emptyEl.textContent = !items.length
        ? '还没有待办事项，从上方输入框添加第一条吧。'
        : (filter === 'done' ? '还没有已完成的任务。' : '当前筛选范围内没有任务，换个条件试试。')
    }
  }

  const render = () => {
    updateProjectOptions()
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
    // 连续录入同一项目：项目输入保留，其余清空
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
    render()
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
      listEl.replaceChild(renderRow(item), li)
    } else {
      li.remove()
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
  updateLinkButton()
  applyFilter('all')
  enterAnimation(items.map(item => item.id), true)
  updateStorageStatus()
  restoreFile()
})()
