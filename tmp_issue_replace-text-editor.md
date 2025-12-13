# 텍스트 에디터 교체

## 요약
현재 프로젝트에서 사용 중인 텍스트/리치 에디터(Quill 및 TUI 관련 라이브러리)를 TipTap 기반 에디터와 TipTap UI로 전환하여 유지보수, 기능, 접근성, 퍼포먼스를 개선합니다. TipTap UI를 기본 툴바/컴포넌트 스타일로 사용합니다.

## 동기
- 기존 에디터 라이브러리는 커스텀 요구사항(이미지 업로드, 워크스페이스 draft, 복사/붙여넣기, 마크다운 호환 등)을 확장하기 어려움
- 새로운 에디터는 더 나은 접근성, 모바일 UX, 플러그인/확장성, 커스텀 툴바/스토리지 통합을 제공
- 장기적으로 유지보수(보안/버그) 비용 절감

## 요구사항
- 마크다운 및 리치텍스트(Rich Text) 전환을 지원
- 이미지 업로드/크롭/리사이즈 및 스토리지 업로드 플로우와 통합
- 자동 저장/드래프트(undo/redo)과 workspace Draft와 호환
- 접근성(ARIA) 및 모바일/터치 조작 지원
- 커스텀 플러그인(예: SEO 메타 입력, publishInfo 자동화) 확장성
- 기존 저장 포맷(Quill delta, 채널 콘텐츠 구조 등)과의 데이터 마이그레이션 계획 포함

## Acceptance Criteria (완료 기준)
- 에디터가 주요 작성 화면(아이디어/칸반/게시물 편집)에 정상적으로 동작
- 기존 데이터(Quill delta)가 새 에디터로 변환되어 문제 없이 표시되고 편집 가능
- 이미지 업로드 + 썸네일, 워크스페이스 draft 저장 흐름 정상 동작
- 중요 단위 테스트(에디터 렌더링, 저장, 마이그레이션)가 작성되어 CI에서 통과

## 계획
1. 옵션 검토: TipTap(프로세미어 기반), Slate, ProseMirror, Editor.js 등 후보 선정 및 평가
2. POC: TipTap 기반 POC 구현(가장 유연한 커스텀/플러그인 제공), Quill 데이터 예시 몇 건을 변환해본다
3. API 추상화: 현재 `addIdeaToKanban` / `update` 호출이 사용하는 포맷을 추상화하여 에디터 교체를 최소한의 변경으로 진행
4. 데이터 마이그레이션: Quill delta → 새 포맷 변환 유틸 제작 + Dry-run 검증 및 Rollback 계획
5. UI/UX: 툴바 구성(마크다운, 이미지, 링크, publishInfo), 모바일 레이아웃 테스트
6. 테스트: 단위/통합/E2E 테스트 추가
7. 점진적 출시: 기능 플래그로 단계적 전환, 필요 시 기존 에디터 잔존 옵션 제공

## 마이그레이션 고려사항
- Quill delta를 저장하고 있는 DB 필드(kanban, channel_content 등) 포맷 확인
- 변환기 유틸을 만든 뒤, Dry-run으로 검사하고 배치 마이그레이션 진행
- 변환 실패 시 롤백 전략(백업/서버 스냅샷 또는 변환된 내용에 대해 재시도 옵션)

## Labels
- enhancement
- ui
- tech-debt

## Assignee
- @yunyoungkil

## 참고
- 현재 코드베이스에서 `lib/quill.js`, `quill.snow.css`, `tui-image-editor` 사용 부분을 확인. `README.md`에 영향도 등 기록하면 좋음.

---

Please run the following command in repository root to open a GitHub issue using the GitHub CLI:

```bash
gh issue create --title "텍스트 에디터 교체" --body "$(sed -n '1,999p' tmp_issue_replace-text-editor.md | sed 's/\"/\\\"/g')" --label enhancement,ui,tech-debt --assignee yunyoungkil
```

Or using curl (replace GITHUB_TOKEN with a valid token):

```bash
curl -X POST -H "Authorization: token GITHUB_TOKEN" -H "Accept: application/vnd.github.v3+json" https://api.github.com/repos/yunyoungkil/Content-Pilot/issues -d '{"title":"텍스트 에디터 교체","body":"REPLACE_WITH_CONTENT","labels":["enhancement","ui","tech-debt"],"assignees":["yunyoungkil"]}'
```
