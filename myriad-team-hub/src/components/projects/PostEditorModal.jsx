/**
 * PostEditorModal — 프로젝트 게시판 글 작성/수정 모달.
 * 섹션 kind 에 따라 노출 필드가 달라짐:
 *   notice    → 핀 고정 + 중요도
 *   monthly / copyright → 해당 월
 *   campaign / adhoc → 라운드(차수)
 *   issues    → 상태 + 기한
 * 첨부: 모든 파일 타입 (xlsx/hwp/docx/pdf/이미지). 신규 글은 tmp 업로드 후 저장 시 commit.
 */
import { useEffect, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import {
  Bold, Italic, Underline as UnderlineIcon, List, ListOrdered, Quote, Link as LinkIcon,
  Undo2, Redo2, X, Loader2, Paperclip, Trash2, Save, Pin
} from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext'
import {
  ISSUE_STATUS, SEVERITY, monthLabel, fmtBytes,
  uploadAttachment, commitTmpAttachments, deleteAttachment, removeTmpFile, listAttachments
} from '../../lib/projects'

export default function PostEditorModal({
  section, project, initial, months = [], campaigns = [],
  defaultMonth = null, defaultCampaignId = null,
  onSave, onClose
}) {
  const { user } = useAuth()
  const kind = section.kind
  const isNew = !initial?.id
  const [form, setForm] = useState(() => ({
    title: initial?.title || '',
    bodyHtml: initial?.body_html || '',
    bodyText: initial?.body_text || '',
    periodMonth: initial?.period_month || defaultMonth || null,
    campaignId: initial?.campaign_id || defaultCampaignId || null,
    category: initial?.category || '',
    status: initial?.status && initial.status !== 'none' ? initial.status : (kind === 'issues' ? 'open' : 'none'),
    dueOn: initial?.due_on || '',
    pinned: !!initial?.pinned,
    severity: initial?.severity || 'info'
  }))
  const [existing, setExisting] = useState([])
  const [tmp, setTmp] = useState([])
  const [uploading, setUploading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const fileRef = useRef(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener' } }),
      Placeholder.configure({ placeholder: '내용을 입력하세요. 파일은 아래 첨부 버튼으로 올릴 수 있습니다.' })
    ],
    content: form.bodyHtml,
    onUpdate: ({ editor }) => setForm((f) => ({ ...f, bodyHtml: editor.getHTML(), bodyText: editor.getText() })),
    editorProps: { attributes: { class: 'case-prose max-w-none focus:outline-none px-4 py-3 min-h-[180px]' } }
  })

  useEffect(() => {
    if (initial?.id) listAttachments(initial.id).then(setExisting).catch(() => {})
  }, [initial?.id])

  // ESC 닫기
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])

  async function handleFiles(files) {
    if (!files?.length) return
    setUploading(true); setError(null)
    try {
      for (const f of files) {
        if (f.size > 50 * 1024 * 1024) { setError(`${f.name}: 50MB 초과 파일은 두레이/드라이브 링크로 공유해 주세요.`); continue }
        const r = await uploadAttachment(f, isNew ? null : initial.id, user.id)
        if (r.tmp) setTmp((t) => [...t, r])
        else setExisting((e) => [...e, r])
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeExisting(att) {
    if (!confirm(`"${att.file_name}" 첨부를 삭제할까요?`)) return
    await deleteAttachment(att)
    setExisting((e) => e.filter((a) => a.id !== att.id))
  }
  async function removeTmp(t) {
    await removeTmpFile(t.storage_path)
    setTmp((l) => l.filter((x) => x.storage_path !== t.storage_path))
  }

  async function submit(e) {
    e?.preventDefault()
    if (!form.title.trim()) { setError('제목을 입력하세요.'); return }
    if ((kind === 'monthly' || kind === 'copyright') && !form.periodMonth) { setError('해당 월을 선택하세요.'); return }
    setSaving(true); setError(null)
    try {
      const saved = await onSave(form)
      if (isNew && tmp.length && saved?.id) await commitTmpAttachments(tmp, saved.id, user.id)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  function setLink() {
    const prev = editor?.getAttributes('link').href
    const url = window.prompt('링크 URL', prev || 'https://')
    if (url === null) return
    if (!url) { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const inputCls = 'px-2.5 py-1.5 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40'
  const showMonth = kind === 'monthly' || kind === 'copyright'
  const showCampaign = kind === 'campaign' || kind === 'adhoc'
  const showIssue = kind === 'issues'
  const showNotice = kind === 'notice'

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-6 overflow-y-auto" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-xl w-full max-w-3xl my-4">
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200">
          <h3 className="font-bold text-slate-900">
            {isNew ? '새 글' : '글 수정'} <span className="text-slate-400 font-normal text-sm">· {section.label}</span>
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          <input
            autoFocus
            value={form.title}
            onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
            placeholder="제목"
            className={`${inputCls} w-full font-semibold`}
          />

          {/* 메타 필드 — kind 별 */}
          <div className="flex flex-wrap gap-2 items-center">
            {showMonth && (
              <select value={form.periodMonth || ''} onChange={(e) => setForm((f) => ({ ...f, periodMonth: e.target.value || null }))} className={inputCls}>
                <option value="">해당 월 선택</option>
                {months.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            )}
            {showCampaign && (
              <select value={form.campaignId || ''} onChange={(e) => setForm((f) => ({ ...f, campaignId: e.target.value || null }))} className={inputCls}>
                <option value="">라운드 미지정</option>
                {campaigns.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </select>
            )}
            {showIssue && (
              <>
                <select value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))} className={inputCls}>
                  {ISSUE_STATUS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <label className="flex items-center gap-1.5 text-sm text-slate-600">
                  기한
                  <input type="date" value={form.dueOn || ''} onChange={(e) => setForm((f) => ({ ...f, dueOn: e.target.value }))} className={inputCls} />
                </label>
              </>
            )}
            {showNotice && (
              <>
                <select value={form.severity} onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value }))} className={inputCls}>
                  {SEVERITY.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, pinned: !f.pinned }))}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 text-sm rounded-lg border ${form.pinned ? 'bg-myriad-primary/20 border-myriad-primary text-myriad-ink font-semibold' : 'border-slate-300 text-slate-600'}`}
                >
                  <Pin size={13} /> {form.pinned ? '상단 고정됨' : '상단 고정'}
                </button>
              </>
            )}
            <input
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="분류 (예: 보완요청 / 제출물 / 회의록)"
              className={`${inputCls} w-56`}
            />
          </div>

          {/* 에디터 */}
          <div className="border border-slate-300 rounded-xl overflow-hidden tiptap-editor">
            <div className="flex flex-wrap gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50">
              <TB on={() => editor.chain().focus().toggleBold().run()} active={editor?.isActive('bold')} icon={Bold} title="굵게" />
              <TB on={() => editor.chain().focus().toggleItalic().run()} active={editor?.isActive('italic')} icon={Italic} title="기울임" />
              <TB on={() => editor.chain().focus().toggleUnderline().run()} active={editor?.isActive('underline')} icon={UnderlineIcon} title="밑줄" />
              <span className="w-px bg-slate-300 mx-1 my-1" />
              <TB on={() => editor.chain().focus().toggleBulletList().run()} active={editor?.isActive('bulletList')} icon={List} title="목록" />
              <TB on={() => editor.chain().focus().toggleOrderedList().run()} active={editor?.isActive('orderedList')} icon={ListOrdered} title="번호 목록" />
              <TB on={() => editor.chain().focus().toggleBlockquote().run()} active={editor?.isActive('blockquote')} icon={Quote} title="인용" />
              <TB on={setLink} active={editor?.isActive('link')} icon={LinkIcon} title="링크" />
              <span className="w-px bg-slate-300 mx-1 my-1" />
              <TB on={() => editor.chain().focus().undo().run()} icon={Undo2} title="되돌리기" />
              <TB on={() => editor.chain().focus().redo().run()} icon={Redo2} title="다시 실행" />
            </div>
            <EditorContent editor={editor} />
          </div>

          {/* 첨부 */}
          <div className="border border-dashed border-slate-300 rounded-xl p-3">
            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500 flex items-center gap-1.5"><Paperclip size={12} /> 첨부파일 (xlsx / hwp / docx / pdf / 이미지, 50MB 이하)</div>
              <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading}
                className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 flex items-center gap-1">
                {uploading ? <Loader2 size={12} className="animate-spin" /> : <Paperclip size={12} />} 파일 추가
              </button>
              <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => handleFiles(Array.from(e.target.files || []))} />
            </div>
            {(existing.length > 0 || tmp.length > 0) && (
              <ul className="mt-2 space-y-1">
                {existing.map((a) => (
                  <li key={a.id} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="truncate flex-1">{a.file_name}</span>
                    <span className="text-xs text-slate-400">{fmtBytes(a.size_bytes)}</span>
                    <button type="button" onClick={() => removeExisting(a)} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                  </li>
                ))}
                {tmp.map((t) => (
                  <li key={t.storage_path} className="flex items-center gap-2 text-sm text-slate-700">
                    <span className="truncate flex-1">{t.file_name}</span>
                    <span className="text-xs text-slate-400">{fmtBytes(t.size_bytes)}</span>
                    <button type="button" onClick={() => removeTmp(t)} className="text-slate-400 hover:text-rose-600"><Trash2 size={13} /></button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {error && <div className="text-sm text-rose-700 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button type="button" onClick={onClose} className="text-sm px-3 py-1.5 text-slate-600 hover:bg-slate-100 rounded-lg">취소</button>
          <button type="submit" disabled={saving || uploading}
            className="text-sm font-semibold px-4 py-1.5 rounded-lg bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink flex items-center gap-1.5 disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} 저장
          </button>
        </div>
      </form>
    </div>
  )
}

function TB({ on, active, icon: Icon, title }) {
  return (
    <button type="button" onClick={on} title={title}
      className={`p-1.5 rounded hover:bg-slate-200 ${active ? 'bg-slate-200 text-myriad-ink' : 'text-slate-600'}`}>
      <Icon size={14} />
    </button>
  )
}
