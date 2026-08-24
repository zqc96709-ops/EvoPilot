import type { RecordData } from './model'

export type CloudSyncStatus = {
  configured: boolean
  signedIn: boolean
  email?: string
  lastSyncedAt?: string
}

type CloudSession = { access_token: string; refresh_token?: string; user?: { email?: string }; expires_at?: number }

const sessionKey = 'jason-os-cloud-session'
const syncedAtKey = 'jason-os-cloud-last-synced-at'
const deviceKey = 'jason-os-cloud-device-id'
const url = String(import.meta.env.VITE_SUPABASE_URL || '').replace(/\/$/, '')
const anonKey = String(import.meta.env.VITE_SUPABASE_ANON_KEY || '')

const configured = () => Boolean(url && anonKey)
const readSession = (): CloudSession | null => {
  try { return JSON.parse(localStorage.getItem(sessionKey) || 'null') as CloudSession | null } catch { return null }
}
const writeSession = (session: CloudSession | null) => {
  if (session) localStorage.setItem(sessionKey, JSON.stringify(session))
  else localStorage.removeItem(sessionKey)
}
const versionOf = (record: Partial<RecordData>) => {
  const raw = String(record.updatedAt || record.createdAt || '')
  if (/^\d+$/.test(raw)) return Number(raw)
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? parsed : 0
}
const ensureConfigured = () => {
  if (!configured()) throw new Error('尚未配置 Supabase。请在应用环境变量中填写 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。')
}
const requireSession = () => {
  const session = readSession()
  if (!session?.access_token) throw new Error('请先登录同步账户。')
  return session
}
const request = async <T>(path: string, init: RequestInit = {}, accessToken?: string): Promise<T> => {
  ensureConfigured()
  const response = await fetch(`${url}${path}`, {
    ...init,
    headers: { apikey: anonKey, 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...(init.headers || {}) },
  })
  if (!response.ok) {
    const body = await response.text()
    throw new Error(body || `云端请求失败（${response.status}）`)
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>
}

export const syncRecordWinner = (local: RecordData | undefined, remote: RecordData | undefined) => {
  if (!local) return remote
  if (!remote) return local
  return versionOf(remote) > versionOf(local) ? remote : local
}

const deviceId = () => {
  const existing = localStorage.getItem(deviceKey)
  if (existing) return existing
  const id = crypto.randomUUID()
  localStorage.setItem(deviceKey, id)
  return id
}

export const cloudSync = {
  status(): CloudSyncStatus {
    const session = readSession()
    return { configured: configured(), signedIn: Boolean(session?.access_token), email: session?.user?.email, lastSyncedAt: localStorage.getItem(syncedAtKey) || undefined }
  },
  async signIn(email: string, password: string) {
    const session = await request<CloudSession>('/auth/v1/token?grant_type=password', { method: 'POST', body: JSON.stringify({ email, password }) })
    writeSession(session)
    return this.status()
  },
  async signUp(email: string, password: string) {
    const session = await request<CloudSession>('/auth/v1/signup', { method: 'POST', body: JSON.stringify({ email, password }) })
    if (session.access_token) writeSession(session)
    return this.status()
  },
  async signOut() {
    const session = readSession()
    if (configured() && session?.access_token) await request('/auth/v1/logout', { method: 'POST' }, session.access_token)
    writeSession(null)
  },
  async sync(localRecords: RecordData[]): Promise<RecordData[]> {
    const session = requireSession()
    const changes = localRecords.map((record) => ({ record_id: record.id, entity: record.entity, payload: record, created_at: versionOf({ updatedAt: record.createdAt }), updated_at: versionOf(record), deleted_at: record.deletedAt ? versionOf({ updatedAt: record.deletedAt }) : null }))
    await request('/rest/v1/rpc/jason_sync_upsert_records', { method: 'POST', body: JSON.stringify({ p_changes: changes, p_device_id: deviceId() }) }, session.access_token)
    const rows = await request<{ payload: RecordData }[]>('/rest/v1/jason_sync_records?select=payload&order=updated_at.asc', { method: 'GET' }, session.access_token)
    const merged = new Map(localRecords.map((record) => [record.id, record]))
    for (const row of rows) {
      const remote = row.payload
      if (remote?.id && remote?.entity) merged.set(remote.id, syncRecordWinner(merged.get(remote.id), remote)!)
    }
    localStorage.setItem(syncedAtKey, new Date().toISOString())
    return [...merged.values()]
  },
}
