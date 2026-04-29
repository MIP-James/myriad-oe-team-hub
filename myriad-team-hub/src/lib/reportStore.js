/**
 * 보고서 그룹/브랜드 보고서 데이터 액세스 레이어.
 * Supabase 테이블(report_groups, brand_reports) + Storage bucket(reports) 래퍼.
 */
import { supabase } from './supabase'

const BUCKET = 'reports'

/** 연월(YYYY-MM) 기준 그룹을 조회하거나 없으면 생성. */
export async function getOrCreateGroup(yearMonth, userId) {
  const title = `${yearMonth} 월간 동향 보고`

  // 우선 조회
  const { data: existing, error: selErr } = await supabase
    .from('report_groups')
    .select('*')
    .eq('year_month', yearMonth)
    .maybeSingle()
  if (selErr) throw selErr
  if (existing) return existing

  // 없으면 생성
  const { data: created, error: insErr } = await supabase
    .from('report_groups')
    .insert({ year_month: yearMonth, title, created_by: userId })
    .select()
    .single()
  if (insErr) {
    // unique 제약 경쟁 상태 방어 — 다시 조회
    const { data: recheck } = await supabase
      .from('report_groups')
      .select('*')
      .eq('year_month', yearMonth)
      .maybeSingle()
    if (recheck) return recheck
    throw insErr
  }
  return created
}

export async function listGroups() {
  const { data, error } = await supabase
    .from('report_groups')
    .select('*')
    .order('year_month', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getGroupByYearMonth(yearMonth) {
  const { data, error } = await supabase
    .from('report_groups')
    .select('*')
    .eq('year_month', yearMonth)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function listBrandReports(groupId) {
  const { data, error } = await supabase
    .from('brand_reports')
    .select('*')
    .eq('group_id', groupId)
    .order('brand_name', { ascending: true })
  if (error) throw error
  return data ?? []
}

/**
 * Excel 버퍼를 Storage 에 올리고 brand_reports 행을 생성/업데이트.
 * 같은 group + brand 가 이미 있으면 **덮어씀** (재생성 시 파일 교체).
 */
export async function uploadBrandReport({
  groupId,
  brandName,
  reportMonth,
  topN,
  excelBuffer,
  fileName,
  userId
}) {
  // 경로 규칙: {group_id}/{safe_brand}.xlsx
  // Supabase Storage object key 는 윈도우 금지문자뿐 아니라 괄호/공백/일부 reserved
  // 까지 거부 — `(주)쏠리드` 같은 회사명 prefix 가 Invalid key 로 깨졌음.
  // 한글은 유지하고, 문제 가능 문자만 _ 로 치환.
  const safeBrand = brandName
    .replace(/[\s\\/:*?"<>|()[\]{}^~%#`'!@$&+=,;]+/g, '_')
    .replace(/_+/g, '_')          // 연속 언더스코어 합치기
    .replace(/^_+|_+$/g, '')      // 앞뒤 언더스코어 제거
    || 'unknown'
  const path = `${groupId}/${safeBrand}.xlsx`

  // 기존 파일 있으면 덮어쓰기 (upsert)
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, excelBuffer, {
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      upsert: true
    })
  if (upErr) throw upErr

  // 기존 brand_reports 조회
  const { data: existing } = await supabase
    .from('brand_reports')
    .select('*')
    .eq('group_id', groupId)
    .eq('brand_name', brandName)
    .maybeSingle()

  const payload = {
    group_id: groupId,
    brand_name: brandName,
    report_month: reportMonth,
    top_n: topN,
    excel_storage_path: path,
    excel_file_name: fileName,
    generated_by: userId
  }

  if (existing) {
    const { data, error } = await supabase
      .from('brand_reports')
      .update(payload)
      .eq('id', existing.id)
      .select()
      .single()
    if (error) throw error
    return data
  } else {
    const { data, error } = await supabase
      .from('brand_reports')
      .insert({ ...payload, status: 'editing' })
      .select()
      .single()
    if (error) throw error
    return data
  }
}

/** Storage 의 Excel 다운로드 URL (signed URL, 1시간 유효). */
export async function getReportSignedUrl(path) {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

export async function updateBrandReportStatus(id, status) {
  const { error } = await supabase
    .from('brand_reports')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function updateBrandReportGoogleSheet(id, url) {
  const { error } = await supabase
    .from('brand_reports')
    .update({ google_sheet_url: url })
    .eq('id', id)
  if (error) throw error
}

export async function updateBrandReportNote(id, note) {
  const { error } = await supabase
    .from('brand_reports')
    .update({ note })
    .eq('id', id)
  if (error) throw error
}

export async function deleteBrandReport(id, storagePath) {
  if (storagePath) {
    await supabase.storage.from(BUCKET).remove([storagePath])
  }
  const { error } = await supabase
    .from('brand_reports')
    .delete()
    .eq('id', id)
  if (error) throw error
}

export async function updateGroupStatus(id, status) {
  const { error } = await supabase
    .from('report_groups')
    .update({ status })
    .eq('id', id)
  if (error) throw error
}

export async function deleteGroup(id) {
  // 그룹 삭제 시 brand_reports 는 CASCADE 로 자동 삭제됨, Storage 는 별도 정리 필요
  const reports = await listBrandReports(id)
  const paths = reports.map((r) => r.excel_storage_path).filter(Boolean)
  if (paths.length) {
    await supabase.storage.from(BUCKET).remove(paths)
  }
  const { error } = await supabase
    .from('report_groups')
    .delete()
    .eq('id', id)
  if (error) throw error
}
