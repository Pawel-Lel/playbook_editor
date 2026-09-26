// Deployment-time settings, resolved in this order:
//  1. window.__APP_CONFIG__ — written to /config.js by the container
//     entrypoint (deploy/docker-entrypoint.sh) from Cloud Run env vars, so
//     values can change without rebuilding the image.
//  2. import.meta.env.VITE_* — baked in at build time (handy for `npm run
//     dev` via a local .env.local file).

const runtime = (typeof window !== 'undefined' && window.__APP_CONFIG__) || {}

// Returns the runtime value if set, else the build-time one, else ''.
function pick(runtimeKey: keyof NonNullable<Window['__APP_CONFIG__']>, viteKey: keyof ImportMetaEnv): string {
  const value = runtime[runtimeKey] || import.meta.env[viteKey] || ''
  return String(value).trim()
}

export const googleOAuthClientId = pick('GOOGLE_OAUTH_CLIENT_ID', 'VITE_GOOGLE_OAUTH_CLIENT_ID')
export const gcsBucket = pick('GCS_BUCKET', 'VITE_GCS_BUCKET')
// Optional "folder" inside the bucket, e.g. "flows/" — blank means bucket root.
export const gcsObjectPrefix = pick('GCS_OBJECT_PREFIX', 'VITE_GCS_OBJECT_PREFIX')
