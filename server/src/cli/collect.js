import { createApplication } from '../application.js'

const sourceId = process.argv[2]
if (!sourceId) {
  console.error('Usage: pnpm --dir server collect <source-id> [--approve]')
  process.exit(1)
}

const application = await createApplication()
try {
  const result = await application.pipeline.processSource(sourceId)
  if (result.outcome === 'review_required' && process.argv.includes('--approve')) {
    result.published = await application.publisher.publishParserRun(result.parserRunId, { actor: 'cli', approved: true })
    result.outcome = 'published'
  }
  console.log(JSON.stringify(result, null, 2))
} finally {
  await application.repository.close()
}
