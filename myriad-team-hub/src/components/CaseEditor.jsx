/**
 * CaseEditor — 케이스 생성/수정 화면.
 *
 * 구성:
 *  - 메타데이터: 제목, 브랜드(자동완성), 플랫폼(드롭다운+기타직접입력), 게시물 URL, 침해 유형, 상태
 *  - Gmail 에서 가져오기 버튼 (메일 URL 붙여넣기 → 제목+본문 자동 채움)
 *  - TipTap 리치 에디터 (볼드/이탤릭/밑줄/취소선/제목/목록/인용/링크/정렬/코드)
 *  - 이미지 첨부 (별도 갤러리, 본문과 분리) — 드래그앤드롭 + 파일선택
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import Underline from '@tiptap/extension-underline'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Heading1, Heading2,
  List, ListOrdered, Quote, Code, Link as LinkIcon, AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2, Loader2, X, Image as ImageIcon, Upload, Mail, AlertTriangle, Trash2
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { supabase } from '../lib/supabase'
import {
  PLATFORMS, INFRINGEMENT_TYPES, STATUS_OPTIONS,
  uploadCaseAttachment, deleteCaseAttachment,
  listBrandSuggestions, getAttachmentSignedUrls
} from '../lib/cases'
import { extractGmailId, fetchMessage, gmailThreadUrl } from '../lib/gmail'
import { GoogleAuthRequiredError } from '../lib/googleDrive'
import Autocomplete from './Autocomplete'

const EMPTY = {
  title: '',
  brand: '',
  platform: '',
  postUrl: '',
  infringementType: '상표권 침해',
  status: 'share',
  bodyHtml: '',
  bodyText: '',
  gmailMessageId: null,
  gmailThreadUrl: null,
  gmailSubject: null,
  gmailFrom: null,
  gmailDate: null,
  gmailBodyText: null
}

export default function CaseEditor({
  initial,
  saving,
  onSubmit,
  onCancel,
  onDelete,            // null 이면 삭제 버튼 숨김 (신규)
  existingAttachments = [],
  onRefreshAttachments
}) {
  const { user, googleAccessToken } = useAuth()
  const [form, setForm] = useState(() => ({ ...EMPTY, ...(initial || {}) }))
  const [brandSuggestions, setBrandSuggestions] = useState([])
  const [tmpAttachments, setTmpAttachments] = useState([]) // 신규 케이스용 임시 업로드
  const [uploading, setUploading] = useState(false)
  const [gmailOpen, setGmailOpen] = useState(false)
  const [gmailUrl, setGmailUrl] = useState('')
  const [gmailLoading, setGmailLoading] = useState(false)
  const [error, setError] = useState(null)
  const [attachmentUrls, setAttachmentUrls] = useState({})
  const fileInputRef = useRef(null)

  const isNew = !initial?.id

  // ── TipTap 에디터 ───────────────────────────────────────
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] }
      }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: 'noopener' } }),
      Placeholder.configure({
        placeholder: '케이스 상황을 자세히 설명해주세요. (발견 경위, 문제점, 조치 필요 여부 등)'
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] })
    ],
    content: form.bodyHtml || '',
    onUpdate: ({ editor }) => {
      setForm((f) => ({
        ...f,
        bodyHtml: editor.getHTML(),
        bodyText: editor.getText()
      }))
    },
    editorProps: {
      attributes: {
        class: 'prose max-w-none focus:outline-none px-4 py-3'
      }
    }
  })

  // 초기 데이터 변경 시 (수정 모드) 에디터 반영
  useEffect(() => {
    if (!editor) return
    if (initial?.bodyHtml !== undefined && initial.bodyHtml !== editor.getHTML()) {
      editor.commands.setContent(initial.bodyHtml || '')
    }
  }, [initial?.id, editor])

  // 브랜드 자동완성
  useEffect(() => {
    listBrandSuggestions().then(setBrandSuggestions).catch(() => {})
  }, [])

  // 기존 첨부 signed URL 로드
  useEffect(() => {
    if (!existingAttachments?.length) {
      setAttachmentUrls({})
      return
    }
    const paths = existingAttachments.map((a) => a.storage_path).filter(Boolean)
    getAttachmentSignedUrls(paths, 60 * 60).then(setAttachmentUrls).catch(() => {})
  }, [existingAttachments])

  // tmp 업로드 blob URL 관리 (신규 케이스에서 미리보기용)
  const tmpPreviewUrls = useMemo(() => {
    const map = {}
    for (const t of tmpAttachments) {
      if (t._blob) map[t.storage_path] = URL.createObjectURL(t._blob)
    }
    return map
  }, [tmpAttachments])

  useEffect(() => () => {
    Object.values(tmpPreviewUrls).forEach((u) => URL.revokeObjectURL(u))
  }, [tmpPreviewUrls])

  // ── handlers ────────────────────────────────────────────

  function update(field, value) {
    setForm((f) => ({ ...f, [field]: value }))
  }

  async function handleFilesSelected(filesLike) {
    const files = Array.from(filesLike || []).filter((f) => f.type?.startsWith('image/'))
    if (files.length === 0) return
    setUploading(true)
    setError(null)
    try {
      if (isNew) {
        // tmp 업로드 — 케이스 저장 시 commit
        const uploaded = []
        for (const f of files) {
          const a = await uploadCaseAttachment(f, null, user.id)
          uploaded.push({ ...a, _blob: f })
        }
        setTmpAttachments((prev) => [...prev, ...uploaded])
      } else {
        // 기존 케이스에 바로 업로드 → attachments 행 추가
        for (const f of files) {
          await uploadCaseAttachment(f, initial.id, user.id)
        }
        onRefreshAttachments?.()
      }
    } catch (e) {
      setError('이미지 업로드 실패: ' + e.message)
    } finally {
      setUploading(false)
    }
  }

  async function handleRemoveTmp(att) {
    if (!window.confirm('이 이미지를 제거할까요?')) return
    try {
      // 업로드된 파일은 삭제 시도 (실패해도 무시 — 케이스 저장 안하면 orphan)
      if (att.storage_path) {
        await supabase.storage.from('case-attachments').remove([att.storage_path]).catch(() => {})
      }
      setTmpAttachments((prev) => prev.filter((t) => t !== att))
    } catch (e) {
      setError('제거 실패: ' + e.message)
    }
  }

  async function handleRemoveExisting(att) {
    if (!window.confirm('이 이미지를 삭제할까요? (복구 불가)')) return
    try {
      await deleteCaseAttachment(att)
      onRefreshAttachments?.()
    } catch (e) {
      setError('삭제 실패: ' + e.message)
    }
  }

  async function importGmail() {
    setError(null)
    const id = extractGmailId(gmailUrl)
    if (!id) {
      setError('Gmail URL 형식을 인식하지 못했습니다. 메일 열고 주소창 URL 을 그대로 붙여넣어주세요.')
      return
    }
    setGmailLoading(true)
    try {
      const msg = await fetchMessage(googleAccessToken, id)
      // Gmail 메타데이터를 form 에 별도 저장 (본문 에디터에 삽입하지 않음).
      // 뷰 모드에서 별도 <details> 블록으로 접힌 상태로 표시됨.
      setForm((f) => ({
        ...f,
        title: f.title || msg.subject || '',
        gmailMessageId: msg.id,
        gmailThreadUrl: gmailThreadUrl(msg.threadId),
        gmailSubject: msg.subject || null,
        gmailFrom: msg.from || null,
        gmailDate: msg.date ? msg.date.toISOString() : null,
        gmailBodyText: msg.text || null
      }))
      setGmailOpen(false)
      setGmailUrl('')
    } catch (e) {
      if (e instanceof GoogleAuthRequiredError) {
        setError(e.message + ' → 로그아웃 후 다시 로그인해주세요.')
      } else {
        setError('Gmail 가져오기 실패: ' + e.message)
      }
    } finally {
      setGmailLoading(false)
    }
  }

  function removeGmailAttachment() {
    if (!window.confirm('Gmail 첨부를 제거할까요? (게시글 본문에는 영향 없음)')) return
    setForm((f) => ({
      ...f,
      gmailMessageId: null,
      gmailThreadUrl: null,
      gmailSubject: null,
      gmailFrom: null,
      gmailDate: null,
      gmailBodyText: null
    }))
  }

  async function handleSubmit(e) {
    e?.preventDefault()
    if (!form.title.trim()) { setError('제목을 입력하세요.'); return }
    if (!form.brand.trim()) { setError('브랜드(고객사)를 입력하세요.'); return }
    if (!form.platform.trim()) { setError('플랫폼을 입력하세요.'); return }
    setError(null)
    try {
      await onSubmit({
        ...form,
        _tmpAttachments: tmpAttachments
      })
    } catch (e) {
      setError('저장 실패: ' + e.message)
    }
  }

  // 폼 안에서 Enter 키로 인한 자동 submit 방지.
  // submit 은 오직 "등록"/"저장" 버튼 클릭 또는 button[type=submit] 으로만.
  // textarea (TipTap 본문, 댓글 입력 같은) 줄바꿈은 정상 동작 유지.
  function preventEnterSubmit(e) {
    if (e.key !== 'Enter') return
    if (e.nativeEvent?.isComposing) return     // 한글 IME 조합 중 무시
    const tag = e.target.tagName
    if (tag === 'TEXTAREA') return              // textarea 는 줄바꿈
    if (tag === 'BUTTON') return                // 버튼은 Enter 로 클릭 정상
    e.preventDefault()
  }

  return (
    <form onSubmit={handleSubmit} onKeyDown={preventEnterSubmit} className="space-y-4">
      {error && (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0" />
          <span className="whitespace-pre-wrap">{error}</span>
          <button type="button" onClick={() => setError(null)} className="ml-auto text-rose-500 hover:text-rose-700">
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── 메타데이터 카드 ─── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">제목 *</label>
          <input
            type="text"
            value={form.title}
            onChange={(e) => update('title', e.target.value)}
            placeholder="예: Apple Inc. — SmartStore 위조품 발견"
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 text-lg font-semibold"
            autoFocus={isNew}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">브랜드 (고객사) *</label>
            <Autocomplete
              value={form.brand}
              onChange={(v) => update('brand', v)}
              suggestions={brandSuggestions}
              placeholder="예: Apple Inc. (목록에 없으면 직접 입력)"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">플랫폼 *</label>
            <Autocomplete
              value={form.platform}
              onChange={(v) => update('platform', v)}
              suggestions={PLATFORMS}
              placeholder="예: 11st (목록에 없으면 직접 입력)"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">침해 유형 *</label>
            <select
              value={form.infringementType}
              onChange={(e) => update('infringementType', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            >
              {INFRINGEMENT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">상태 *</label>
            <select
              value={form.status}
              onChange={(e) => update('status', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            >
              {STATUS_OPTIONS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-600 mb-1">게시물 URL (선택)</label>
          <input
            type="url"
            value={form.postUrl}
            onChange={(e) => update('postUrl', e.target.value)}
            placeholder="https://..."
            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
        </div>
      </div>

      {/* ── Gmail 가져오기 ─── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Mail size={16} className="text-sky-600" />
            <span className="text-sm font-semibold text-slate-700">Gmail 에서 가져오기</span>
            {form.gmailMessageId && (
              <span className="text-[10px] bg-sky-100 text-sky-700 px-2 py-0.5 rounded-full">
                첨부됨
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {form.gmailMessageId && (
              <button
                type="button"
                onClick={removeGmailAttachment}
                className="text-xs text-rose-600 hover:text-rose-800"
              >
                제거
              </button>
            )}
            <button
              type="button"
              onClick={() => { setGmailOpen((v) => !v); setGmailUrl('') }}
              className="text-xs font-semibold text-sky-700 hover:text-sky-900"
            >
              {gmailOpen ? '닫기' : (form.gmailMessageId ? '다른 메일로 다시 가져오기' : '메일 URL 붙여넣기')}
            </button>
          </div>
        </div>

        {/* 첨부된 Gmail 미리보기 (접힌 details — 에디터에서 미리 어떻게 보일지 확인용) */}
        {form.gmailMessageId && !gmailOpen && (
          <details className="mt-3 bg-sky-50 border border-sky-200 rounded-lg overflow-hidden">
            <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 flex items-center gap-1.5">
              📧 {form.gmailSubject || '(제목 없음)'}
              <span className="text-sky-700/70 font-normal">
                · {form.gmailFrom?.replace(/<.*>/, '').trim() || ''}
                {form.gmailDate && ` · ${new Date(form.gmailDate).toLocaleString('ko-KR')}`}
              </span>
            </summary>
            <div className="px-4 py-3 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed bg-white border-t border-sky-200 max-h-64 overflow-auto">
              {form.gmailBodyText || '(본문 없음)'}
            </div>
          </details>
        )}

        {gmailOpen && (
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <input
                type="url"
                value={gmailUrl}
                onChange={(e) => setGmailUrl(e.target.value)}
                placeholder="permmsgid=msg-f:... 가 포함된 '원본 보기' URL"
                className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500/40"
                disabled={gmailLoading}
              />
              <button
                type="button"
                onClick={importGmail}
                disabled={gmailLoading || !gmailUrl.trim()}
                className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white text-sm font-semibold px-4 rounded-lg"
              >
                {gmailLoading ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
                가져오기
              </button>
            </div>
            <details className="text-[11px] text-slate-500">
              <summary className="cursor-pointer hover:text-slate-700">
                💡 어떤 URL 을 붙여넣어야 하나요? (클릭)
              </summary>
              <div className="mt-2 pl-4 space-y-1 leading-relaxed">
                <p>Gmail 웹 주소창의 <code className="bg-slate-100 px-1 rounded">#inbox/FMfcgz...</code> 형식 URL 은 Gmail API 가 받지 못합니다.</p>
                <p className="font-semibold text-slate-700">올바른 방법:</p>
                <ol className="list-decimal pl-5 space-y-0.5">
                  <li>가져올 메일을 Gmail 에서 열기</li>
                  <li>메일 우측 상단 <b>⋮ (더보기)</b> → <b>"원본 보기"</b> 클릭</li>
                  <li>새로 열린 탭의 주소창 URL 을 그대로 복사 → 위 칸에 붙여넣기</li>
                </ol>
                <p className="text-slate-400">(URL 에 <code className="bg-slate-100 px-1 rounded">?permmsgid=msg-f:...</code> 가 포함되어 있으면 정상)</p>
              </div>
            </details>
          </div>
        )}
        {form.gmailThreadUrl && (
          <a
            href={form.gmailThreadUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-[11px] text-sky-700 hover:text-sky-900 underline"
          >
            Gmail 에서 원본 열기 →
          </a>
        )}
      </div>

      {/* ── 본문 에디터 ─── */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <EditorToolbar editor={editor} />
        <div className="tiptap-editor">
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* ── 이미지 첨부 (갤러리) ─── */}
      <div className="bg-white border border-slate-200 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ImageIcon size={16} className="text-myriad-ink" />
            <span className="text-sm font-semibold text-slate-700">이미지 첨부</span>
            <span className="text-[10px] text-slate-400">
              (본문과 별도 갤러리 — 스크린샷 등)
            </span>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            multiple
            hidden
            onChange={(e) => handleFilesSelected(e.target.files)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-1.5 text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-semibold disabled:opacity-50"
          >
            {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            이미지 추가
          </button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault() }}
          onDrop={(e) => {
            e.preventDefault()
            if (e.dataTransfer.files?.length) handleFilesSelected(e.dataTransfer.files)
          }}
          className="border-2 border-dashed border-slate-200 rounded-xl p-4"
        >
          <AttachmentsGallery
            tmp={tmpAttachments}
            tmpPreviewUrls={tmpPreviewUrls}
            existing={existingAttachments}
            existingUrls={attachmentUrls}
            onRemoveTmp={handleRemoveTmp}
            onRemoveExisting={handleRemoveExisting}
          />
          {tmpAttachments.length === 0 && existingAttachments.length === 0 && (
            <p className="text-center text-xs text-slate-400 py-6">
              이미지를 드래그하거나 위 버튼을 눌러 추가하세요.
            </p>
          )}
        </div>
      </div>

      {/* ── Footer ─── */}
      <div className="flex items-center gap-2 pt-2">
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            className="flex items-center gap-1.5 text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg text-sm"
          >
            <Trash2 size={14} /> 삭제
          </button>
        )}
        <div className="flex-1" />
        <button
          type="button"
          onClick={onCancel}
          className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg text-sm"
        >
          취소
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-5 py-2 rounded-lg text-sm disabled:opacity-50"
        >
          {saving ? <Loader2 size={13} className="animate-spin" /> : null}
          {isNew ? '등록' : '저장'}
        </button>
      </div>
    </form>
  )
}

// ─────────────────────────────────────────────────────
// TipTap 툴바
// ─────────────────────────────────────────────────────

function EditorToolbar({ editor }) {
  if (!editor) {
    return <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 h-10" />
  }

  const btn = (active, onClick, icon, title, disabled = false) => {
    const Icon = icon
    return (
      <button
        type="button"
        title={title}
        onClick={onClick}
        disabled={disabled}
        className={`p-1.5 rounded transition ${
          active
            ? 'bg-myriad-primary/30 text-myriad-ink'
            : 'text-slate-600 hover:bg-slate-100 disabled:opacity-40 disabled:hover:bg-transparent'
        }`}
      >
        <Icon size={14} />
      </button>
    )
  }

  function promptLink() {
    const prev = editor.getAttributes('link').href
    const url = window.prompt('링크 URL 을 입력하세요 (비우면 해제):', prev || '')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    let href = url.trim()
    if (!/^https?:\/\//i.test(href)) href = 'https://' + href
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run()
  }

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-2 py-1.5 flex items-center gap-0.5 flex-wrap">
      {btn(editor.isActive('bold'), () => editor.chain().focus().toggleBold().run(), Bold, '굵게 (Ctrl+B)')}
      {btn(editor.isActive('italic'), () => editor.chain().focus().toggleItalic().run(), Italic, '이탤릭 (Ctrl+I)')}
      {btn(editor.isActive('underline'), () => editor.chain().focus().toggleUnderline().run(), UnderlineIcon, '밑줄 (Ctrl+U)')}
      {btn(editor.isActive('strike'), () => editor.chain().focus().toggleStrike().run(), Strikethrough, '취소선')}

      <span className="w-px h-5 bg-slate-300 mx-1" />

      {btn(editor.isActive('heading', { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), Heading1, '제목 1')}
      {btn(editor.isActive('heading', { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), Heading2, '제목 2')}

      <span className="w-px h-5 bg-slate-300 mx-1" />

      {btn(editor.isActive('bulletList'), () => editor.chain().focus().toggleBulletList().run(), List, '글머리 기호')}
      {btn(editor.isActive('orderedList'), () => editor.chain().focus().toggleOrderedList().run(), ListOrdered, '번호 매기기')}
      {btn(editor.isActive('blockquote'), () => editor.chain().focus().toggleBlockquote().run(), Quote, '인용')}
      {btn(editor.isActive('codeBlock'), () => editor.chain().focus().toggleCodeBlock().run(), Code, '코드 블록')}

      <span className="w-px h-5 bg-slate-300 mx-1" />

      {btn(editor.isActive({ textAlign: 'left' }), () => editor.chain().focus().setTextAlign('left').run(), AlignLeft, '왼쪽 정렬')}
      {btn(editor.isActive({ textAlign: 'center' }), () => editor.chain().focus().setTextAlign('center').run(), AlignCenter, '가운데 정렬')}
      {btn(editor.isActive({ textAlign: 'right' }), () => editor.chain().focus().setTextAlign('right').run(), AlignRight, '오른쪽 정렬')}

      <span className="w-px h-5 bg-slate-300 mx-1" />

      {btn(editor.isActive('link'), promptLink, LinkIcon, '링크')}

      <span className="flex-1" />

      {btn(false, () => editor.chain().focus().undo().run(), Undo2, '실행 취소 (Ctrl+Z)', !editor.can().undo())}
      {btn(false, () => editor.chain().focus().redo().run(), Redo2, '다시 실행 (Ctrl+Y)', !editor.can().redo())}
    </div>
  )
}

// ─────────────────────────────────────────────────────
// 첨부 갤러리
// ─────────────────────────────────────────────────────

function AttachmentsGallery({ tmp, tmpPreviewUrls, existing, existingUrls, onRemoveTmp, onRemoveExisting }) {
  const items = [
    ...existing.map((a) => ({
      key: `e-${a.id}`,
      name: a.file_name,
      src: existingUrls[a.storage_path],
      kind: 'existing',
      raw: a
    })),
    ...tmp.map((a, i) => ({
      key: `t-${i}`,
      name: a.file_name,
      src: tmpPreviewUrls[a.storage_path],
      kind: 'tmp',
      raw: a
    }))
  ]
  if (items.length === 0) return null
  return (
    <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
      {items.map((it) => (
        <div key={it.key} className="relative group bg-slate-100 rounded-lg overflow-hidden aspect-square">
          {it.src ? (
            <img src={it.src} alt={it.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-slate-400">
              <Loader2 size={16} className="animate-spin" />
            </div>
          )}
          <button
            type="button"
            onClick={() => it.kind === 'tmp' ? onRemoveTmp(it.raw) : onRemoveExisting(it.raw)}
            className="absolute top-1 right-1 p-1 bg-white/90 hover:bg-rose-500 hover:text-white text-slate-700 rounded-full opacity-0 group-hover:opacity-100 transition"
            title="삭제"
          >
            <X size={12} />
          </button>
          <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[10px] px-2 py-1 truncate opacity-0 group-hover:opacity-100 transition">
            {it.name}
          </div>
        </div>
      ))}
    </div>
  )
}

