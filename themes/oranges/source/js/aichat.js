// AI 助手：每次提问都把上下文连同最近几轮对话发给 OpenAI 兼容接口（中转站），
// SSE 流式渲染回答；支持多轮追问、停止生成，配置由 aichat.ejs 以 JSON script 标签注入。
// 文章页（articleMode）将文章正文全文放入 system prompt 作阅读助手；
// 其余页面为站点助手，仅附带当前页面信息做通用问答。
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

  const commonRules = '用中文回答，使用 Markdown，代码放在代码块中，保持简洁。'

  const articleBody = document.querySelector('#post-details .markdown-body')
  const articleText = ((articleBody && articleBody.innerText) || '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, ARTICLE_MAX_CHARS)

  const systemPrompt = config.articleMode
    ? [
        '你是博客文章的 AI 阅读助手。请优先依据下面提供的文章全文回答读者提问；',
        '文章未涉及的内容可以结合通用知识简要回答，但需说明文章中没有相关内容。',
        commonRules,
        '',
        '# 文章标题',
        config.articleTitle || '',
        '',
        '# 文章全文',
        articleText || '（未能提取到正文）'
      ].join('\n')
    : [
        '你是个人技术博客 Frank\'s Notes 的 AI 助手（博主刘起杰 Frank，关注 Java 后端、全栈开发与 AI 工程化）。读者正在浏览博客页面，请就技术问题或博客内容提供简洁准确的回答；',
        '读者问到某篇文章的内容时，可提示他打开对应文章页，文章页内有基于全文的阅读助手。',
        commonRules,
        '',
        '# 当前页面',
        document.title || ''
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
})()
