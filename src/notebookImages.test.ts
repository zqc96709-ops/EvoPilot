import { describe, expect, it } from 'vitest'
import { imageFiles, sanitizeNotebookHtml } from './notebookImages'

describe('notebook image persistence', () => {
  it.each([
    ['blob:tauri://localhost/id', 'blob'],
    ['file:///tmp/image.png', 'temporary-file'],
    ['file:///var/folders/x/image.png', 'temporary-file'],
    ['http://localhost:5173/image.png', 'localhost'],
    ['https://files.test/a?X-Amz-Signature=secret', 'presigned-url'],
  ])('never persists unsafe runtime reference %s', (src, type) => {
    const html = sanitizeNotebookHtml(`<p>正文</p><img src="${src}">`)
    expect(html).not.toContain(src)
    expect(html).toContain('data-jason-missing-asset="true"')
    expect(html).toContain(`data-jason-original-reference-type="${type}"`)
    expect(html).toContain('正文')
  })

  it('keeps stable FileAsset references', () => {
    const html = '<img src="jason-file://file-1" data-jason-file-id="file-1">'
    expect(sanitizeNotebookHtml(html)).toBe(html)
  })

  it('accepts only image files from paste and drop payloads', () => {
    expect(imageFiles([new File(['a'], 'a.png', { type: 'image/png' }), new File(['b'], 'b.txt', { type: 'text/plain' })])).toHaveLength(1)
  })
})
