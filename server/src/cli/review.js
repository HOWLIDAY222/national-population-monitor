import { createApplication } from '../application.js'

const parserRunId = process.argv[2]
const application = await createApplication()
try {
  const result = parserRunId
    ? await application.repository.getReviewRun(parserRunId)
    : { items: await application.repository.listReviewRuns(50) }
  if (parserRunId && !result) {
    console.error(`Unknown parser run: ${parserRunId}`)
    process.exitCode = 1
  } else {
    console.log(JSON.stringify(result, null, 2))
  }
} finally {
  await application.repository.close()
}
