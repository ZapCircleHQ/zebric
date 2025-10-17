/**
 * Database Connection
 *
 * Manages database connections using Drizzle ORM.
 * Supports SQLite and PostgreSQL.
 */

import { drizzle as drizzleSQLite } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { SchemaGenerator } from './schema-generator.js'
import type { Blueprint, Entity } from '../types/blueprint.js'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import type { SchemaDiffResult, EntityFieldChange } from './schema-diff.js'
import { sql } from 'drizzle-orm'
import { createHash } from 'node:crypto'

export interface DatabaseConfig {
  type: 'sqlite' | 'postgres' | 'mysql'
  path?: string // For SQLite
  url?: string // For PostgreSQL/MySQL
}

export class DatabaseConnection {
  private db!: BetterSQLite3Database | PostgresJsDatabase
  private sqlite?: Database.Database
  private postgres?: postgres.Sql
  private schema: any
  private schemaGenerator: SchemaGenerator
  private readonly migrationsTable = '__zbl_migrations'
  private migrationsInitialized = false
  private lastMigrationMillis = 0

  constructor(
    private config: DatabaseConfig,
    private blueprint: Blueprint
  ) {
    this.schemaGenerator = new SchemaGenerator(config.type)
  }

  /**
   * Connect to database and initialize schema
   */
  async connect(): Promise<void> {
    if (this.config.type === 'sqlite') {
      await this.connectSQLite()
    } else if (this.config.type === 'postgres') {
      await this.connectPostgres()
    } else {
      throw new Error(`Database type ${this.config.type} not yet supported`)
    }

    // Generate schema from Blueprint
    const generated = this.schemaGenerator.generate(this.blueprint)
    this.schema = generated.tables

    // Run migrations (create tables if they don't exist)
    await this.migrate()
  }

  /**
   * Connect to SQLite database
   */
  private async connectSQLite(): Promise<void> {
    const dbPath = this.config.path || './data/app.db'

    // Ensure directory exists
    const dir = dirname(dbPath)
    try {
      mkdirSync(dir, { recursive: true })
    } catch (err) {
      // Directory might already exist
    }

    // Create/open database
    this.sqlite = new Database(dbPath)

    // Enable foreign keys
    this.sqlite.pragma('foreign_keys = ON')

    // Enable WAL mode for better concurrency
    this.sqlite.pragma('journal_mode = WAL')

    // Create Drizzle instance
    this.db = drizzleSQLite(this.sqlite)

    console.log(`✅ Connected to SQLite database: ${dbPath}`)
  }

  /**
   * Connect to PostgreSQL database
   */
  private async connectPostgres(): Promise<void> {
    if (!this.config.url) {
      throw new Error('PostgreSQL connection URL is required')
    }

    // Create postgres connection
    this.postgres = postgres(this.config.url, {
      max: 10, // Connection pool size
      idle_timeout: 20,
      connect_timeout: 10,
    })

    // Create Drizzle instance
    this.db = drizzlePostgres(this.postgres)

    console.log(`✅ Connected to PostgreSQL database`)
  }

  /**
   * Run migrations (create tables)
   */
  private async migrate(): Promise<void> {
    const statements = this.schemaGenerator.generateInitialSchemaStatements(this.blueprint)
    await this.runDrizzleMigration(statements, `initial:${this.blueprint.hash ?? 'bootstrap'}`)
    console.log('✅ Database schema synchronized')
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close()
    }
    if (this.postgres) {
      await this.postgres.end()
    }
  }

  /**
   * Lightweight health check to ensure the database connection is alive.
   */
  async healthCheck(): Promise<boolean> {
    try {
      if (!this.db) {
        return false
      }
      this.getSession().run(sql`SELECT 1`)
      return true
    } catch (error) {
      console.error('Database health check failed:', error)
      return false
    }
  }

  /**
   * Apply schema diff to underlying database.
   * Supports additive changes (new tables, new safe columns).
   * Returns a diff containing any remaining changes that require manual intervention.
   */
  async applySchemaDiff(diff: SchemaDiffResult, nextBlueprint: Blueprint): Promise<SchemaDiffResult> {
    if (!this.db) {
      throw new Error('Database connection not initialized')
    }

    const remaining: SchemaDiffResult = {
      entitiesAdded: [],
      entitiesRemoved: [...diff.entitiesRemoved],
      fieldsAdded: [],
      fieldsRemoved: [...diff.fieldsRemoved],
      fieldsChanged: [...diff.fieldsChanged],
      hasBreakingChanges: false,
      hasChanges: false,
    }

    // Handle entity additions (new tables)
    for (const entity of diff.entitiesAdded) {
      try {
        const statements = this.schemaGenerator.generateCreateStatementsForEntity(entity)
        await this.runDrizzleMigration(statements, `entity:${entity.name}:${nextBlueprint.hash ?? ''}`)
      } catch (error) {
        console.error(`Failed to create table for entity ${entity.name}:`, error)
        remaining.entitiesAdded.push(entity)
      }
    }

    // Handle field additions (safe column additions)
    for (const fieldChange of diff.fieldsAdded) {
      if (this.canSafelyAddField(fieldChange)) {
        try {
          const { statement, postStatements } = this.schemaGenerator.generateAddColumnStatements(
            this.getEntityByName(nextBlueprint, fieldChange.entity),
            fieldChange.field
          )
          const statements = [statement, ...postStatements]
          await this.runDrizzleMigration(statements, `add:${fieldChange.entity}.${fieldChange.field.name}:${nextBlueprint.hash ?? ''}`)
        } catch (error) {
          console.error(`Failed to add column ${fieldChange.field.name} to ${fieldChange.entity}:`, error)
          remaining.fieldsAdded.push(fieldChange)
        }
      } else {
        remaining.fieldsAdded.push(fieldChange)
      }
    }

    // Update internal schema representation to reflect new blueprint
    this.blueprint = nextBlueprint
    const generated = this.schemaGenerator.generate(nextBlueprint)
    this.schema = generated.tables

    remaining.hasChanges =
      remaining.entitiesAdded.length > 0 ||
      remaining.entitiesRemoved.length > 0 ||
      remaining.fieldsAdded.length > 0 ||
      remaining.fieldsRemoved.length > 0 ||
      remaining.fieldsChanged.length > 0

    remaining.hasBreakingChanges =
      remaining.entitiesRemoved.length > 0 ||
      remaining.fieldsRemoved.length > 0 ||
      remaining.fieldsChanged.length > 0 ||
      remaining.fieldsAdded.length > 0

    return remaining
  }

  /**
   * Get Drizzle database instance
   */
  getDb(): BetterSQLite3Database | PostgresJsDatabase {
    return this.db
  }

  /**
   * Get schema tables
   */
  getSchema(): Record<string, any> {
    return this.schema
  }

  /**
   * Get raw SQLite instance (for direct queries)
   */
  getSQLite(): Database.Database | undefined {
    return this.sqlite
  }

  /**
   * Get raw Postgres instance (for direct queries)
   */
  getPostgres(): postgres.Sql | undefined {
    return this.postgres
  }

  /**
   * Get entity table
   */
  getTable(entityName: string): any {
    return this.schema[entityName]
  }

  /**
   * Get entity definition from Blueprint
   */
  getEntity(entityName: string): any {
    return this.blueprint.entities.find(e => e.name === entityName)
  }

  private canSafelyAddField(change: EntityFieldChange): boolean {
    const field = change.field

    if (field.primary_key) {
      return false
    }

    if (field.required && !field.nullable && field.default === undefined) {
      return false
    }

    // SQLite limitations: cannot add column with CHECK or UNIQUE inline; handled separately
    return true
  }

  private getEntityByName(blueprint: Blueprint, name: string): Entity {
    const entity = blueprint.entities.find((e) => e.name === name)
    if (!entity) {
      throw new Error(`Entity ${name} not found in blueprint`)
    }
    return entity
  }

  private async runDrizzleMigration(statements: string[], tag: string): Promise<void> {
    if (statements.length === 0) {
      return
    }

    this.ensureMigrationsTable()

    const hash = createHash('sha256').update(tag).update(statements.join('\n')).digest('hex')
    if (this.migrationAlreadyApplied(hash)) {
      return
    }

    const folderMillis = this.nextMigrationTimestamp()
    const migrations = [
      {
        sql: statements,
        folderMillis,
        hash,
        bps: false,
      },
    ]

    this.getDialect().migrate(migrations, this.getSession(), { migrationsTable: this.migrationsTable })
  }

  private ensureMigrationsTable(): void {
    if (this.migrationsInitialized) {
      return
    }

    if (this.config.type === 'postgres') {
      this.getSession().execute(sql`
        CREATE TABLE IF NOT EXISTS ${sql.raw(this.migrationsTable)} (
          id SERIAL PRIMARY KEY,
          hash TEXT NOT NULL UNIQUE,
          created_at BIGINT NOT NULL
        )
      `)
    } else {
      this.getSession().run(sql`
        CREATE TABLE IF NOT EXISTS ${sql.raw(this.migrationsTable)} (
          id INTEGER PRIMARY KEY,
          hash TEXT NOT NULL UNIQUE,
          created_at NUMERIC NOT NULL
        )
      `)
    }

    this.migrationsInitialized = true
  }

  private migrationAlreadyApplied(hash: string): boolean {
    const existing = this.getSession().values(
      sql`SELECT 1 FROM ${sql.raw(this.migrationsTable)} WHERE hash = ${hash} LIMIT 1`
    )
    return existing.length > 0
  }

  private nextMigrationTimestamp(): number {
    const now = Date.now()
    if (now <= this.lastMigrationMillis) {
      this.lastMigrationMillis += 1
    } else {
      this.lastMigrationMillis = now
    }
    return this.lastMigrationMillis
  }

  private getSession(): any {
    return (this.db as any).session
  }

  private getDialect(): any {
    return (this.db as any).dialect
  }
}
