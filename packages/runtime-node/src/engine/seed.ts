/**
 * Dev seeding
 *
 * Inserts the sample records declared in an entity's `seed` array. Entities
 * that already contain data are skipped, so restarting `zebric dev --seed`
 * never duplicates records.
 */

import { SYSTEM_SESSION } from '@zebric/runtime-core'
import type { Blueprint } from '@zebric/runtime-core'
import type { QueryExecutor } from '../database/query-executor.js'

interface SeedLogger {
  info(message: string, meta?: Record<string, unknown>): void
}

export async function seedDatabase(
  blueprint: Blueprint,
  queryExecutor: QueryExecutor,
  logger: SeedLogger
): Promise<void> {
  const context = { session: SYSTEM_SESSION }

  for (const entity of blueprint.entities) {
    if (!entity.seed?.length) continue

    const existing = await queryExecutor.count({ entity: entity.name }, context)
    if (existing > 0) {
      logger.info('Skipping seed, entity already has data', { entity: entity.name, existing })
      continue
    }

    for (const record of entity.seed) {
      await queryExecutor.create(entity.name, { ...record }, context)
    }
    logger.info('Seeded entity', { entity: entity.name, count: entity.seed.length })
  }
}
