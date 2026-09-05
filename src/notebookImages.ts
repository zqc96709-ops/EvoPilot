export const unsafeReferenceType = (src: string) => {
  const value = src.trim().toLowerCase()
  if (value.startsWith('blob:')) return 'blob'
  if (value.startsWith('file:') || value.includes('/tmp/') || value.includes('/var/folders/')) return 'temporary-file'
  if (value.includes('localhost') || value.includes('127.0.0.1')) return 'localhost'
  if (value.includes('x-amz-signature=') || value.includes('x-amz-credential=')) return 'presigned-url'
  return ''
}

export const sanitizeNotebookHtml = (html: string) => html.replace(/<img\b[^>]*>/gi, (tag) => {
  const source = tag.match(/\bsrc\s*=\s*["']([^"']*)["']/i)
  const referenceType = unsafeReferenceType(source?.[1] || '')
  if (!source || !referenceType) return tag
  const safe = tag.replace(source[0], '').replace(/\s*>$/, '')
  return `${safe} data-jason-missing-asset="true" data-jason-original-reference-type="${referenceType}" alt="图片资源已失效">`
})

export const durableNotebookHtml = (editor: HTMLElement) => {
  const clone = editor.cloneNode(true) as HTMLElement
  for (const image of Array.from(clone.querySelectorAll<HTMLImageElement>('img'))) {
    const fileId = image.dataset.jasonFileId
    if (fileId) {
      image.setAttribute('src', `jason-file://${fileId}`)
      image.removeAttribute('data-jason-missing-asset')
      image.removeAttribute('data-jason-original-reference-type')
      continue
    }
    const referenceType = unsafeReferenceType(image.getAttribute('src') || '')
    if (!referenceType) continue
    image.removeAttribute('src')
    image.dataset.jasonMissingAsset = 'true'
    image.dataset.jasonOriginalReferenceType = referenceType
    image.alt ||= '图片资源已失效'
  }
  return sanitizeNotebookHtml(clone.innerHTML)
}

export const notebookFileIds = (editor: HTMLElement) => [...new Set(Array.from(editor.querySelectorAll<HTMLImageElement>('img[data-jason-file-id]')).map((image) => image.dataset.jasonFileId).filter((id): id is string => Boolean(id)))]

export const imageFiles = (files: FileList | File[]) => Array.from(files).filter((file) => file.type.startsWith('image/'))
