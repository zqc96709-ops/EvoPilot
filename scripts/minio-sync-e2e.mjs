import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSyncServer, openSyncDatabase } from '../sync-server/server.mjs'
import { S3ObjectStorage } from '../sync-server/object-storage.mjs'

const binary = process.env.MINIO_BINARY || 'minio'; const temp = mkdtempSync(join(tmpdir(), 'jason-minio-e2e-')); const accessKeyId = `jason${randomBytes(8).toString('hex')}`; const secretAccessKey = randomBytes(24).toString('hex'); const token = randomBytes(24).toString('hex'); const endpoint = 'http://127.0.0.1:9010'
let minio; let server
const wait = async (url, timeout = 15_000) => { const until = Date.now() + timeout; while (Date.now() < until) { try { const result = await fetch(url); if (result.ok) return } catch {} await new Promise((resolve) => setTimeout(resolve, 150)) } throw new Error(`Timed out: ${url}`) }
const startMinio = async () => { minio = spawn(binary, ['server', temp, '--address', '127.0.0.1:9010', '--console-address', '127.0.0.1:9011'], { env: { ...process.env, MINIO_ROOT_USER: accessKeyId, MINIO_ROOT_PASSWORD: secretAccessKey }, stdio: 'ignore' }); await wait(`${endpoint}/minio/health/live`) }
const stopMinio = async () => { if (!minio) return; minio.kill('SIGTERM'); await new Promise((resolve) => minio.once('exit', resolve)); minio = undefined }
try {
  await startMinio(); const storage = new S3ObjectStorage({ endpoint, bucket: 'jason-sync', accessKeyId, secretAccessKey }); await storage.ensureBucket()
  server = createSyncServer({ db: openSyncDatabase(), token, objectDir: join(temp, 'api'), objectStorage: storage }); await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); const address = server.address(); const root = `http://127.0.0.1:${address.port}`; const headers = { authorization: `Bearer ${token}` }
  const bytes = Buffer.alloc(1024 * 1024 * 3, 9); const sha256 = createHash('sha256').update(bytes).digest('hex'); const start = await fetch(`${root}/files/init`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ sha256, size: bytes.length, mimeType: 'application/octet-stream' }) }).then((response) => response.json()); const split = Math.floor(bytes.length * 0.3)
  await fetch(`${root}/files/chunk/${start.uploadId}?offset=0`, { method: 'PUT', headers, body: bytes.subarray(0, split) }); await fetch(`${root}/files/chunk/${start.uploadId}?offset=${split}`, { method: 'PUT', headers, body: bytes.subarray(split) })
  await stopMinio(); const failed = await fetch(`${root}/files/complete/${start.uploadId}`, { method: 'POST', headers }); if (failed.ok) throw new Error('MinIO outage was not surfaced')
  await startMinio(); const completed = await fetch(`${root}/files/complete/${start.uploadId}`, { method: 'POST', headers }).then((response) => response.json()); if (completed.state !== 'AVAILABLE') throw new Error(JSON.stringify(completed))
  const first = Buffer.from(await fetch(`${root}/files/object/${sha256}`, { headers: { ...headers, range: `bytes=0-${split - 1}` } }).then((response) => response.arrayBuffer())); await stopMinio(); await startMinio(); const second = Buffer.from(await fetch(`${root}/files/object/${sha256}`, { headers: { ...headers, range: `bytes=${split}-${bytes.length - 1}` } }).then((response) => response.arrayBuffer()))
  const dedup = await fetch(`${root}/files/init`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ sha256, size: bytes.length }) }).then((response) => response.json()); const privateStatus = (await fetch(`${root}/files/object/${sha256}`)).status
  if (!Buffer.concat([first, second]).equals(bytes) || !dedup.deduplicated || privateStatus !== 401 || !(await storage.head(completed.objectKey))) throw new Error('MinIO verification failed')
  console.log(JSON.stringify({ ok: true, provider: 'MinIO S3-compatible', uploadResumeAfterOutage: true, rangeDownloadResumeAfterOutage: true, sha256Verified: true, deduplicated: true, private: true }))
} finally { await new Promise((resolve) => server?.close(resolve)); await stopMinio(); rmSync(temp, { recursive: true, force: true }) }
