// 文章页 AI 阅读助手：每次提问都把文章正文全文放入 system prompt，
// 连同最近几轮对话发给 OpenAI 兼容接口（中转站），SSE 流式渲染回答；
// 支持多轮追问、停止生成，配置由 aichat.ejs 以 JSON script 标签注入。
(() => {
  const configElement = document.getElementById('ai-chat-config')
  if (!configElement) return
  let config
  try {
    config = JSON.parse(configElement.textContent)
  } catch (error) {
    return
  }

  const icon = document.getElementById('ai-chat-icon')
  const backdrop = document.getElementById('ai-chat-backdrop')
  const panel = document.getElementById('ai-chat-panel')
  const closeButton = document.getElementById('ai-chat-close')
  const messagesBox = document.getElementById('ai-chat-messages')
  const input = document.getElementById('ai-chat-input')
  const sendButton = document.getElementById('ai-chat-send')
  if (!icon || !panel || !messagesBox || !input || !sendButton) return

  // 超长正文截断，避免请求体与上下文超出模型限制
  const ARTICLE_MAX_CHARS = 24000
  const conversation = []
  let controller = null
  let generating = false

  const articleBody = document.querySelector('#post-details .markdown-body')
  const articleText = ((articleBody && articleBody.innerText) || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, ARTICLE_MAX_CHARS)

  const systemPrompt = [
    '你是博客文章的 AI 阅读助手。请优先依据下面提供的文章全文回答读者提问；',
    '文章未涉及的内容可以结合通用知识简要回答，但需说明文章中没有相关内容。',
    '用中文回答，使用 Markdown，代码放在代码块中，保持简洁。',
    '',
    '# 文章标题',
    config.articleTitle || '',
    '',
    '# 文章全文',
    articleText || '（未能提取到正文）'
  ].join('\n')

  const openPanel = () => {
    panel.classList.add('open')
    backdrop.classList.add('open')
    document.body.classList.add('hidden')
    input.focus()
  }

  const closePanel = () => {
    panel.classList.remove('open')
    backdrop.classList.remove('open')
    document.body.classList.remove('hidden')
  }

  icon.addEventListener('click', openPanel)
  closeButton.addEventListener('click', closePanel)
  backdrop.addEventListener('click', closePanel)

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && panel.classList.contains('open') && !event.defaultPrevented) {
      event.preventDefault()
      closePanel()
    }
  })

  const escapeHtml = value => value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

  // 行内格式：行内代码、加粗、链接（仅放行 http(s)，输入已整体转义，无注入风险）
  const renderInline = text => text
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')

  // 轻量 Markdown 渲染：只支持代码块/行内代码/加粗/链接/标题行/空行分段，
  // 先转义再生成受控标签，不透传任何原始 HTML
  const renderMarkdown = source => {
    const parts = escapeHtml(source).split('```')
    let html = ''
    parts.forEach((part, index) => {
      if (index % 2 === 1) {
        const firstNewline = part.indexOf('\n')
        const code = firstNewline === -1 ? part : part.slice(firstNewline + 1)
        html += '<pre><code>' + code.replace(/\n+$/, '') + '</code></pre>'
        return
      }
      const blocks = part.split(/\n{2,}/).map(block => {
        const heading = block.match(/^#{1,6}\s+(.+)$/m)
        const body = heading ? block.replace(/^#{1,6}\s+/gm, '') : block
        const rendered = renderInline(body.trim()).replace(/\n/g, '<br>')
        return heading ? '<strong>' + rendered + '</strong>' : rendered
      }).filter(Boolean)
      if (blocks.length) html += '<p>' + blocks.join('</p><p>') + '</p>'
    })
    return html
  }

  const nearBottom = () =>
    messagesBox.scrollHeight - messagesBox.scrollTop - messagesBox.clientHeight < 80

  const scrollToBottom = force => {
    if (force || nearBottom()) messagesBox.scrollTop = messagesBox.scrollHeight
  }

  const appendMessage = role => {
    const message = document.createElement('div')
    message.className = 'ai-chat-msg ai-chat-msg-' + role
    const bubble = document.createElement('div')
    bubble.className = 'ai-chat-bubble'
    message.appendChild(bubble)
    messagesBox.appendChild(message)
    scrollToBottom(true)
    return bubble
  }

  const showThinking = bubble => {
    bubble.classList.add('is-thinking')
    bubble.replaceChildren()
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement('span')
      dot.className = 'ai-chat-dot'
      bubble.appendChild(dot)
    }
  }

  const setGenerating = state => {
    generating = state
    sendButton.classList.toggle('is-generating', state)
    sendButton.setAttribute('aria-label', state ? config.i18n.stop : config.i18n.send)
    syncSendIdle()
  }

  // 空输入且未在生成时弱化发送按钮（样式见 .ai-chat-send.is-idle）
  const syncSendIdle = () => {
    sendButton.classList.toggle('is-idle', !generating && !input.value.trim())
  }

  const errorMessage = error => {
    const status = error.status || 0
    if (status === 401 || status === 403) return config.i18n.authError
    if (status === 429) return config.i18n.rateError
    if (status >= 400) return config.i18n.serverError.replace('{n}', status) + (error.detail || '')
    // fetch 网络层失败（断网/跨域被拦/地址错误）均抛 TypeError
    return config.i18n.netError
  }

  const growInput = () => {
    input.style.height = 'auto'
    input.style.height = Math.min(input.scrollHeight, 120) + 'px'
    syncSendIdle()
  }

  const submit = () => {
    const question = input.value.trim()
    if (!question || generating) return
    input.value = ''
    growInput()
    ask(question)
  }

  const ask = async question => {
    conversation.push({ role: 'user', content: question })
    const userBubble = appendMessage('user')
    userBubble.textContent = question

    const pending = appendMessage('bot')
    showThinking(pending)

    const context = conversation.slice(-(config.maxContextTurns * 2))
    controller = new AbortController()
    setGenerating(true)

    let answer = ''
    let reasoning = ''
    const renderChunk = () => {
      if (pending.classList.contains('is-thinking')) {
        pending.classList.remove('is-thinking')
        pending.replaceChildren()
      }
      if (answer) {
        pending.innerHTML = renderMarkdown(answer) + '<span class="ai-chat-cursor"></span>'
      } else if (reasoning) {
        // 推理模型思考阶段：灰色小字滚动展示思考片段（只保留尾部，避免长思考全量重排）
        pending.innerHTML = '<p class="ai-chat-reasoning">' + escapeHtml(reasoning.slice(-600)) + '…</p>'
      }
      scrollToBottom()
    }

    try {
      const response = await fetch(config.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + config.apiKey
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'system', content: systemPrompt }].concat(context),
          stream: config.stream
        }),
        signal: controller.signal
      })

      if (!response.ok) {
        let detail = ''
        try {
          const data = await response.json()
          const message = data.error && data.error.message
          if (message) detail = '：' + message
        } catch (error) {
          // 忽略非 JSON 响应体
        }
        const error = new Error('http-' + response.status)
        error.status = response.status
        error.detail = detail
        throw error
      }

      if (config.stream && response.body && response.body.getReader) {
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''
          for (const line of lines) {
            const payload = line.trim()
            if (!payload.startsWith('data:')) continue
            const data = payload.slice(5).trim()
            if (!data || data === '[DONE]') continue
            try {
              const chunk = JSON.parse(data)
              const choice = chunk.choices && chunk.choices[0]
              const delta = choice && choice.delta
              const piece = (delta && delta.content) || ''
              // 推理模型思考流：不同网关字段名不同（reasoning / reasoning_content）
              const think = (delta && (delta.reasoning || delta.reasoning_content)) || ''
              if (piece || think) {
                if (piece) answer += piece
                if (think) reasoning += think
                renderChunk()
              }
            } catch (error) {
              // 跳过不完整的 SSE 片段
            }
          }
        }
      } else {
        const data = await response.json()
        const choice = data.choices && data.choices[0]
        answer = (choice && choice.message && choice.message.content) || ''
      }

      pending.classList.remove('is-thinking')
      pending.innerHTML = renderMarkdown(answer || '…')
      if (answer) conversation.push({ role: 'assistant', content: answer })
    } catch (error) {
      if (error.name === 'AbortError') {
        // 用户主动停止：保留已生成的部分，并纳入后续上下文
        pending.classList.remove('is-thinking')
        const note = document.createElement('p')
        note.className = 'ai-chat-stopped'
        note.textContent = config.i18n.aborted
        pending.innerHTML = renderMarkdown(answer)
        if (answer) {
          pending.appendChild(note)
          conversation.push({ role: 'assistant', content: answer })
        } else {
          pending.replaceChildren(note)
        }
      } else {
        pending.classList.remove('is-thinking')
        pending.classList.add('is-error')
        pending.textContent = errorMessage(error)
        // 失败的一轮不入上下文，便于直接重试
        conversation.pop()
      }
    } finally {
      setGenerating(false)
      controller = null
      scrollToBottom(true)
    }
  }

  input.addEventListener('input', growInput)
  syncSendIdle()

  input.addEventListener('keydown', event => {
    if (event.isComposing) return
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      submit()
    }
  })

  sendButton.addEventListener('click', () => {
    if (generating) {
      if (controller) controller.abort()
    } else {
      submit()
    }
  })

  // 划词自动浮现菜单：正文内选中文字停稳后（约 200ms 防抖），菜单自动浮现在选区上方；
  // 快捷动作与自由提问都以引用块预填进输入框，由读者补充/确认后自行发送；
  // 取消选择、滚动或窗口缩放即收起，不干扰页面其余交互
  if (config.selectionSend && articleBody) {
    const QUOTE_MAX_CHARS = 2000
    const menu = document.createElement('div')
    menu.className = 'ai-chat-selection-menu'
    menu.setAttribute('role', 'menu')
    menu.setAttribute('aria-label', config.i18n.assistantName)
    menu.hidden = true

    const ITEM_ICON =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.85-.93L3 20.5l1.46-5.4A8.5 8.5 0 1 1 21 11.5Z"/>' +
      '<path d="M12.5 7.4l.75 2.05 2.05.75-2.05.75-.75 2.05-.75-2.05-2.05-.75 2.05-.75.75-2.05Z"/></svg>'
    // 提问模板前缀与系统提示词同风格硬编码中文；自由提问不带指令，仅引用
    const menuActions = [
      { label: config.i18n.selectionExplain, prefix: '请解释下面这段内容：' },
      { label: config.i18n.selectionTranslate, prefix: '请把下面的内容翻译成中文：' },
      { label: config.i18n.selectionSummarize, prefix: '请总结下面内容的要点：' },
      { label: config.i18n.selectionSend, prefix: '', separator: true }
    ]
    const menuItems = menuActions.map(action => {
      if (action.separator) {
        const divider = document.createElement('div')
        divider.className = 'ai-chat-selection-menu-separator'
        menu.appendChild(divider)
      }
      const item = document.createElement('button')
      item.type = 'button'
      item.className = 'ai-chat-selection-menu-item'
      item.setAttribute('role', 'menuitem')
      item.innerHTML = ITEM_ICON + '<span>' + escapeHtml(action.label) + '</span>'
      item.addEventListener('click', () => {
        hideMenu()
        quoteSelection(action.prefix)
      })
      menu.appendChild(item)
      return item
    })
    // 自动弹出时不抢焦点（避免打断键盘选词）；仅首项可 Tab 到达，其余靠方向键漫游
    menuItems.forEach((item, index) => { item.tabIndex = index === 0 ? 0 : -1 })
    document.body.appendChild(menu)

    let quotedText = ''
    let selectionTimer = 0

    const hideMenu = () => { menu.hidden = true }

    // 浮在选区上方居中；上方放不下移到选区下方，均贴视口内缘钳制
    const showMenu = () => {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      menu.hidden = false
      const menuRect = menu.getBoundingClientRect()
      const left = Math.max(8, Math.min(
        rect.left + rect.width / 2 - menuRect.width / 2,
        window.innerWidth - menuRect.width - 8))
      let top = rect.top - menuRect.height - 8
      if (top < 8) top = rect.bottom + 8
      menu.style.left = Math.round(left) + 'px'
      menu.style.top = Math.round(Math.min(top, window.innerHeight - menuRect.height - 8)) + 'px'
    }

    // 引用块预填：逐行加 "> " 前缀，快捷动作带提问模板，末尾留空行供读者补充，光标落在末尾
    const quoteSelection = prefix => {
      let quote = quotedText.replace(/[ \t]+\n/g, '\n').trim()
      if (!quote) return
      if (quote.length > QUOTE_MAX_CHARS) quote = quote.slice(0, QUOTE_MAX_CHARS) + '…'
      const quoted = quote.split('\n').map(line => '> ' + line).join('\n')
      input.value = prefix ? prefix + '\n\n' + quoted + '\n\n' : quoted + '\n\n'
      openPanel()
      growInput()
      const end = input.value.length
      input.setSelectionRange(end, end)
    }

    // 选区变化后延迟判定：拖选过程中不闪烁，停稳且选区在正文中才浮现，否则收起
    document.addEventListener('selectionchange', () => {
      clearTimeout(selectionTimer)
      selectionTimer = setTimeout(() => {
        const selection = window.getSelection()
        const text = (selection && String(selection)) || ''
        if (text.trim() && selection.anchorNode && articleBody.contains(selection.anchorNode)) {
          quotedText = text
          showMenu()
        } else {
          hideMenu()
        }
      }, 200)
    })

    // 抑制菜单上的 mousedown 默认行为：点击按钮时不转移焦点、不清掉选区
    menu.addEventListener('mousedown', event => event.preventDefault())

    // 焦点在菜单内时方向键循环移动焦点；Escape 收起由下方 document 监听统一处理
    menu.addEventListener('keydown', event => {
      const index = menuItems.indexOf(document.activeElement)
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const delta = event.key === 'ArrowDown' ? 1 : -1
        menuItems[(index + delta + menuItems.length) % menuItems.length].focus({ preventScroll: true })
      }
    })

    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !menu.hidden) {
        event.preventDefault()
        hideMenu()
      }
    })

    // 滚动或窗口缩放后菜单位置会与选区脱节，直接收起
    window.addEventListener('scroll', hideMenu, true)
    window.addEventListener('resize', hideMenu)
  }
})()
