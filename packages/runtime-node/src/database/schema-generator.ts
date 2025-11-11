/**
 * Schema Generator
 *
 * Generates Drizzle schema from Blueprint entity definitions.
 */

import { sql } from 'drizzle-orm'
import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  real as sqliteReal,
  index as sqliteIndex,
  uniqueIndex as sqliteUniqueIndex,
} from 'drizzle-orm/sqlite-core'
import {
  pgTable,
  text as pgText,
  integer as pgInteger,
  real as pgReal,
  boolean as pgBoolean,
  timestamp as pgTimestamp,
  index as pgIndex,
  uniqueIndex as pgUniqueIndex,
  uuid as pgUuid,
} from 'drizzle-orm/pg-core'
import type { Blueprint, Entity, Field } from '@zebric/runtime-core'

export interface GeneratedSchema {
  tables: Record<string, any>
  indexes: any[]
  relations: any[]
}

export class SchemaGenerator {
  constructor(private dbType: 'sqlite' | 'postgres' | 'mysql' = 'sqlite') {}

  /**
   * Generate Drizzle schema from Blueprint
   */
  generate(blueprint: Blueprint): GeneratedSchema {
    const tables: Record<string, any> = {}
    const indexes: any[] = []
    const relations: any[] = []

    for (const entity of blueprint.entities) {
      // Skip User entity if auth is enabled - let Better Auth manage it
      if (entity.name === 'User' && blueprint.auth?.providers) {
        continue
      }

      const { table, entityIndexes, entityRelations } = this.generateTable(entity)
      tables[entity.name] = table
      indexes.push(...entityIndexes)
      relations.push(...entityRelations)
    }

    return { tables, indexes, relations }
  }

  /**
   * Generate table definition for an entity
   */
  private generateTable(entity: Entity) {
    const columns: Record<string, any> = {}
    const entityIndexes: any[] = []
    const entityRelations: any[] = []

    // Generate columns from fields
    for (const field of entity.fields) {
      // Use snake_case for column keys to match SQL column names
      const columnKey = this.toSnakeCase(field.name)
      columns[columnKey] = this.generateColumn(field)
    }

    // Create table with appropriate table function
    let table: any

    if (this.dbType === 'postgres') {
      table = pgTable(
        this.toSnakeCase(entity.name),
        columns,
        (table: any) => {
          const constraints: Record<string, any> = {}

          // Add indexes
          if (entity.indexes) {
            entity.indexes.forEach((idx, i) => {
              const name = idx.name || `idx_${entity.name}_${i}`
              const columns = idx.fields.map((f) => table[f])
              if (idx.unique) {
                constraints[name] = pgUniqueIndex(name).on(...(columns as [any, ...any[]]))
              } else {
                constraints[name] = pgIndex(name).on(...(columns as [any, ...any[]]))
              }
            })
          }

          return constraints
        }
      )
    } else {
      table = sqliteTable(
        this.toSnakeCase(entity.name),
        columns,
        (table: any) => {
          const constraints: Record<string, any> = {}

          // Add indexes
          if (entity.indexes) {
            entity.indexes.forEach((idx, i) => {
              const name = idx.name || `idx_${entity.name}_${i}`
              const columns = idx.fields.map((f) => table[f])
              if (idx.unique) {
                constraints[name] = sqliteUniqueIndex(name).on(...(columns as [any, ...any[]]))
              } else {
                constraints[name] = sqliteIndex(name).on(...(columns as [any, ...any[]]))
              }
            })
          }

          return constraints
        }
      )
    }

    return { table, entityIndexes, entityRelations }
  }

  /**
   * Generate column definition for a field
   */
  private generateColumn(field: Field): any {
    const columnName = this.toSnakeCase(field.name)
    let column: any

    // Map Blueprint types to Drizzle types based on database type
    if (this.dbType === 'postgres') {
      switch (field.type) {
        case 'ULID':
        case 'Text':
        case 'Email':
          column = pgText(columnName)
          break

        case 'UUID':
          column = pgUuid(columnName)
          break

        case 'LongText':
          column = pgText(columnName)
          break

        case 'Integer':
          column = pgInteger(columnName)
          break

        case 'Float':
          column = pgReal(columnName)
          break

        case 'Boolean':
          column = pgBoolean(columnName)
          break

        case 'DateTime':
          column = pgTimestamp(columnName, { withTimezone: true })
          break

        case 'Date':
          column = pgText(columnName) // Store as ISO string
          break

        case 'JSON':
          column = pgText(columnName)
          break

        case 'Enum':
          if (field.values && field.values.length > 0) {
            column = pgText(columnName)
          } else {
            column = pgText(columnName)
          }
          break

        case 'Ref':
          // Foreign key - store as text (ULID/UUID)
          column = pgText(columnName)
          break

        default:
          column = pgText(columnName)
      }
    } else {
      // SQLite
      switch (field.type) {
        case 'ULID':
        case 'UUID':
        case 'Text':
        case 'Email':
          column = sqliteText(columnName)
          break

        case 'LongText':
          column = sqliteText(columnName)
          break

        case 'Integer':
          column = sqliteInteger(columnName)
          break

        case 'Float':
          column = sqliteReal(columnName)
          break

        case 'Boolean':
          column = sqliteInteger(columnName, { mode: 'boolean' })
          break

        case 'DateTime':
          column = sqliteInteger(columnName, { mode: 'timestamp' })
          break

        case 'Date':
          column = sqliteText(columnName) // Store as ISO string
          break

        case 'JSON':
          column = sqliteText(columnName, { mode: 'json' })
          break

        case 'Enum':
          if (field.values && field.values.length > 0) {
            column = sqliteText(columnName, { enum: field.values as [string, ...string[]] })
          } else {
            column = sqliteText(columnName)
          }
          break

        case 'Ref':
          // Foreign key - store as text (ULID/UUID)
          column = sqliteText(columnName)
          break

        default:
          column = sqliteText(columnName)
      }
    }

    // Apply modifiers
    if (field.primary_key) {
      column = column.primaryKey()
    }

    if (field.unique) {
      column = column.unique()
    }

    if (field.required && !field.primary_key) {
      column = column.notNull()
    }

    if (field.default !== undefined) {
      if (field.default === 'now' && (field.type === 'DateTime' || field.type === 'Date')) {
        column = column.default(sql`CURRENT_TIMESTAMP`)
      } else if (typeof field.default === 'string') {
        column = column.default(field.default)
      } else if (typeof field.default === 'number') {
        column = column.default(field.default)
      } else if (typeof field.default === 'boolean') {
        column = column.default(field.default)
      }
    }

    return column
  }

  /**
   * Generate SQL statements to create a single entity (table + indexes).
   */
  generateCreateStatementsForEntity(entity: Entity): string[] {
    const tableName = this.toSnakeCase(entity.name)
    const columns = entity.fields.map((field) => this.getColumnDefinition(field)).join(',\n  ')

    const statements: string[] = [
      `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${columns}\n);`,
    ]

    if (entity.indexes) {
      entity.indexes.forEach((idx, i) => {
        const indexName = idx.name || `idx_${entity.name}_${i}`
        const columnNames = idx.fields.map((f) => this.toSnakeCase(f)).join(', ')
        const unique = idx.unique ? 'UNIQUE ' : ''
        statements.push(`CREATE ${unique}INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columnNames});`)
      })
    }

    entity.fields
      .filter((f) => f.unique && !f.primary_key)
      .forEach((field) => {
        const indexName = `idx_${entity.name}_${field.name}_unique`
        statements.push(
          `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${this.toSnakeCase(field.name)});`
        )
      })

    return statements
  }

  /**
   * Generate SQL statement to add a column to an existing table.
   * Returns the main ALTER TABLE statement plus any post-statements (e.g. indexes).
   */
  generateAddColumnStatements(entity: Entity, field: Field): { statement: string; postStatements: string[] } {
    const tableName = this.toSnakeCase(entity.name)
    const columnDefinition = this.getColumnDefinition(field, { forAlter: true })
    const statement = `ALTER TABLE ${tableName} ADD COLUMN ${columnDefinition};`

    const postStatements: string[] = []

    if (field.unique && !field.primary_key) {
      const indexName = `idx_${entity.name}_${field.name}_unique`
      postStatements.push(
        `CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${this.toSnakeCase(field.name)});`
      )
    }

    return { statement, postStatements }
  }

  /**
   * Expose table naming utility.
   */
  getTableName(entityName: string): string {
    return this.toSnakeCase(entityName)
  }

  /**
   * Generate column definition SQL fragment.
   */
  getColumnDefinition(field: Field, options: { forAlter?: boolean } = {}): string {
    const { forAlter } = options
    const columnName = this.toSnakeCase(field.name)

    const type = this.mapFieldType(field)
    const parts = [`${columnName} ${type}`]

    if (field.primary_key && !forAlter) {
      parts.push('PRIMARY KEY')
    }

    if (field.unique && !forAlter && !field.primary_key) {
      parts.push('UNIQUE')
    }

    if (field.required && !field.nullable && !field.primary_key) {
      parts.push('NOT NULL')
    }

    if (field.default !== undefined) {
      if (field.default === 'now' && (field.type === 'DateTime' || field.type === 'Date')) {
        parts.push('DEFAULT CURRENT_TIMESTAMP')
      } else if (typeof field.default === 'string') {
        parts.push(`DEFAULT '${field.default}'`)
      } else if (typeof field.default === 'number') {
        parts.push(`DEFAULT ${field.default}`)
      } else if (typeof field.default === 'boolean') {
        parts.push(`DEFAULT ${field.default ? 1 : 0}`)
      }
    }

    return parts.join(' ')
  }

  private mapFieldType(field: Field): string {
    switch (field.type) {
      case 'Integer':
      case 'Boolean':
      case 'DateTime':
        return 'INTEGER'
      case 'Float':
        return 'REAL'
      case 'ULID':
      case 'UUID':
      case 'Text':
      case 'Email':
      case 'LongText':
      case 'Date':
      case 'JSON':
      case 'Enum':
      case 'Ref':
      default:
        return 'TEXT'
    }
  }

  /**
   * Convert camelCase to snake_case
   */
  private toSnakeCase(str: string): string {
    return str
      .replace(/[A-Z]/g, (letter, index) =>
        index === 0 ? letter.toLowerCase() : `_${letter.toLowerCase()}`
      )
  }

  /**
   * Generate initial schema statements for full Blueprint.
   */
  generateInitialSchemaStatements(blueprint: Blueprint): string[] {
    const statements: string[] = []

    if (blueprint.auth?.providers) {
      statements.push(...this.getBetterAuthSchema())
    }

    for (const entity of blueprint.entities) {
      if (entity.name === 'User' && blueprint.auth?.providers) {
        continue
      }
      statements.push(...this.generateCreateStatementsForEntity(entity))
    }

    return statements
  }

  /**
   * Get Better Auth schema for SQLite
   * Based on Better Auth v1 core schema
   */
  private getBetterAuthSchema(): string[] {
    return [
      `CREATE TABLE IF NOT EXISTS user (
  id TEXT PRIMARY KEY,
  name TEXT,
  email TEXT NOT NULL,
  emailVerified INTEGER,
  image TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);`,
      `CREATE TABLE IF NOT EXISTS session (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expiresAt INTEGER NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);`,
      `CREATE TABLE IF NOT EXISTS account (
  id TEXT PRIMARY KEY,
  userId TEXT NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  accessToken TEXT,
  refreshToken TEXT,
  accessTokenExpiresAt INTEGER,
  refreshTokenExpiresAt INTEGER,
  scope TEXT,
  idToken TEXT,
  password TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);`,
      `CREATE TABLE IF NOT EXISTS verification (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt INTEGER NOT NULL,
  createdAt INTEGER,
  updatedAt INTEGER
);`
    ]
  }
}
