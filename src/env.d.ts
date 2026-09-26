// Global type declarations: things that exist at runtime but that
// TypeScript can't discover on its own.

/// <reference types="vite/client" />

// Lets TypeScript accept `import X from './Something.vue'`.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

// Build-time settings read by src/config/runtimeConfig.ts (from .env.local).
interface ImportMetaEnv {
  readonly VITE_GOOGLE_OAUTH_CLIENT_ID?: string
  readonly VITE_GCS_BUCKET?: string
  readonly VITE_GCS_OBJECT_PREFIX?: string
}

interface Window {
  // Written by /config.js at container start (deploy/docker-entrypoint.sh).
  __APP_CONFIG__?: {
    GOOGLE_OAUTH_CLIENT_ID?: string
    GCS_BUCKET?: string
    GCS_OBJECT_PREFIX?: string
  }
  // Google Identity Services, loaded on demand by services/gcsClient.ts.
  // Left untyped (any) — it's a large external API we only touch in one place.
  google?: any
  // File System Access API (Chrome/Edge only), used by services/localFolder.ts.
  showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
}

// Permission methods of the File System Access API that TypeScript's
// built-in DOM types don't include yet.
interface FileSystemHandle {
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>
}
