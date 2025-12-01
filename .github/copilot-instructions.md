# Content Pilot — AI agent quick reference (concise)

This file gives an AI coding agent the minimal, high-value information needed to be productive working in Content Pilot.

Core idea — Manifest V3 Chrome extension with 3 logical runtime roles:

- background (service worker): dist/background.bundle.js (bundled from background.cjs; CommonJS runtime)
- content: dist/content.bundle.js (UI + page integration; uses Shadow DOM)
- offscreen: dist/offscreen.bundle.js (full DOM environment for HTML parsing/cleaning)

Key developer flows / commands

- Build: `npm run build` (webpack production)
- Dev watch: `npm run watch` (webpack --watch)
- Tests: `npm test` (Jest)
- Lint: `npm run lint` / `npm run lint:fix`
- Required runtime: Node 18–22, Chrome 109+ (offscreen API)

Important implementation notes (copy these when editing code)

- Background is bundled from `background.cjs` and intentionally compiled to CommonJS. Keep background-specific code there when you need service-worker semantics.
- Offscreen document (`offscreen.js`) is the safe DOM parser: heavy DOM parsing / sanitization (DOMPurify, Marked) should run there; background delegates these jobs.
- `cleanDataForFirebase(data)` must be used before writes (converts undefined → null) — see `js/services/firebaseService.js`.

Patterns and places to look

- UI and interaction code: `js/ui/*` (panel, dashboard, kanban, workspace)
- Business services: `js/services/*` (aiService, analyticsService, authService, offscreenService)
- Core helpers: `js/core/*` and `js/utils/*`
- Build entry points: `content.js`, `background.cjs`, `offscreen.js`, `editor.js` (see webpack config)

Inter-process / runtime signals

- Cross-frame UI: highlighter runs in all frames; main panel only runs when `window.self === window.top`.
- Storage & state sync: uses `chrome.storage.local` for toggles and shared state across frames.
- iframe editors communicate via postMessage (see `editor.html` / `editor.js` and parent listeners).

Testing & CI hints

- Unit tests use Jest with jsdom (see `test/` folder). Tests exercise service logic (e.g., `analyticsService`, `authService`) — use them to validate logic changes quickly.

Where to find deeper docs

- Detailed guides and architecture docs are under `docs/` (AI_SERVICE_GUIDE.md, SERVICES_ARCHITECTURE.md, FIREBASE_CHANNELS_STRUCTURE.md).

If anything is unclear or you want more examples, ask for the specific area (build, background, offscreen parser, or a particular service) and I’ll expand examples or add tests. ✅
<parameter name="filePath">c:\Content-Pilot\.github\copilot-instructions.md
