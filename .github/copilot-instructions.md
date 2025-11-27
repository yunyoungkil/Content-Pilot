# Content Pilot - AI Coding Agent Instructions

## Project Overview

Content Pilot is a Chrome Extension (Manifest V3) for web content curation, AI-powered content planning, and performance tracking. It uses Firebase for data sync, Google Analytics/AdSense APIs, and Gemini AI.

## Core Architecture (3-Layer)

- **Background Script** (`background.js`): Service worker handling Firebase, API calls, AI services. Delegates DOM parsing to offscreen.
- **Content Script** (`content.js` → `dist/content.bundle.js`): Injected into web pages for UI rendering and user interactions. Uses Shadow DOM for isolation.
- **Offscreen Document** (`offscreen.js`): Handles DOM parsing and HTML sanitization (DOMPurify, Marked) due to background script restrictions.

## Build & Debug Workflow

- **Build**: `npm run build` (Webpack bundles JS) or `npm run watch` (auto-rebuild)
- **Reload Extension**: `chrome://extensions/` → Refresh Content Pilot
- **Reload Webpage**: Test page refresh after content script changes
- **Debug Background**: `chrome://extensions/` → Content Pilot → "Inspect service worker"
- **Debug Content**: Webpage dev tools console

## Critical Patterns

### Frame Execution Rules

```javascript
setupHighlighter(); // ✅ All frames (iframes included)

if (window.self === window.top) {
  createAndShowPanel(); // ✅ Top frame only for UI
}
```

### Firebase Data Sanitization

Always call `cleanDataForFirebase(data)` before Firebase saves to convert `undefined` to `null`.

### iframe Editor Communication

Editors run in iframes for focus isolation. Use postMessage:

```javascript
// Parent: Send command
editorIframe.contentWindow.postMessage(
  { action: "set-content", data: { html } },
  "*"
);

// iframe: Receive and respond
window.addEventListener("message", (event) => {
  if (event.source !== parentWindow) return;
  // Handle action, postMessage back if needed
});
```

### Alt Key Toggle Highlighter

State managed in `chrome.storage.local` for cross-frame sync:

```javascript
chrome.storage.local.get(["highlightToggleState"], (result) => {
  if (result.highlightToggleState) {
    /* highlight */
  }
});
```

### Shadow DOM UI

All UI components use Shadow DOM to avoid webpage CSS conflicts:

```javascript
const shadowRoot = host.attachShadow({ mode: "open" });
shadowRoot.appendChild(styleLink); // chrome.runtime.getURL('css/style.css')
```

## Key Files & Directories

- `js/core/`: Highlighter, scrapbook logic
- `js/ui/`: Mode-specific UI (dashboard, kanban, workspace, etc.)
- `js/services/`: Firebase, AI, analytics, auth services
- `manifest.json`: Extension config (permissions: storage, offscreen, identity)
- `webpack.config.js`: Bundles content/background/offscreen to `dist/`

## Development Notes

- Chrome 109+ required for offscreen API
- All Firebase ops via REST API (not SDK in background)
- AI: Gemini Pro/Vision for content generation and image analysis
- OAuth: Google for GA4/AdSense integration</content>
  <parameter name="filePath">c:\Content-Pilot\.github\copilot-instructions.md
