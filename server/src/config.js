import path from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = path.dirname(fileURLToPath(import.meta.url))
const serverRoot = path.resolve(moduleDir, '..')
const projectRoot = path.resolve(serverRoot, '..')

const booleanFromEnv = (value, fallback = false) => {
  if (value === undefined) return fallback
  return value === '1' || value?.toLowerCase() === 'true'
}

export function loadConfig(env = process.env) {
  return {
    env: env.NODE_ENV ?? 'development',
    host: env.HOST ?? '127.0.0.1',
    port: Number(env.PORT ?? 8787),
    storageDriver: env.STORAGE_DRIVER ?? 'file',
    databaseUrl: env.DATABASE_URL ?? '',
    adminToken: env.ADMIN_TOKEN ?? '',
    collectOnStart: booleanFromEnv(env.COLLECT_ON_START, false),
    schedulerEnabled: booleanFromEnv(env.SCHEDULER_ENABLED, true),
    fileDataDir: path.resolve(env.FILE_DATA_DIR ?? path.join(serverRoot, '.local-data')),
    rawStorageDir: path.resolve(env.RAW_STORAGE_DIR ?? path.join(projectRoot, 'raw-storage')),
    monitoringDir: path.resolve(env.MONITORING_DIR ?? path.join(projectRoot, 'monitoring')),
    sourcesPath: path.resolve(env.SOURCES_PATH ?? path.join(serverRoot, 'data', 'sources.json')),
    bootstrapPath: path.resolve(env.BOOTSTRAP_PATH ?? path.join(serverRoot, 'data', 'bootstrap.json')),
    apiPrefix: '/api/v1',
    sseHeartbeatMs: Number(env.SSE_HEARTBEAT_MS ?? 20000),
    workerPollMs: Number(env.WORKER_POLL_MS ?? 1000),
    schedulerPollMs: Number(env.SCHEDULER_POLL_MS ?? 15000),
    jobStaleMs: Number(env.JOB_STALE_MS ?? 10 * 60 * 1000),
  }
}
