import { describe, expect, it } from 'vitest'
import { capabilityFolderDuplicateGroups, capabilityFolderVisibleIds } from './capabilityFolderDedupe'

describe('capability folder duplicate handling', () => {
  const folders = [
    { id: 'first', title: '01 新公司接岗', orderIndex: 1 },
    { id: 'second', title: ' 01  新公司接岗 ', orderIndex: 2 },
    { id: 'nested', title: '01 新公司接岗', parentId: 'parent', orderIndex: 1 },
  ]

  it('only groups same-parent normalized names and keeps the first one visible', () => {
    const groups = capabilityFolderDuplicateGroups(folders)
    expect(groups).toHaveLength(1)
    expect(groups[0].folders.map((folder) => folder.id)).toEqual(['first', 'second'])
    expect([...capabilityFolderVisibleIds(folders)]).toEqual(['first', 'nested'])
  })
})
