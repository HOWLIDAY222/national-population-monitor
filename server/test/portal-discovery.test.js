import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { test } from 'node:test'
import { discoverPortalResources } from '../src/discovery/portal-link-discovery.js'

test('显式官方候选与年度统计公报栏目都能进入发现清单', async () => {
  const source = {
    kind: 'html',
    name: '测试省级统计门户',
    url: 'https://example.gov.cn/catalog/',
    parserConfig: {
      seedResources: [{
        title: '2025年测试省国民经济和社会发展统计公报',
        resourceUrl: 'https://example.gov.cn/reports/2025.html#content',
        resourceKind: 'html',
      }],
    },
  }
  const buffer = Buffer.from('<a href="/annual/index.html">年度统计公报</a>')
  const discoveries = discoverPortalResources({ buffer, source })

  assert.equal(discoveries.length, 2)
  const seeded = discoveries.find((item) => item.metadata.seeded)
  assert.equal(seeded.resourceUrl, 'https://example.gov.cn/reports/2025.html')
  assert.equal(seeded.metadata.secure, true)
  assert.ok(discoveries.some((item) => item.title === '年度统计公报'))
})

test('甘肃门户配置只使用政府域名作为降级来源和显式候选', async () => {
  const sources = JSON.parse(await fs.readFile(path.resolve('data/sources.json'), 'utf8'))
  const source = sources.find((item) => item.id === 'province-portal-620000')

  assert.deepEqual(source.fallbackUrls, ['https://ydyl.gansu.gov.cn/gsydyl/news/gsdt/'])
  assert.equal(source.parserConfig.seedResources.length, 1)
  assert.ok(source.parserConfig.seedResources[0].resourceUrl.startsWith('https://ydyl.gansu.gov.cn/'))
})

test('旧版Word人口公报附件按doc候选保存', () => {
  const source = {
    kind: 'html',
    name: '测试省级统计门户',
    url: 'https://example.gov.cn/catalog/',
    parserConfig: {},
  }
  const buffer = Buffer.from('<a href="/reports/population-2025.doc">2025年人口统计公报</a>')

  const discoveries = discoverPortalResources({ buffer, source })

  assert.equal(discoveries.length, 1)
  assert.equal(discoveries[0].resourceKind, 'doc')
  assert.equal(discoveries[0].metadata.attachment, true)
})
