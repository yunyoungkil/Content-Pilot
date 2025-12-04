# Content Pilot — AI agent quick reference (concise)

This file gives an AI coding agent the minimal, high-value information needed to be productive working in Content Pilot.

Core idea — Manifest V3 Chrome extension with 3 logical runtime roles:

- background (service worker): dist/background.bundle.js (bundled from background.cjs; CommonJS runtime)
- content: dist/content.bundle.js (UI + page integration; uses Shadow DOM)
- offscreen: dist/offscreen.bundle.js (full DOM environment for HTML parsing/cleaning)

Key developer flows / commands

- Build: `npm run build` (webpack production)
- Dev watch: `npm run watch` (webpack --watch)
- Tests: `npm test` (Jest with jsdom)
- Lint: `npm run lint` / `npm run lint:fix`
- Offscreen CLI: `npm run offscreen-cli` (for testing offscreen logic)
- Required runtime: Node 18–22, Chrome 109+ (offscreen API)

Important implementation notes (copy these when editing code)

- Background is bundled from `background.cjs` and intentionally compiled to CommonJS. Keep background-specific code there when you need service-worker semantics.
- Offscreen document (`offscreen.js`) is the safe DOM parser: heavy DOM parsing / sanitization (DOMPurify, Marked) should run there; background delegates these jobs.
- `cleanDataForFirebase(data)` must be used before writes (converts undefined → null) — see `js/services/firebaseService.js`.
- Cross-frame UI: highlighter runs in all frames; main panel only runs when `window.self === window.top`.
- Storage & state sync: uses `chrome.storage.local` for toggles and shared state across frames.
- iframe editors communicate via postMessage (see `editor.html` / `editor.js` and parent listeners).
 - UI considerations: When working with scrollable lists inside flex containers (eg. `affiliate-link-list` inside the modal), keep in mind the following CSS rules are applied consistently across the project:
	 - Set `min-height: 0` and `min-width: 0` on flex children to allow proper shrinking/growth behavior.
	 - For scrollable lists, prefer explicit `max-height` (eg. `max-height: calc(100% - 120px)`) and `overflow-y: auto` rather than relying on implicit heights — this prevents the list from growing and breaking surrounding card layout.
	 - Provide an inline fallback `<style>` block in renderers that may run in Shadow DOM (eg. `renderAffiliateModal` adds compact fallback CSS) so UI remains usable in environments where the main CSS fails to load.

Patterns and places to look

- UI and interaction code: `js/ui/*` (panel, dashboard, kanban, workspace)
- Business services: `js/services/*` (aiService, analyticsService, authService, offscreenService)
- Core helpers: `js/core/*` and `js/utils/*`
- Build entry points: `content.js`, `background.cjs`, `offscreen.js`, `editor.js` (see webpack config)
- Tests: `test/` folder with Jest (e.g., `aiService.test.js`, `authService.test.js`)

Inter-process / runtime signals

- Background initializes Firebase and pre-creates offscreen document on startup.
- Content script injected dynamically on icon click, sets up Shadow DOM panel.
- Offscreen handles message-based requests for DOM operations (e.g., sanitize HTML, parse markdown).

Testing & CI hints

- Unit tests use Jest with jsdom (see `test/` folder). Tests exercise service logic (e.g., `analyticsService`, `authService`) — use them to validate logic changes quickly.
- Offscreen CLI tool (`tools/offscreen-cli.js`) for isolated testing of DOM parsing.

Where to find deeper docs

- Detailed guides and architecture docs are under `docs/` (AI_SERVICE_GUIDE.md, SERVICES_ARCHITECTURE.md, FIREBASE_CHANNELS_STRUCTURE.md).

If anything is unclear or you want more examples, ask for the specific area (build, background, offscreen parser, or a particular service) and I'll expand examples or add tests. ✅
<parameter name="filePath">c:\Content-Pilot\.github\copilot-instructions.md
