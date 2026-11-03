import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createBackup, verifyBackup } from '../src/operations/backup.js'

test('文件仓储备份包含状态、原始快照、配置与可验证清单', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'population-backup-test-'))
  const fileDataDir = path.join(root, 'state-source')
  const rawStorageDir = path.join(root, 'raw-source')
  const configDir = path.join(root, 'config-source')
  const outputRoot = path.join(root, 'backup-output')
  await fs.mkdir(fileDataDir)
  await fs.mkdir(rawStorageDir)
  await fs.mkdir(configDir)
  await fs.writeFile(path.join(fileDataDir, 'state.json'), '{"schemaVersion":1}', 'utf8')
  await fs.writeFile(path.join(rawStorageDir, 'snapshot.html'), '<p>official</p>', 'utf8')
  await fs.writeFile(path.join(configDir, 'sources.json'), '[]', 'utf8')
  await fs.writeFile(path.join(configDir, 'bootstrap.json'), '{}', 'utf8')

  const result = await createBackup({
    outputRoot,
    storageDriver: 'file',
    fileDataDir,
    rawStorageDir,
    sourcesPath: path.join(configDir, 'sources.json'),
    bootstrapPath: path.join(configDir, 'bootstrap.json'),
  })
  assert.equal(result.verification.ok, true)
  assert.equal(result.manifest.fileCount, 4)
  assert.ok(result.manifest.files.every((item) => item.sha256.length === 64))

  await fs.writeFile(path.join(result.backupDir, 'state', 'state.json'), '{"corrupted":true}', 'utf8')
  const corrupted = await verifyBackup(result.backupDir)
  assert.equal(corrupted.ok, false)
  assert.ok(corrupted.errors.some((error) => error.includes('state/state.json')))
})
