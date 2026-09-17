export type CapabilityFolderLike = {
  id: string
  title?: unknown
  parentId?: unknown
  orderIndex?: unknown
  createdAt?: unknown
}

export type CapabilityFolderDuplicateGroup<T extends CapabilityFolderLike> = {
  key: string
  title: string
  parentId: string
  folders: T[]
}

const normalizedTitle = (value: unknown) => String(value || '').trim().replace(/\s+/g, ' ').toLocaleLowerCase()
const rank = (folder: CapabilityFolderLike) => `${String(folder.orderIndex ?? '').padStart(12, '0')}\u0000${String(folder.createdAt || '')}\u0000${folder.id}`

export function capabilityFolderDuplicateGroups<T extends CapabilityFolderLike>(folders: T[]): CapabilityFolderDuplicateGroup<T>[] {
  const groups = new Map<string, T[]>()
  for (const folder of folders) {
    const title = normalizedTitle(folder.title)
    if (!title) continue
    const parentId = String(folder.parentId || '')
    const key = `${parentId}\u0000${title}`
    groups.set(key, [...(groups.get(key) || []), folder])
  }
  return [...groups.entries()]
    .filter(([, items]) => items.length > 1)
    .map(([key, items]) => {
      const folders = [...items].sort((left, right) => rank(left).localeCompare(rank(right)))
      return { key, title: String(folders[0].title || '').trim(), parentId: String(folders[0].parentId || ''), folders }
    })
}

export function capabilityFolderVisibleIds<T extends CapabilityFolderLike>(folders: T[]): Set<string> {
  const hidden = new Set<string>()
  for (const group of capabilityFolderDuplicateGroups(folders)) group.folders.slice(1).forEach((folder) => hidden.add(folder.id))
  return new Set(folders.filter((folder) => !hidden.has(folder.id)).map((folder) => folder.id))
}
