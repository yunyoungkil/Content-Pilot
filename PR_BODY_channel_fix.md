Title: Fix: preserve channel platformType across reload/save; Apply local-only, add tests

Summary
- This PR fixes a regression where a channel's `platformType` could be lost when saving channels after relogin. The backend previously overwrote `channels/${userId}` via `set()` which removed fields missing from the incoming payload. The fix adds merging logic on the backend and defensive payload normalization on the frontend.

Changes
- Frontend: `js/ui/channelMode.js` — `Apply` updates UI only; `Save All` triggers backend save. Ensures payload contains `platformType`.
- Backend: `background.cjs` & `background.js` — read existing DB and merge `platformType` before `set()`.
- Utils: `js/services/channelUtils.js` — `genId()` and `mergeBlogsPreservePlatform`.
- Tests: Added/updated tests in `test/` confirming both frontend behavior and backend merge logic.

Testing
- Added `test/background.save_channels_and_key.test.js` to validate server-side merge protection.
- Updated `channelMode` tests to assert `Apply` is local and `Save All` persists data and preserves `platformType`.

Notes
- Remove temporary debug logs in `channelUtils` before merging to Master.

Fixes: # (link to issue created)
# PR: Fix channel ID derivation & header refresh (fix/channel-id-refresh)

## 요약
- 채널 ID를 `inputUrl` 기반으로 deterministic하게 생성(후행 슬래시 제거 및 base64 encoding)하여 로그아웃/재로그인 시 ID가 변경되어 생기는 중복 문제를 해결했습니다.
- 채널 저장/삭제 시 헤더의 글로벌 채널 선택기를 강제로 갱신하고 `channels_data_updated` 브로드캐스트를 보내어 대시보드/헤더 UI가 즉시 최신 상태를 반영하도록 수정했습니다.

## 변경사항
- `js/ui/channelMode.js`: ID 파생 로직 정규화, 저장/삭제 후 헤더 갱신 + 브로드캐스트 호출
- `js/ui/header.js`: `refreshGlobalChannelSelector(shadowRoot)` 내보내기 추가
- `test/channelMode.header_refresh_on_save.test.js` 추가 및 채널 관련 테스트 보완

## 테스트
- 로컬 `npm test` 실행: 대부분 통과했음(≈265 통과), 다만 워크스페이스 UI 관련 6개 테스트가 실패(이미지 드래그/드롭·썸네일·액션 버튼 등).
- 빌드: `npm run build` 성공(경고만 존재)

## 검증 체크리스트 (리뷰어)
1. CI 통과 확인
2. 브라우저 수동 스모크: `npm run build` → 확장 새로고침 → 로그인/로그아웃 → 채널 추가/수정/삭제 → 헤더/대시보드의 즉시 반영 확인

## 관련 이슈
- #14: "로그아웃 후 로그인 시 채널 id가 변함" — 본 PR에서 통합적으로 해결

---

(이 본문을 GitHub PR에 붙여넣어서 사용하세요.)