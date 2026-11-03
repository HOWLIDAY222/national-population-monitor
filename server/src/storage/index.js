import { FileRepository } from './file-repository.js'
import { PostgresRepository } from './postgres-repository.js'

export async function createRepository(config) {
  const repository = config.storageDriver === 'postgres'
    ? new PostgresRepository({ connectionString: config.databaseUrl, sourcesPath: config.sourcesPath, bootstrapPath: config.bootstrapPath })
    : new FileRepository({ directory: config.fileDataDir, sourcesPath: config.sourcesPath, bootstrapPath: config.bootstrapPath })
  return repository.init()
}
