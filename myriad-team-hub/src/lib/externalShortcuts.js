/**
 * 대시보드 외부 바로가기 CRUD.
 * 전원 read (활성만), 관리자 write.
 */
import { supabase } from './supabase'

// 카드 색상 프리셋 — Tailwind 클래스 매핑
export const COLOR_PRESETS = [
  { key: 'sky',     label: '하늘', icon: 'bg-sky-100 text-sky-700',         border: 'hover:border-sky-400' },
  { key: 'emerald', label: '에메랄드', icon: 'bg-emerald-100 text-emerald-700', border: 'hover:border-emerald-400' },
  { key: 'amber',   label: '앰버', icon: 'bg-amber-100 text-amber-800',       border: 'hover:border-amber-400' },
  { key: 'rose',    label: '로즈', icon: 'bg-rose-100 text-rose-700',         border: 'hover:border-rose-400' },
  { key: 'purple',  label: '퍼플', icon: 'bg-purple-100 text-purple-700',     border: 'hover:border-purple-400' },
  { key: 'cyan',    label: '시안', icon: 'bg-cyan-100 text-cyan-700',         border: 'hover:border-cyan-400' },
  { key: 'slate',   label: '슬레이트', icon: 'bg-slate-100 text-slate-700',     border: 'hover:border-slate-400' }
]

export function getColorClasses(key) {
  return COLOR_PRESETS.find((c) => c.key === key) || COLOR_PRESETS[0]
}

// ───── List / get ─────────────────────────────

/** 대시보드 표시용 — 활성된 것만 */
export async function listActiveShortcuts() {
  const { data, error } = await supabase
    .from('external_shortcuts')
    .select('*')
    .eq('is_active', true)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** 관리자 페이지용 — 전부 (비활성 포함) */
export async function listAllShortcuts() {
  const { data, error } = await supabase
    .from('external_shortcuts')
    .select('*')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

// ───── Mutate ─────────────────────────────────

export async function createShortcut(payload, userId) {
  const row = {
    name: (payload.name || '').trim(),
    url: (payload.url || '').trim(),
    description: payload.description?.trim() || null,
    icon: payload.icon?.trim() || null,
    color: payload.color || 'sky',
    position: payload.position ?? 0,
    is_active: payload.is_active !== false,
    created_by: userId
  }
  const { data, error } = await supabase
    .from('external_shortcuts')
    .insert(row)
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateShortcut(id, payload) {
  const row = {
    name: (payload.name || '').trim(),
    url: (payload.url || '').trim(),
    description: payload.description?.trim() || null,
    icon: payload.icon?.trim() || null,
    color: payload.color || 'sky',
    position: payload.position ?? 0,
    is_active: payload.is_active !== false
  }
  const { error } = await supabase
    .from('external_shortcuts')
    .update(row)
    .eq('id', id)
  if (error) throw error
}

export async function deleteShortcut(id) {
  const { error } = await supabase
    .from('external_shortcuts')
    .delete()
    .eq('id', id)
  if (error) throw error
}
