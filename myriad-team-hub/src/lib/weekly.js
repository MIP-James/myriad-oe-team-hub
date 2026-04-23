/**
 * 주간 계획 + 일일 기록 + 리마인더 설정 데이터 액세스 (Phase 9).
 *
 * 모두 본인 전용 (RLS 로 강제). 활동 피드 로깅 안 함 (사적 기록).
 */
import { supabase } from './supabase'
import { dateKey } from './dateHelpers'

// ───── Weekly Plans ────────────────────────────────────────────

export async function getWeeklyPlan(userId, year, week) {
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .eq('year', year)
    .eq('week_number', week)
    .maybeSingle()
  if (error) throw error
  return data
}

/**
 * 주간 계획 upsert. items 가 빈 배열이고 기존 행이 없으면 insert 안 함 (불필요한 빈 행 방지).
 */
export async function saveWeeklyPlan(userId, { year, week, weekStart, items }) {
  const trimmed = (items || []).filter((it) => it.text && it.text.trim().length > 0)
  // 기존 행 있는지 확인
  const existing = await getWeeklyPlan(userId, year, week)
  if (!existing && trimmed.length === 0) return null   // 빈 행 만들지 않음

  const { data, error } = await supabase
    .from('weekly_plans')
    .upsert(
      {
        user_id: userId,
        year,
        week_number: week,
        week_start: weekStart,
        items: trimmed
      },
      { onConflict: 'user_id,year,week_number' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

/** 한 달 그리드 범위에 걸친 모든 weekly_plans (인덱스용 맵 만들 때 사용) */
export async function listWeeklyPlansInRange(userId, weekStartFrom, weekStartTo) {
  const { data, error } = await supabase
    .from('weekly_plans')
    .select('*')
    .eq('user_id', userId)
    .gte('week_start', weekStartFrom)
    .lte('week_start', weekStartTo)
  if (error) throw error
  return data ?? []
}

// ───── Daily Records ───────────────────────────────────────────

export async function getDailyRecord(userId, dateStr) {
  const { data, error } = await supabase
    .from('daily_records')
    .select('*')
    .eq('user_id', userId)
    .eq('log_date', dateStr)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function saveDailyRecord(userId, dateStr, items) {
  const trimmed = (items || []).filter((it) => it.text && it.text.trim().length > 0)
  const existing = await getDailyRecord(userId, dateStr)
  if (!existing && trimmed.length === 0) return null

  const { data, error } = await supabase
    .from('daily_records')
    .upsert(
      {
        user_id: userId,
        log_date: dateStr,
        items: trimmed
      },
      { onConflict: 'user_id,log_date' }
    )
    .select()
    .single()
  if (error) throw error
  return data
}

export async function listDailyRecordsInRange(userId, fromDate, toDate) {
  const { data, error } = await supabase
    .from('daily_records')
    .select('user_id,log_date,items')
    .eq('user_id', userId)
    .gte('log_date', fromDate)
    .lte('log_date', toDate)
  if (error) throw error
  return data ?? []
}

// ───── Reminder Settings ───────────────────────────────────────

export async function getReminderSettings(userId) {
  if (!userId) return null
  const { data, error } = await supabase
    .from('reminder_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) {
    console.warn('[reminder] load:', error.message)
    return null
  }
  return data
}

export async function saveReminderSettings(userId, { dailyTime, enabled }) {
  const row = {
    user_id: userId,
    daily_time: dailyTime || null,
    enabled: !!enabled
  }
  const { data, error } = await supabase
    .from('reminder_settings')
    .upsert(row, { onConflict: 'user_id' })
    .select()
    .single()
  if (error) throw error
  return data
}
