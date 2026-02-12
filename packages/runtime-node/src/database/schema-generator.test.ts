import { describe, expect, it } from 'vitest'
import { SchemaGenerator } from './schema-generator.js'

function entity(name: string, fields: any[], indexes?: any[]) {
  return { name, fields, indexes }
}

function blueprint(entities: any[], auth?: any) {
  return {
    version: '1.0',
    project: { name: 'x', version: '0.1.0', runtime: { min_version: '0.1.0' } },
    entities,
    pages: [],
    auth,
  } as any
}

describe('SchemaGenerator', () => {
  it('generates tables and skips User when auth providers are enabled', () => {
    const generator = new SchemaGenerator('sqlite')
    const bp = blueprint(
      [
        entity('User', [{ name: 'id', type: 'ULID', primary_key: true }]),
        entity('BlogPost', [{ name: 'id', type: 'ULID', primary_key: true }]),
      ],
      { providers: ['email'] }
    )

    const generated = generator.generate(bp)
    expect(Object.keys(generated.tables)).toEqual(['BlogPost'])
  })

  it('generates tables for postgres path as well', () => {
    const generator = new SchemaGenerator('postgres')
    const bp = blueprint([
      entity(
        'OrderItem',
        [
          { name: 'id', type: 'UUID', primary_key: true },
          { name: 'createdAt', type: 'DateTime', required: true },
        ],
        [{ fields: ['id'], unique: true, name: 'u_idx' }]
      ),
    ])

    const generated = generator.generate(bp)
    expect(generated.tables.OrderItem).toBeDefined()
  })

  it('creates SQL statements for entity tables and indexes', () => {
    const generator = new SchemaGenerator()
    const statements = generator.generateCreateStatementsForEntity(
      entity(
        'BlogPost',
        [
          { name: 'id', type: 'ULID', primary_key: true },
          { name: 'title', type: 'Text', required: true, unique: true },
        ],
        [{ fields: ['title'], unique: false, name: 'idx_blog_title' }]
      )
    )

    expect(statements[0]).toContain('CREATE TABLE IF NOT EXISTS blog_post')
    expect(statements.join('\n')).toContain('CREATE INDEX IF NOT EXISTS idx_blog_title ON blog_post (title);')
    expect(statements.join('\n')).toContain('CREATE UNIQUE INDEX IF NOT EXISTS idx_BlogPost_title_unique ON blog_post (title);')
  })

  it('generates alter table add-column statement and unique post statement', () => {
    const generator = new SchemaGenerator()
    const result = generator.generateAddColumnStatements(
      entity('TodoItem', []),
      { name: 'status', type: 'Text', required: true, unique: true }
    )

    expect(result.statement).toBe('ALTER TABLE todo_item ADD COLUMN status TEXT NOT NULL;')
    expect(result.postStatements[0]).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS idx_TodoItem_status_unique ON todo_item (status);'
    )
  })

  it('maps names and default modifiers in column definitions', () => {
    const generator = new SchemaGenerator()

    expect(generator.getTableName('BlogPost')).toBe('blog_post')
    expect(generator.getColumnDefinition({ name: 'isActive', type: 'Boolean', default: true } as any))
      .toBe('is_active INTEGER DEFAULT 1')
    expect(generator.getColumnDefinition({ name: 'rating', type: 'Float', default: 4.5 } as any))
      .toBe('rating REAL DEFAULT 4.5')
    expect(generator.getColumnDefinition({ name: 'title', type: 'Text', default: 'hello' } as any))
      .toBe("title TEXT DEFAULT 'hello'")
    expect(generator.getColumnDefinition({ name: 'createdAt', type: 'DateTime', default: 'now' } as any))
      .toBe('created_at INTEGER DEFAULT CURRENT_TIMESTAMP')
  })

  it('omits primary key and unique modifiers for alter column definitions', () => {
    const generator = new SchemaGenerator()
    const sql = generator.getColumnDefinition(
      { name: 'id', type: 'ULID', primary_key: true, unique: true, required: true } as any,
      { forAlter: true }
    )
    expect(sql).toBe('id TEXT')
  })

  it('generates initial schema including Better Auth tables when auth is enabled', () => {
    const generator = new SchemaGenerator()
    const bp = blueprint(
      [
        entity('User', [{ name: 'id', type: 'ULID', primary_key: true }]),
        entity('Task', [{ name: 'id', type: 'ULID', primary_key: true }]),
      ],
      { providers: ['email'] }
    )

    const statements = generator.generateInitialSchemaStatements(bp)
    const combined = statements.join('\n')

    expect(combined).toContain('CREATE TABLE IF NOT EXISTS user')
    expect(combined).toContain('CREATE TABLE IF NOT EXISTS session')
    expect(combined).toContain('CREATE TABLE IF NOT EXISTS account')
    expect(combined).toContain('CREATE TABLE IF NOT EXISTS verification')
    expect(combined).toContain('CREATE TABLE IF NOT EXISTS task')
    const userTableMatches = combined.match(/CREATE TABLE IF NOT EXISTS user \(/g) || []
    expect(userTableMatches).toHaveLength(1)
  })
})
