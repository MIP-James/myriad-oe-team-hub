/**
 * 팀 커뮤니티 데이터 액세스.
 * 공지 / 읽음 / 활동 이벤트 CRUD + 편의 함수.
 */
import { supabase } from './supabase'

// ---- Announcements ----

export async function listAnnouncements() {
  const { data, error } = await supabase
    .from('announcements')
    .select('*, created_by_profile:profiles!announcements_created_by_fkey(email,full_name,avatar_url)')
    .order('pinned', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    // profile foreign key 조인이 실패하는 환경 대비 fallback
    const { data: d2, error: e2 } = await supabase
      .from('announcements')
      .select('*')
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(100)
    if (e2) throw e2
    return d2 ?? []
  }
  return data ?? []
}

export async function createAnnouncement(payload, userId) {
  const { data, error } = await supabase
    .from('announcements')
    .insert({ ...payload, created_by: userId })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateAnnouncement(id, payload) {
  const { error } = await supabase
    .from('announcements')
    .update(payload)
    .eq('id', id)
  if (error) throw error
}

export async function deleteAnnouncement(id) {
  const { error } = await supabase
    .from('announcements')
    .delete()
    .eq('id', id)
  if (error) throw error
}

// ---- Reads ----

export async function markAnnouncementRead(announcementId, userId) {
  const { error } = await supabase
    .from('announcement_reads')
    .upsert({ announcement_id: announcementId, user_id: userId })
  if (error) console.warn('markRead:', error.message)
}

export async function getMyReadIds(userId) {
  if (!userId) return new Set()
  const { data, error } = await supabase
    .from('announcement_reads')
    .select('announcement_id')
    .eq('user_id', userId)
  if (error) {
    console.warn('getMyReadIds:', error.message)
    return new Set()
  }
  return new Set((data ?? []).map((r) => r.announcement_id))
}

// ---- Activity Events ----

export async function listActivityEvents(limit = 50) {
  const { data, error } = await supabase
    .from('activity_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

/**
 * 이벤트 기록. 실패해도 호출자에게 예외 안 던짐 (로깅은 보조 기능).
 * @param {string} eventType - 'report_generated' | 'brand_report_status_changed' | 'report_group_published' | 'announcement_posted' | 'utility_executed' 등
 * @param {{ target_type?, target_id?, payload? }} opts
 */
export async function logActivity(eventType, opts = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    await supabase.from('activity_events').insert({
      actor_id: user.id,
      event_type: eventType,
      target_type: opts.target_type ?? null,
      target_id: opts.target_id ?? null,
      payload: opts.payload ?? null
    })
  } catch (e) {
    console.warn('logActivity:', e?.message)
  }
}

// ---- 사용자 프로필 조회 헬퍼 (이벤트 표시용) ----

const _profileCache = new Map()

export async function getProfileShort(userId) {
  if (!userId) return null
  if (_profileCache.has(userId)) return _profileCache.get(userId)
  const { data } = await supabase
    .from('profiles')
    .select('id,email,full_name,avatar_url')
    .eq('id', userId)
    .maybeSingle()
  _profileCache.set(userId, data)
  return data
}

// ---- 대시보드용 ----

export async function countUnreadAnnouncements(userId) {
  if (!userId) return 0
  const [anns, reads] = await Promise.all([
    supabase.from('announcements').select('id'),
    supabase.from('announcement_reads').select('announcement_id').eq('user_id', userId)
  ])
  if (anns.error) return 0
  const readSet = new Set((reads.data ?? []).map((r) => r.announcement_id))
  return (anns.data ?? []).filter((a) => !readSet.has(a.id)).length
}
