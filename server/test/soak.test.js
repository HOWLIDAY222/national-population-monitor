import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createApplication } from '../src/application.js'
import { loadConfig } from '../src/config.js'

test('文件仓储在连续作业领取与并发读取中保持可恢复一致状态', { timeout: 30_000 }, async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'population-soak-'))
  const environment = {
    NODE_ENV: 'test',
    STORAGE_DRIVER: 'file',
    SCHEDULER_ENABLED: 'false',
    FILE_DATA_DIR: path.join(directory, 'data'),
    RAW_STORAGE_DIR: path.join(directory, 'raw'),
    MONITORING_DIR: path.join(directory, 'logs'),
    SOURCES_PATH: path.resolve('data/sources.json'),
    BOOTSTRAP_PATH: path.resolve('data/bootstrap.json'),
  }
  const configuredSourceCount = JSON.parse(await fs.readFile(environment.SOURCES_PATH, 'utf8')).length
  const application = await createApplication(loadConfig(environment))
  const sources = await application.repository.listSources()
  const cycles = 120
  try {
    for (let index = 0; index < cycles; index += 1) {
      const source = sources[index % sources.length]
      const job = await application.repository.enqueueSource(source.id, { priority: index % 7 })
      const [claimed, statusDuringClaim, snapshotDuringClaim] = await Promise.all([
        application.repository.claimJob(`soak-worker-${index % 4}`),
        application.repository.getStatus(),
        application.repository.getSnapshot(),
      ])
      assert.equal(claimed.id, job.id)
      assert.equal(statusDuringClaim.connection, 'connected')
      assert.ok(snapshotDuringClaim.records.length > 0)
      await application.repository.completeJob(claimed.id)
    }
  } finally {
    await application.repository.close()
  }

  const restarted = await createApplication(loadConfig(environment))
  try {
    const status = await restarted.repository.getStatus()
    assert.deepEqual(status.jobs, { pending: 0, processing: 0, failed: 0 })
    assert.equal((await restarted.repository.listSources()).length, configuredSourceCount)
    assert.ok((await restarted.repository.getSnapshot()).records.length > 0)
  } finally {
    await restarted.repository.close()
  }
})
