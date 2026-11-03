import path from 'node:path'
import { createApplication } from '../application.js'
import { loadConfig } from '../config.js'
import { createBackup } from '../operations/backup.js'

const argumentValue = (name) => {
  const index = process.argv.indexOf(name)
  return index === -1 ? null : process.argv[index + 1]
}

const config = loadConfig({ ...process.env, SCHEDULER_ENABLED: 'false' })
const outputRoot = path.resolve(argumentValue('--output') ?? process.env.BACKUP_DIR ?? path.resolve('backups'))

const application = await createApplication(config)
await application.repository.close()

const result = await createBackup({
  outputRoot,
  storageDriver: config.storageDriver,
  fileDataDir: config.fileDataDir,
  rawStorageDir: config.rawStorageDir,
  sourcesPath: config.sourcesPath,
  bootstrapPath: config.bootstrapPath,
  databaseUrl: config.databaseUrl,
  pgDumpPath: process.env.PG_DUMP_PATH ?? 'pg_dump',
})

console.log(JSON.stringify({
  backupDir: result.backupDir,
  storageDriver: result.manifest.storageDriver,
  fileCount: result.manifest.fileCount,
  totalBytes: result.manifest.totalBytes,
  verified: result.verification.ok,
}, null, 2))
