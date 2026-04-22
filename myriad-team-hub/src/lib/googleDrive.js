/**
 * Google Drive API v3 래퍼.
 * Shared Drive (공유 드라이브) 지원 — 모든 호출에 supportsAllDrives=true 자동 부착.
 * provider_token(Google access_token)을 직접 fetch 에 붙여 호출.
 */

export class GoogleAuthRequiredError extends Error {
  constructor(message = 'Google 연결이 만료됐거나 없습니다. 재로그인이 필요합니다.') {
    super(message)
    this.name = 'GoogleAuthRequiredError'
  }
}

// 모든 파일 API 호출에 기본 부착할 공통 쿼리
const ALL_DRIVES_PARAMS = {
  supportsAllDrives: 'true',
  includeItemsFromAllDrives: 'true'
}

function appendParams(url, extra = {}) {
  const u = new URL(url)
  for (const [k, v] of Object.entries(extra)) {
    u.searchParams.set(k, String(v))
  }
  return u.toString()
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
 * 공유 드라이브 폴더에도 업로드 가능.
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

  const url = appendParams(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
    { supportsAllDrives: 'true' }
  )

  return _fetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body
    },
    token
  )
}

/** Google Drive 에 폴더 생성 (공유 드라이브 지원). */
export async function createFolder(token, name, parentFolderId = null) {
  const metadata = { name, mimeType: 'application/vnd.google-apps.folder' }
  if (parentFolderId) metadata.parents = [parentFolderId]
  const url = appendParams(
    'https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink',
    { supportsAllDrives: 'true' }
  )
  return _fetch(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(metadata)
    },
    token
  )
}

/** 파일을 다른 폴더로 이동 (공유 드라이브 지원). */
export async function moveFile(token, fileId, newParentId) {
  // 현재 parents 조회
  const getUrl = appendParams(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=parents,name,webViewLink`,
    { supportsAllDrives: 'true' }
  )
  const current = await _fetch(getUrl, {}, token)
  const oldParents = (current.parents || []).join(',')

  const patchUrl = appendParams(
    `https://www.googleapis.com/drive/v3/files/${fileId}?fields=id,parents,name,webViewLink`,
    {
      supportsAllDrives: 'true',
      addParents: newParentId,
      removeParents: oldParents
    }
  )
  return _fetch(patchUrl, { method: 'PATCH' }, token)
}

/**
 * 부모 폴더 안에서 이름이 일치하는 하위 폴더가 있으면 재사용, 없으면 생성.
 * 공유 드라이브 지원.
 */
export async function findOrCreateSubfolder(token, parentFolderId, name) {
  const safe = name.replace(/'/g, "\\'")
  const q = `'${parentFolderId}' in parents and name = '${safe}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`

  const listUrl = appendParams(
    'https://www.googleapis.com/drive/v3/files?fields=files(id,name,webViewLink)',
    { ...ALL_DRIVES_PARAMS, q, corpora: 'allDrives' }
  )

  const res = await _fetch(listUrl, {}, token)
  if (res.files && res.files.length > 0) return res.files[0]
  return createFolder(token, name, parentFolderId)
}

/** 폴더 메타 조회 (접근 가능한지 확인 목적 — 공유 드라이브 포함). */
export async function probeFolder(token, folderId) {
  const url = appendParams(
    `https://www.googleapis.com/drive/v3/files/${folderId}?fields=id,name,mimeType,trashed,driveId`,
    { supportsAllDrives: 'true' }
  )
  try {
    const info = await _fetch(url, {}, token)
    if (info.trashed) throw new Error(`폴더가 휴지통에 있습니다: ${info.name}`)
    if (info.mimeType !== 'application/vnd.google-apps.folder') {
      throw new Error(`지정된 ID 는 폴더가 아닙니다: ${info.mimeType}`)
    }
    return info
  } catch (e) {
    if (e instanceof GoogleAuthRequiredError) throw e
    if (/404/.test(e.message)) {
      throw new Error(
        `Drive 폴더를 찾을 수 없습니다 (ID: ${folderId}).\n\n` +
        `가능한 원인:\n` +
        `  1) 현재 로그인된 Google 계정에 이 폴더 접근 권한이 없음\n` +
        `     → https://drive.google.com/drive/folders/${folderId} 를 브라우저에 열어 확인\n` +
        `  2) OAuth 스코프가 아직 반영 안 됨 (drive.file → drive 로 업그레이드 필요)\n` +
        `     → https://myaccount.google.com/permissions 앱 해제 후 재로그인\n` +
        `  3) 폴더 ID 오타 또는 삭제됨`
      )
    }
    throw e
  }
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
