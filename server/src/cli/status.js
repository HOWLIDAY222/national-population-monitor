import { createApplication } from '../application.js'

const application = await createApplication()
try {
  console.log(JSON.stringify({
    status: await application.repository.getStatus(),
    sources: await application.repository.listSources(),
    versions: await application.repository.listVersions(),
  }, null, 2))
} finally {
  await application.repository.close()
}
