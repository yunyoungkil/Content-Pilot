---
title: 워크스페이스 종료 시 데이터 로드 실패 (Data load failure on workspace exit)
labels: bug, high-priority
assignees: yunyoungkil
---

## 🐛 Bug Report

### 설명 (Description)
워크스페이스 모드에서 대시보드(칸반 보드)로 돌아갈 때, 간헐적으로 데이터 로드가 완료되지 않고 "로딩 중..." 상태에서 멈추는 현상이 발생합니다.
로그 상으로는 `get_kanban_data` 요청이 발생하지만 UI가 갱신되지 않습니다.

### 재현 방법 (Steps to Reproduce)
1. 워크스페이스 모드 진입
2. '대시보드로 돌아가기' 버튼 클릭
3. 네트워크 상태가 불안정하거나 컨텍스트 전환이 빠를 때 간헐적으로 발생

### 원인 (Root Cause)
`js/ui/kanbanMode.js`의 `loadKanbanData` 함수에서 초기 요청이 실패하거나 응답이 지연될 경우 재시도(retry) 로직이 실행됩니다.
하지만 이 재시도 로직에서 `chrome.runtime.sendMessage`를 호출할 때, 응답을 받아 UI를 갱신하는 콜백 함수(`updateKanbanUI`)가 누락되어 있었습니다.
이로 인해 데이터는 받아오지만 화면은 여전히 로딩 상태로 남게 됩니다.

### 해결 방안 (Fix)
재시도 로직에도 콜백 함수를 추가하여 데이터 수신 시 `updateKanbanUI`가 호출되도록 수정해야 합니다.
