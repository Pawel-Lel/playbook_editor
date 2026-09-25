# Playbook Editor

A Vue 3 + Vite app for managing LLM playbook instructions (the kind of
`<LLM_INSTRUCTIONS>` XML used to drive a diagnostic voice or chat agent) and
for visualizing how the dialog steps inside it connect to one another.

The app ships pre-loaded with two example playbooks — a **diagnostic-flow**
playbook (Heating and Hot Water: playbook setup, behavioural guidelines,
dialog constraints, clarification rules, top-level escalation triggers, and
23 dialog steps — the original 20 diagnostic questions plus the issue
confirmation / re-diagnosis / refined-confirmation steps that close the
loop) and a **router/triage** playbook (Triage: routes to other playbooks by
category instead of asking its own questions — `Role`/`Objective`, 10
routing categories, 20 keyword-matched clarification rules, and global
NoMatch/NoInput reprompt logic, with no dialog steps of its own) — both
fully editable from the UI, and each independently resettable to its own
seed content. You can create as many additional playbooks as you like, each
with its own independent settings and steps; the **Playbooks** page lists,
creates, renames, duplicates and deletes them, and a switcher in the header
always shows which one is active. Every other page (Steps, Flow map,
Playbook settings, Export) always operates on the currently active playbook
only.

## Features

- **HomeServe-themed** — the color palette (`src/assets/main.css`'s
  `:root` custom properties: `--brand`, `--amber`, `--navy-*`, `--slate-*`,
  `--paper*`, `--line`) is built around HomeServe's signature coral-red,
  paired with a clean cool-neutral scale rather than a generic default
  theme. Because every component sources its colors from these variables
  rather than hardcoding hex values, the whole app's look flows from this
  one place — swap the dozen or so values there to retheme it again.

- **Import XML directly — no Cloud Storage required** — "Import from XML…"
  on the Playbooks page parses a pasted or uploaded `<LLM_INSTRUCTIONS>` (or
  bare `<DIAGNOSTIC_FLOWS>`) document into a brand-new playbook, entirely
  client-side; "Import XML…" on the Playbook Settings page does the same
  but replaces the *active* playbook's content in place (keeping its id, and
  its bucket file path if it has one, so a later save still overwrites the
  same file). Both use the exact same parser Cloud Sync uses, so every
  field — escalations, routing categories, global reprompt logic, steps —
  ends up populated exactly as a bucket load would, without needing a
  Google account or a bucket set up first.
- **Multiple playbooks** — create, rename, duplicate and delete playbooks
  from the Playbooks page, each with its own fully independent setup,
  guidelines, constraints, escalations and steps. A switcher in the header
  is always visible and controls which playbook every other page (Steps,
  Flow map, Playbook settings, Export) operates on — the app only ever
  shows one playbook's data at a time. Duplicating a playbook makes a deep,
  independent copy; deleting requires at least one playbook to remain.
- **Two dedicated Playbook Settings layouts** — the page detects which
  playbook "shape" is active (no dialog steps but at least one routing
  category means router/triage) and renders a genuinely different set of
  sections rather than one form trying to cover both. Diagnostic-flow
  playbooks (like Heating and Hot Water) get `SETUP`/context-handling,
  `GUIDELINES`, `DIALOG_CONSTRAINTS`, a plain `CLARIFICATION_RULES_POLICY`,
  and `ESCALATION_HANDLING`. Router/triage playbooks (like the seeded
  Triage example) get `Role`/`Objective`, `GUIDELINES`,
  `ESCALATION_HANDLING` with its "No-match / no-input reprompts"
  sub-section, a `CLARIFICATION_RULES` wrapper with its own shared
  condition plus `keyword=`-matched rules, and `Routing logic` (categories
  with trigger phrases and an action). Both layouts save automatically and
  share the same Export/Import/Reset actions. See "Data model" below for
  the details.
- **Create / Read / Update / Delete** dialog steps: ID, topic, issue summary,
  step-specific instructions, the initial prompt, NoMatch/NoInput reprompts,
  and an editable list of classifications. Each classification supports a
  next step, trigger condition, an optional inline dialog response, an
  optional simple RAG query, and any number of `<Action>` blocks (tool
  invocations, flow invocations, RAG retrieval, or self-closing state
  updates like `Internal_State_Update`).
- **Comments** — every step and every classification has its own editable
  `comment` field, reproduced on export as XML comments immediately above
  the element they annotate (scenario labels like `SCENARIO 2.1 BOILER NOT
  WORKING CORRECTLY: MAINS GAS`, section headers, inline notes). A comment
  with a blank line in it exports as multiple stacked `<!-- ... -->` blocks,
  matching how the source document layers a long explanatory note followed
  by a short scenario tag. Steps with a comment show it (rendered literally
  as `<!-- ... -->`) on the Steps list, and as a small dot + hover tooltip
  on the Flow map.
- **Flow map** — a dedicated page rendering every step and every
  classification's `next_step` as a node/edge diagram, auto-laid-out into
  columns by distance from the entry steps. Click a node to trace its
  incoming/outgoing links; double-click to jump straight to editing that
  step. Escalation paths are drawn in amber; a fifth node kind (dynamic,
  purple) marks runtime placeholders such as
  `[DYNAMICALLY_GENERATED_QUESTION_FLOW]` that the source XML resolves at
  runtime rather than pointing at a fixed step. For a router/triage-style
  playbook (no dialog steps, just `ROUTING_LOGIC`), the map switches to a
  different graph automatically: this playbook → each routing category →
  the playbook it routes to. A target playbook that also exists in this
  workspace resolves as a real, clickable node (double-click to switch the
  active playbook straight to it, from right there on the map); a target
  that isn't loaded yet is shown as an unresolved reference instead of
  silently disappearing. A plain "Category → target playbook" summary list
  sits above the graph itself, so the relationship is readable as text —
  with a resolved/not-found badge and a one-click "Switch →" per row —
  independent of the diagram.
- **Local persistence** — all edits are saved to the browser's
  `localStorage`, so changes survive a refresh. "Reset to seed data" restores
  the original parsed-from-XML content at any time (steps and playbook
  settings reset independently).
- **Cloud Storage sync** — the "Cloud sync" page reads and writes your
  playbooks to a Google Cloud Storage bucket directly from the browser (no
  backend) — one `.xml` file per playbook. Signing in automatically loads
  every playbook found in the bucket. See "Cloud Storage sync (optional)"
  below.
- **Export to XML** — the "Export XML" button (on the Steps list, the Flow
  map, and Playbook settings) reconstructs the current playbook config +
  step data back into the full `<LLM_INSTRUCTIONS>` document — `SETUP`,
  `GUIDELINES`, `DIALOG_CONSTRAINTS`, `CLARIFICATION_RULES_POLICY`,
  `ESCALATION_HANDLING`, and `DIAGNOSTIC_FLOWS` — shown in a preview modal
  with copy-to-clipboard and download-as-`.xml` actions. Verified against
  Python's XML parser for well-formedness during development.
- **Referential integrity** — renaming a step ID automatically repoints every
  classification elsewhere in the flow that targeted the old ID.

## Project structure

```
src/
  data/
    seedSteps.js        # Dialog steps parsed from the source XML
    seedPlaybook.js      # Setup/guidelines/constraints/escalations seed data (Heating and Hot Water)
    seedTriagePlaybook.js # Same, for the Triage (router/triage-style) example playbook
  store/
    playbooks.js          # Core store: collection of playbooks + active selection,
                           # localStorage persistence + cloud sync registration
    steps.js               # Steps CRUD, scoped to the active playbook (thin view)
    playbook.js            # Playbook-config CRUD, scoped to the active playbook (thin view)
    cloudSync.js          # GCS bucket config, auth status, load/save orchestration
  services/
    gcsClient.js          # Google Identity Services auth + GCS JSON API (fetch)
  components/
    GuidelinesEditor.vue      # POLICY CRUD (text / structured / raw shapes), both layouts
    EscalationsEditor.vue     # ESCALATION CRUD, both layouts
    DocumentLayoutEditor.vue  # Section order, section comments, <?xml?> declaration
    ItemToolbar.vue           # Index / move up / move down / remove row header
    StepForm.vue
    ExportXmlModal.vue
    ImportXmlModal.vue   # Paste/upload XML → new playbook or replace-in-place, no cloud needed
  views/
    PlaybooksView.vue    # List/create/rename/duplicate/delete playbooks
    StepsListView.vue    # List + search + delete (active playbook's steps)
    StepCreateView.vue   # Create form
    StepEditView.vue     # Edit form
    FlowMapView.vue      # SVG relationship diagram (active playbook only)
    PlaybookSettingsView.vue  # Setup/guidelines/constraints/escalations
    CloudSyncView.vue    # Google Cloud Storage bucket config + load/save
  utils/xmlExport.js     # Serializes the store back into LLM_INSTRUCTIONS XML
  router/index.js
  App.vue
  main.js
```

## Local development

Requires Node.js 18+.

```bash
npm install
npm run dev
```

This starts a local dev server (default `http://localhost:5173`) with hot
reload.

## Production build

```bash
npm run build
```

Outputs a fully static site to `dist/`. Preview it locally with:

```bash
npm run preview
```

Because the app uses hash-based routing (`/#/steps`, `/#/flow-map`), the
`dist/` output can be hosted on **any** static file host with zero
server-side rewrite rules — including plain S3 buckets, GitHub Pages, or a
basic nginx `try_files` config.

## Deploying

**Google Cloud Run** — a `Dockerfile` is included (Vite build → nginx on
`$PORT`). Deploy straight from source:

```bash
gcloud run deploy playbook-editor \
  --source . \
  --region europe-west2 \
  --allow-unauthenticated \
  --set-env-vars GOOGLE_OAUTH_CLIENT_ID=xxxxxxxxxxxx.apps.googleusercontent.com,GCS_BUCKET=my-project-boiler-flows,GCS_OBJECT_PREFIX=flows/
```

| Variable | Purpose |
| --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | OAuth 2.0 Web Client ID used for "Sign in with Google" (needed to save) |
| `GCS_BUCKET` | Bucket holding the playbook `.xml` files |
| `GCS_OBJECT_PREFIX` | Optional folder inside the bucket, e.g. `flows/` (blank = bucket root) |

These are read when the container **starts**: `deploy/docker-entrypoint.sh`
writes them into `/config.js`, which `index.html` loads before the app
(`src/config/runtimeConfig.js` reads it). Change them without rebuilding:

```bash
gcloud run services update playbook-editor --region europe-west2 \
  --update-env-vars GCS_BUCKET=another-bucket
```

They are not editable on the Cloud sync page — it shows the configured
`gs://bucket/prefix` and flags any missing variable. After the first deploy, add
the service URL (`https://playbook-editor-….run.app`) to the OAuth client's
"Authorized JavaScript origins" and to the bucket's CORS `origin` list (see
"Cloud Storage sync" below).

For local dev, put the same names with a `VITE_` prefix
(`VITE_GOOGLE_OAUTH_CLIENT_ID`, `VITE_GCS_BUCKET`, `VITE_GCS_OBJECT_PREFIX`)
in `.env.local` (see `.env.example`). These are baked in at build time and the runtime values take precedence.

**Vercel** — a `vercel.json` is included. Import the repo (or run
`vercel --prod` from this folder) and it will pick up the Vite framework
preset automatically.

**Netlify** — a `netlify.toml` is included. Either drag-and-drop the built
`dist/` folder onto Netlify, or connect the repo (`npm run build`, publish
directory `dist`).

**GitHub Pages**
```bash
npm run build
# push the contents of dist/ to a gh-pages branch, or use an action such as
# peaceiris/actions-gh-pages
```

**Any static host / CDN (S3, Cloudflare Pages, Firebase Hosting, nginx)** —
upload the contents of `dist/` after `npm run build`. No server-side routing
config is required thanks to hash history.

## Data model

A playbook (one entry in `playbooks.js`'s `playbooks` array):

```js
{
  id: 'heating-and-hot-water',     // slug, unique per playbook, generated from the name
  playbookName: 'Heating and Hot Water',
  setup: {
    contextInstruction: '...', contextConstraint: '...', // this playbook's style
    role: '', objective: ''                                // alternate style (router/triage playbooks) — both coexist
  },
  guidelines: [ /* policies — see below */ ],
  dialogConstraints: [ /* ... */ ],
  clarificationRules: [ /* condition/keyword rules — see below */ ],
  clarificationRulesCondition: '', // optional — only for a <CLARIFICATION_RULES condition="..."> wrapper
  escalations: [ /* gas leak, emergency, max interactions, ... */ ],
  globalNoMatch: { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },
  globalNoInput: { prompt: '', action: { toolType: '', toolId: '', flowId: '', parameterName: '', parameterValue: '' } },
  routingCategories: [ /* a router/triage playbook's DIAGNOSTIC_FLOWS equivalent — see below */ ],
  steps: [ /* this playbook's own dialog steps — see below */ ]
}
```

**Two genuinely separate playbook "shapes" are supported**, each with its
own dedicated Playbook Settings layout (`PlaybookSettingsView.vue` detects
which one it's looking at — no steps but at least one routing category means
router/triage — and renders a completely different set of sections, rather
than one form trying to cover both):

- **Diagnostic-flow** (like the seeded Heating and Hot Water example):
  `CONTEXT_HANDLING`, `DIALOG_CONSTRAINTS`, a plain
  `CLARIFICATION_RULES_POLICY`, per-step `DIALOG_STEP`s. No routing logic,
  no global reprompts — this shape's steps carry their own NoMatch/NoInput.
- **Router/triage** (like the seeded Triage example): `ROLE`/`OBJECTIVE`
  instead of context handling, `ROUTING_LOGIC` instead of dialog steps, a
  `CLARIFICATION_RULES` wrapper with its own shared `condition=` and
  `keyword=` rules, and a global No-match/No-input reprompt shown once
  before escalating (`globalNoMatch`/`globalNoInput`) —
  `<EVENT_HANDLERS><NO_MATCH>/<NO_INPUT></EVENT_HANDLERS>` on export. Each
  is a `{ prompt, action }` pair, and `action` is the *same shape* a
  classification's action uses (`toolType`/`toolId`/`flowId`/
  `parameterName`/`parameterValue` — see `buildActionElement` in
  `xmlExport.js`, reused directly here rather than duplicated). So the tool
  actually invoked on a no-match/no-input reprompt (which tool, which
  parameter) is genuine per-playbook data, editable the same way a
  classification's action is — not boilerplate baked into the exporter.

Escalations and Guidelines are shared between both shapes (both kinds of
playbook can have escalation triggers and behavioural policies). Only the
fields a given playbook's source XML actually used get emitted on export;
an empty `routingCategories` array, for instance, means no
`<ROUTING_LOGIC>` block is written at all, and a blank
`globalNoMatch.prompt`/`globalNoInput.prompt` means no `<EVENT_HANDLERS>`
block.

### Full-fidelity XML (Triage.xml)

Everything in a router/triage file like `Triage.xml` is now real, editable
data rather than hardcoded export boilerplate, and exporting the seeded
Triage playbook reproduces `Triage.xml` exactly (apart from whitespace):

- **Structured policies** — each guideline has a `shape`: `text`,
  `structured` or `raw`. Structured policies expose `trigger`,
  `triggerKeywords`, `action` (plain text) **or** `actionSteps`
  (`<SET_PARAMETER name value>` / `<INVOKE_FLOW name>` rows), `requirement`
  and `format` — so `CANCELLATION_OVERRIDE` and `HANDOFF_SUMMARY` are edited
  field by field instead of as a raw XML blob. Anything else (e.g. Heating's
  `AGENT_ESCALATION_OVERRIDE` with its `ATTEMPT`s) stays `raw`; a raw
  policy that fits the structured shape can be converted with one click.
- **Comments everywhere** — escalations (`<!-- Gas Emergency -->`),
  guidelines, clarification rules, routing categories and the
  `NO_MATCH`/`NO_INPUT` reprompts each have a `comment` field.
- **Escalation `param_playbook_name`** — `playbookNameParam`; blank means
  "this playbook's own name", so renaming the playbook keeps them in step.
- **Document layout** — `sectionOrder` (Triage lists `ESCALATION_HANDLING`
  before `CLARIFICATION_RULES`), `sectionComments` (`SETUP AND PERSONA`,
  `STEP 1: CLARIFY AMBIGUOUS INPUTS`, ...) and `includeXmlDeclaration`,
  edited in the "Document layout" panel. Empty sections the source didn't
  have (`DIALOG_CONSTRAINTS`, `DIAGNOSTIC_FLOWS` for Triage) are no longer
  written.
- **Reordering** — every list (policies, escalations, rules, categories,
  constraints) has ↑/↓ controls, since order is significant in the XML.
- Imported prose is re-joined from the file's hard line-wrapping, and raw
  XML bodies are de-indented so repeated import → export cycles are stable.

Older saved data is upgraded in place on load (`normalizeRecord` in
`store/playbooks.js`). A Triage playbook already saved in your browser keeps
its old contents until you click **Reset to seed data** or re-import
`Triage.xml`.

A few structural quirks are normalized transparently:
- An `<ESCALATION>` may use either `condition="..."` or `type="..."` for
  its identifying attribute — whichever the source used is preserved via
  each escalation's `attrName` field and re-emitted the same way.
- A clarification `<RULE>` may use either `condition="..."` or
  `keyword="..."` — same `attrName` pattern — and may carry an optional
  `<INSTRUCTION>` (extra per-rule routing guidance beyond the prompt),
  captured as the rule's `instruction` field.
- `<GUIDELINES>` policies that don't fit the simple "plain text" or
  "trigger/action" shapes (e.g. `CANCELLATION_OVERRIDE`'s
  `TRIGGER_KEYWORDS`/`ACTION` pair, or `HANDOFF_SUMMARY`'s
  `REQUIREMENT`/`FORMAT` pair) are captured verbatim as `rawXml` and
  re-emitted unchanged — this already handled router/triage-style policies
  with no code changes needed, since it's a generic fallback.


Everything else in the app — the Steps list, the Flow map, Playbook
settings, and Export — always reads and writes the `steps` and config
fields of whichever playbook is currently active (`activePlaybookId` in the
same store). Switching the active playbook in the header switcher is enough
to make every page show a different playbook's data; nothing is ever mixed
between playbooks.

Each step (an entry in a playbook's `steps` array):

```js
{
  id: 'NoHotWater_Initial',
  topic: 'No Hot Water Diagnosis',
  issueSummary: '...',
  instructions: '...',       // DialogStepSpecificInstructions (optional)
  comment: '',                // optional — exported as <!-- ... --> above this DIALOG_STEP
  promptType: 'InitialQuery', // InitialQuery | ConfirmationQuery | InternalProcessing
  prompt: '...',              // AgentInteraction > Prompt
  noMatchResponse: '...',     // optional
  noInputResponse: '...',     // optional
  classifications: [
    {
      id: 'c1',
      classificationId: 'NO_HOT_WATER_MAINS_GAS',
      nextStep: 'Issue_Confirmation_Summary_Final', // optional — some classifications are dead ends
      triggerCondition: 'user confirms, yes, mains gas boiler',
      query: 'No Hot water on a, Mains Gas Boiler', // optional bare <Parameter name="query">
      dialogResponse: '',    // optional inline <DialogResponse> (e.g. "no" branches)
      comment: '',           // optional — exported as <!-- ... --> above this Classification
      actions: [              // any number of <Action> elements
        {
          toolType: 'Flow_Invocation', // Flow_Invocation | RAG_Retrieval | Tool_Invocation | Internal_State_Update | custom
          toolId: '',                  // e.g. heating_hot_water_issues_rag_tool
          flowId: 'Default_Escalation_Hot_Water',
          parameterName: '',           // e.g. "query" or "Summary_Status"
          parameterValue: ''           // e.g. "{CONCISE_SEARCH_QUERY_FROM_DIAGNOSIS}" or "REFINED"
        }
      ]
    }
  ]
}
```

The `guidelines` policies (a simple one-liner, a trigger/action pair, or a
`rawXml` escape hatch for structurally complex policies like
`AGENT_ESCALATION_OVERRIDE`), `dialogConstraints`, `clarificationRules`, and
`escalations` shapes are exactly what `PlaybookSettingsView.vue` edits and
`xmlExport.js` serializes — see `src/data/seedPlaybook.js` for a fully
populated example of each.

Some classifications point at IDs that are referenced but never defined as
their own `<DIALOG_STEP>` in the source XML (`Default_Escalation_Hot_Water`,
`Fulfilment_Escalation`, `Data_Retrieval_Phase`,
`FINAL_SUMMARY_CONFIRMATION_NO`, and the runtime placeholder
`[DYNAMICALLY_GENERATED_QUESTION_FLOW]`). These are kept as terminal/flow/
dynamic reference nodes on the flow map so the graph stays complete, but
they don't have editable step records of their own — create a step with
that same ID if you want to flesh one out.

Only the built-in example playbooks — Heating and Hot Water
(`id: 'heating-and-hot-water'`, `SEED_PLAYBOOK_ID`) and Triage
(`id: 'triage'`, `SEED_TRIAGE_PLAYBOOK_ID`), both exported from
`store/playbooks.js` alongside the generic `isBuiltInSeedId(id)` check —
have real seed content to restore to; their "Reset to seed data" buttons
put back that playbook's own original example content (`getSeedConfigFor(id)`
for the settings, `getSeedStepsFor(id)` for the steps — empty for Triage,
which has no dialog steps). Every other playbook you create starts empty
and its equivalent buttons ("Clear all steps" / "Clear settings") just
clear it back to blank, since there's no seed content to restore for a
playbook you made yourself. Adding a third built-in example playbook means
adding one more entry to the `SEED_REGISTRY` map in `store/playbooks.js`
(and a matching `src/data/seed*.js` config file) — nothing else needs to
change, since every other piece of the app already generalizes over "any
number of seed playbooks".

## Notes on persistence

Every edit is saved instantly to the browser's `localStorage` under
`playbook-editor:playbooks:v1`, as one JSON document holding the full
array of playbooks (each with its own settings and steps) plus which one is
active. This is always on and needs no setup, so the app works standalone
with zero configuration.

`src/store/steps.js` and `src/store/playbook.js` no longer hold any state of
their own — they're thin, scoped views over `getActivePlaybookRecord()`
from `store/playbooks.js`, exposing the same CRUD API as before
(`createStep`, `updateStep`, `deleteStep`, `getStep`, `addItem`,
`updateItem`, `removeItem`, ...) so no other view code had to change when
multi-playbook support was added. `playbook.js` also exposes
`toExportPayload()` — the single source of truth for "every field
`buildLlmInstructionsXml()` needs from the playbook side" — which every
export call-site (Steps list, Flow map, Playbook settings) calls rather
than re-listing fields by hand, so a new field added there can't be
silently missed at some call sites but not others. If you need a durable
backend beyond Cloud Storage (a real API, Firestore, etc.),
`store/playbooks.js` is the one file to point elsewhere — everything
downstream keeps working unchanged.

### Cloud Storage sync (optional)

The **Cloud sync** page (`/cloud-sync`) lets you read and write your
playbooks to a Google Cloud Storage bucket, directly from the browser, no
backend server required — **one `.xml` file per playbook**, matching how
you'd actually browse them in the GCS console (`Appliances.xml`,
`Heating and Hot Water.xml`, `Water Taps.xml`, ...). It's additive: local
storage keeps working as the always-on fast cache, and the bucket becomes a
shared/durable copy you pull from or push to.

- **Signing in automatically loads every playbook in the bucket.** The
  moment you sign in, the app lists every `.xml` object under the
  configured bucket/prefix, parses each one as a playbook, and replaces the
  local collection with what it found. You don't have to click "Load"
  separately — though that button is there too, for reloading without
  signing out first.
- **Reading** a publicly readable bucket/objects works with no sign-in at
  all — click "Load all playbooks from bucket" directly. Handy for a
  read-only deployment that just needs to load a shared set of playbooks.
- **Writing** requires signing in with a Google account (via Google Identity
  Services' OAuth token flow) that has at least the `Storage Object Admin`
  IAM role — or `Storage Object Creator` + `Storage Object Viewer` — on the
  bucket. "Save all playbooks to bucket" writes each playbook to its own
  file; a playbook loaded from (or previously saved to) a given filename
  keeps overwriting that same file even if you rename the playbook
  afterwards — renaming doesn't rename the file until you explicitly
  duplicate or the filename is next derived fresh (a brand-new playbook is
  named `<playbook name>.xml` the first time it's saved).
- **Auto-save** debounces saving just the *active* playbook's file ~1.5s
  after any change, once you're signed in and have turned it on — not every
  playbook on every keystroke, since the bucket holds one file each.
- A file that fails to parse (not valid XML, or missing the expected root
  element) is skipped rather than aborting the whole load; the Cloud sync
  page lists which files failed and why.

One-time setup (also shown inline on the Cloud sync page):

1. Create a bucket: `gsutil mb gs://your-bucket-name`.
2. Allow this app's origin to call the bucket over CORS:
   ```bash
   gsutil cors set cors.json gs://your-bucket-name
   ```
   with `cors.json`:
   ```json
   [
     {
       "origin": ["http://localhost:5173", "https://your-deployed-site.example.com"],
       "method": ["GET", "POST", "OPTIONS"],
       "responseHeader": ["Content-Type", "Authorization"],
       "maxAgeSeconds": 3600
     }
   ]
   ```
3. Create an OAuth 2.0 Client ID (type: Web application) in the same GCP
   project, with this app's origin(s) under "Authorized JavaScript origins",
   and set it as `GOOGLE_OAUTH_CLIENT_ID`, together with `GCS_BUCKET` (and
   optionally `GCS_OBJECT_PREFIX`) — see "Deploying" above.
4. Grant the signing-in account the IAM role mentioned above on the bucket.

The implementation lives in three small, dependency-free files:

- `src/services/gcsClient.js` — loads Google Identity Services on demand,
  requests a short-lived OAuth access token (scope `devstorage.read_write`),
  and lists/reads/writes objects via the plain GCS JSON API
  (`storage.googleapis.com`) using `fetch`. `listObjects()` paginates
  automatically and supports GCS's `delimiter` param so a folder prefix only
  picks up files directly under it, not in deeper "subfolders".
- `src/utils/xmlImport.js` — parses one `<LLM_INSTRUCTIONS>` XML document
  (using the browser's native `DOMParser`) back into the app's playbook
  shape, mirroring `xmlExport.js` in reverse: policies, constraints,
  escalations (including recovering the `note` field from its `<!-- Note:
  ... -->` comment), and every step's classifications, actions (including
  the `Internal_State_Update` self-closing attribute form), and comments
  (walking backward through preceding sibling comment nodes, the reverse of
  how the exporter stacks multiple `<!-- --> `blocks). Also accepts a bare
  `<DIAGNOSTIC_FLOWS>` root as a steps-only file.
- `src/store/cloudSync.js` — reads the bucket/prefix/Client ID from
  `src/config/runtimeConfig.js`, keeps the auto-sync preference in
  `localStorage` (under `playbook-editor:cloud-sync-config:v1`), auth/sync status, and
  orchestrates loading/saving. It never imports `store/playbooks.js`
  directly — `playbooks.js` registers itself once at module load
  (`registerSyncTarget('playbooks', { loadAll, saveAll, saveOne })`),
  keeping the dependency one-directional.
# playbook_editor
