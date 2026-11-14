import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createCipheriv, pbkdf2Sync } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

assert.equal(globalThis.Bun, undefined, 'This check must run under Node.js')
const packageDir = resolve(process.argv[2])
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
assert.match(pkg.version, /-fork\.[0-9a-f]{12}$/)
assert.equal(pkg.scripts, undefined, 'Consumers must not need build scripts')
for (const cli of Object.values(pkg.bin)) {
  const filename = join(packageDir, cli)
  assert.ok(readFileSync(filename, 'utf8').startsWith('#!/usr/bin/env node\n'))
  assert.equal(execFileSync(process.execPath, [filename, '--version'], { encoding: 'utf8' }).trim(), pkg.version)
}

const require = createRequire(join(packageDir, 'package.json'))
const Database = require('better-sqlite3')
const { BrowserTokenExtractor } = await import(
  pathToFileURL(join(packageDir, 'dist/src/platforms/notion/browser-token-extractor.js')).href
)
const temporary = mkdtempSync(join(tmpdir(), 'notion-node-cookies-'))
try {
  const cookiePath = join(temporary, 'Cookies')
  const db = new Database(cookiePath)
  db.exec('CREATE TABLE cookies (name TEXT, value TEXT, encrypted_value BLOB, host_key TEXT, last_access_utc INTEGER)')
  const insert = db.prepare('INSERT INTO cookies VALUES (?, ?, ?, ?, ?)')
  class Extractor extends BrowserTokenExtractor {
    getBrowserCookiePaths() {
      return [cookiePath]
    }
  }
  for (const host of [
    'notion.so',
    '.notion.so',
    'www.notion.so',
    '.www.notion.so',
    'notion.com',
    '.notion.com',
    'www.notion.com',
    '.www.notion.com',
    'app.notion.com',
    '.app.notion.com',
  ]) {
    db.exec('DELETE FROM cookies')
    insert.run('token_v2', 'v02%3Anode-test-token', null, host, 3)
    insert.run('notion_user_id', 'test-user', null, host, 2)
    insert.run('notion_users', '["test-user","other-user"]', null, host, 1)
    insert.run('token_v2', 'v02%3Aunrelated-token', null, 'notion.com.example.com', 100)
    assert.deepEqual(
      await new Extractor('linux').extract(),
      {
        token_v2: 'v02%3Anode-test-token',
        user_id: 'test-user',
        user_ids: ['test-user', 'other-user'],
      },
      host,
    )
  }
  db.exec('DELETE FROM cookies')
  const key = pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1')
  const cipher = createCipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20))
  const encrypted = Buffer.concat([Buffer.from('v10'), cipher.update('v02%3Aencrypted-node-token'), cipher.final()])
  insert.run('token_v2', '', encrypted, '.app.notion.com', 1)
  assert.deepEqual(await new Extractor('linux').extract(), { token_v2: 'v02%3Aencrypted-node-token' })
  db.close()
  console.log(`Node.js package ${pkg.version}: both CLIs and 11 cookie extraction cases passed`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
