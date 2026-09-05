import type { RecordData } from './model'

export const notebookContentEntities = new Set(['notes', 'notebookFiles', 'inbox'])

export const notebookCategoryId = (record: RecordData) => String(record.notebookCategoryId || '').trim()

export const isNotebookContent = (record: RecordData) => notebookContentEntities.has(record.entity)

export const isUnorganizedNotebookItem = (record: RecordData) => isNotebookContent(record) && !notebookCategoryId(record)

export const belongsToNotebookCategory = (record: RecordData, categoryId: string) => isNotebookContent(record) && notebookCategoryId(record) === categoryId
