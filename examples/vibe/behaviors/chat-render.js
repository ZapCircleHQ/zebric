/**
 * Chat Render Behavior
 *
 * Provides a two-column layout:
 * - Conversation history with a composer that posts to /api/chat-messages
 * - Blueprint preview pane that renders the latest assistant response
 */

function render(ctx) {
  const { data, helpers } = ctx
  const session = Array.isArray(data.session) ? data.session[0] : null
  const messages = Array.isArray(data.messages) ? data.messages : []

  if (!session) {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <head>
          <meta charset="utf-8" />
          <title>Session Not Found</title>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body class="min-h-screen bg-slate-950 text-slate-100">
          <main class="max-w-2xl mx-auto py-24 px-6 text-center space-y-4">
            <h1 class="text-3xl font-semibold">We could not find that chat session.</h1>
            <p class="text-slate-400">
              Start a new session from the <a href="/" class="text-cyan-400 hover:text-cyan-300 underline">sessions list</a>.
            </p>
          </main>
        </body>
      </html>
    `
  }

  const latestBlueprint = findLatestBlueprint(messages)
  const statusBadge = renderStatusBadge(session.status)
  const messageItems = messages.map((message) => renderMessage(message, helpers)).join('')
  const blueprintPanel = renderBlueprintPanel(latestBlueprint, helpers)

  const sessionIdJson = JSON.stringify(session.id)
  const postUrlJson = JSON.stringify('/api/chat-messages')

  return `
    <!DOCTYPE html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${helpers.escapeHtml(session.title)} · Vibe Chat</title>
        <script src="https://cdn.tailwindcss.com"></script>
        <style>
          .chat-scroll {
            max-height: calc(100vh - 220px);
          }
          .blueprint-scroll {
            max-height: calc(100vh - 220px);
          }
          .message-content code {
            background-color: rgba(15, 23, 42, 0.4);
            padding: 0.1rem 0.3rem;
            border-radius: 0.25rem;
            font-size: 0.875rem;
          }
          pre {
            white-space: pre-wrap;
            word-break: break-word;
          }
        </style>
      </head>
      <body class="bg-slate-950 text-slate-100">
        <div class="min-h-screen px-6 py-10">
          <div class="max-w-6xl mx-auto space-y-6">
            <header class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              <div>
                <p class="text-sm uppercase tracking-wider text-slate-500">ZapCircle · Vibe Coding</p>
                <h1 class="text-3xl font-semibold text-slate-50">${helpers.escapeHtml(session.title)}</h1>
              </div>
              <div class="flex items-center gap-3">
                ${statusBadge}
                <span class="text-xs text-slate-500">
                  Updated ${helpers.escapeHtml(helpers.formatDateTime ? helpers.formatDateTime(session.updatedAt) : session.updatedAt)}
                </span>
              </div>
            </header>

            <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <!-- Chat Column -->
              <section class="bg-slate-900/60 border border-slate-800 rounded-xl backdrop-blur-sm shadow-lg flex flex-col">
                <div class="px-6 pt-6 pb-4 border-b border-slate-800">
                  <h2 class="text-lg font-semibold text-slate-100">Conversation</h2>
                  <p class="text-sm text-slate-400">Describe the vibe you want and let ZapCircle draft a blueprint.toml for you.</p>
                </div>

                <div class="flex-1 overflow-y-auto chat-scroll px-6 py-4 space-y-4">
                  ${messageItems || renderEmptyState()}
                </div>

                <div class="px-6 py-5 border-t border-slate-800 bg-slate-900/70">
                  <form id="chat-form" class="space-y-3">
                    <textarea
                      id="chat-input"
                      name="content"
                      rows="4"
                      placeholder="Describe the user journey, entities, and pages you need..."
                      class="w-full resize-none rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-500"
                      required
                    ></textarea>
                    <div class="flex items-center justify-between">
                      <p class="text-xs text-slate-500">
                        Blueprint responses will appear on the right once OpenAI finishes processing.
                      </p>
                      <button
                        type="submit"
                        class="inline-flex items-center gap-2 rounded-lg bg-cyan-500 px-4 py-2 text-sm font-medium text-slate-950 hover:bg-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-300 disabled:opacity-60"
                        id="chat-submit"
                      >
                        Send to OpenAI
                      </button>
                    </div>
                  </form>
                </div>
              </section>

              <!-- Blueprint Column -->
              ${blueprintPanel}
            </div>
          </div>
        </div>

        <script>
          (function() {
            const form = document.getElementById('chat-form')
            if (!form) return

            const textarea = document.getElementById('chat-input')
            const submitButton = document.getElementById('chat-submit')

            form.addEventListener('submit', async (event) => {
              event.preventDefault()
              const content = textarea.value.trim()
              if (!content) {
                return
              }

              submitButton.disabled = true
              submitButton.textContent = 'Sending...'

              try {
                const response = await fetch(${postUrlJson}, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json'
                  },
                  body: JSON.stringify({
                    sessionId: ${sessionIdJson},
                    role: 'user',
                    kind: 'chat',
                    content
                  })
                })

                if (!response.ok) {
                  throw new Error('Failed to send message')
                }
              } catch (error) {
                console.error(error)
                alert('Something went wrong sending your message. Check the server logs for details.')
              } finally {
                textarea.value = ''
                submitButton.disabled = false
                submitButton.textContent = 'Send to OpenAI'
                window.location.reload()
              }
            })

            const copyButton = document.getElementById('copy-blueprint')
            if (copyButton) {
              copyButton.addEventListener('click', () => {
                const target = document.getElementById('blueprint-source')
                if (!target) return
                navigator.clipboard.writeText(target.textContent).then(() => {
                  copyButton.textContent = 'Copied!'
                  setTimeout(() => (copyButton.textContent = 'Copy blueprint.toml'), 1800)
                })
              })
            }

            const downloadButton = document.getElementById('download-blueprint')
            if (downloadButton) {
              downloadButton.addEventListener('click', () => {
                const target = document.getElementById('blueprint-source')
                if (!target) return
                const blob = new Blob([target.textContent], { type: 'text/plain' })
                const url = URL.createObjectURL(blob)
                const link = document.createElement('a')
                link.href = url
                link.download = 'blueprint.toml'
                document.body.appendChild(link)
                link.click()
                document.body.removeChild(link)
                URL.revokeObjectURL(url)
              })
            }
          })()
        </script>
      </body>
    </html>
  `
}

function renderStatusBadge(status) {
  const badge = {
    waiting: { text: 'Waiting for prompt', classes: 'bg-slate-800 text-slate-300' },
    generating: { text: 'Generating with OpenAI', classes: 'bg-amber-500/20 text-amber-200 border border-amber-400/40 animate-pulse' },
    ready: { text: 'Blueprint ready', classes: 'bg-emerald-500/20 text-emerald-200 border border-emerald-400/40' },
    error: { text: 'Needs attention', classes: 'bg-rose-500/20 text-rose-200 border border-rose-400/40' }
  }

  const meta = badge[status] || badge.waiting
  return `
    <span class="px-3 py-1 text-xs font-medium rounded-full ${meta.classes}">
      ${meta.text}
    </span>
  `
}

function renderMessage(message, helpers) {
  const isAssistant = message.role === 'assistant'
  const isBlueprint = message.kind === 'blueprint'
  const alignment = isAssistant ? 'items-start' : 'items-end'
  const bubbleClasses = isAssistant
    ? 'bg-slate-800/80 border border-slate-700 text-slate-100'
    : 'bg-cyan-500 text-slate-950 border border-cyan-400/40'

  const roleLabel = isAssistant ? 'ZapCircle' : 'You'
  const timestamp = helpers.formatDateTime ? helpers.formatDateTime(message.createdAt) : message.createdAt

  const content = isBlueprint
    ? `<pre class="text-sm leading-6 text-emerald-200">${helpers.escapeHtml(message.content)}</pre>`
    : `<p class="message-content text-sm leading-6 whitespace-pre-line">${helpers.escapeHtml(message.content)}</p>`

  return `
    <article class="flex flex-col gap-1 ${alignment}">
      <div class="flex items-center gap-2 text-xs uppercase tracking-wider text-slate-500 ${isAssistant ? '' : 'justify-end'}">
        <span>${roleLabel}</span>
        <span class="text-slate-600">•</span>
        <time>${helpers.escapeHtml(timestamp)}</time>
      </div>
      <div class="max-w-full rounded-2xl px-4 py-3 shadow ${bubbleClasses}">
        ${content}
      </div>
    </article>
  `
}

function renderEmptyState() {
  return `
    <div class="rounded-xl border border-dashed border-slate-700 bg-slate-900/30 p-6 text-center">
      <h3 class="text-sm font-semibold text-slate-200">Describe your vibe to kick things off</h3>
      <p class="mt-2 text-sm text-slate-500">
        Share the entities, pages, and workflows you want. The workflow will call OpenAI and bring back a blueprint.toml on the right.
      </p>
    </div>
  `
}

function renderBlueprintPanel(blueprintMessage, helpers) {
  if (!blueprintMessage) {
    return `
      <section class="bg-slate-900/30 border border-dashed border-slate-800 rounded-xl backdrop-blur-sm flex flex-col justify-center items-center text-center p-10 min-h-[420px]">
        <div class="space-y-4 max-w-sm">
          <h2 class="text-lg font-semibold text-slate-200">Blueprint output will appear here</h2>
          <p class="text-sm text-slate-500">
            Once the workflow finishes calling OpenAI with your latest prompt, the generated blueprint.toml will render inside this panel.
          </p>
          <p class="text-xs text-slate-600">
            Make sure <code class="font-mono px-1 py-0.5 bg-slate-800/80 rounded">OPENAI_API_KEY</code> is set before running the engine.
          </p>
        </div>
      </section>
    `
  }

  const escape = (value) => helpers.escapeHtml(value)
  const previewHtml = `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Blueprint Preview</title>
    <style>
      :root {
        color-scheme: dark;
        font-family: "JetBrains Mono", "Fira Code", Menlo, monospace;
      }
      body {
        margin: 0;
        background: #020617;
        color: #e2e8f0;
        padding: 24px;
        line-height: 1.5;
      }
      h1 {
        font-size: 1rem;
        margin-bottom: 16px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #38bdf8;
      }
      pre {
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(15, 23, 42, 0.65);
        border: 1px solid rgba(51, 65, 85, 0.8);
        border-radius: 12px;
        padding: 18px;
        box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.08);
      }
    </style>
  </head>
  <body>
    <h1>Generated blueprint.toml</h1>
    <pre>${escape(blueprintMessage.content)}</pre>
  </body>
</html>
  `.trim()

  return `
    <section class="bg-slate-900/60 border border-slate-800 rounded-xl backdrop-blur-sm shadow-lg flex flex-col">
      <div class="px-6 pt-6 pb-4 border-b border-slate-800">
        <div class="flex items-center justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold text-slate-100">Latest blueprint.toml</h2>
            <p class="text-sm text-slate-500">Generated ${helpers.escapeHtml(helpers.formatDateTime ? helpers.formatDateTime(blueprintMessage.createdAt) : blueprintMessage.createdAt)}</p>
          </div>
          <div class="flex items-center gap-2">
            <button id="copy-blueprint" class="text-xs uppercase tracking-wide rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-cyan-400 hover:text-cyan-200 transition">
              Copy blueprint.toml
            </button>
            <button id="download-blueprint" class="text-xs uppercase tracking-wide rounded-lg border border-slate-700 px-3 py-1.5 text-slate-200 hover:border-cyan-400 hover:text-cyan-200 transition">
              Download
            </button>
          </div>
        </div>
      </div>

      <div class="blueprint-scroll overflow-y-auto px-6 py-4 space-y-4">
        <div class="rounded-lg border border-slate-800 bg-slate-950/70">
          <pre id="blueprint-source" class="text-xs leading-6 p-4 text-slate-200 font-mono">${escape(blueprintMessage.content)}</pre>
        </div>
        <div class="rounded-lg border border-slate-800 overflow-hidden">
          <iframe
            title="Blueprint Preview"
            class="w-full h-[360px] border-0"
            srcdoc="${escape(previewHtml)}"
          ></iframe>
        </div>
        <p class="text-xs text-slate-500">
          Drop this blueprint.toml into a fresh ZapCircle runtime or hand it back to your favorite LLM to iterate.
        </p>
      </div>
    </section>
  `
}

// Export render function
render

