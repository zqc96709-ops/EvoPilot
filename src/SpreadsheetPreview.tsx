import { useEffect, useMemo, useState } from 'react'
import type { NotebookFilePreview, NotebookSpreadsheetEdit } from './api'

const columnName = (index: number) => {
  let value = index + 1
  let name = ''
  while (value > 0) { const remainder = (value - 1) % 26; name = String.fromCharCode(65 + remainder) + name; value = Math.floor((value - 1) / 26) }
  return name
}

type SpreadsheetPreviewProps = { preview: NotebookFilePreview; editable?: boolean; onSave?: (edits: NotebookSpreadsheetEdit[]) => Promise<void>; onNotice?: (text: string) => void }

export function SpreadsheetPreview({ preview, editable = false, onSave, onNotice }: SpreadsheetPreviewProps) {
  const sheets = preview.sheets || []
  const [sheetIndex, setSheetIndex] = useState(0)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [changes, setChanges] = useState<Record<string, string>>({})
  useEffect(() => { setSheetIndex(0); setEditing(false); setChanges({}) }, [preview.sheets])
  const sheet = sheets[Math.min(sheetIndex, Math.max(0, sheets.length - 1))]
  const columns = useMemo(() => sheet ? Array.from({ length: sheet.columnCount || Math.max(1, ...sheet.rows.map((row) => row.length)) }, (_, index) => columnName(index)) : [], [sheet])
  if (!sheet) return <p className="file-sheet-empty">表格没有可显示的工作表。</p>
  const keyFor = (row: number, column: number) => `${row}:${column}`
  const valueFor = (row: number, column: number) => changes[keyFor(row, column)] ?? sheet.rows[row]?.[column] ?? ''
  const updateCell = (row: number, column: number, value: string) => setChanges((current) => ({ ...current, [keyFor(row, column)]: value }))
  const cancel = () => { setChanges({}); setEditing(false) }
  const save = async () => {
    if (!onSave) return
    const edits = Object.entries(changes).map(([key, value]) => { const [row, column] = key.split(':'); return { sheetName: sheet.name, row: Number(row), column: Number(column), value } })
    if (!edits.length) return cancel()
    setSaving(true)
    try { await onSave(edits); setChanges({}); setEditing(false) } catch (error) { onNotice?.(`表格保存失败：${String(error)}`) } finally { setSaving(false) }
  }
  return <section className={`file-sheet-preview ${editing ? 'editing' : ''}`} aria-label="表格预览">
    <header><div><strong>{editing ? '编辑表格' : '表格预览'}</strong><small>{editing ? '修改保留在本地，点击保存后写入系统文件' : editable ? '可直接编辑系统内的 .xlsx 文件' : '只读查看，原文件未修改'}</small></div><div className="file-sheet-actions">{editing ? <><button onClick={cancel} disabled={saving}>取消</button><button className="button primary" onClick={() => void save()} disabled={saving}>{saving ? '正在保存…' : `保存${Object.keys(changes).length ? `（${Object.keys(changes).length}）` : ''}`}</button></> : editable ? <button className="button primary" onClick={() => setEditing(true)}>编辑表格</button> : null}{preview.truncated && <small>仅显示前 {preview.rowLimit || sheet.rows.length} 行、{preview.columnLimit || columns.length} 列</small>}</div></header>
    {sheets.length > 1 && <nav aria-label="工作表">{sheets.map((item, index) => <button key={item.name} className={index === sheetIndex ? 'active' : ''} disabled={editing} onClick={() => setSheetIndex(index)}>{item.name}</button>)}</nav>}
    <div className="file-sheet-scroll"><table><thead><tr><th aria-label="行号" />{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{sheet.rows.length ? sheet.rows.map((_, rowIndex) => <tr key={rowIndex}><th>{rowIndex + 1}</th>{columns.map((_, columnIndex) => <td key={columnIndex}>{editing ? <input aria-label={`${sheet.name} ${columnName(columnIndex)}${rowIndex + 1}`} value={valueFor(rowIndex, columnIndex)} onChange={(event) => updateCell(rowIndex, columnIndex, event.target.value)} /> : valueFor(rowIndex, columnIndex)}</td>)}</tr>) : <tr><td colSpan={columns.length + 1}>此工作表为空。</td></tr>}</tbody></table></div>
    <footer>{editing ? '保存时会先保留一份最初导入的工作簿备份；修改会覆盖该单元格原值或公式。' : editable ? '点击“编辑表格”可直接修改单元格。复杂公式、图表和格式仍建议使用原应用编辑。' : '可在此查看导入后的数据；如需完整公式、格式或编辑，请使用“用原应用打开”。'}</footer>
  </section>
}
