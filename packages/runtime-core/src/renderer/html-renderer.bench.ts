/**
 * HTMLRenderer Benchmarks
 *
 * Measures full-page rendering cost for each layout type.
 */

import { bench, describe } from 'vitest'
import { HTMLRenderer } from './html-renderer.js'
import type { Blueprint } from '../types/blueprint.js'
import type { RenderContext } from '../routing/request-ports.js'

function makeBlueprint(): Blueprint {
  return {
    version: '1.0',
    project: { name: 'Bench App', version: '1.0.0', runtime: { min_version: '0.1.0' } },
    entities: [
      {
        name: 'Task',
        fields: [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'title', type: 'Text', required: true },
          { name: 'description', type: 'LongText' },
          { name: 'status', type: 'Text' },
          { name: 'priority', type: 'Integer' },
        ],
      },
    ],
    pages: [
      { path: '/tasks', title: 'Tasks', layout: 'list', queries: { tasks: { entity: 'Task' } } },
      { path: '/tasks/:id', title: 'Task Detail', layout: 'detail', queries: { task: { entity: 'Task' } } },
      {
        path: '/tasks/new', title: 'New Task', layout: 'form',
        form: {
          entity: 'Task', method: 'create',
          fields: [
            { name: 'title', type: 'text', required: true, label: 'Title' },
            { name: 'description', type: 'textarea', required: false, label: 'Description' },
            { name: 'status', type: 'select', required: true, label: 'Status', options: ['pending', 'in_progress', 'done'] },
            { name: 'priority', type: 'number', required: false, label: 'Priority' },
          ],
        },
      },
      { path: '/dashboard', title: 'Dashboard', layout: 'dashboard', queries: { tasks: { entity: 'Task' } } },
    ],
  } as any
}

function makeTask(i: number) {
  return { id: `task-${i}`, title: `Task number ${i}`, description: `Description for task ${i}`, status: 'pending', priority: i }
}

const blueprint = makeBlueprint()
const renderer = new HTMLRenderer(blueprint)

const smallDataset = Array.from({ length: 5 }, (_, i) => makeTask(i))
const mediumDataset = Array.from({ length: 25 }, (_, i) => makeTask(i))
const largeDataset = Array.from({ length: 100 }, (_, i) => makeTask(i))

const listPageSmall: RenderContext = {
  page: blueprint.pages![0],
  data: { tasks: smallDataset },
  params: {},
  query: {},
}
const listPageMedium: RenderContext = {
  page: blueprint.pages![0],
  data: { tasks: mediumDataset },
  params: {},
  query: {},
}
const listPageLarge: RenderContext = {
  page: blueprint.pages![0],
  data: { tasks: largeDataset },
  params: {},
  query: {},
}
const detailPage: RenderContext = {
  page: blueprint.pages![1],
  data: { task: makeTask(1) },
  params: { id: 'task-1' },
  query: {},
}
const formPage: RenderContext = {
  page: blueprint.pages![2],
  data: {},
  params: {},
  query: {},
}
const dashboardPage: RenderContext = {
  page: blueprint.pages![3],
  data: { tasks: mediumDataset },
  params: {},
  query: {},
}

describe('HTMLRenderer - list layout', () => {
  bench('render list page (5 rows)', () => {
    renderer.renderPage(listPageSmall)
  })

  bench('render list page (25 rows)', () => {
    renderer.renderPage(listPageMedium)
  })

  bench('render list page (100 rows)', () => {
    renderer.renderPage(listPageLarge)
  })
})

describe('HTMLRenderer - other layouts', () => {
  bench('render detail page', () => {
    renderer.renderPage(detailPage)
  })

  bench('render form page (4 fields)', () => {
    renderer.renderPage(formPage)
  })

  bench('render dashboard page (25 rows)', () => {
    renderer.renderPage(dashboardPage)
  })
})

describe('HTMLRenderer - renderer construction', () => {
  bench('construct new HTMLRenderer', () => {
    new HTMLRenderer(blueprint)
  })
})
