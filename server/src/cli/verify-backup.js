import path from 'node:path'
import { verifyBackup } from '../operations/backup.js'

const backupDir = process.argv[2]
if (!backupDir) throw new Error('Usage: pnpm --dir server verify:backup <backup-directory>')
const result = await verifyBackup(path.resolve(backupDir))
console.log(JSON.stringify({ ok: result.ok, checkedFiles: result.checkedFiles, errors: result.errors }, null, 2))
if (!result.ok) process.exitCode = 1
