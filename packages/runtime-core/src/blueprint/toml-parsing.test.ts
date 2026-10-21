/**
 * Blueprint TOML parsing: behavior plus the denial-of-service cases that have
 * affected `smol-toml` (infinite loop on an unterminated trailing comment, and
 * quadratic key scanning). Blueprints can come from untrusted sources, so the
 * parser must always terminate promptly.
 */
import { describe, expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { parse as parseToml } from 'smol-toml'
import { BlueprintParser, BlueprintValidationError } from './loader.js'

const parser = new BlueprintParser()

const VALID = `
version = "1.0"

[project]
name = "toml-test"
version = "0.1.0"

[project.runtime]
min_version = "0.1.0"

[entity.Task]
fields = [
  { name = "id", type = "ULID", primary_key = true },
  { name = "title", type = "Text", required = true }
]
`

describe('Blueprint TOML parsing', () => {
  it('parses a valid blueprint using [entity.Name] tables and inline field tables', () => {
    const blueprint = parser.parse(VALID, 'toml', 'valid.toml')
    expect(blueprint.project.name).toBe('toml-test')
    expect(blueprint.entities.map((e) => e.name)).toEqual(['Task'])
    expect(blueprint.entities[0].fields.map((f) => f.name)).toEqual(['id', 'title'])
    expect(blueprint.hash).toMatch(/^sha256:[0-9a-f]+$/)
  })

  it('supports comments, multi-line strings and arrays of tables', () => {
    const source = `${VALID}
# trailing comment
[[entities]]
name = "Note"
fields = [ { name = "id", type = "ULID", primary_key = true }, ] # comment after array
`
    const blueprint = parser.parse(source, 'toml')
    expect(blueprint.entities.map((e) => e.name).sort()).toEqual(['Note', 'Task'])
  })

  it('reports syntax errors as structured parse errors with the source file and position', () => {
    let error: unknown
    try {
      parser.parse('version = "1.0"\n[project\nname = "x"', 'toml', 'broken.toml')
    } catch (e) {
      error = e
    }
    expect(error).toBeInstanceOf(BlueprintValidationError)
    const details = (error as BlueprintValidationError).structured
    expect(details.type).toBe('PARSE_ERROR')
    expect(details.file).toBe('broken.toml')
    expect(details.errors[0].location.line).toBeGreaterThan(0)
  })

  it.each([
    ['unterminated string', 'a = "abc'],
    ['duplicate key', 'a = 1\na = 2'],
    ['redefined table', '[a]\nx = 1\n[a]\ny = 2'],
    ['bad number', 'a = 1__0'],
    ['missing value', 'a ='],
    ['unterminated array', 'a = [1, 2'],
    ['unterminated inline table', 'a = { b = 1'],
  ])('rejects %s without throwing a non-parse error', (_name, source) => {
    expect(() => parser.parse(source, 'toml')).toThrow(BlueprintValidationError)
  })

  it('does not let TOML keys pollute Object.prototype', () => {
    const source = `${VALID}\n[__proto__]\npolluted = "yes"\n[constructor.prototype]\npolluted = "yes"\n`
    try {
      parser.parse(source, 'toml')
    } catch {
      // rejection is fine; pollution is not
    }
    expect(({} as any).polluted).toBeUndefined()
  })
})

describe('TOML parser denial-of-service resistance', () => {
  // These inputs made smol-toml <= 1.7.0 loop forever, which would freeze a test runner,
  // so they run in a child process with a hard timeout.
  const hangVectors = ['a=[1 #', 'a={b=1 #', 'a=[[1 #', 'a = [1, 2 # comment without newline', 'x = { y = [1, 2 #']

  it.each(hangVectors)('terminates promptly and throws for an unterminated trailing comment: %j', (vector) => {
    const smolToml = createRequire(import.meta.url).resolve('smol-toml')
    const script = `
      const { parse } = await import(${JSON.stringify(smolToml)})
      try { parse(process.argv[1]); console.log('parsed') } catch (e) { console.log('threw:' + e.constructor.name) }
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, vector], {
      timeout: 5_000,
      killSignal: 'SIGKILL',
      encoding: 'utf8',
    })
    expect(result.error, 'parser did not terminate (hung)').toBeUndefined()
    expect(result.status).toBe(0)
    expect(result.stdout.trim()).toMatch(/^threw:/)
  })

  it.each([
    ['inline-table lines', (n: number) => Array.from({ length: n }, (_, i) => `k${i} = { a = 1, b = 2 }`).join('\n')],
    ['tables', (n: number) => Array.from({ length: n }, (_, i) => `[t${i}]\nv = ${i}`).join('\n')],
  ])('parses a large document of %s in linear time (no quadratic key scanning)', (_name, generate) => {
    // 80k lines took several seconds with smol-toml <= 1.8.0 and ~tens of milliseconds after the fix;
    // the generous bound keeps this stable on slow CI machines.
    const source = generate(80_000)
    const started = performance.now()
    const data = parseToml(source)
    const elapsed = performance.now() - started
    expect(Object.keys(data).length).toBeGreaterThan(1_000)
    expect(elapsed).toBeLessThan(1_500)
  }, 30_000)
})
