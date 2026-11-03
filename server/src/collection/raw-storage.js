import fs from 'node:fs/promises'
import path from 'node:path'

const extensions = { html: 'html', json: 'json', csv: 'csv', xlsx: 'xlsx', pdf: 'pdf', doc: 'doc' }

export class RawStorage {
  constructor(rootDirectory) {
    this.rootDirectory = rootDirectory
  }

  async save({ source, contentHash, buffer, collectedAt, metadata }) {
    const date = new Date(collectedAt)
    const relativeDirectory = path.join(
      String(date.getUTCFullYear()),
      String(date.getUTCMonth() + 1).padStart(2, '0'),
      String(date.getUTCDate()).padStart(2, '0'),
      source.id,
    )
    const directory = path.join(this.rootDirectory, relativeDirectory)
    await fs.mkdir(directory, { recursive: true })
    const extension = extensions[source.kind] ?? 'bin'
    const filename = `${contentHash}.${extension}`
    const fullPath = path.join(directory, filename)
    const metadataPath = `${fullPath}.meta.json`
    try {
      await fs.writeFile(fullPath, buffer, { flag: 'wx' })
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), { encoding: 'utf8', flag: 'wx' })
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
    }
    return path.relative(this.rootDirectory, fullPath).replaceAll('\\', '/')
  }
}
