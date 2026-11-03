import { pathToFileURL } from 'node:url'
import { createApplication } from './application.js'

const isEntrypoint = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href

if (isEntrypoint) {
  const application = await createApplication()
  await application.start()
  const shutdown = async (signal) => {
    await application.logger.info('application.shutdown.requested', { signal })
    await application.stop()
    process.exit(0)
  }
  process.once('SIGINT', () => shutdown('SIGINT'))
  process.once('SIGTERM', () => shutdown('SIGTERM'))
}

export { createApplication }
