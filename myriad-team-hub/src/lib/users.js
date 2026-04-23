/**
 * 사용자(프로필) 데이터 액세스 — 관리자 페이지 전용.
 * 일반 조회는 community.js 의 getProfileShort 사용.
 */
import { supabase } from './supabase'

/** 모든 팀원 프로필 — 관리자 페이지용 */
export async function listAllProfiles() {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** 사용자 역할 변경 (member ↔ admin) — RLS 로 admin 만 호출 가능 */
export async function updateUserRole(userId, newRole) {
  if (!['member', 'admin'].includes(newRole)) {
    throw new Error(`잘못된 역할: ${newRole}`)
  }
  const { error } = await supabase
    .from('profiles')
    .update({ role: newRole })
    .eq('id', userId)
  if (error) throw error
}

/** 현재 admin 수 카운트 — 마지막 admin 강등 방지용 */
export async function countAdmins() {
  const { count, error } = await supabase
    .from('profiles')
    .select('id', { count: 'exact', head: true })
    .eq('role', 'admin')
  if (error) throw error
  return count ?? 0
}
