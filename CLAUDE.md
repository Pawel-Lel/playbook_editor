# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A Vue 3 + Vite single-page app (plain JS, no TypeScript, no state library) for editing LLM playbook instructions: `<LLM_INSTRUCTIONS>` XML documents that drive a diagnostic voice/chat agent. It also maps how the dialog steps connect. The app has no backend. Data lives in `localStorage` and can optionally be synced to a Google Cloud Storage bucket straight from the browser.

## Commands

```bash
npm install
npm run dev       # dev server on http://localhost:5173
npm run build     # static output in dist/
npm run preview   # serve dist/ locally
```

There is no test runner, linter, or formatter configured. `dom-stub.mjs` is a small `DOMParser`/`XMLSerializer` shim that lets `src/utils/xmlImport.js` run under plain Node. It handles only the well-formed, namespace-free XML that `xmlExport.js` produces. For ad-hoc round-trip checks, write a Node script that imports `./dom-stub.mjs` **first**, then imports the utils. Both `xmlImport.js` and `xmlExport.js` have no imports, so they load outside Vite.

## Architecture

### State: one store owns everything
- `src/store/playbooks.js` is the single source of truth. It holds a reactive `{ playbooks: [...], activePlaybookId }` that is persisted whole to `localStorage` under `playbook-editor:playbooks:v1`. Each playbook record contains its own `steps`.
- `src/store/steps.js` and `src/store/playbook.js` hold **no state**. They are thin views scoped to `getActivePlaybookRecord()` and expose CRUD APIs (`createStep`, `updateStep`, `addItem`, `updateItem`, `removeItem`, …). Every page except Playbooks works on the active playbook only.
- `normalizeRecord()` and the `PARSED_FIELDS` list in `playbooks.js` define the canonical record shape. Every import and load path goes through them. To add a playbook-level field, add it to `PARSED_FIELDS`/`normalizeRecord`, `xmlImport.js`, `xmlExport.js`, and `playbook.js`'s `toExportPayload()`. `toExportPayload()` is the one place every export call-site gets playbook data from.
- The app ships with no playbook data. Playbooks are loaded from a GCS bucket (Cloud sync) or a local folder, both of which replace the whole collection through `replaceCollection()`. With nothing cached, the app starts with one blank "Untitled playbook", because every view assumes an active playbook exists. A record remembers where it came from in `sourceObjectPath` (bucket) and `localFileName` (local folder), so saves overwrite the same files.

### XML round-trip is the core invariant
- `src/utils/xmlExport.js` (`buildLlmInstructionsXml`) and `src/utils/xmlImport.js` (`parsePlaybookXml`) mirror each other. Import → export must reproduce the source. That includes XML comments (stacked `<!-- -->` blocks before elements, `<!-- Note: … -->` on escalations), attribute-name variants (`attrName: 'condition' | 'keyword'`), section order (`resolveSectionOrder`), and indentation (the importer dedents policy bodies so the exporter doesn't drift them rightward). When you change one side, change the other.
- The exporter emits only sections that hold data. For example, an empty `routingCategories` writes no `<ROUTING_LOGIC>`, and blank global reprompts write no `<EVENT_HANDLERS>`.

### Two playbook shapes
- **Diagnostic-flow** (e.g. Heating and Hot Water) has `CONTEXT_HANDLING`, `DIALOG_CONSTRAINTS`, and per-step `DIALOG_STEP`s with their own NoMatch/NoInput.
- **Router/triage** (e.g. Triage) has `ROLE`/`OBJECTIVE`, `ROUTING_LOGIC` (`routingCategories`), a `CLARIFICATION_RULES` wrapper with a shared condition, and global `globalNoMatch`/`globalNoInput` reprompts. It has no steps.
- `PlaybookSettingsView.vue` detects the shape (no steps and at least one routing category means router) and renders an entirely different section set. Guidelines and escalations are shared by both shapes. A global reprompt's `action` has the same shape as a step classification's action, and the exporter reuses `buildActionElement` for both.

### Cloud sync (optional)
- `src/services/gcsClient.js` loads Google Identity Services on demand, gets an OAuth token (`devstorage.read_write`), and calls the GCS JSON API through `fetch`.
- `src/store/cloudSync.js` orchestrates load and save and **never imports `playbooks.js`**. Instead, `playbooks.js` calls `registerSyncTarget('playbooks', { loadAll, saveAll, saveOne })` at module load. This avoids a circular import, so keep the dependency one-directional.
- The bucket holds one `.xml` file per playbook. A playbook remembers its `sourceObjectPath`, so renaming the playbook doesn't rename its file. Auto-save debounces a save of only the active playbook.

### Local folder
`src/services/localFolder.js` uses the File System Access API and remembers the chosen folder handle in IndexedDB.
- The header's **Save** button calls `saveActiveToLocalFolder()` in `playbooks.js`, which writes the active playbook's `.xml`. Browsers without the API (Firefox, Safari) get a plain download instead.
- The Playbooks page's **Open local folder…** calls `loadAllFromLocalFolder()`, which reads every `.xml` file directly in the folder. It confirms only after reading the folder, because a dialog shown before the folder picker would use up the click's user activation.

### Runtime config
`src/config/runtimeConfig.js` resolves `GOOGLE_OAUTH_CLIENT_ID`, `GCS_BUCKET`, and `GCS_OBJECT_PREFIX` in this order:
1. `window.__APP_CONFIG__`, from `/config.js`. In the Docker/Cloud Run image, `deploy/docker-entrypoint.sh` writes that file from env vars at container start. `public/config.js` is an empty placeholder for dev and static hosts.
2. `VITE_`-prefixed build-time vars, e.g. from `.env.local`.

The Cloud sync page shows these values but doesn't edit them.

### Routing and deployment
- Routes use hash history (`createWebHashHistory`) and Vite uses `base: './'`, so `dist/` runs on any static host without rewrite rules. Keep both settings.
- The `Dockerfile` does a Vite build and then serves the result with nginx on `$PORT` for Cloud Run. `deploy/nginx.conf.template` marks `/config.js` as `no-store` and caches `/assets/` immutably. The repo also includes `vercel.json` and `netlify.toml`.
