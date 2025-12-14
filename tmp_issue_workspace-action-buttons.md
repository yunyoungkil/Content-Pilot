요약:
- TipTap POC 병합(프론트엔드 에디터 교체) 이후 워크스페이스 액션 버튼 UI 동작을 정리하고 개선할 필요가 있습니다. 주요 포인트는 Generate/Regenerate/Delete 버튼 전환 로직, 썸네일 버튼 렌더링 조건, 툴바의 버튼 순서 및 접근성입니다.

현재 문제/배경:
- `generate` 버튼과 `regenerate`/`delete` 버튼 전환이 일부 시나리오에서 일관적이지 않은 것으로 보입니다 (예: placeholder/링크-only/메타-전용 초안).
- 썸네일 버튼(`regenerate-thumbnail`) 렌더 조건이 복잡하여 예상치 못한 경우 버튼이 렌더되지 않거나 중복됩니다.
- 에디터 툴바에서 링크 버튼의 위치(현재 변경됨)를 검증하고 Blockquote 앞에 위치하도록 보장해야 합니다.
- 기존 PR에서 Bold 아이콘 stroke 변경, Blockquote 스타일 업데이트, toolbar 순서 변경(링크 버튼 앞) 등이 적용되었음(PR #23, 커밋 087e78a). 테스트 안정화 커밋(458d86d)이 추가됨.

재현 방법 예시:
1. 워크스페이스에서 아이디어를 열어 초안 상태를 다양한 케이스(빈/placeholder, 링크-only, 실제 텍스트 포함 초안)로 시뮬레이션합니다.
2. Generate 버튼이 올바른 경우에만 나타나고, 의미있는 초안이 존재하면 Regenerate + Delete 버튼으로 대체되는지 확인합니다.
3. 썸네일 관련(regenerate-thumbnail) 버튼이 hasDraft/hasThumbnailUrls 조건에 따라 정확히 렌더링되는지 확인합니다.
4. 툴바에서 Link 버튼이 Blockquote 버튼보다 앞에 있는지 확인합니다.

완료 기준:
- 빈/플레이스홀더 또는 링크-only 초안은 "draft 존재"로 취급하지 않음(Generate 버튼 유지).
- 의미있는 초안에는 Generate → Regenerate + Delete로 전환됨(정확한 버튼 셀렉터 존재).
- 썸네일/재생성 버튼은 `hasDraft`/`hasThumbnailUrls` 조건에 따라 정확하게 렌더링됨.
- 툴바의 버튼 순서가 디자인/사양과 일치함(링크 버튼이 Blockquote 앞에 위치).
- 관련 유닛/UI 테스트(`test/workspaceMode.*`)가 추가/갱신되어 로컬 및 CI에서 통과함.

작업 항목(체크리스트):
- [ ] UI/UX 검토: 디자인/순서/아이콘 스타일 가이드와 일치하는지 확인
- [ ] `renderWorkspace`/`updateWorkspaceActionButtons` 동작 점검 및 리팩터
- [ ] 썸네일 버튼 렌더링 조건 정리 및 관련 테스트 보강
- [ ] 툴바 순서(링크/blockquote) 정합성 확인 및 접근성(ARIA) 보강
- [ ] 테스트(유닛/통합) 추가/갱신 및 CI 통과

참고/연관 변경 사항:
- PR #23 (feat/tiptap-poc) — TipTap POC 병합
- 커밋: 087e78a (UI 변경 관련), 458d86d (테스트 안정화)
- 관련 파일: `js/ui/workspaceMode.js`, `editor.html`, `editor.js`, `test/setup.js`, `test/workspaceMode.*`

레이블: enhancement, ui, tests
담당자: @yunyoungkil
