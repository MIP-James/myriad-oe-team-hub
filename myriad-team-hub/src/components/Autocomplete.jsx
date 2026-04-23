/**
 * 자유 입력 + 자동완성 콤보 (HTML5 datalist 대체).
 *
 * datalist 의 단점을 해결:
 *  - 드롭다운 위치를 input 좌측에 정확히 정렬 (브라우저 자동 위치 X)
 *  - Enter 키가 폼 자동 submit 을 트리거하지 않음 (자체 e.preventDefault)
 *  - Up/Down 으로 후보 탐색, Enter 로 선택, Esc 로 닫기
 *  - 한글 IME 조합 중 Enter 무시 (composition 중 selection 방지)
 *  - 클릭으로도 선택 가능 (mouseDown 으로 blur 차단)
 *
 * 사용:
 *   <Autocomplete
 *     value={brand}
 *     onChange={setBrand}
 *     suggestions={BRAND_LIST}
 *     placeholder="브랜드 입력"
 *   />
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'

const MAX_VISIBLE = 50

export default function Autocomplete({
  value,
  onChange,
  suggestions = [],
  placeholder,
  className = '',
  disabled = false,
  autoFocus = false
}) {
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(-1)
  const wrapRef = useRef(null)
  const listRef = useRef(null)
  const inputRef = useRef(null)
  const composingRef = useRef(false)

  // 필터링: value 에 따라 부분 일치
  const filtered = useMemo(() => {
    const q = (value || '').trim().toLowerCase()
    if (!q) return suggestions.slice(0, MAX_VISIBLE)
    // 시작 일치 우선 → 부분 일치
    const starts = []
    const contains = []
    for (const s of suggestions) {
      const lower = s.toLowerCase()
      if (lower.startsWith(q)) starts.push(s)
      else if (lower.includes(q)) contains.push(s)
      if (starts.length + contains.length >= MAX_VISIBLE * 2) break
    }
    return [...starts, ...contains].slice(0, MAX_VISIBLE)
  }, [value, suggestions])

  // 외부 클릭으로 닫기
  useEffect(() => {
    function handleDocClick(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) {
        setOpen(false)
        setHighlight(-1)
      }
    }
    if (open) document.addEventListener('mousedown', handleDocClick)
    return () => document.removeEventListener('mousedown', handleDocClick)
  }, [open])

  // 하이라이트 변경 시 스크롤 따라가기
  useEffect(() => {
    if (highlight < 0 || !listRef.current) return
    const el = listRef.current.children[highlight]
    if (el) el.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  function handleKeyDown(e) {
    // 한글 IME 조합 중에는 Enter / 화살표 키 무시
    if (composingRef.current || e.nativeEvent?.isComposing) {
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      setHighlight((h) => Math.min(filtered.length - 1, h + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlight((h) => Math.max(-1, h - 1))
    } else if (e.key === 'Enter') {
      // 폼 submit 방지가 핵심.
      // 후보 하이라이트 있으면 선택, 없으면 그냥 현재 값 유지하고 닫기.
      e.preventDefault()
      if (open && highlight >= 0 && filtered[highlight]) {
        onChange(filtered[highlight])
      }
      setOpen(false)
      setHighlight(-1)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
      setHighlight(-1)
    } else if (e.key === 'Tab') {
      // Tab 으로 빠져나갈 땐 드롭다운 닫기 (다음 필드로 자연스럽게 이동)
      setOpen(false)
      setHighlight(-1)
    }
  }

  function handleSelect(s) {
    onChange(s)
    setOpen(false)
    setHighlight(-1)
    inputRef.current?.focus()
  }

  return (
    <div ref={wrapRef} className="relative">
      <input
        ref={inputRef}
        type="text"
        value={value || ''}
        onChange={(e) => {
          onChange(e.target.value)
          setOpen(true)
          setHighlight(-1)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => { composingRef.current = true }}
        onCompositionEnd={() => { composingRef.current = false }}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        autoComplete="off"
        className={`w-full px-3 py-2 pr-8 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-myriad-primary/40 disabled:bg-slate-50 ${className}`}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => {
          setOpen((v) => !v)
          inputRef.current?.focus()
        }}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 p-1"
      >
        <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && filtered.length > 0 && (
        <ul
          ref={listRef}
          className="absolute z-30 left-0 right-0 mt-1 max-h-60 overflow-auto bg-white border border-slate-200 rounded-lg shadow-lg py-1"
        >
          {filtered.map((s, i) => (
            <li key={s}>
              <button
                type="button"
                // mouseDown 에서 input blur 가 dropdown 을 닫지 않도록 preventDefault
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => handleSelect(s)}
                onMouseEnter={() => setHighlight(i)}
                className={`w-full text-left px-3 py-1.5 text-sm transition ${
                  i === highlight
                    ? 'bg-myriad-primary/20 text-myriad-ink font-semibold'
                    : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {highlightMatch(s, value)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 입력값과 일치하는 부분에 굵게 표시
function highlightMatch(text, query) {
  const q = (query || '').trim()
  if (!q) return text
  const idx = text.toLowerCase().indexOf(q.toLowerCase())
  if (idx < 0) return text
  return (
    <>
      {text.slice(0, idx)}
      <b className="text-myriad-ink">{text.slice(idx, idx + q.length)}</b>
      {text.slice(idx + q.length)}
    </>
  )
}
