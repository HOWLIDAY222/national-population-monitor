import { loadConfig } from './config.js'
import { createRepository } from './storage/index.js'
import { RealtimeEventBus } from './realtime/event-bus.js'
import { StructuredLogger } from './monitoring/logger.js'
import { RawStorage } from './collection/raw-storage.js'
import { HttpCollector } from './collection/http-collector.js'
import { IndicatorValidator } from './validation/indicator-validator.js'
import { VersionPublisher } from './publishing/publisher.js'
import { CollectionPipeline } from './pipeline.js'
import { CollectionScheduler } from './scheduler/scheduler.js'
import { CollectionWorker } from './scheduler/worker.js'
import { createApiServer } from './api/server.js'

export async function createApplication(config = loadConfig()) {
  const logger = new StructuredLogger({ directory: config.monitoringDir })
  const repository = await createRepository(config)
  const eventBus = new RealtimeEventBus()
  const rawStorage = new RawStorage(config.rawStorageDir)
  const collector = new HttpCollector({ repository, rawStorage, logger })
  const validator = new IndicatorValidator({ repository })
  const publisher = new VersionPublisher({ repository, eventBus, logger })
  const pipeline = new CollectionPipeline({ repository, collector, validator, publisher, eventBus, logger })
  const scheduler = new CollectionScheduler({
    repository,
    logger,
    pollMs: config.schedulerPollMs,
    jobStaleMs: config.jobStaleMs,
  })
  const worker = new CollectionWorker({ repository, pipeline, eventBus, logger, pollMs: config.workerPollMs })
  const api = createApiServer({ config, repository, publisher, eventBus, logger })

  return {
    config, logger, repository, eventBus, rawStorage, collector, validator, publisher, pipeline, scheduler, worker, api,
    async start() {
      const address = await api.listen()
      if (config.schedulerEnabled) {
        scheduler.start()
        worker.start()
      }
      if (config.collectOnStart) {
        const sources = await repository.listSources()
        await Promise.all(sources.filter((source) => source.enabled).map((source) => repository.enqueueSource(source.id)))
      }
      await logger.info('application.started', { host: config.host, port: config.port, storage: config.storageDriver })
      return address
    },
    async stop() {
      scheduler.stop()
      worker.stop()
      await api.close()
      await repository.close()
      await logger.info('application.stopped')
    },
  }
}
