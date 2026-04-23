/**
 * 공용 시트 + 그룹 폴더 CRUD 헬퍼.
 *  - 모든 authenticated 사용자가 작성/편집 가능
 *  - 삭제는 작성자 본인 또는 admin (RLS 에서 강제)
 */
import { supabase } from './supabase'

// ── 그룹 ────────────────────────────────────────────────
export async function listGroups() {
  const { data, error } = await supabase
    .from('shared_sheet_groups')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createGroup(payload) {
  const { data: userData } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('shared_sheet_groups')
    .insert({ ...payload, created_by: userData?.user?.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateGroup(id, payload) {
  const { error } = await supabase
    .from('shared_sheet_groups')
    .update(payload)
    .eq('id', id)
  if (error) throw error
}

export async function deleteGroup(id) {
  const { error } = await supabase
    .from('shared_sheet_groups')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ── 시트 ────────────────────────────────────────────────
export async function listAllSheets() {
  const { data, error } = await supabase
    .from('shared_sheets')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function createSheet(payload) {
  const { data: userData } = await supabase.auth.getUser()
  const { data, error } = await supabase
    .from('shared_sheets')
    .insert({ ...payload, created_by: userData?.user?.id })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateSheet(id, payload) {
  const { error } = await supabase
    .from('shared_sheets')
    .update(payload)
    .eq('id', id)
  if (error) throw error
}

export async function deleteSheet(id) {
  const { error } = await supabase
    .from('shared_sheets')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function moveSheetToGroup(sheetId, groupId) {
  const { error } = await supabase
    .from('shared_sheets')
    .update({ group_id: groupId })
    .eq('id', sheetId)
  if (error) throw error
}

export function isValidSheetUrl(url) {
  if (!url) return false
  return /^https?:\/\/docs\.google\.com\/spreadsheets\/d\//i.test(url.trim())
}
