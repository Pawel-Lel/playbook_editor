// Minimal client for reading and writing JSON objects in a Google Cloud
// Storage bucket directly from the browser — no backend required.
//
// Auth: uses Google Identity Services (GIS) token client to obtain 
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

/** One object (file) in a bucket, as the GCS JSON API describes it. */
export interface BucketObject {
  name: string
  updated?: string
  size?: string
}

const GIS_SRC = 'https://accounts.google.com/gsi/client'
// openid + email let the app show who is signed in (via the userinfo
// endpoint) alongside the storage scope the bucket calls need.
const STORAGE_SCOPE = 'https://www.googleapis.com/auth/devstorage.read_write'
const SCOPE = `${STORAGE_SCOPE} openid email`
const USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo'
// The token is kept in sessionStorage so a page reload in the same tab
// doesn't force a new sign-in; it still expires with the token (~1 hour)
// and is gone when the tab closes.
const SESSION_KEY = 'playbook-editor:google-session:v1'
const GCS_API = 'https://storage.googleapis.com/storage/v1'
const GCS_UPLOAD = 'https://storage.googleapis.com/upload/storage/v1'

let gisLoadPromise: Promise<void> | null = null
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve()
  if (gisLoadPromise) return gisLoadPromise
  gisLoadPromise = new Promise<void>((resolve, reject) => {
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

// Google's token client object (untyped: part of the external Google API).
let tokenClient: any = null
let tokenClientId: string | null = null
let accessToken: string | null = null
let tokenExpiresAt = 0 // ms since 1970, like Date.now()
let userEmail = ''

function persistSession(): void {
  try {
    if (tokenExpiresAt) {
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ accessToken, tokenExpiresAt, userEmail }))
    } else {
      sessionStorage.removeItem(SESSION_KEY)
    }
  } catch (error) {
    console.warn('Could not persist the Google session.', error)
  }
}

;(function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null')
    if (saved?.accessToken) {
      accessToken = saved.accessToken
      tokenExpiresAt = saved.tokenExpiresAt || 0
      userEmail = saved.userEmail || ''
    }
  } catch (error) {
    console.warn('Could not restore the Google session.', error)
  }
})()

/**
 * Loads Google Identity Services and prepares the token client ahead of
 * time, so the sign-in popup opens straight from the click that asks for
 * it — a slow script load in between could get the popup blocked.
 */
export async function prepareSignIn(clientId: string): Promise<void> {
  if (clientId?.trim()) await ensureTokenClient(clientId.trim())
}

async function ensureTokenClient(clientId: string): Promise<void> {
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
 * @param clientId - OAuth 2.0 Web-application Client ID
 * @param [opts] - prompt: '' for silent/auto, 'consent' to force the picker
 */
export async function requestAccessToken(clientId: string, { prompt = '' }: { prompt?: string } = {}): Promise<string> {
  if (!clientId?.trim()) throw new Error('Missing Google OAuth Client ID.')
  await ensureTokenClient(clientId.trim())
  return new Promise<string>((resolve, reject) => {
    tokenClient.callback = (tokenResponse) => {
      if (tokenResponse.error) {
        reject(new Error(tokenResponse.error_description || tokenResponse.error))
        return
      }
      // Google's consent screen lets people untick individual permissions,
      // so a successful sign-in doesn't guarantee Cloud Storage access.
      if (!window.google.accounts.oauth2.hasGrantedAllScopes(tokenResponse, STORAGE_SCOPE)) {
        window.google.accounts.oauth2.revoke(tokenResponse.access_token, () => {})
        reject(
          new Error(
            'Google sign-in finished without permission to use Cloud Storage. Sign in again and, on ' +
              "Google's screen, tick the box to see, edit, create and delete your Google Cloud Storage data."
          )
        )
        return
      }
      accessToken = tokenResponse.access_token
      tokenExpiresAt = Date.now() + (tokenResponse.expires_in || 3600) * 1000
      persistSession()
      resolve(accessToken)
    }
    try {
      tokenClient.requestAccessToken({ prompt })
    } catch (error) {
      reject(error)
    }
  })
}

export function getAccessToken(): string | null {
  if (accessToken && Date.now() < tokenExpiresAt - 5000) return accessToken
  return null
}

export function isSignedIn(): boolean {
  return !!getAccessToken()
}

/** When the current token expires (ms since epoch), or 0 if none. */
export function getTokenExpiresAt(): number {
  return tokenExpiresAt
}

/**
 * True if this tab signed in earlier, even if that token has since expired
 * — i.e. signing in again is a re-authentication, not a fresh session.
 */
export function hadSession(): boolean {
  return tokenExpiresAt > 0
}

export function getUserEmail(): string {
  return userEmail
}

/**
 * Looks up the signed-in account's email address (needs the openid/email
 * scopes). Resolves to '' rather than failing if it can't be read.
 */
export async function fetchUserEmail(): Promise<string> {
  const token = getAccessToken()
  if (!token) return ''
  try {
    const response = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${token}` } })
    if (response.ok) userEmail = (await response.json()).email || ''
  } catch (error) {
    console.warn('Could not read the signed-in account.', error)
  }
  persistSession()
  return userEmail
}

export function clearAccessToken(): void {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {})
  }
  accessToken = null
  tokenExpiresAt = 0
  userEmail = ''
  persistSession()
}

function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token ? { Authorization: `Bearer ${token}` } : {}
}

/**
 * Lists every object in a bucket (optionally scoped to a prefix, e.g. a
 * "folder"), following pagination automatically. Works without signing in
 * for a publicly listable bucket.
 * @param [prefix] - e.g. "flows/" to only list within that folder
 * @param [opts] - delimiter: '/' restricts results to
 *   objects directly under `prefix`, excluding anything in a deeper "subfolder"
 *   (GCS reports those separately as folder-like prefixes, which are dropped here)
 */
export async function listObjects(
  bucket: string,
  prefix = '',
  { delimiter = '' }: { delimiter?: string } = {}
): Promise<BucketObject[]> {
  if (!bucket?.trim()) throw new Error('Missing bucket name.')
  const results: BucketObject[] = []
  let pageToken = ''
  do {
    const queryParams = new URLSearchParams()
    if (prefix) queryParams.set('prefix', prefix)
    if (delimiter) queryParams.set('delimiter', delimiter)
    if (pageToken) queryParams.set('pageToken', pageToken)
    const queryString = queryParams.toString()
    const url = `${GCS_API}/b/${encodeURIComponent(bucket)}/o${queryString ? `?${queryString}` : ''}`
    const response = await fetch(url, { headers: authHeaders() })
    if (!response.ok) {
      throw new Error(`Could not list objects in gs://${bucket}/${prefix} (${response.status} ${response.statusText}).`)
    }
    const data = await response.json()
    results.push(...(data.items || []))
    pageToken = data.nextPageToken || ''
  } while (pageToken)
  return results
}

/**
 * Confirms the signed-in account can list objects in the bucket (under
 * `prefix`) — the app's test for "authorized to use this app". Throws a
 * readable error if not.
 */
export async function checkBucketAccess(bucket: string, prefix = ''): Promise<void> {
  if (!bucket?.trim()) throw new Error('Missing bucket name.')
  const queryParams = new URLSearchParams({ maxResults: '1' })
  if (prefix) queryParams.set('prefix', prefix)
  const response = await fetch(`${GCS_API}/b/${encodeURIComponent(bucket)}/o?${queryParams}`, { headers: authHeaders() })
  if (response.status === 401 || response.status === 403) {
    // Include Google's own explanation, e.g. "user@x.com does not have
    // storage.objects.list access to the Google Cloud Storage bucket".
    const googleReason = await response
      .json()
      .then((body) => body?.error?.message || '')
      .catch(() => '')
    throw new Error(
      `This Google account doesn't have access to gs://${bucket} (${response.status}). ` +
        (googleReason ? `Google says: "${googleReason}". ` : '') +
        'Ask an administrator to grant it a Storage role on the bucket.'
    )
  }
  if (!response.ok) {
    throw new Error(`Could not check access to gs://${bucket} (${response.status} ${response.statusText}).`)
  }
}

/**
 * Reads an object as raw text (e.g. an XML file). Returns null if the
 * object doesn't exist. Works without signing in for a public object.
 */
export async function readTextObject(bucket: string, objectPath: string): Promise<string | null> {
  if (!bucket?.trim() || !objectPath?.trim()) throw new Error('Missing bucket name or object path.')
  const url = `${GCS_API}/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(objectPath)}?alt=media`
  const response = await fetch(url, { headers: authHeaders() })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new Error(`Could not read gs://${bucket}/${objectPath} (${response.status} ${response.statusText}).`)
  }
  return response.text()
}

/**
 * Uploads raw text (e.g. an XML file) to a bucket, overwriting any existing
 * object at that path. Requires a valid access token.
 */
export async function writeTextObject(
  bucket: string,
  objectPath: string,
  text: string,
  contentType = 'application/xml'
): Promise<BucketObject> {
  if (!bucket?.trim() || !objectPath?.trim()) throw new Error('Missing bucket name or object path.')
  const token = getAccessToken()
  if (!token) throw new Error('Not signed in to Google — connect first.')
  const url = `${GCS_UPLOAD}/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(objectPath)}`
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': contentType
    },
    body: text
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Could not write gs://${bucket}/${objectPath} (${response.status} ${response.statusText}). ${detail}`.trim())
  }
  return response.json()
}

/**
 * Reads and JSON-parses an object from a bucket. Returns null if the object
 * doesn't exist yet. Works without signing in if the object is publicly
 * readable. Kept as a small convenience wrapper around readTextObject.
 */
export async function readJsonObject(bucket: string, objectPath: string): Promise<unknown> {
  const text = await readTextObject(bucket, objectPath)
  return text === null ? null : JSON.parse(text)
}

/**
 * Serializes `data` as JSON and uploads it to a bucket. Kept as a small
 * convenience wrapper around writeTextObject.
 */
export async function writeJsonObject(bucket: string, objectPath: string, data: unknown): Promise<BucketObject> {
  return writeTextObject(bucket, objectPath, JSON.stringify(data, null, 2), 'application/json')
}
