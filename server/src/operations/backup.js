import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

const isInside = (candidate, parent) => {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

const exists = async (target) => fs.access(target).then(() => true, () => false)

const copyIfPresent = async (source, destination) => {
  if (!await exists(source)) return false
  await fs.mkdir(path.dirname(destination), { recursive: true })
  await fs.cp(source, destination, { recursive: true, errorOnExist: true, force: false })
  return true
}

const listFiles = async (directory, relative = '') => {
  const current = path.join(directory, relative)
  const entries = await fs.readdir(current, { withFileTypes: true })
  const files = []
  for (const entry of entries) {
    const next = path.join(relative, entry.name)
    if (entry.isDirectory()) files.push(...await listFiles(directory, next))
    else if (entry.isFile() && next !== 'manifest.json') files.push(next)
  }
  return files
}

const hashFile = async (filePath) => {
  const content = await fs.readFile(filePath)
  return {
    sha256: createHash('sha256').update(content).digest('hex'),
    byteSize: content.byteLength,
  }
}

const runPgDump = ({ executable, databaseUrl, outputPath }) => new Promise((resolve, reject) => {
  const connection = new URL(databaseUrl)
  if (!['postgres:', 'postgresql:'].includes(connection.protocol)) {
    reject(new Error('DATABASE_URL must use the postgres or postgresql protocol'))
    return
  }
  const databaseName = decodeURIComponent(connection.pathname.replace(/^\//, ''))
  const pgEnvironment = {
    ...process.env,
    PGPASSWORD: decodeURIComponent(connection.password),
    ...(connection.searchParams.get('sslmode') ? { PGSSLMODE: connection.searchParams.get('sslmode') } : {}),
  }
  const child = spawn(executable, [
    '--format=custom',
    '--no-owner',
    '--no-privileges',
    `--file=${outputPath}`,
    `--host=${connection.hostname}`,
    `--port=${connection.port || '5432'}`,
    `--username=${decodeURIComponent(connection.username)}`,
    `--dbname=${databaseName}`,
  ], { windowsHide: true, env: pgEnvironment, stdio: ['ignore', 'ignore', 'pipe'] })
  let errorOutput = ''
  child.stderr.on('data', (chunk) => { errorOutput += chunk.toString() })
  child.once('error', (error) => reject(new Error(`pg_dump could not start: ${error.message}`)))
  child.once('exit', (code) => {
    if (code === 0) resolve()
    else reject(new Error(`pg_dump failed with exit code ${code}: ${errorOutput.trim().slice(0, 500)}`))
  })
})

export async function createBackup({
  outputRoot,
  storageDriver,
  fileDataDir,
  rawStorageDir,
  sourcesPath,
  bootstrapPath,
  databaseUrl = '',
  pgDumpPath = 'pg_dump',
  createdAt = new Date().toISOString(),
}) {
  const resolvedOutput = path.resolve(outputRoot)
  for (const protectedInput of [fileDataDir, rawStorageDir, path.dirname(sourcesPath), path.dirname(bootstrapPath)]) {
    if (isInside(resolvedOutput, protectedInput)) {
      throw new Error(`Backup output must not be inside an input directory: ${resolvedOutput}`)
    }
  }
  const stamp = createdAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
  const backupDir = path.join(resolvedOutput, `population-${stamp}-${randomUUID().slice(0, 8)}`)
  await fs.mkdir(backupDir, { recursive: true })
  try {
    await copyIfPresent(sourcesPath, path.join(backupDir, 'config', 'sources.json'))
    await copyIfPresent(bootstrapPath, path.join(backupDir, 'config', 'bootstrap.json'))
    await copyIfPresent(rawStorageDir, path.join(backupDir, 'raw-storage'))
    if (storageDriver === 'file') {
      const statePath = path.join(fileDataDir, 'state.json')
      if (!await copyIfPresent(statePath, path.join(backupDir, 'state', 'state.json'))) {
        throw new Error(`File repository state was not found: ${statePath}`)
      }
    } else if (storageDriver === 'postgres') {
      if (!databaseUrl) throw new Error('DATABASE_URL is required for a PostgreSQL backup')
      await runPgDump({ executable: pgDumpPath, databaseUrl, outputPath: path.join(backupDir, 'database.dump') })
    } else {
      throw new Error(`Unsupported storage driver: ${storageDriver}`)
    }

    const files = await listFiles(backupDir)
    const entries = []
    for (const relativePath of files.sort()) {
      entries.push({ path: relativePath.replaceAll('\\', '/'), ...await hashFile(path.join(backupDir, relativePath)) })
    }
    const manifest = {
      formatVersion: 1,
      createdAt,
      storageDriver,
      fileCount: entries.length,
      totalBytes: entries.reduce((sum, item) => sum + item.byteSize, 0),
      files: entries,
    }
    await fs.writeFile(path.join(backupDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8')
    const verification = await verifyBackup(backupDir)
    if (!verification.ok) throw new Error(`Backup verification failed: ${verification.errors.join('; ')}`)
    return { backupDir, manifest, verification }
  } catch (error) {
    await fs.rm(backupDir, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export async function verifyBackup(backupDir) {
  const manifestPath = path.join(path.resolve(backupDir), 'manifest.json')
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
  const errors = []
  for (const expected of manifest.files) {
    const candidate = path.join(backupDir, expected.path)
    if (!isInside(candidate, backupDir)) {
      errors.push(`unsafe path ${expected.path}`)
      continue
    }
    try {
      const actual = await hashFile(candidate)
      if (actual.sha256 !== expected.sha256) errors.push(`hash mismatch ${expected.path}`)
      if (actual.byteSize !== expected.byteSize) errors.push(`size mismatch ${expected.path}`)
    } catch (error) {
      errors.push(`missing ${expected.path}: ${error.code ?? error.message}`)
    }
  }
  return { ok: errors.length === 0, checkedFiles: manifest.files.length, errors, manifest }
}
