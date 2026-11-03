export class CollectionScheduler {
  constructor({ repository, logger, pollMs = 15000, jobStaleMs = 10 * 60 * 1000 }) {
    this.repository = repository
    this.logger = logger
    this.pollMs = pollMs
    this.jobStaleMs = jobStaleMs
    this.timer = null
    this.running = false
  }

  async tick() {
    if (this.running) return []
    this.running = true
    try {
      const recovered = await this.repository.recoverStaleJobs(new Date().toISOString(), this.jobStaleMs)
      if (recovered.length) {
        await this.logger.warn('scheduler.jobs.recovered', {
          count: recovered.length,
          jobIds: recovered.map((job) => job.id),
        })
      }
      const jobs = await this.repository.enqueueDueSources()
      if (jobs.length) await this.logger.info('scheduler.jobs.enqueued', { count: jobs.length, sourceIds: jobs.map((job) => job.sourceId) })
      return jobs
    } finally {
      this.running = false
    }
  }

  start() {
    if (this.timer) return
    this.tick().catch((error) => this.logger.error('scheduler.tick.failed', { error }))
    this.timer = setInterval(() => this.tick().catch((error) => this.logger.error('scheduler.tick.failed', { error })), this.pollMs)
    this.timer.unref?.()
  }

  stop() {
    clearInterval(this.timer)
    this.timer = null
  }
}
