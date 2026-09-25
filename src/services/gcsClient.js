// Minimal client for reading and writing JSON objects in a Google Cloud
// Storage bucket directly from the browser — no backend required.
//
// Auth: uses Google Identity Services (GIS) token client to obtain a
// short-lived OAuth2 access token with the `devstorage.read_write` scope.
// The person signs in with a Google account that has at least the
// "Storage Object Admin" (or Object Creator + Viewer) IAM role on the
// target bucket. Reads of a *publicly readable* object work without
// signing in at all (no Authorization header is sent).
//
// Requirements on the bucket side (can't be done from here):
//  - A CORS policy on the bucket allowing GET/POST/OPTIONS from this app's
//    origin (see README "Cloud Storage sync" section for the gcloud/gsutil
//    command).
//  - An OAuth 2.0 Client ID (Web application) in the same Google Cloud
//    project, with this app's origin listed under "Authorized JavaScript
//    origins".

const GIS_SRC = 'https://accounts.google.com/gsi/client'
const SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
const GCS_API = 'https://storage.googleapis.com/storage/v1'
const GCS_UPLOAD = 'https://storage.googleapis.com/upload/storage/v1'

let gisLoadPromise = null
function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoadPromise) return gisLoadPromise
  gisLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('Could not load Google Identity Services (check your network / ad blocker).'))
    document.head.appendChild(script)
  })
  return gisLoadPromise
}

let tokenClient = null
let tokenClientId = null
let accessToken = null
let tokenExpiresAt = 0

async function ensureTokenClient(clientId) {
  await loadGis()
  if (tokenClient && tokenClientId === clientId) return
  tokenClientId = clientId
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPE,
    callback: () => {} // replaced per-call in requestAccessToken()
  })
}

/**
 * Prompts the person to sign in with Google (or silently refreshes if a
 * session already exists) and resolves with a short-lived access token.
 * @param {string} clientId - OAuth 2.0 Web-application Client ID
 * @param {{ prompt?: string }} [opts] - prompt: '' for silent/auto, 'consent' to force the picker
 */
export async function requestAccessToken(clientId, { prompt = '' } = {}) {
  if (!clientId?.trim()) throw new Error('Missing Google OAuth Client ID.')
  await ensureTokenClient(clientId.trim())
  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error_description || resp.error))
        return
      }
      accessToken = resp.access_token
      tokenExpiresAt = Date.now() + (resp.expires_in || 3600) * 1000
      resolve(accessToken)
    }
    try {
      tokenClient.requestAccessToken({ prompt })
    } catch (e) {
      reject(e)
    }
  })
}

export function getAccessToken() {
  if (accessToken && Date.now() < tokenExpiresAt - 5000) return accessToken
  return null
}

export function isSignedIn() {
  return !!getAccessToken()
}

export function clearAccessToken() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {})
  }
  accessToken = null
  tokenExpiresAt = 0
}

function authHeaders() {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Lists every object in a bucket (optionally scoped to a prefix, e.g. a
 * "folder"), following pagination automatically. Works without signing in
 * for a publicly listable bucket.
 * @param {string} bucket
 * @param {string} [prefix] - e.g. "flows/" to only list within that folder
 * @param {{ delimiter?: string }} [opts] - delimiter: '/' restricts results to
 *   objects directly under `prefix`, excluding anything in a deeper "subfolder"
 *   (GCS reports those separately as folder-like prefixes, which are dropped here)
 * @returns {Promise<Array<{name: string, updated?: string, size?: string}>>}
 */
export async function listObjects(bucket, prefix = '', { delimiter = '' } = {}) {
  if (!bucket?.trim()) throw new Error('Missing bucket name.')
  const results = []
  let pageToken = ''
  do {
    const params = new URLSearchParams()
    if (prefix) params.set('prefix', prefix)
    if (delimiter) params.set('delimiter', delimiter)
    if (pageToken) params.set('pageToken', pageToken)
    const qs = params.toString()
    const url = `${GCS_API}/b/${encodeURIComponent(bucket)}/o${qs ? `?${qs}` : ''}`
    const res = await fetch(url, { headers: authHeaders() })
    if (!res.ok) {
      throw new Error(`Could not list objects in gs://${bucket}/${prefix} (${res.status} ${res.statusText}).`)
    }
    const data = await res.json()
    results.push(...(data.items || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return results
}

/**
 * Reads an object as raw text (e.g. an XML file). Returns null if the
 * object doesn't exist. Works without signing in for a public object.
 * @param {string} bucket
 * @param {string} objectPath
 */
export async function readTextObject(bucket, objectPath) {
  if (!bucket?.trim() || !objectPath?.trim()) throw new Error('Missing bucket name or object path.')
  const url = `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`
  const res = await fetch(url, { headers: authHeaders() })
  if (res.status === 404) return null
  if (!res.ok) {
    throw new Error(`Could not read gs://${bucket}/${objectPath} (${res.status} ${res.statusText}).`)
  }
  return res.text()
}

/**
 * Uploads raw text (e.g. an XML file) to a bucket, overwriting any existing
 * object at that path. Requires a valid access token.
 * @param {string} bucket
 * @param {string} objectPath
 * @param {string} text
 * @param {string} [contentType]
 */
export async function writeTextObject(bucket, objectPath, text, contentType = 'application/xml') {
  if (!bucket?.trim() || !objectPath?.trim()) throw new Error('Missing bucket name or object path.')
  const token = getAccessToken()
  if (!token) throw new Error('Not signed in to Google — connect first.')
  const url = `${GCS_UPLOAD}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType
    },
    body: text
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Could not write gs://${bucket}/${objectPath} (${res.status} ${res.statusText}). ${detail}`.trim())
  }
  return res.json()
}

/**
 * Reads and JSON-parses an object from a bucket. Returns null if the object
 * doesn't exist yet. Works without signing in if the object is publicly
 * readable. Kept as a small convenience wrapper around readTextObject.
 * @param {string} bucket
 * @param {string} objectPath
 */
export async function readJsonObject(bucket, objectPath) {
  const text = await readTextObject(bucket, objectPath)
  return text === null ? null : JSON.parse(text)
}

/**
 * Serializes `data` as JSON and uploads it to a bucket. Kept as a small
 * convenience wrapper around writeTextObject.
 * @param {string} bucket
 * @param {string} objectPath
 * @param {*} data
 */
export async function writeJsonObject(bucket, objectPath, data) {
  return writeTextObject(bucket, objectPath, JSON.stringify(data, null, 2), 'application/json')
}
