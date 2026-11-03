import fs from 'node:fs/promises'
import path from 'node:path'

const sanitize = (value) => {
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack }
  return value
}

export class StructuredLogger {
  constructor({ directory, stream = process.stdout }) {
    this.directory = directory
    this.stream = stream
  }

  async write(level, message, context = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context: Object.fromEntries(Object.entries(context).map(([key, value]) => [key, sanitize(value)])),
    }
    this.stream.write(`${JSON.stringify(entry)}\n`)
    await fs.mkdir(this.directory, { recursive: true })
    const date = entry.timestamp.slice(0, 10)
    await fs.appendFile(path.join(this.directory, `${date}.jsonl`), `${JSON.stringify(entry)}\n`, 'utf8')
  }

  info(message, context) { return this.write('info', message, context) }
  warn(message, context) { return this.write('warn', message, context) }
  error(message, context) { return this.write('error', message, context) }
}
