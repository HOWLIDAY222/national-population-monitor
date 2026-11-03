import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'pg'
import { initdb as packagedInitdb, pg_ctl as packagedPgCtl } from '@embedded-postgres/windows-x64'

const commandEnvironment = (binaryDir, tempDir) => ({
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  COMSPEC: process.env.COMSPEC,
  PATH: `${binaryDir};${path.join(process.env.SystemRoot, 'System32')}`,
  TEMP: tempDir,
  TMP: tempDir,
  LC_MESSAGES: 'C',
  LANG: 'C',
})

const runCommand = (command, args, options, timeoutMs = 60_000) => new Promise((resolve, reject) => {
  const child = spawn(command, args, { ...options, windowsHide: true })
  const output = []
  const errors = []
  const timer = setTimeout(() => {
    child.kill()
    const stdout = Buffer.concat(output).toString('utf8')
    const stderr = Buffer.concat(errors).toString('utf8')
    reject(new Error(`${path.basename(command)} timed out: ${stderr || stdout}`))
  }, timeoutMs)
  child.stdout?.on('data', (chunk) => output.push(chunk))
  child.stderr?.on('data', (chunk) => errors.push(chunk))
  child.once('error', (error) => {
    clearTimeout(timer)
    reject(error)
  })
  child.once('exit', (code) => {
    clearTimeout(timer)
    const stdout = Buffer.concat(output).toString('utf8')
    const stderr = Buffer.concat(errors).toString('utf8')
    if (code === 0) resolve({ stdout, stderr })
    else reject(new Error(`${path.basename(command)} exited with ${code}: ${stderr || stdout}`))
  })
})

export class PortablePostgres {
  constructor({ rootDir, port, user, password }) {
    this.rootDir = rootDir
    this.port = port
    this.user = user
    this.password = password
    this.nativeDir = path.join(rootDir, 'native')
    this.binDir = path.join(this.nativeDir, 'bin')
    this.dataDir = path.join(rootDir, 'data')
    this.tempDir = path.join(rootDir, 'tmp')
    this.env = commandEnvironment(this.binDir, this.tempDir)
  }

  async initialise() {
    const packagedNative = path.resolve(path.dirname(packagedInitdb), '..')
    await fs.mkdir(this.tempDir, { recursive: true })
    await fs.cp(packagedNative, this.nativeDir, { recursive: true })
    const passwordFile = path.join(this.tempDir, 'password.txt')
    await fs.writeFile(passwordFile, `${this.password}\n`, 'utf8')
    try {
      await runCommand(path.join(this.binDir, 'initdb.exe'), [
        `--pgdata=${this.dataDir}`,
        '--auth=scram-sha-256',
        `--username=${this.user}`,
        `--pwfile=${passwordFile}`,
        '--locale=C',
        '--encoding=UTF8',
        '--lc-messages=C',
      ], { env: this.env })
    } finally {
      await fs.rm(passwordFile, { force: true })
    }
  }

  async start() {
    const logPath = path.join(this.rootDir, 'postgres.log')
    try {
      await runCommand(path.join(this.binDir, 'pg_ctl.exe'), [
        'start',
        '-D', this.dataDir,
        '-o', `-h 127.0.0.1 -p ${this.port}`,
        '-l', logPath,
        '-w',
      ], { env: this.env }, 30_000)
    } catch (error) {
      const serverLog = await fs.readFile(logPath, 'utf8').catch(() => '')
      throw new Error(`${error.message}${serverLog ? `\nPostgreSQL log:\n${serverLog}` : ''}`)
    }
  }

  getClient(database = 'postgres') {
    return new Client({
      host: '127.0.0.1',
      port: this.port,
      user: this.user,
      password: this.password,
      database,
    })
  }

  async createDatabase(name) {
    const client = this.getClient()
    await client.connect()
    try {
      await client.query(`create database ${name}`)
    } finally {
      await client.end()
    }
  }

  async stop() {
    await runCommand(path.join(this.binDir, 'pg_ctl.exe'), [
      'stop',
      '-D', this.dataDir,
      '-m', 'fast',
      '-w',
    ], { env: this.env }).catch(() => {})
  }

  async cleanup() {
    const resolvedRoot = path.resolve(this.rootDir)
    const resolvedTemp = path.resolve(os.tmpdir())
    if (!resolvedRoot.startsWith(`${resolvedTemp}${path.sep}`)) {
      throw new Error(`Refusing to remove non-temporary PostgreSQL path: ${resolvedRoot}`)
    }
    await fs.rm(resolvedRoot, { recursive: true, force: true })
  }
}

export const packagedPgCtlPath = packagedPgCtl
