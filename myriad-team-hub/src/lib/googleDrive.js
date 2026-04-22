/**
 * Google Drive API v3 래퍼.
 * provider_token(Google access_token)을 직접 fetch 에 붙여 호출.
 * Supabase 는 provider_token 을 자동 refresh 하지 않으므로 401 발생 시
 * GoogleAuthRequiredError 로 상위에 알려 재로그인 유도.
 */

export class GoogleAuthRequiredError extends Error {
  constructor(message = 'Google 연결이 만료됐거나 없습니다. 재로그인이 필요합니다.') {
    super(message)
    this.name = 'GoogleAuthRequiredError'
  }
}

async function _fetch(url, options, token) {
  if (!token) throw new GoogleAuthRequiredError()
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {})
    }
  })
  if (resp.status === 401 || resp.status === 403) {
    let body = ''
    try { body = await resp.text() } catch {}
    // 403 은 scope 부족이나 권한 문제일 수 있음
    if (resp.status === 401 || /invalid_token|expired/i.test(body)) {
      throw new GoogleAuthRequiredError()
    }
    throw new Error(`Google API ${resp.status}: ${body}`)
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Google API ${resp.status}: ${text}`)
  }
  return resp.json()
}

/**
 * Excel 바이너리를 Google Drive 에 올리면서 Google Sheets 로 자동 변환.
 * @param {string} token - Google OAuth access_token
 * @param {ArrayBuffer} buffer - .xlsx 바이너리
 * @param {string} name - 생성할 시트 이름 (.xlsx 확장자 있으면 자동 제거)
 * @param {string|null} parentFolderId - 부모 폴더 ID (없으면 Drive 루트)
 * @returns {Promise<{id, name, webViewLink}>}
 */
export async function uploadExcelAsSheet(token, buffer, name, parentFolderId = null) {
  const cleanName = String(name).replace(/\.xlsx?$/i, '')
  const metadata = {
    name: cleanName,
    mimeType: 'application/vnd.google-apps.spreadsheet'
  }
  if (parentFolderId) metadata.parents = [parentFolderId]

  const boundary = '-------myriad-' + Date.now()
  const metaPart = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`
  const filePart = `--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`
  const closingPart = `\r\n--${boundary}--`

  const enc = new TextEncoder()
  const parts = [enc.encode(metaPart), enc.encode(filePart), buffer, enc.encode(closingPart)]
  const body = new Blob(parts, { type: `multipart/related; boundary=${boundary}` })

  return _fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    },
    token
  )
}

/**
 * Google Drive 에 폴더 생성.
 */
export async function createFolder(token, name, parentFolderId = null) {
  const metadata = { name, mimeType: 'application/vnd.google-apps.folder' }
  if (parentFolderId) metadata.parents = [parentFolderId]
  return _fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    },
    token
  )
}

/**
 * 파일을 다른 폴더로 이동 (기존 parents 제거 + 새 parents 추가).
 */
export async function moveFile(token, fileId, newParentId) {
  // 현재 parents 조회
  const current = await _fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents,name,webViewLink`,
    {},
    token
  )
  const oldParents = (current.parents || []).join(',')
  const qs = new URLSearchParams({
    addParents: newParentId,
    removeParents: oldParents,
    fields: 'id,parents,name,webViewLink'
  })
  return _fetch(
    `https://www.googleapis.com/drive/v3/files/${fileId}?${qs}`,
    { method: 'PATCH' },
    token
  )
}

/**
 * 폴더 안에 이름이 일치하는 하위 폴더가 있으면 재사용, 없으면 생성.
 */
export async function findOrCreateSubfolder(token, parentFolderId, name) {
  const safe = name.replace(/'/g, "\\'")
  const query = encodeURIComponent(
    `'${parentFolderId}' in parents and name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`
  )
  const res = await _fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)`,
    {},
    token
  )
  if (res.files && res.files.length > 0) return res.files[0]
  return createFolder(token, name, parentFolderId)
}

/** Google Drive 폴더 URL 에서 folder ID 추출. */
export function extractFolderId(url) {
  if (!url) return null
  const m = String(url).match(/\/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

/** Google Sheets URL 에서 file ID 추출. */
export function extractSheetId(url) {
  if (!url) return null
  const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : null
}

/** 폴더 ID 로부터 브라우저에서 열 수 있는 Drive 폴더 URL 생성. */
export function folderIdToUrl(id) {
  return id ? `https://drive.google.com/drive/folders/${id}` : null
}
