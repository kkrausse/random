import { resolve } from 'node:path'
import { DuckDBInstance } from '@duckdb/node-api'
import type { DuckDBConnection } from '@duckdb/node-api'
import type { Plugin } from 'vite'
import type { DatabaseHost } from '../../src/engine/database.ts'
import { createBunDuckDbConnectionHost } from '../../src/hosts/bun/DuckDbHost.ts'

type Operation =
  | { op: 'query' | 'execute'; sql: string; parameters?: unknown[]; transactionId?: string }
  | { op: 'bulkInsert'; table: string; columns: string[]; rows: unknown[][]; transactionId?: string }
  | { op: 'begin' }
  | { op: 'commit' | 'rollback'; transactionId: string }

const readBody = (request: import('node:http').IncomingMessage) => new Promise<string>((resolveBody, reject) => {
  let body = ''
  request.setEncoding('utf8')
  request.on('data', (chunk) => {
    body += chunk
    if (body.length > 32 * 1024 * 1024) reject(new Error('Database request is too large'))
  })
  request.on('end', () => resolveBody(body))
  request.on('error', reject)
})

const json = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? { $databaseBigInt: item.toString() } : item)
const parse = (value: string) => JSON.parse(value, (_key, item) => item && typeof item === 'object' && Object.keys(item).length === 1 && typeof item.$databaseBigInt === 'string' ? BigInt(item.$databaseBigInt) : item) as Operation

export const localDatabasePlugin = (): Plugin => {
  let instance: DuckDBInstance | null = null
  const transactions = new Map<string, { connection: DuckDBConnection; host: DatabaseHost }>()
  const database = async () => instance ??= await DuckDBInstance.create(resolve(process.env.FITNESS_DATABASE_PATH ?? 'data/fitness.duckdb'))
  const connection = async () => {
    const value = await (await database()).connect()
    return { connection: value, host: createBunDuckDbConnectionHost(value) }
  }
  return {
    name: 'workout-local-database-host', apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__workout/database', async (request, response) => {
        response.setHeader('Content-Type', 'application/json')
        response.setHeader('Cache-Control', 'no-store')
        let temporary: DuckDBConnection | null = null
        try {
          if (request.method !== 'POST') throw new Error('Database host accepts POST requests only')
          const origin = request.headers.origin
          if (origin && new URL(origin).host !== request.headers.host) throw new Error('Cross-origin database access is not allowed')
          const operation = parse(await readBody(request))
          if (operation.op === 'begin') {
            const opened = await connection(); temporary = opened.connection
            await opened.host.execute('BEGIN TRANSACTION')
            const transactionId = crypto.randomUUID()
            transactions.set(transactionId, opened); temporary = null
            response.end(json({ transactionId })); return
          }
          if (operation.op === 'commit' || operation.op === 'rollback') {
            const active = transactions.get(operation.transactionId)
            if (!active) throw new Error('Unknown database transaction')
            transactions.delete(operation.transactionId)
            try { await active.host.execute(operation.op === 'commit' ? 'COMMIT' : 'ROLLBACK') } finally { active.connection.closeSync() }
            response.end('{}'); return
          }
          const active = operation.transactionId ? transactions.get(operation.transactionId) : await connection()
          if (!active) throw new Error('Unknown database transaction')
          if (!operation.transactionId) temporary = active.connection
          if (operation.op === 'query') response.end(json({ rows: await active.host.query(operation.sql, operation.parameters as never) }))
          else if (operation.op === 'execute') { await active.host.execute(operation.sql, operation.parameters as never); response.end('{}') }
          else if (operation.op === 'bulkInsert') { await active.host.bulkInsert(operation.table, operation.columns, operation.rows as never); response.end('{}') }
          else throw new Error('Invalid database operation')
        } catch (error) {
          response.statusCode = 400
          response.end(json({ error: error instanceof Error ? error.message : 'Database host request failed' }))
        } finally { temporary?.closeSync() }
      })
    },
    async closeBundle() {
      for (const { connection, host } of transactions.values()) { await host.execute('ROLLBACK').catch(() => undefined); connection.closeSync() }
      transactions.clear(); instance?.closeSync(); instance = null
    },
  }
}
