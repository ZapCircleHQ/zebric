/** Table enhancements are scoped to each table and reinitialized after Live Mode refreshes. */
export const UX_CLIENT_RUNTIME = `<script>
(() => {
  function enhance() {
    document.querySelectorAll('[data-zebric-table]').forEach(container => {
      if (container.dataset.zebricTableEnhanced) return
      container.dataset.zebricTableEnhanced = 'true'
      const rows = Array.from(container.querySelectorAll('tbody [data-zebric-row]'))
      const search = container.querySelector('[data-zebric-table-search]')
      const selection = container.dataset.selection
      const selectors = Array.from(container.querySelectorAll('[data-zebric-row-select]'))
      const selectAll = container.querySelector('[data-zebric-select-all]')
      const pageSize = 25
      let currentPage = 0
      let visible = rows
      function selected() {
        selectors.forEach(input => {
          input.closest('tr').dataset.selected = String(input.checked)
          input.closest('tr').setAttribute('aria-selected', String(input.checked))
        })
        const checked = selectors.filter(input => input.checked)
        const count = container.querySelector('[data-zebric-selection-count]')
        if (count) count.textContent = checked.length + ' selected'
        if (selectAll) {
          const shown = selectors.filter(input => !input.closest('tr').hidden)
          selectAll.checked = shown.length > 0 && shown.every(input => input.checked)
          selectAll.indeterminate = shown.some(input => input.checked) && !selectAll.checked
        }
        container.dispatchEvent(new CustomEvent('zebric:selection-change', { bubbles: true,
          detail: { ids: checked.map(input => input.value) } }))
      }
      function draw() {
        const term = search ? search.value.trim().toLocaleLowerCase() : ''
        visible = rows.filter(row => (row.dataset.search || '').includes(term))
        const paginate = container.dataset.pagination === 'client'
        const pages = Math.max(1, Math.ceil(visible.length / pageSize))
        currentPage = Math.min(currentPage, pages - 1)
        rows.forEach(row => { row.hidden = true })
        const shown = paginate ? visible.slice(currentPage * pageSize, (currentPage + 1) * pageSize) : visible
        shown.forEach(row => { row.hidden = false })
        const empty = container.querySelector('[data-zebric-filter-empty]')
        if (empty) empty.hidden = visible.length !== 0
        const previous = container.querySelector('[data-zebric-page-previous]')
        const next = container.querySelector('[data-zebric-page-next]')
        const label = container.querySelector('[data-zebric-page-label]')
        if (previous) previous.disabled = currentPage === 0
        if (next) next.disabled = currentPage >= pages - 1
        if (label) label.textContent = 'Page ' + (currentPage + 1) + ' of ' + pages
        selected()
      }
      search?.addEventListener('input', () => { currentPage = 0; draw() })
      selectors.forEach(input => input.addEventListener('change', () => {
        if (selection === 'single' && input.checked) selectors.forEach(other => { if (other !== input) other.checked = false })
        selected()
      }))
      selectAll?.addEventListener('change', () => {
        selectors.filter(input => !input.closest('tr').hidden).forEach(input => { input.checked = selectAll.checked })
        selected()
      })
      rows.forEach(row => {
        const toggle = () => {
          const input = row.querySelector('[data-zebric-row-select]')
          if (!input) return
          input.checked = !input.checked
          input.dispatchEvent(new Event('change'))
        }
        row.addEventListener('click', event => {
          if (row.dataset.rowClick === 'select' && !event.target.closest('a,button,input,select,textarea,form,label')) toggle()
        })
        row.addEventListener('keydown', event => {
          if (event.target === row && row.dataset.rowClick === 'select' && (event.key === ' ' || event.key === 'Enter')) {
            event.preventDefault(); toggle()
          }
        })
      })
      container.querySelector('[data-zebric-page-previous]')?.addEventListener('click', () => { currentPage--; draw() })
      container.querySelector('[data-zebric-page-next]')?.addEventListener('click', () => { currentPage++; draw() })
      container.querySelectorAll('[data-zebric-column-toggle]').forEach(input => input.addEventListener('change', () => {
        const index = input.dataset.zebricColumnToggle
        container.querySelectorAll('[data-zebric-column]').forEach(cell => {
          if (cell.dataset.zebricColumn === index) cell.hidden = !input.checked
        })
      }))
      draw()
    })
  }
  enhance()
  document.addEventListener('zebric:enhance', enhance)
  document.querySelector('[data-zebric-sidebar-toggle]')?.addEventListener('click', event => {
    const button = event.currentTarget
    const expanded = button.getAttribute('aria-expanded') !== 'true'
    button.setAttribute('aria-expanded', String(expanded))
    document.querySelector('[data-zebric-navigation-model="sidebar"]').dataset.expanded = String(expanded)
  })
})()
</script>`
