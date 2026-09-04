import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CreateBucketCommand, DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'

export class FileSystemObjectStorage {
  constructor(root) { this.root = join(root, 'objects'); mkdirSync(this.root, { recursive: true }) }
  async put(key, bytes, contentType) { const path = join(this.root, key.split('/').at(-1)); if (!existsSync(path)) writeFileSync(path, bytes); return { key, contentType } }
  async get(key, range) { const path = join(this.root, key.split('/').at(-1)); if (!existsSync(path)) return null; const bytes = readFileSync(path); return range ? bytes.subarray(range.start, range.end + 1) : bytes }
  async head(key) { const path = join(this.root, key.split('/').at(-1)); return existsSync(path) ? { size: statSync(path).size } : null }
  async delete(key) { rmSync(join(this.root, key.split('/').at(-1)), { force: true }) }
}

export class S3ObjectStorage {
  constructor({ endpoint, region = 'us-east-1', bucket, accessKeyId, secretAccessKey, forcePathStyle = true }) { this.bucket = bucket; this.client = new S3Client({ endpoint, region, forcePathStyle, credentials: { accessKeyId, secretAccessKey } }) }
  async ensureBucket() { try { await this.client.send(new HeadBucketCommand({ Bucket: this.bucket })) } catch { await this.client.send(new CreateBucketCommand({ Bucket: this.bucket })) } }
  async put(key, bytes, contentType) { await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType, ChecksumSHA256: undefined })); return { key, contentType } }
  async get(key, range) { try { const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key, Range: range ? `bytes=${range.start}-${range.end}` : undefined })); return Buffer.from(await result.Body.transformToByteArray()) } catch (error) { if (error.$metadata?.httpStatusCode === 404 || error.name === 'NoSuchKey') return null; throw error } }
  async head(key) { try { const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key })); return { size: Number(result.ContentLength || 0) } } catch (error) { if (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound') return null; throw error } }
  async delete(key) { await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })) }
}
