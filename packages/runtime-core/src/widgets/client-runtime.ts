/**
 * Client-side runtime for widgets — a single inlined IIFE that initializes
 * any `[data-widget]` elements in the page.
 *
 * Exported as a string so DocumentWrapper can inject it conditionally.
 */

export const WIDGET_CLIENT_RUNTIME = `<script>
(function() {
  'use strict'

  function init() {
    document.querySelectorAll('[data-widget="board"]').forEach(initBoard)
  }

  function readCsrf() {
    var match = document.cookie.split(';').map(function(s) { return s.trim() })
      .find(function(s) { return s.indexOf('csrf-token=') === 0 })
    if (!match) return null
    var parts = match.split('=')
    parts.shift()
    try { return decodeURIComponent(parts.join('=')) } catch (_) { return null }
  }

  function sendEvent(config, event, row, ctx) {
    var csrf = readCsrf()
    var headers = { 'Content-Type': 'application/json', 'Accept': 'application/json' }
    if (csrf) headers['x-csrf-token'] = csrf
    return fetch('/_widget/event', {
      method: 'POST',
      credentials: 'same-origin',
      headers: headers,
      body: JSON.stringify({ page: config.pagePath, event: event, row: row, ctx: ctx })
    }).then(function(res) {
      if (!res.ok) { return res.text().then(function(t) { console.error('widget event failed', res.status, t); return null }) }
      return res.json().catch(function() { return null })
    }).catch(function(err) {
      console.error('widget event error', err)
      return null
    })
  }

  function initBoard(root) {
    var raw = root.getAttribute('data-widget-config') || '{}'
    var config
    try { config = JSON.parse(raw) } catch (_) { config = { events: {} } }

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

      sendEvent(config, 'move',
        { entity: config.entity, id: cardId },
        { to: { id: columnId }, index: index }
      ).then(function() {
        // Refresh column counts
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

      // Optimistic swap
      applyToggleVisual(btn, newVal, labelOn, labelOff)

      sendEvent(config, 'toggle',
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
      sendEvent(config, 'column_rename',
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

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init)
  } else {
    init()
  }
})()
</script>`
