title: "이슈 #16 — 재로그인/저장으로 인한 채널 platformType 덮어쓰기 버그"

# 이슈 요약
- 재로그인(또는 UI 재로딩) 후 `Save All`로 채널 목록을 다시 저장할 때 일부 채널의 `platformType`이 누락/덮어써지는 문제가 있었습니다.

# 원인
- 프론트엔드에서 서버 응답 내 `platformType`이 누락되는 경우 기존 값을 보존하지 않고 전송 또는 기본값으로 덮어써서 발생했습니다.
- 백엔드에서 Firebase `set()`으로 전체 노드를 덮어쓰기 때문에 누락된 필드가 영구적으로 삭제되었습니다.

# 조치 및 결과
- 프런트엔드: `Apply`는 로컬 상태만 갱신하도록 변경했고, `Save All`에서는 보존 가능한 `platformType` 값을 포함하도록 방어 로직을 추가했습니다.
- 백엔드: 기존 DB 데이터를 읽어 들어온 페이로드와 병합(누락 필드 보존)한 뒤 `set()`을 수행하도록 변경했습니다.
- 테스트: `test/channelMode.*`와 `test/background.save_channels_and_key.test.js`를 추가/수정하여 회귀를 방지했습니다.

# 커밋/PR
- 커밋: `e77c088` (Master에 병합 및 푸시 완료)
- PR: `fix/channel-platform-overwrite` → Master (머지 완료)

# 상태
- 해결(완료). GitHub 이슈를 닫으시면 됩니다.

# 참조 문서
- `docs/bugs/relogin_platform_overwrite.md`

--
자동 생성된 이슈 문서입니다.
