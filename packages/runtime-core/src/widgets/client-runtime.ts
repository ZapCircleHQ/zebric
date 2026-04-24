/**
 * Client-side runtime for controls — a single inlined IIFE that initializes
 * any `[data-control]` elements in the page.
 *
 * Covers both page-level widgets (board) and form-embedded controls (lookup).
 * Exported as a string so DocumentWrapper can inject it conditionally.
 */

export const WIDGET_CLIENT_RUNTIME = `<script>
(function() {
  'use strict'

  var INITS = {
    board: initBoard,
    lookup: initLookup
  }

  function init() {
    document.querySelectorAll('[data-control]').forEach(function(el) {
      var kind = el.getAttribute('data-control')
      var fn = INITS[kind]
      if (fn) fn(el)
    })
  }

  function readConfig(el) {
    var raw = el.getAttribute('data-control-config') || '{}'
    try { return JSON.parse(raw) } catch (_) { return {} }
  }

  function readCsrf() {
    var match = document.cookie.split(';').map(function(s) { return s.trim() })
      .find(function(s) { return s.indexOf('csrf-token=') === 0 })
    if (!match) return null
    var parts = match.split('=')
    parts.shift()
    try { return decodeURIComponent(parts.join('=')) } catch (_) { return null }
  }

  function sendEvent(pagePath, event, row, ctx) {
    var csrf = readCsrf()
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    if (csrf) headers['x-csrf-token'] = csrf
    return fetch('/_widget/event', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: JSON.stringify({ page: pagePath, event: event, row: row, ctx: ctx })
    }).then(function(res) {
      if (!res.ok) { return res.text().then(function(t) { console.error('widget event failed', res.status, t); return null }) }
      return res.json().catch(function() { return null })
    }).catch(function(err) {
      console.error('widget event error', err)
      return null
    })
  }

  // ==========================================
  // Board
  // ==========================================

  function initBoard(root) {
    var config = readConfig(root)
    var dragEl = null

    root.addEventListener('dragstart', function(e) {
      var card = e.target.closest && e.target.closest('.widget-board-card')
      if (!card || !config.events.move) return
      dragEl = card
      card.classList.add('widget-dragging')
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move'
        try { e.dataTransfer.setData('text/plain', card.dataset.cardId || '') } catch (_) {}
      }
    })

    root.addEventListener('dragend', function(e) {
      var card = e.target.closest && e.target.closest('.widget-board-card')
      if (card) card.classList.remove('widget-dragging')
      dragEl = null
      root.querySelectorAll('.widget-drop-active').forEach(function(el) { el.classList.remove('widget-drop-active') })
    })

    root.addEventListener('dragover', function(e) {
      var zone = e.target.closest && e.target.closest('[data-column-dropzone]')
      if (!zone || !dragEl) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      zone.classList.add('widget-drop-active')
      var after = cardAfter(zone, e.clientY)
      if (after == null) {
        if (zone.lastElementChild !== dragEl) zone.appendChild(dragEl)
      } else if (after !== dragEl) {
        zone.insertBefore(dragEl, after)
      }
    })

    root.addEventListener('dragleave', function(e) {
      var zone = e.target.closest && e.target.closest('[data-column-dropzone]')
      if (zone && (!e.relatedTarget || !zone.contains(e.relatedTarget))) {
        zone.classList.remove('widget-drop-active')
      }
    })

    root.addEventListener('drop', function(e) {
      var zone = e.target.closest && e.target.closest('[data-column-dropzone]')
      if (!zone || !dragEl) return
      e.preventDefault()
      zone.classList.remove('widget-drop-active')
      if (!config.events.move) return

      var column = zone.closest('[data-column-id]')
      var columnId = column ? column.getAttribute('data-column-id') : null
      var cardId = dragEl.getAttribute('data-card-id')
      var children = Array.prototype.slice.call(zone.children)
      var index = children.indexOf(dragEl)

      sendEvent(config.pagePath, 'move',
        { entity: config.entity, id: cardId },
        { to: { id: columnId }, index: index }
      ).then(function() {
        root.querySelectorAll('.widget-board-column').forEach(function(col) {
          var count = col.querySelectorAll('.widget-board-card').length
          var badge = col.querySelector('.widget-board-column-count')
          if (badge) badge.textContent = String(count)
        })
      })
    })

    root.querySelectorAll('[data-editable="true"]').forEach(function(el) {
      el.addEventListener('dblclick', function() { startColumnEdit(el, config) })
    })

    root.addEventListener('click', function(e) {
      var btn = e.target.closest && e.target.closest('.widget-board-card-toggle')
      if (!btn || btn.disabled || !config.events.toggle) return

      var card = btn.closest('.widget-board-card')
      if (!card) return
      var field = btn.getAttribute('data-toggle-field')
      var currentVal = btn.getAttribute('data-toggle-value') === 'true'
      var newVal = !currentVal
      var labelOn = btn.getAttribute('data-label-on') || ''
      var labelOff = btn.getAttribute('data-label-off') || ''

      applyToggleVisual(btn, newVal, labelOn, labelOff)

      sendEvent(config.pagePath, 'toggle',
        { entity: config.entity, id: card.getAttribute('data-card-id') },
        { field: field, value: newVal }
      ).then(function(result) {
        if (!result) applyToggleVisual(btn, currentVal, labelOn, labelOff)
      })
    })
  }

  function applyToggleVisual(btn, on, labelOn, labelOff) {
    btn.setAttribute('data-toggle-value', on ? 'true' : 'false')
    btn.setAttribute('aria-pressed', on ? 'true' : 'false')
    btn.textContent = on ? labelOn : labelOff
    btn.classList.toggle('widget-toggle-on', on)
  }

  function cardAfter(zone, y) {
    var cards = Array.prototype.slice.call(zone.querySelectorAll('.widget-board-card:not(.widget-dragging)'))
    for (var i = 0; i < cards.length; i++) {
      var rect = cards[i].getBoundingClientRect()
      if (y < rect.top + rect.height / 2) return cards[i]
    }
    return null
  }

  function startColumnEdit(el, config) {
    var original = el.textContent || ''
    el.setAttribute('contenteditable', 'true')
    el.focus()
    var range = document.createRange()
    range.selectNodeContents(el)
    var sel = window.getSelection()
    if (sel) { sel.removeAllRanges(); sel.addRange(range) }

    var finished = false
    function finish(commit) {
      if (finished) return
      finished = true
      el.removeEventListener('blur', onBlur)
      el.removeEventListener('keydown', onKey)
      el.removeAttribute('contenteditable')
      var trimmed = (el.textContent || '').trim()
      if (!commit || trimmed === original.trim() || !trimmed) {
        el.textContent = original
        return
      }
      el.textContent = trimmed
      var column = el.closest('[data-column-id]')
      if (!column) return
      var field = el.getAttribute('data-column-field') || 'name'
      sendEvent(config.pagePath, 'column_rename',
        { entity: config.columnEntity, id: column.getAttribute('data-column-id') },
        { field: field, value: trimmed }
      ).then(function(result) {
        if (!result) el.textContent = original
      })
    }
    function onBlur() { finish(true) }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); el.blur() }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); el.blur() }
    }
    el.addEventListener('blur', onBlur)
    el.addEventListener('keydown', onKey)
  }

  // ==========================================
  // Lookup
  // ==========================================

  function initLookup(root) {
    var config = readConfig(root)
    var input = root.querySelector('.control-lookup-label')
    var hidden = root.querySelector('.control-lookup-value')
    var list = root.querySelector('.control-lookup-list')
    if (!input || !list) return

    var debounceTimer = null
    var lastQuery = ''
    var active = -1
    var items = []

    function close() {
      list.hidden = true
      list.innerHTML = ''
      input.setAttribute('aria-expanded', 'false')
      input.removeAttribute('aria-activedescendant')
      active = -1
      items = []
    }

    function render(results) {
      items = results || []
      if (!items.length) {
        list.innerHTML = '<li class="control-lookup-empty">No matches</li>'
        list.hidden = false
        input.setAttribute('aria-expanded', 'true')
        return
      }
      var html = items.map(function(r, i) {
        var itemId = root.id + '-opt-' + i
        return '<li class="control-lookup-item" role="option" id="' + itemId + '"' +
               ' data-id="' + escapeAttr(r.id) + '"' +
               ' data-label="' + escapeAttr(r.label) + '"' +
               ' aria-selected="false">' + escapeHtml(r.label) + '</li>'
      }).join('')
      list.innerHTML = html
      list.hidden = false
      input.setAttribute('aria-expanded', 'true')
    }

    function escapeHtml(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[c] || c
      })
    }
    function escapeAttr(s) { return escapeHtml(s).replace(/\\n/g, '&#10;') }

    function highlight(index) {
      var nodes = list.querySelectorAll('.control-lookup-item')
      nodes.forEach(function(n) { n.setAttribute('aria-selected', 'false') })
      if (index < 0 || index >= nodes.length) {
        input.removeAttribute('aria-activedescendant')
        return
      }
      var n = nodes[index]
      n.setAttribute('aria-selected', 'true')
      input.setAttribute('aria-activedescendant', n.id)
      if (n.scrollIntoView) n.scrollIntoView({ block: 'nearest' })
    }

    function search(q) {
      if (q === lastQuery) return
      lastQuery = q
      if (!q || q.length < 1) { close(); return }
      var params = new URLSearchParams({ page: config.pagePath, q: q })
      if (config.field) params.set('field', config.field)
      fetch('/_widget/search?' + params.toString(), {
        credentials: 'same-origin',
        headers: { 'Accept': 'application/json' }
      }).then(function(res) { return res.ok ? res.json() : null })
        .then(function(data) {
          if (!data) { close(); return }
          render(data.results || [])
          active = -1
        })
        .catch(function(err) { console.error('lookup search error', err); close() })
    }

    function pick(idx) {
      var r = items[idx]
      if (!r) return
      input.value = r.label
      if (hidden) hidden.value = r.id
      close()

      if (config.mount === 'widget' && config.onSelect && config.onSelect.navigate) {
        var target = String(config.onSelect.navigate)
          .replace(/\\$to\\.id/g, encodeURIComponent(r.id))
          .replace(/\\$to\\.label/g, encodeURIComponent(r.label))
        window.location.href = target
        return
      }

      if (hidden) {
        try { hidden.dispatchEvent(new Event('change', { bubbles: true })) } catch (_) {}
      }
    }

    input.addEventListener('input', function() {
      if (debounceTimer) clearTimeout(debounceTimer)
      var q = input.value.trim()
      debounceTimer = setTimeout(function() { search(q) }, 250)
      // Clear the stored id when the visible text changes — user is re-searching.
      if (hidden && hidden.value && input.value !== (input.getAttribute('data-picked-label') || '')) {
        hidden.value = ''
      }
    })

    input.addEventListener('keydown', function(e) {
      if (list.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        search(input.value.trim())
        return
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        active = Math.min(active + 1, items.length - 1)
        highlight(active)
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        active = Math.max(active - 1, -1)
        highlight(active)
      } else if (e.key === 'Enter') {
        if (!list.hidden && active >= 0) { e.preventDefault(); pick(active) }
      } else if (e.key === 'Escape') {
        if (!list.hidden) { e.preventDefault(); close() }
      }
    })

    input.addEventListener('blur', function() {
      // Delay so a click on a list item can fire first.
      setTimeout(close, 150)
    })

    list.addEventListener('mousedown', function(e) {
      var el = e.target.closest && e.target.closest('.control-lookup-item')
      if (!el) return
      e.preventDefault()
      var idx = Array.prototype.indexOf.call(list.children, el)
      pick(idx)
    })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
</script>`
