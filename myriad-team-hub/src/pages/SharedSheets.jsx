/**
 * 공용 시트 페이지 — Phase 10 개편:
 *  - 그룹 폴더 2단계 네비게이션 (폴더 그리드 → 폴더 클릭 → 시트 목록)
 *  - "미분류" 가상 폴더 (group_id IS NULL)
 *  - 시트/그룹 CRUD 일반 사용자에게 개방
 *  - 삭제는 작성자 본인 또는 admin 만 (RLS + UI 이중 체크)
 *  - 검색 시 그룹 구분 무시하고 전체 결과 표시
 */
import { useEffect, useMemo, useState } from 'react'
import {
  FileSpreadsheet, Loader2, Search, Tag, ExternalLink, Maximize2, X,
  Download, RefreshCw, AlertTriangle, Zap, Plus, ChevronLeft, FolderPlus,
  MoreVertical, Edit2, Trash2, Save, Eye, EyeOff, Move
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import {
  listGroups, createGroup, updateGroup, deleteGroup,
  listAllSheets, createSheet, updateSheet, deleteSheet, moveSheetToGroup,
  isValidSheetUrl
} from '../lib/sharedSheets'
import { logActivity } from '../lib/community'

// Google 시트 URL → iframe 임베드용
function toEmbedUrl(url) {
  if (!url) return ''
  const sep = url.includes('?') ? '&' : '?'
  return url + sep + 'rm=minimal'
}
function toXlsxUrl(url) {
  const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  if (!m) return null
  return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=xlsx`
}

const GROUP_COLORS = ['#f59e0b', '#ef4444', '#10b981', '#3b82f6', '#8b5cf6', '#64748b']
const SHEET_EDITOR_EMPTY = {
  id: null,
  title: '',
  description: '',
  icon: '📊',
  google_url: '',
  category: '',
  uses_apps_script: false,
  is_active: true,
  sort_order: 0,
  group_id: null
}

export default function SharedSheets() {
  const { user, isAdmin } = useAuth()
  const [groups, setGroups] = useState([])
  const [sheets, setSheets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [query, setQuery] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [currentGroupId, setCurrentGroupId] = useState(null) // null = 그룹 그리드 뷰, 'UNGROUPED' | uuid = 그룹 내부
  const [opened, setOpened] = useState(null)                  // 풀스크린 iframe 대상
  const [sheetEditor, setSheetEditor] = useState(null)        // 시트 편집/생성
  const [groupEditor, setGroupEditor] = useState(null)        // 그룹 편집/생성
  const [moveTarget, setMoveTarget] = useState(null)          // 그룹 이동 선택 중인 시트
  const [menuOpenId, setMenuOpenId] = useState(null)          // 시트/그룹 ... 메뉴

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [gs, ss] = await Promise.all([listGroups(), listAllSheets()])
      setGroups(gs)
      setSheets(ss)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  // 권한 체크 (UI 노출용 — 실제 차단은 RLS)
  const canDelete = (row) => row?.created_by === user?.id || isAdmin

  // 현재 뷰의 시트 목록
  const visibleSheets = useMemo(() => {
    const q = query.trim().toLowerCase()
    return sheets.filter((s) => {
      if (!s.is_active && !isAdmin) return false
      if (categoryFilter !== 'all' && s.category !== categoryFilter) return false
      if (q) {
        return (
          (s.title ?? '').toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q)
        )
      }
      // 검색/필터 없으면 현재 그룹 기준
      if (currentGroupId === null) return false // 그룹 그리드 뷰에서는 시트 리스트 숨김
      if (currentGroupId === 'UNGROUPED') return !s.group_id
      return s.group_id === currentGroupId
    })
  }, [sheets, query, categoryFilter, currentGroupId, isAdmin])

  const categories = useMemo(() => {
    const set = new Set(sheets.map((u) => u.category).filter(Boolean))
    return ['all', ...set]
  }, [sheets])

  // 각 그룹별 시트 개수
  const sheetCountByGroup = useMemo(() => {
    const map = {}
    for (const s of sheets) {
      if (!s.is_active && !isAdmin) continue
      const k = s.group_id || 'UNGROUPED'
      map[k] = (map[k] || 0) + 1
    }
    return map
  }, [sheets, isAdmin])

  const currentGroup = useMemo(() => {
    if (currentGroupId === 'UNGROUPED') return { id: 'UNGROUPED', name: '미분류', icon: '📂', color: '#64748b' }
    if (!currentGroupId) return null
    return groups.find((g) => g.id === currentGroupId)
  }, [groups, currentGroupId])

  const isSearching = query.trim() || categoryFilter !== 'all'

  // ─── CRUD 핸들러 ───────────────────────────
  async function saveSheet() {
    const e = sheetEditor
    if (!e.title.trim()) { setError('제목은 필수입니다.'); return }
    if (!e.google_url.trim()) { setError('Google 시트 URL 은 필수입니다.'); return }
    if (!isValidSheetUrl(e.google_url)) {
      setError('Google Sheets URL 형식이 아닙니다.')
      return
    }
    setError(null)
    const payload = {
      title: e.title.trim(),
      description: e.description?.trim() || null,
      icon: e.icon || null,
      google_url: e.google_url.trim(),
      category: e.category?.trim() || null,
      uses_apps_script: !!e.uses_apps_script,
      is_active: e.is_active,
      sort_order: Number(e.sort_order) || 0,
      group_id: e.group_id || null
    }
    try {
      if (e.id) {
        await updateSheet(e.id, payload)
      } else {
        const created = await createSheet(payload)
        logActivity('shared_sheet_added', {
          target_type: 'shared_sheet',
          payload: { title: created.title, url: created.google_url }
        }).catch(() => {})
      }
      setSheetEditor(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function removeSheet() {
    const e = sheetEditor
    if (!e?.id) { setSheetEditor(null); return }
    if (!canDelete(e)) {
      setError('이 시트는 작성자 또는 관리자만 삭제할 수 있습니다.')
      return
    }
    if (!window.confirm(`"${e.title}" 시트 등록을 삭제할까요?`)) return
    try {
      await deleteSheet(e.id)
      setSheetEditor(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function toggleSheetActive(s) {
    try {
      await updateSheet(s.id, { is_active: !s.is_active })
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function saveGroup() {
    const g = groupEditor
    if (!g.name.trim()) { setError('폴더 이름을 입력하세요.'); return }
    setError(null)
    const payload = {
      name: g.name.trim(),
      icon: g.icon || '📁',
      color: g.color || '#f59e0b',
      sort_order: Number(g.sort_order) || 0
    }
    try {
      if (g.id) await updateGroup(g.id, payload)
      else await createGroup(payload)
      setGroupEditor(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function removeGroup() {
    const g = groupEditor
    if (!g?.id) { setGroupEditor(null); return }
    if (!canDelete(g)) {
      setError('이 폴더는 작성자 또는 관리자만 삭제할 수 있습니다.')
      return
    }
    const childCount = sheetCountByGroup[g.id] || 0
    const msg = childCount > 0
      ? `"${g.name}" 폴더를 삭제할까요?\n소속된 시트 ${childCount}개는 "미분류"로 이동됩니다.`
      : `"${g.name}" 폴더를 삭제할까요?`
    if (!window.confirm(msg)) return
    try {
      await deleteGroup(g.id)
      setGroupEditor(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  async function onMoveSheet(sheetId, groupId) {
    try {
      await moveSheetToGroup(sheetId, groupId)
      setMoveTarget(null)
      setMenuOpenId(null)
      await load()
    } catch (err) {
      setError(err.message)
    }
  }

  // ─── 풀스크린 iframe ───────────────────────
  if (opened) {
    return (
      <div className="fixed inset-0 z-40 bg-white flex flex-col">
        <div className="h-12 border-b border-slate-200 bg-white flex items-center gap-3 px-4 shrink-0">
          <button
            onClick={() => setOpened(null)}
            className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
          >
            <X size={16} /> 목록으로
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <span className="text-xl">{opened.icon || '📊'}</span>
          <span className="font-semibold text-slate-900 truncate">{opened.title}</span>
          <div className="flex-1" />
          {toXlsxUrl(opened.google_url) && (
            <a
              href={toXlsxUrl(opened.google_url)}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-900 px-2 py-1 rounded hover:bg-slate-100"
              title="Excel 다운로드"
            >
              <Download size={14} /> Excel
            </a>
          )}
          <a
            href={opened.google_url}
            target="_blank" rel="noreferrer"
            className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1 rounded border border-myriad-primary text-myriad-ink hover:bg-myriad-primary/10"
          >
            <ExternalLink size={14} /> 새 탭에서 열기
          </a>
        </div>
        {opened.uses_apps_script && (
          <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 flex items-start gap-2 shrink-0">
            <AlertTriangle size={14} className="text-amber-600 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800">
              이 시트는 <b>Apps Script</b>를 사용합니다. 매크로 실행 시 오류가 나면 우측 상단 "새 탭에서 열기" 로 실행하세요.
            </div>
          </div>
        )}
        <iframe
          src={toEmbedUrl(opened.google_url)}
          title={opened.title}
          className="flex-1 w-full border-0"
        />
      </div>
    )
  }

  // ─── 리스트 뷰 ─────────────────────────────
  return (
    <div className="p-8 max-w-6xl mx-auto">
      <header className="mb-6 flex items-center gap-3 flex-wrap">
        {currentGroupId && !isSearching && (
          <button
            onClick={() => { setCurrentGroupId(null); setMenuOpenId(null) }}
            className="p-2 rounded-lg hover:bg-slate-100 text-slate-500 hover:text-slate-900"
            title="폴더 목록으로"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        <FileSpreadsheet className="text-myriad-ink" />
        <h1 className="text-2xl font-bold text-slate-900">
          공용 시트
          {currentGroup && (
            <span className="ml-2 text-slate-400 font-normal text-lg">
              / <span className="text-lg">{currentGroup.icon}</span> {currentGroup.name}
            </span>
          )}
        </h1>
        <div className="flex-1" />
        <button onClick={load} className="p-2 rounded-lg hover:bg-slate-100" title="새로고침">
          <RefreshCw size={14} className="text-slate-500" />
        </button>
        <button
          onClick={() => setGroupEditor({
            id: null, name: '', icon: '📁', color: GROUP_COLORS[0], sort_order: 0
          })}
          className="flex items-center gap-1.5 text-sm border border-slate-300 text-slate-700 hover:bg-slate-50 px-3 py-2 rounded-lg"
        >
          <FolderPlus size={14} /> 새 폴더
        </button>
        <button
          onClick={() => setSheetEditor({
            ...SHEET_EDITOR_EMPTY,
            group_id: currentGroupId && currentGroupId !== 'UNGROUPED' ? currentGroupId : null
          })}
          className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-2 rounded-lg text-sm"
        >
          <Plus size={14} /> 새 시트
        </button>
      </header>

      <p className="text-sm text-slate-500 mb-5">
        팀 업무에 쓰는 Google Sheets 를 폴더로 묶어 관리합니다. 카드를 클릭하면 이 페이지 안에서 바로 편집 가능 (Google 로그인 상태 필요).
      </p>

      {/* 검색 + 필터 */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="제목 또는 설명으로 검색 (폴더 무시)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
          />
        </div>
        <div className="flex gap-1.5 overflow-x-auto">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={`whitespace-nowrap px-3 py-1.5 rounded-lg text-xs border transition ${
                categoryFilter === c
                  ? 'bg-myriad-primary border-myriad-primary text-myriad-ink font-semibold'
                  : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >
              {c === 'all' ? '전체' : c}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div className="py-12 text-center text-sm text-slate-400 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> 불러오는 중...
        </div>
      )}
      {error && (
        <div className="mb-4 bg-rose-50 border border-rose-200 text-rose-700 text-sm rounded-lg p-3">
          {error}
        </div>
      )}

      {/* ─── 폴더 그리드 뷰 (루트) ─── */}
      {!loading && !isSearching && currentGroupId === null && (
        <GroupGrid
          groups={groups}
          sheetCountByGroup={sheetCountByGroup}
          onOpenGroup={(id) => setCurrentGroupId(id)}
          onEditGroup={(g) => setGroupEditor({ ...g })}
          canDelete={canDelete}
          menuOpenId={menuOpenId}
          setMenuOpenId={setMenuOpenId}
        />
      )}

      {/* ─── 시트 카드 그리드 (그룹 내부 또는 검색 결과) ─── */}
      {!loading && (isSearching || currentGroupId !== null) && (
        <>
          {visibleSheets.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-400">
              {isSearching
                ? '검색 결과가 없습니다.'
                : '이 폴더에 등록된 시트가 없습니다. 우측 상단 "새 시트" 버튼으로 추가하세요.'}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {visibleSheets.map((s) => (
                <SheetCard
                  key={s.id}
                  sheet={s}
                  groups={groups}
                  onOpen={() => setOpened(s)}
                  onEdit={() => setSheetEditor({ ...s })}
                  onToggleActive={() => toggleSheetActive(s)}
                  onDelete={async () => {
                    if (!canDelete(s)) { setError('작성자/관리자만 삭제 가능'); return }
                    if (!window.confirm(`"${s.title}" 시트를 삭제할까요?`)) return
                    try {
                      await deleteSheet(s.id)
                      await load()
                    } catch (err) { setError(err.message) }
                  }}
                  onMove={(gid) => onMoveSheet(s.id, gid)}
                  canDelete={canDelete(s)}
                  menuOpenId={menuOpenId}
                  setMenuOpenId={setMenuOpenId}
                  moveTarget={moveTarget}
                  setMoveTarget={setMoveTarget}
                />
              ))}
            </div>
          )}
        </>
      )}

      {/* ─── 모달 ─── */}
      {sheetEditor && (
        <SheetEditorModal
          editor={sheetEditor}
          setEditor={setSheetEditor}
          groups={groups}
          canDelete={canDelete(sheetEditor)}
          onSave={saveSheet}
          onDelete={removeSheet}
          onClose={() => { setSheetEditor(null); setError(null) }}
          error={error}
        />
      )}
      {groupEditor && (
        <GroupEditorModal
          editor={groupEditor}
          setEditor={setGroupEditor}
          canDelete={canDelete(groupEditor)}
          onSave={saveGroup}
          onDelete={removeGroup}
          onClose={() => { setGroupEditor(null); setError(null) }}
          error={error}
        />
      )}
    </div>
  )
}

// =====================================================================
// 그룹 카드 그리드
// =====================================================================
function GroupGrid({ groups, sheetCountByGroup, onOpenGroup, onEditGroup, canDelete, menuOpenId, setMenuOpenId }) {
  const hasUngrouped = (sheetCountByGroup.UNGROUPED || 0) > 0

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {groups.map((g) => {
        const count = sheetCountByGroup[g.id] || 0
        return (
          <div
            key={g.id}
            className="group relative bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-myriad-primary transition cursor-pointer"
            onClick={() => onOpenGroup(g.id)}
            style={{ borderLeftColor: g.color, borderLeftWidth: 4 }}
          >
            <div className="flex items-start gap-3">
              <div
                className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                style={{ backgroundColor: g.color + '22' }}
              >
                {g.icon || '📁'}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="font-bold text-slate-900 truncate">{g.name}</h3>
                <p className="text-xs text-slate-500 mt-1">시트 {count}개</p>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); onEditGroup(g) }}
                className="opacity-0 group-hover:opacity-100 p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900 transition"
                title="폴더 편집"
              >
                <Edit2 size={14} />
              </button>
            </div>
          </div>
        )
      })}

      {/* 미분류 가상 폴더 */}
      {hasUngrouped && (
        <div
          className="bg-slate-50 border border-dashed border-slate-300 rounded-2xl p-5 hover:shadow-md hover:border-myriad-primary hover:bg-white transition cursor-pointer"
          onClick={() => onOpenGroup('UNGROUPED')}
        >
          <div className="flex items-start gap-3">
            <div className="w-11 h-11 rounded-xl bg-slate-200 flex items-center justify-center text-2xl shrink-0">
              📂
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-bold text-slate-900">미분류</h3>
              <p className="text-xs text-slate-500 mt-1">
                시트 {sheetCountByGroup.UNGROUPED || 0}개
              </p>
            </div>
          </div>
        </div>
      )}

      {groups.length === 0 && !hasUngrouped && (
        <div className="col-span-full py-16 text-center text-sm text-slate-400">
          아직 폴더가 없습니다. 우측 상단 "새 폴더" 버튼으로 만들어보세요.
        </div>
      )}
    </div>
  )
}

// =====================================================================
// 시트 카드
// =====================================================================
function SheetCard({
  sheet: s, groups, onOpen, onEdit, onToggleActive, onDelete, onMove,
  canDelete, menuOpenId, setMenuOpenId, moveTarget, setMoveTarget
}) {
  const menuOpen = menuOpenId === s.id
  const isMoving = moveTarget === s.id

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-5 hover:shadow-md hover:border-myriad-primary transition flex flex-col relative">
      {!s.is_active && (
        <span className="absolute top-3 right-3 text-[10px] font-semibold bg-slate-100 text-slate-500 px-2 py-0.5 rounded">
          비공개
        </span>
      )}
      <div className="flex items-start gap-3 flex-1">
        <div className="w-12 h-12 rounded-xl bg-myriad-primary/10 flex items-center justify-center text-2xl shrink-0">
          {s.icon || '📊'}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-slate-900 truncate">{s.title}</h3>
            {s.uses_apps_script && (
              <span
                className="inline-flex items-center gap-0.5 text-[10px] font-semibold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded"
                title="Apps Script 사용 - 새 탭에서 열어야 매크로 동작"
              >
                <Zap size={10} /> Apps Script
              </span>
            )}
          </div>
          {s.description && (
            <p className="text-xs text-slate-500 mt-1 line-clamp-2">{s.description}</p>
          )}
          {s.category && (
            <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 mt-2">
              <Tag size={10} /> {s.category}
            </span>
          )}
        </div>
        {/* ... 메뉴 */}
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpenId(menuOpen ? null : s.id)
              setMoveTarget(null)
            }}
            className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-900"
          >
            <MoreVertical size={14} />
          </button>
          {menuOpen && !isMoving && (
            <div
              className="absolute right-0 top-full mt-1 w-44 bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <MenuBtn icon={Edit2} label="편집" onClick={() => { setMenuOpenId(null); onEdit() }} />
              <MenuBtn icon={Move} label="폴더 이동" onClick={() => setMoveTarget(s.id)} />
              <MenuBtn
                icon={s.is_active ? EyeOff : Eye}
                label={s.is_active ? '비공개로' : '공개로'}
                onClick={() => { setMenuOpenId(null); onToggleActive() }}
              />
              {canDelete && (
                <MenuBtn
                  icon={Trash2}
                  label="삭제"
                  danger
                  onClick={() => { setMenuOpenId(null); onDelete() }}
                />
              )}
            </div>
          )}
          {menuOpen && isMoving && (
            <div
              className="absolute right-0 top-full mt-1 w-56 max-h-72 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg z-10 py-1"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-3 py-2 text-[10px] font-semibold text-slate-500 uppercase border-b border-slate-100">
                이동할 폴더 선택
              </div>
              <button
                onClick={() => onMove(null)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2"
              >
                📂 미분류
              </button>
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => onMove(g.id)}
                  disabled={g.id === s.group_id}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-40 disabled:bg-slate-50 flex items-center gap-2"
                >
                  <span>{g.icon || '📁'}</span>
                  <span className="truncate">{g.name}</span>
                  {g.id === s.group_id && <span className="ml-auto text-[10px] text-slate-400">(현재)</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-4 pt-4 border-t border-slate-100">
        {s.uses_apps_script ? (
          <>
            <button
              onClick={onOpen}
              className="text-xs text-slate-500 hover:text-myriad-ink flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
              title="웹 허브 내 미리보기"
            >
              <Maximize2 size={12} /> 미리보기
            </button>
            <div className="flex-1" />
            <a
              href={s.google_url}
              target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
            >
              <ExternalLink size={12} /> 새 탭에서 열기
            </a>
          </>
        ) : (
          <>
            <a
              href={s.google_url}
              target="_blank" rel="noreferrer"
              className="text-xs text-slate-500 hover:text-myriad-ink flex items-center gap-1 px-2 py-1 rounded hover:bg-slate-100"
            >
              <ExternalLink size={12} /> 새 탭
            </a>
            <div className="flex-1" />
            <button
              onClick={onOpen}
              className="flex items-center gap-1.5 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-3 py-1.5 rounded-lg text-sm"
            >
              <Maximize2 size={12} /> 열기
            </button>
          </>
        )}
      </div>
    </div>
  )
}

function MenuBtn({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-2 text-sm hover:bg-slate-50 flex items-center gap-2 ${
        danger ? 'text-rose-600 hover:bg-rose-50' : 'text-slate-700'
      }`}
    >
      <Icon size={14} /> {label}
    </button>
  )
}

// =====================================================================
// 시트 편집 모달
// =====================================================================
function SheetEditorModal({ editor, setEditor, groups, canDelete, onSave, onDelete, onClose, error }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">{editor.id ? '시트 편집' : '새 시트 등록'}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 overflow-auto flex-1 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Field label="아이콘" span={1}>
              <input
                type="text"
                value={editor.icon ?? ''}
                onChange={(e) => setEditor({ ...editor, icon: e.target.value })}
                placeholder="📊"
                className="w-full text-2xl text-center px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                maxLength={4}
              />
            </Field>
            <Field label="제목 *" span={3}>
              <input
                type="text"
                value={editor.title}
                onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                placeholder="예: 브랜드A 침해 이력 2026"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                autoFocus
              />
            </Field>
          </div>
          <Field label="Google 시트 URL *">
            <input
              type="url"
              value={editor.google_url}
              onChange={(e) => setEditor({ ...editor, google_url: e.target.value })}
              placeholder="https://docs.google.com/spreadsheets/d/.../edit"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 font-mono text-xs"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              팀원 접근 권한이 있는 시트여야 합니다. (공유 설정: Myriad 도메인 전체 또는 개별 이메일)
            </p>
          </Field>
          <Field label="설명">
            <textarea
              value={editor.description ?? ''}
              onChange={(e) => setEditor({ ...editor, description: e.target.value })}
              rows={2}
              placeholder="어떤 목적의 시트인지 한 줄 설명"
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 resize-none text-sm"
            />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="폴더">
              <select
                value={editor.group_id ?? ''}
                onChange={(e) => setEditor({ ...editor, group_id: e.target.value || null })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 text-sm"
              >
                <option value="">📂 미분류</option>
                {groups.map((g) => (
                  <option key={g.id} value={g.id}>{g.icon || '📁'} {g.name}</option>
                ))}
              </select>
            </Field>
            <Field label="분류 태그">
              <input
                type="text"
                value={editor.category ?? ''}
                onChange={(e) => setEditor({ ...editor, category: e.target.value })}
                placeholder="예: 마스터, 이력"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
            </Field>
            <Field label="정렬">
              <input
                type="number"
                value={editor.sort_order}
                onChange={(e) => setEditor({ ...editor, sort_order: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
              />
            </Field>
          </div>
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <input
              type="checkbox"
              id="ss_uses_apps_script"
              checked={editor.uses_apps_script}
              onChange={(e) => setEditor({ ...editor, uses_apps_script: e.target.checked })}
              className="w-4 h-4 mt-0.5"
            />
            <label htmlFor="ss_uses_apps_script" className="text-sm text-slate-700 flex-1">
              <b>이 시트는 Apps Script 를 사용합니다</b>
              <p className="text-xs text-slate-500 mt-1">
                체크하면 "새 탭에서 열기" 가 기본 버튼이 됩니다.
              </p>
            </label>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              id="ss_is_active"
              checked={editor.is_active}
              onChange={(e) => setEditor({ ...editor, is_active: e.target.checked })}
              className="w-4 h-4"
            />
            <label htmlFor="ss_is_active" className="text-sm text-slate-700">
              팀원에게 공개 (체크 해제 시 목록에서 숨김)
            </label>
          </div>
          {error && <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center">
          {editor.id && canDelete && (
            <button
              onClick={onDelete}
              className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg">
            취소
          </button>
          <button
            onClick={onSave}
            className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg"
          >
            <Save size={14} /> 저장
          </button>
        </div>
      </div>
    </div>
  )
}

// =====================================================================
// 그룹 편집 모달
// =====================================================================
function GroupEditorModal({ editor, setEditor, canDelete, onSave, onDelete, onClose, error }) {
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center">
          <h2 className="font-bold text-slate-900">{editor.id ? '폴더 편집' : '새 폴더'}</h2>
          <div className="flex-1" />
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-4 gap-3">
            <Field label="아이콘" span={1}>
              <input
                type="text"
                value={editor.icon ?? ''}
                onChange={(e) => setEditor({ ...editor, icon: e.target.value })}
                placeholder="📁"
                className="w-full text-2xl text-center px-3 py-2 border border-slate-300 rounded-lg"
                maxLength={4}
              />
            </Field>
            <Field label="폴더 이름 *" span={3}>
              <input
                type="text"
                value={editor.name}
                onChange={(e) => setEditor({ ...editor, name: e.target.value })}
                placeholder="예: 브랜드A 관련"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
                autoFocus
              />
            </Field>
          </div>
          <Field label="색상">
            <div className="flex gap-2 flex-wrap">
              {GROUP_COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setEditor({ ...editor, color: c })}
                  className={`w-8 h-8 rounded-full border-2 transition ${
                    editor.color === c ? 'border-slate-900 scale-110' : 'border-transparent'
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </Field>
          <Field label="정렬 순서">
            <input
              type="number"
              value={editor.sort_order}
              onChange={(e) => setEditor({ ...editor, sort_order: e.target.value })}
              className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40"
            />
          </Field>
          {error && <div className="text-xs text-rose-600 bg-rose-50 p-2 rounded">{error}</div>}
        </div>
        <div className="px-6 py-4 border-t border-slate-200 flex items-center">
          {editor.id && canDelete && (
            <button
              onClick={onDelete}
              className="text-rose-600 hover:bg-rose-50 px-3 py-2 rounded-lg flex items-center gap-2 text-sm"
            >
              <Trash2 size={14} /> 삭제
            </button>
          )}
          <div className="flex-1" />
          <button onClick={onClose} className="text-slate-600 hover:bg-slate-100 px-4 py-2 rounded-lg">
            취소
          </button>
          <button
            onClick={onSave}
            className="ml-2 flex items-center gap-2 bg-myriad-primary hover:bg-myriad-primaryDark text-myriad-ink font-semibold px-4 py-2 rounded-lg"
          >
            <Save size={14} /> 저장
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, span = 1 }) {
  return (
    <div style={{ gridColumn: `span ${span} / span ${span}` }}>
      <label className="text-xs font-semibold text-slate-600 block mb-1">{label}</label>
      {children}
    </div>
  )
}
