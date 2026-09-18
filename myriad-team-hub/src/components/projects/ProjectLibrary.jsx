/**
 * ProjectLibrary — 자료실(링크/파일) + 연락처.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Plus, Edit3, Trash2, X, Save, Loader2, ExternalLink, Download, FileText, Link as LinkIcon, User, Mail, Phone, Upload, AlertTriangle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import { listResources, saveResource, deleteResource, uploadResourceFile, signedUrls, fmtBytes } from '../../lib/projects'

export default function ProjectLibrary({ project }) {
  const { isAdmin, user } = useAuth()
  const [rows, setRows] = useState([])
  const [urls, setUrls] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [editor, setEditor] = useState(null)

  useEffect(() => { load() }, [project.id])
  async function load() {
    setLoading(true)
    try {
      const r = await listResources(project.id)
      setRows(r)
      setUrls(await signedUrls(r.filter((x) => x.storage_path).map((x) => x.storage_path)))
    } catch (e) { setError(e.message) } finally { setLoading(false) }
  }

  const files = useMemo(() => groupBy(rows.filter((r) => r.kind !== 'contact'), (r) => r.group_label || '기타'), [rows])
  const contacts = useMemo(() => groupBy(rows.filter((r) => r.kind === 'contact'), (r) => r.group_label || r.org || '기타'), [rows])

  async function handleDelete(r) {
    if (!confirm(`"${r.label}" 을 삭제할까요?`)) return
    await deleteResource(r); load()
  }
  const canEdit = (r) => isAdmin || r.created_by === user?.id || !r.created_by

  return (
    <div>
      {error && <div className="mb-3 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-center gap-2"><AlertTriangle size={13} /> {error}</div>}
      <div className="grid md:grid-cols-5 gap-5">
        {/* 자료 */}
        <section className="md:col-span-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-slate-900 flex items-center gap-2"><FileText size={16} /> 자료 · 링크</h3>
            <button onClick={() => setEditor({ initial: { kind: 'file' } })} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink"><Plus size={12} /> 자료 추가</button>
          </div>
          {loading ? <Loading /> : Object.keys(files).length === 0 ? <Empty text="자료가 없습니다." /> : (
            <div className="space-y-4">
              {Object.entries(files).map(([g, items]) => (
                <div key={g}>
                  <div className="text-[11px] font-bold text-[#8A8580] uppercase tracking-wider mb-1.5">{g}</div>
                  <ul className="bg-white border border-[#E7E3DE] rounded-xl divide-y divide-[#E7E3DE]">
                    {items.map((r) => {
                      const href = r.kind === 'link' ? r.url : urls[r.storage_path]
                      const missing = r.kind === 'file' && !r.storage_path
                      return (
                        <li key={r.id} className="flex items-start gap-3 px-3 py-2.5 hover:bg-[#FAF8F4]">
                          <div className="mt-0.5 text-slate-400 shrink-0">{r.kind === 'link' ? <LinkIcon size={15} /> : <FileText size={15} />}</div>
                          <div className="flex-1 min-w-0">
                            {href ? (
                              <a href={href} target="_blank" rel="noopener" download={r.kind === 'file' ? r.file_name : undefined}
                                className="font-semibold text-slate-900 hover:text-[#B98A00] inline-flex items-center gap-1 break-all">
                                {r.label} {r.kind === 'link' ? <ExternalLink size={11} className="shrink-0" /> : <Download size={11} className="shrink-0" />}
                              </a>
                            ) : (
                              <span className="font-semibold text-slate-700">{r.label}</span>
                            )}
                            {missing && <span className="ml-2 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">파일 미업로드 — 수정에서 업로드</span>}
                            {r.file_name && r.storage_path && <div className="text-[11px] text-slate-400">{r.file_name} · {fmtBytes(r.size_bytes)}</div>}
                            {r.note && <div className="text-xs text-slate-500 mt-0.5">{r.note}</div>}
                          </div>
                          {canEdit(r) && (
                            <div className="flex gap-0.5 shrink-0">
                              <button onClick={() => setEditor({ initial: r })} className="p-1 text-slate-400 hover:text-slate-800"><Edit3 size={13} /></button>
                              <button onClick={() => handleDelete(r)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* 연락처 */}
        <section className="md:col-span-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-bold text-slate-900 flex items-center gap-2"><User size={16} /> 연락처</h3>
            <button onClick={() => setEditor({ initial: { kind: 'contact' } })} className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"><Plus size={12} /> 추가</button>
          </div>
          {loading ? <Loading /> : Object.keys(contacts).length === 0 ? <Empty text="연락처가 없습니다." /> : (
            <div className="space-y-4">
              {Object.entries(contacts).map(([g, items]) => (
                <div key={g}>
                  <div className="text-[11px] font-bold text-[#8A8580] uppercase tracking-wider mb-1.5">{g}</div>
                  <ul className="space-y-1.5">
                    {items.map((r) => (
                      <li key={r.id} className="bg-white border border-[#E7E3DE] rounded-xl px-3 py-2.5 flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-slate-900 text-sm">{r.label} {r.role && <span className="text-xs text-slate-500 font-normal">· {r.role}</span>}</div>
                          {r.org && <div className="text-[11px] text-slate-500">{r.org}</div>}
                          <div className="text-xs text-slate-600 mt-1 space-y-0.5">
                            {r.email && <div className="flex items-center gap-1"><Mail size={11} className="text-slate-400" /><a href={`mailto:${r.email}`} className="hover:underline break-all">{r.email}</a></div>}
                            {r.phone && <div className="flex items-center gap-1"><Phone size={11} className="text-slate-400" />{r.phone}</div>}
                          </div>
                          {r.note && <div className="text-[11px] text-slate-500 mt-1">{r.note}</div>}
                        </div>
                        {canEdit(r) && (
                          <div className="flex gap-0.5 shrink-0">
                            <button onClick={() => setEditor({ initial: r })} className="p-1 text-slate-400 hover:text-slate-800"><Edit3 size={13} /></button>
                            <button onClick={() => handleDelete(r)} className="p-1 text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      {editor && <ResourceEditorModal project={project} initial={editor.initial} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); load() }} />}
    </div>
  )
}

function groupBy(list, fn) {
  const out = {}
  for (const x of list) (out[fn(x)] ||= []).push(x)
  return out
}
const Loading = () => <div className="py-10 text-center text-sm text-slate-400 flex items-center justify-center gap-2"><Loader2 size={14} className="animate-spin" /> 불러오는 중...</div>
const Empty = ({ text }) => <div className="py-10 text-center text-sm text-slate-400 bg-white border border-dashed border-slate-200 rounded-xl">{text}</div>

function ResourceEditorModal({ project, initial, onClose, onSaved }) {
  const { user } = useAuth()
  const [form, setForm] = useState(() => ({
    id: initial?.id, project_id: project.id,
    kind: initial?.kind || 'file',
    label: initial?.label || '', url: initial?.url || '',
    storage_path: initial?.storage_path || null, file_name: initial?.file_name || null, size_bytes: initial?.size_bytes ?? null,
    org: initial?.org || '', role: initial?.role || '', email: initial?.email || '', phone: initial?.phone || '',
    note: initial?.note || '', group_label: initial?.group_label || '', sort_order: initial?.sort_order ?? 0
  }))
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)
  const inputCls = 'px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40'

  async function pickFile(f) {
    if (!f) return
    if (f.size > 50 * 1024 * 1024) { setError('50MB 초과 파일은 두레이/드라이브 링크로 등록해 주세요.'); return }
    setUploading(true); setError(null)
    try {
      const up = await uploadResourceFile(f)
      setForm((x) => ({ ...x, ...up, label: x.label || f.name, kind: 'file' }))
    } catch (e) { setError(e.message) } finally { setUploading(false) }
  }

  async function submit(e) {
    e.preventDefault()
    if (!form.label.trim()) { setError('이름을 입력하세요.'); return }
    if (form.kind === 'link' && !form.url.trim()) { setError('URL 을 입력하세요.'); return }
    setSaving(true); setError(null)
    try { await saveResource(form, user.id); onSaved() } catch (e) { setError(e.message) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-lg my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">{initial?.id ? '수정' : '추가'}</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="flex gap-1 text-xs">
            {[['file', '파일'], ['link', '링크'], ['contact', '연락처']].map(([k, l]) => (
              <button type="button" key={k} onClick={() => setForm((f) => ({ ...f, kind: k }))} className={`px-3 py-1 rounded-full border font-semibold ${form.kind === k ? 'bg-myriad-primary/20 border-myriad-primary text-myriad-ink' : 'border-slate-200 text-slate-500'}`}>{l}</button>
            ))}
          </div>
          <input value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} className={`${inputCls} w-full font-semibold`} placeholder={form.kind === 'contact' ? '이름' : '표시 이름'} autoFocus />
          {form.kind === 'link' && <input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} className={`${inputCls} w-full`} placeholder="https://" />}
          {form.kind === 'file' && (
            <div className="border border-dashed border-slate-300 rounded-xl p-3 flex items-center gap-3">
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading} className="text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1">
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />} {form.storage_path ? '파일 교체' : '파일 선택'}
              </button>
              <input ref={fileRef} type="file" className="hidden" onChange={(e) => pickFile(e.target.files?.[0])} />
              <span className="text-xs text-slate-500 truncate">{form.file_name ? `${form.file_name} (${fmtBytes(form.size_bytes)})` : '업로드된 파일 없음'}</span>
            </div>
          )}
          {form.kind === 'contact' && (
            <div className="grid grid-cols-2 gap-2">
              <input value={form.org} onChange={(e) => setForm((f) => ({ ...f, org: e.target.value }))} className={inputCls} placeholder="소속" />
              <input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className={inputCls} placeholder="직책" />
              <input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className={inputCls} placeholder="이메일" />
              <input value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} className={inputCls} placeholder="전화" />
            </div>
          )}
          <div className="grid grid-cols-3 gap-2">
            <input value={form.group_label} onChange={(e) => setForm((f) => ({ ...f, group_label: e.target.value }))} className={`${inputCls} col-span-2`} placeholder={form.kind === 'contact' ? '그룹 (KOIPA / Myriad)' : '그룹 (양식·기준 / 외부 드라이브)'} />
            <input type="number" value={form.sort_order} onChange={(e) => setForm((f) => ({ ...f, sort_order: Number(e.target.value) }))} className={inputCls} placeholder="정렬" />
          </div>
          <textarea value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} rows={2} className={`${inputCls} w-full`} placeholder="설명 / 비고" />
          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">취소</button>
          <button type="submit" disabled={saving || uploading} className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
          </button>
        </div>
      </form>
    </div>
  )
}
