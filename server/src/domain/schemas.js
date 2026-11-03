import { randomUUID } from 'node:crypto'
import { z } from 'zod'

export const sourceSchema = z.object({
  id: z.string().min(2),
  name: z.string().min(2),
  institution: z.string().min(2),
  url: z.string().url(),
  fallbackUrls: z.array(z.string().url()).default([]),
  kind: z.enum(['html', 'json', 'csv', 'xlsx', 'pdf', 'doc']),
  parserType: z.string().min(2),
  parserVersion: z.string().min(2),
  checkIntervalSeconds: z.number().int().min(60),
  enabled: z.boolean().default(true),
  autoPublish: z.boolean().default(false),
  role: z.enum(['dataset', 'portal']).default('dataset'),
  monitorOnly: z.boolean().default(false),
  regionCode: z.string().min(2).default('CN'),
  regionName: z.string().min(2).default('全国'),
  initialDelaySeconds: z.number().int().min(0).default(0),
  datasetKey: z.string().min(2),
  period: z.string().min(1),
  effectiveAt: z.string().datetime({ offset: true }),
  sourcePublishedAt: z.string().datetime({ offset: true }),
  dataStatus: z.enum(['official', 'provisional', 'survey', 'index']),
  request: z.object({
    timeoutMs: z.number().int().min(1000).max(120000).default(20000),
    userAgent: z.string().min(8),
    headers: z.record(z.string(), z.string()).default({}),
    fallbackUrls: z.array(z.string().url()).default([]),
  }),
  parserConfig: z.record(z.string(), z.unknown()).default({}),
})

export const indicatorDefinitionSchema = z.object({
  code: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(2),
  description: z.string().min(2),
  defaultUnit: z.string().min(1),
  frequency: z.enum(['realtime', 'hourly', 'daily', 'monthly', 'quarterly', 'annual', 'census', 'survey']),
  valueType: z.enum(['number', 'index', 'ratio']),
  minimumValue: z.number().nullable().optional(),
  maximumValue: z.number().nullable().optional(),
  reviewChangeRatio: z.number().nonnegative(),
  autoPublish: z.boolean(),
})

export const parsedRecordSchema = z.object({
  indicatorCode: z.string().regex(/^[a-z0-9_]+$/),
  indicatorName: z.string().min(2),
  regionCode: z.string().min(2),
  regionName: z.string().min(2),
  period: z.string().min(1),
  value: z.number().finite(),
  unit: z.string().min(1),
  frequency: z.enum(['realtime', 'hourly', 'daily', 'monthly', 'quarterly', 'annual', 'census', 'survey']),
  sourceId: z.string().min(2),
  sourceName: z.string().min(2),
  sourceUrl: z.string().url(),
  sourcePublishedAt: z.string().datetime({ offset: true }),
  collectedAt: z.string().datetime({ offset: true }),
  effectiveAt: z.string().datetime({ offset: true }),
  dataStatus: z.enum(['official', 'provisional', 'survey', 'index']),
  parserVersion: z.string().min(2),
  qualityStatus: z.enum(['pending', 'verified', 'review_required', 'rejected']).default('pending'),
  dimensions: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).default({}),
  rawValue: z.string().optional(),
})

export const jobSchema = z.object({
  id: z.string().uuid(),
  sourceId: z.string().min(2),
  status: z.enum(['pending', 'processing', 'retry', 'completed', 'failed']),
  priority: z.number().int(),
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  availableAt: z.string().datetime({ offset: true }),
  createdAt: z.string().datetime({ offset: true }),
})

export const makeId = () => randomUUID()
export const nowIso = () => new Date().toISOString()

export function parseSources(input) {
  return z.array(sourceSchema).parse(input)
}

export function parseDefinitions(input) {
  return z.array(indicatorDefinitionSchema).parse(input)
}
