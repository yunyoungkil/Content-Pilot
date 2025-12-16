---
title: "버그: 아이디어 추가 시 SEO 제목에 아이디어 제목이 중복으로 추가됨"
status: draft
labels:
  - bug
  - tests-needed
assignee: undefined
branch: bugfix/seo-title-adds-idea-title
---

요약
----
아이디어를 추가하면 SEO 제목(`publishInfo.seoTitle`)에 아이디어 제목이 불필요하게 덧붙여집니다.

재현 방법
--------
1. 워크스페이스에서 새 아이디어 생성
2. 아이디어 저장 시 SEO 제목 필드 확인

기대 동작
-------
SEO 제목은 자동 생성되거나 빈 값이면 자동으로 설정되지만, 아이디어 제목이 중복으로 추가되면 안 됩니다.

의심되는 파일
-----------
- `js/ui/workspaceMode.js` (제목/저장 관련 로직)

우선 조치
-------
- 브랜치 `bugfix/seo-title-adds-idea-title` 생성 및 체크아웃 (완료)
- 해당 브랜치에서 회귀 테스트(새 케이스) 추가 후 버그 수정 구현

추가 메모
------
아래 명령으로 동일한 이슈를 직접 GitHub에 생성할 수 있습니다 (로컬에서 `gh`가 설치되어 있고 로그인되어 있을 경우):

```bash
gh issue create --title "버그: 아이디어 추가 시 SEO 제목에 아이디어 제목이 중복으로 추가됨" \
  --body "요약: 아이디어를 추가하면 SEO 제목(publishInfo.seoTitle)에 아이디어 제목이 불필요하게 덧붙여집니다.\n\n재현 방법:\n1. 워크스페이스에서 새 아이디어 생성\n2. 아이디어 저장 시 SEO 제목 필드를 확인\n\n기대 동작: SEO 제목은 아이디어 제목이 중복으로 추가되지 않아야 합니다.\n\n의심되는 파일: js/ui/workspaceMode.js\n브랜치: bugfix/seo-title-adds-idea-title\n" \
  --label bug --label "tests-needed"
```

원하시면 제가 이 브랜치에서 테스트를 추가하고 버그 수정을 바로 진행하겠습니다.
