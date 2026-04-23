/**
 * 알림(in-app notifications) 헬퍼.
 *  - 본인에게 온 알림만 select/update 가능 (RLS)
 *  - INSERT 는 서버 trigger 가 전담
 */
import { supabase } from './supabase'

export async function listRecentNotifications(userId, limit = 20) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('recipient_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data ?? []
}

export async function countUnread(userId) {
  const { count, error } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('recipient_id', userId)
    .is('read_at', null)
  if (error) throw error
  return count ?? 0
}

export async function markAllRead(userId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', userId)
    .is('read_at', null)
  if (error) throw error
}

export async function markOneRead(notificationId) {
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', notificationId)
  if (error) throw error
}

/**
 * 실시간 알림 INSERT 구독.
 * @returns unsubscribe 함수
 */
export function subscribeToNotifications(userId, onInsert) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notifications',
        filter: `recipient_id=eq.${userId}`
      },
      (payload) => onInsert(payload.new)
    )
    .subscribe()
  return () => {
    try { supabase.removeChannel(channel) } catch {}
  }
}
