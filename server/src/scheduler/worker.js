import { makeId, nowIso } from '../domain/schemas.js'

export class CollectionWorker {
  constructor({ repository, pipeline, eventBus, logger, pollMs = 1000, workerId = `worker-${process.pid}` }) {
    this.repository = repository
    this.pipeline = pipeline
    this.eventBus = eventBus
    this.logger = logger
    this.pollMs = pollMs
    this.workerId = workerId
    this.timer = null
    this.stopped = true
  }

  start() {
    if (!this.stopped) return
    this.stopped = false
    this.#schedule(0)
  }

  stop() {
    this.stopped = true
    clearTimeout(this.timer)
    this.timer = null
  }

  #schedule(delay = this.pollMs) {
    if (this.stopped) return
    this.timer = setTimeout(() => this.#work().finally(() => this.#schedule()), delay)
    this.timer.unref?.()
  }

  async #work() {
    const job = await this.repository.claimJob(this.workerId)
    if (!job) return
    try {
      const result = await this.pipeline.processSource(job.sourceId)
      await this.repository.completeJob(job.id)
      await this.logger.info('collection.job.completed', { jobId: job.id, sourceId: job.sourceId, outcome: result.outcome })
    } catch (error) {
      const failedJob = await this.repository.failJob(job.id, error.message)
      const source = await this.repository.getSource(job.sourceId)
      const at = nowIso()
      const event = {
        id: makeId(), eventType: 'source.failed', occurredAt: at, regionCode: null, regionName: '全国',
        indicatorCode: null, indicatorName: '数据源采集状态', previousValue: null, currentValue: null, unit: null,
        sourceId: source?.id ?? job.sourceId, sourceName: source?.name ?? job.sourceId, sourceUrl: source?.url ?? null,
        triggerRule: failedJob.status === 'failed' ? '采集重试次数已耗尽' : '采集失败，已进入指数退避重试',
        versionId: null, versionCode: null, severity: failedJob.status === 'failed' ? 'error' : 'warning',
        details: { jobId: job.id, attempts: failedJob.attempts, maxAttempts: failedJob.maxAttempts, error: error.message }, createdAt: at,
      }
      await this.repository.appendEvents([event])
      this.eventBus.publish(event)
      await this.logger.error('collection.job.failed', { jobId: job.id, sourceId: job.sourceId, error, nextStatus: failedJob.status })
    }
  }
}
