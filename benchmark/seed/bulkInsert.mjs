function toSnakeCase(input) {
  return input.replace(/[A-Z]/g, (char, index) => index === 0 ? char.toLowerCase() : `_${char.toLowerCase()}`)
}

function quoteIdentifier(connection, identifier) {
  if (connection.getPostgres()) {
    return `"${identifier.replace(/"/g, '""')}"`
  }
  return identifier
}

function escapeValue(connection, value) {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'boolean') {
    if (connection.getPostgres()) {
      return value ? 'TRUE' : 'FALSE'
    }
    return value ? '1' : '0'
  }
  if (typeof value === 'object') return `'${JSON.stringify(value).replace(/'/g, "''")}'`
  return `'${String(value).replace(/'/g, "''")}'`
}

async function executeSql(connection, sql) {
  const sqlite = connection.getSQLite()
  if (sqlite) {
    sqlite.exec(sql)
    return
  }

  const postgres = connection.getPostgres()
  await postgres.unsafe(sql)
}

export async function bulkInsertEntity(connection, entityName, rows, batchSize = 1000) {
  if (!rows.length) {
    return 0
  }

  let inserted = 0

  for (let index = 0; index < rows.length; index += batchSize) {
    const batch = rows.slice(index, index + batchSize)
    const columnKeys = Object.keys(batch[0])
    const tableName = quoteIdentifier(connection, toSnakeCase(entityName))
    const columns = columnKeys.map((key) => quoteIdentifier(connection, toSnakeCase(key)))
    const values = batch
      .map((row) => `(${columnKeys.map((key) => escapeValue(connection, row[key])).join(', ')})`)
      .join(',\n')
    const sql = `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES\n${values};`
    await executeSql(connection, sql)
    inserted += batch.length
  }

  return inserted
}
