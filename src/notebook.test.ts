import { describe, expect, it } from 'vitest'
import { entities, linkedTo, type RecordData } from './model'

const entityNames = () => entities.map((item) => item.entity)

describe('Notebook information space', () => {
  it('registers independent category, folder and file entities', () => {
    expect(entityNames()).toEqual(expect.arrayContaining(['notes', 'notebookCategories', 'notebookFolders', 'notebookFiles']))
    expect(entities.find((item) => item.entity === 'notebookCategories')?.description).toContain('不是 EvoPilot Project')
  })

  it('does not require notes or files to link to EvoPilot business objects', () => {
    const note = { id: 'note-1', entity: 'notes', title: '自由想法', createdAt: '1', updatedAt: '1' } as RecordData
    const file = { id: 'file-1', entity: 'notebookFiles', name: 'report.pdf', createdAt: '1', updatedAt: '1' } as RecordData
    expect(linkedTo(note, 'project-1')).toBe(false)
    expect(linkedTo(file, 'project-1')).toBe(false)
  })
})
