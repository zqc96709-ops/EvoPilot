import { describe, expect, it } from 'vitest'
import type { RecordData } from './model'
import { belongsToNotebookCategory, isUnorganizedNotebookItem } from './notebookClassification'

const record = (entity: RecordData['entity'], extra: Partial<RecordData> = {}) => ({ id: `${entity}-1`, entity, title: entity, createdAt: '1', updatedAt: '1', ...extra }) as RecordData

describe('notebook category ownership', () => {
  it('derives unorganized solely from missing notebookCategoryId', () => {
    expect(isUnorganizedNotebookItem(record('notes', { status: 'INBOX' }))).toBe(true)
    expect(isUnorganizedNotebookItem(record('notes', { status: 'INBOX', notebookCategoryId: 'plus-size' }))).toBe(false)
    expect(isUnorganizedNotebookItem(record('notes', { status: 'ACTIVE', notebookCategoryId: 'plus-size' }))).toBe(false)
  })

  it('keeps category ownership independent from view and workflow fields', () => {
    const categorized = record('notebookFiles', { notebookCategoryId: 'jason', status: 'LATER', notebookFolderId: 'folder-1' })
    expect(belongsToNotebookCategory(categorized, 'jason')).toBe(true)
    expect(belongsToNotebookCategory(categorized, 'books')).toBe(false)
    expect(isUnorganizedNotebookItem(categorized)).toBe(false)
  })

  it('does not treat folders or unrelated entities as inbox content ownership', () => {
    expect(isUnorganizedNotebookItem(record('notebookFolders'))).toBe(false)
    expect(isUnorganizedNotebookItem(record('tasks'))).toBe(false)
  })
})
