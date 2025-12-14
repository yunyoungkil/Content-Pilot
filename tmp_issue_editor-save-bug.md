요약:
- TipTap 기반 에디터로 교체 후 워크스페이스에서 에디터 편집 내용을 저장(또는 업데이트)하려고 해도 저장되지 않는 현상이 발생합니다.

재현(예상) 시나리오:
1. 워크스페이스에서 아이디어를 열고 편집기의 텍스트 내용을 수정합니다.
2. 저장(또는 Generate / Save) 버튼을 클릭하거나 자동 저장이 동작하더라도 DB 업데이트가 이루어지지 않음.
3. 새로고침 또는 다시 열기 시 변경 내용이 유지되지 않음.

관찰되는 동작(실제):
- 버튼 클릭 시 시각적 응답(스피너/비활성화 가능)은 보이지만, `chrome.runtime.sendMessage` 또는 Firebase에 업데이트되는 로그/메시지 호출이 발생하지 않거나 실패함.
- 콘솔, 네트워크 로그: (재현 시 확인 필요)

기대 동작(정상):
- 편집된 텍스트 변경 시 `save` 로직이 호출되어 DB(kanban/cards 등) 저장 요청이 전송되어야 함.
- 저장 성공 시 토스트 알림 및 UI 상태(버튼 비활성화 해제 또는 최신 저장 상태 반영) 업데이트.

영향 범위/관련 파일:
- `editor.js` — TipTap 초기화, 커맨드/저장 호출
- `editor.html` — 툴바/버튼 DOM 변경
- `js/ui/workspaceMode.js` — `renderWorkspace`, `addWorkspaceEventListeners`, `updateWorkspaceActionButtons`
- 테스트: `test/workspaceMode.*.test.js` (저장/토스트/ID 및 메시지 전송 검증)

우선 확인 포인트:
- `editor`에서 저장 버튼 클릭 이벤트가 정상적으로 메시지를 보내는지(`chrome.runtime.sendMessage`), 혹은 `firebase` 쓰기 함수가 호출되는지 로그 확인.
- `getEditorContent()` 직렬화 및 서버 호출 payload 포맷(Quill → TipTap 저장 포맷 변화) 여부.
- `addWorkspaceEventListeners`나 버튼에서 이벤트 리스너가 중복되거나 덮어쓰기되어 호출되지 않는지 여부.

우선 조치(권장):
- 로컬에서 재현 테스트: 로그에 `chrome.runtime.sendMessage` 호출이 찍히는지 확인.
- 단위 테스트/통합 테스트 추가: Edit → Save → runtime message & db update 예상 동작 규정.

레이블: bug, editor, workspace
담당자: @yunyoungkil
