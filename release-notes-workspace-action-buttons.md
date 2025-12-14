Workspace action buttons UI & behavior improvements

PR #27 / Issue #24

Summary
- Moved `#btn-create-thumbnail` to follow `.compose-thumbnail-controls` and made it persistent across publish-panel re-renders. Button is now text-only: "🎨 썸네일 만들기" (preview image removed).
- Adjusted `publish-info-panel` styling (reduced padding to 10px) and fixed input `box-sizing` for layout stability.
- Ensured `regenerate-draft-btn` is not nested inside `.compose-thumbnail-controls` and removed the static `#workspace-action-buttons` creation in favor of dynamic placement with fallbacks.

Files modified
- `js/ui/workspaceMode.js`
- `css/workspace.css`
- `editor.html`
- Tests: `test/workspaceMode.noStaticActionButtons.ui.test.js`, `test/workspaceMode.thumbnailPersistence.ui.test.js` and others

Notes
- QA: Open the publish panel and confirm the "🎨 썸네일 만들기" button is present next to `.compose-thumbnail-controls` and that `regenerate-draft-btn` is not nested inside the compose controls.
- This is a UI/UX change; no DB or API migrations are required.
