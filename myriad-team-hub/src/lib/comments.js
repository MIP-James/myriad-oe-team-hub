/**
 * brand_report_comments 데이터 액세스 + 해결 상태 토글.
 */
import { supabase } from './supabase'

export async function listComments(brandReportId) {
  const { data, error } = await supabase
    .from('brand_report_comments')
    .select('*')
    .eq('brand_report_id', brandReportId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

/** 여러 보고서의 댓글 개수/미해결 개수 한 번에 조회 (카드 뱃지용). */
export async function countCommentsForReports(reportIds) {
  if (!reportIds?.length) return {}
  const { data, error } = await supabase
    .from('brand_report_comments')
    .select('brand_report_id, resolved')
    .in('brand_report_id', reportIds)
  if (error) {
    console.warn('countComments:', error.message)
    return {}
  }
  const map = {}
  for (const r of data ?? []) {
    if (!map[r.brand_report_id]) map[r.brand_report_id] = { total: 0, open: 0 }
    map[r.brand_report_id].total++
    if (!r.resolved) map[r.brand_report_id].open++
  }
  return map
}

export async function createComment(brandReportId, body, userId) {
  const { data, error } = await supabase
    .from('brand_report_comments')
    .insert({
      brand_report_id: brandReportId,
      author_id: userId,
      body: body.trim()
    })
    .select()
    .single()
  if (error) throw error
  return data
}

export async function updateCommentBody(id, body) {
  const { error } = await supabase
    .from('brand_report_comments')
    .update({ body: body.trim() })
    .eq('id', id)
  if (error) throw error
}

export async function toggleCommentResolved(comment, userId) {
  const next = !comment.resolved
  const { error } = await supabase
    .from('brand_report_comments')
    .update({
      resolved: next,
      resolved_by: next ? userId : null,
      resolved_at: next ? new Date().toISOString() : null
    })
    .eq('id', comment.id)
  if (error) throw error
  return next
}

export async function deleteComment(id) {
  const { error } = await supabase
    .from('brand_report_comments')
    .delete()
    .eq('id', id)
  if (error) throw error
}
