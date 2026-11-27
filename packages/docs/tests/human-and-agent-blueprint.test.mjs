import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { BlueprintParser } from '../../runtime-core/dist/blueprint/loader.js'

test('following the tutorial edits produces the downloadable app contract', async () => {
  const base = await readFile(new URL('../public/quickstart/blueprint.toml', import.meta.url), 'utf8')
  const guide = await readFile(new URL('../src/content/docs/guides/human-and-agent.mdx', import.meta.url), 'utf8')
  const blocks = [...guide.matchAll(/```toml\n([\s\S]*?)\n```/g)].map(match => match[1])
  assert.equal(blocks.length, 3, 'Expected the field, command, and credential edits')
  const edited = base.replace('  { name = "published",', `${blocks[0]}\n  { name = "published",`)
    + `\n${blocks[1]}\n${blocks[2]}\n`
  const downloaded = await readFile(new URL('../public/human-and-agent/blueprint.toml', import.meta.url), 'utf8')
  const parser = new BlueprintParser()
  const actual = parser.parse(edited, 'toml')
  const expected = parser.parse(downloaded, 'toml')
  for (const key of ['entities', 'commands', 'pages', 'auth']) {
    assert.deepEqual(actual[key], expected[key], `Documented ${key} differ from the executable tutorial`)
  }
})
