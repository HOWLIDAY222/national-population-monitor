import { load } from 'cheerio'

const populationTerms = /(人口|常住人口|人口普查|抽样调查|统计年鉴|年度统计公报|国民经济和社会发展统计公报)/i
const supportedExtensions = /\.(xlsx?|csv|pdf|json|html?|htm|docx?)(?:$|[?#])/i
const supportedResourceKinds = new Set(['html', 'json', 'csv', 'xlsx', 'pdf', 'doc'])

const classifyResource = (resourceUrl) => {
  const pathname = new URL(resourceUrl).pathname.toLowerCase()
  if (/\.xlsx?$/.test(pathname)) return 'xlsx'
  if (/\.csv$/.test(pathname)) return 'csv'
  if (/\.pdf$/.test(pathname)) return 'pdf'
  if (/\.json$/.test(pathname)) return 'json'
  if (/\.docx?$/.test(pathname)) return 'doc'
  return 'html'
}

const normalizeTitle = (value) => value.replace(/\s+/g, ' ').trim().slice(0, 500)

export function discoverPortalResources({ buffer, source, maximum = 100 }) {
  if (source.kind !== 'html') return []
  const $ = load(buffer.toString('utf8'))
  const resources = new Map()

  for (const seed of source.parserConfig?.seedResources ?? []) {
    if (resources.size >= maximum || !seed || typeof seed !== 'object') break
    let resourceUrl
    try {
      resourceUrl = new URL(seed.resourceUrl)
      if (!['http:', 'https:'].includes(resourceUrl.protocol)) continue
      resourceUrl.hash = ''
    } catch {
      continue
    }
    const title = normalizeTitle(String(seed.title ?? ''))
    if (!title) continue
    const normalizedUrl = resourceUrl.toString()
    const resourceKind = supportedResourceKinds.has(seed.resourceKind)
      ? seed.resourceKind
      : classifyResource(normalizedUrl)
    resources.set(normalizedUrl, {
      title,
      resourceUrl: normalizedUrl,
      resourceKind,
      metadata: {
        seeded: true,
        discoveredOn: source.url,
        host: resourceUrl.hostname,
        secure: resourceUrl.protocol === 'https:',
        attachment: resourceKind !== 'html',
      },
    })
  }

  $('a[href]').each((_index, element) => {
    if (resources.size >= maximum) return false
    const href = $(element).attr('href')?.trim()
    if (!href || /^(?:#|javascript:|mailto:|tel:)/i.test(href)) return
    let resourceUrl
    try {
      resourceUrl = new URL(href, source.url)
      if (!['http:', 'https:'].includes(resourceUrl.protocol)) return
      resourceUrl.hash = ''
    } catch {
      return
    }

    const title = normalizeTitle($(element).text() || $(element).attr('title') || resourceUrl.pathname.split('/').pop() || source.name)
    const decodedUrl = (() => {
      try { return decodeURIComponent(resourceUrl.toString()) } catch { return resourceUrl.toString() }
    })()
    const exactBulletinCategory = /^统计公报(?:栏目)?$/.test(title)
    if (!populationTerms.test(`${title} ${decodedUrl}`) && !exactBulletinCategory) return
    if (!supportedExtensions.test(resourceUrl.toString()) && !populationTerms.test(title)) return

    const normalizedUrl = resourceUrl.toString()
    if (resources.has(normalizedUrl)) return
    resources.set(normalizedUrl, {
      title,
      resourceUrl: normalizedUrl,
      resourceKind: classifyResource(normalizedUrl),
      metadata: {
        discoveredOn: source.url,
        host: resourceUrl.hostname,
        secure: resourceUrl.protocol === 'https:',
        attachment: supportedExtensions.test(resourceUrl.toString()) && classifyResource(normalizedUrl) !== 'html',
      },
    })
  })

  return [...resources.values()]
}

export const discoveryInternals = { classifyResource, normalizeTitle, populationTerms }
