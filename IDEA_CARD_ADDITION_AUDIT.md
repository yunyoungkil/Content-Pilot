# 아이디어 카드 추가 로직 점검 보고서

## 📋 점검 개요

아이디어 카드 추가 로직의 각 경로를 점검하고 발견된 문제점과 개선 사항을 정리했습니다.

## 🔍 점검 항목

### 1. 칸반 보드 직접 추가 (`kanbanMode.js`)

**코드 위치**: `js/ui/kanbanMode.js:886` (`submitCard`)

**현재 구현**:
- ✅ 제목 검증 (클라이언트 측)
- ✅ 채널 ID 전송
- ✅ 상태 지정 가능
- ❌ 에러 처리 불완전 (`response?.error`만 확인)
- ❌ 중복 검사 없음 (직접 추가는 `origin.postUrl`이 없음)

**문제점**:
1. 중복 검사가 URL 기반만 지원되어 직접 추가한 카드는 중복 검사 불가
2. `DUPLICATE_FOUND` 에러 코드에 대한 특별 처리 없음
3. 서버 측 제목 검증 없음

### 2. 대시보드에서 추가 (`dashboardMode.js`)

**코드 위치**: `js/ui/dashboardMode.js:1415` (`ideaForKanban`)

**현재 구현**:
- ✅ 콘텐츠 데이터를 아이디어 형식으로 변환
- ✅ 채널 ID 전송
- ✅ UI 업데이트 (버튼 제거, 배지 추가)
- ❌ 중복 검사 실패 시 사용자 피드백 부족
- ❌ `DUPLICATE_FOUND` 에러 처리 없음

**문제점**:
1. 중복 검사 실패 시 단순 에러 메시지만 표시
2. 중복된 카드로 이동하거나 상세 보기 기능 없음

### 3. AI 아이디어 추가 (`dashboardMode.js`)

**코드 위치**: `js/ui/dashboardMode.js:1527`

**현재 구현**:
- ✅ AI 분석 결과에서 아이디어 생성
- ✅ 채널 ID 전송
- ✅ 캐시 관리
- ❌ 에러 처리 불완전

### 4. 스크랩에서 변환 (`scrapbookMode.js`)

**코드 위치**: `js/ui/scrapbookMode.js:729`

**현재 구현**:
- ✅ 스크랩 데이터를 아이디어 형식으로 변환
- ✅ 채널 ID 전송
- ✅ 태그 추가 (`#스크랩-전환`)
- ❌ `origin.postUrl`이 `sourceUrl`로 저장되어 중복 검사 불가능

**문제점**:
1. `sourceUrl`은 `origin.postUrl`과 다른 필드명
2. 중복 검사가 `origin.postUrl`만 확인하므로 스크랩 변환은 중복 검사 안 됨

### 5. 백엔드 처리 (`background.js`)

**코드 위치**: `background.js:379` (`add_idea_to_kanban`)

**현재 구현**:
- ✅ 메시지 데이터 파싱
- ✅ 중복 검사 (URL 기반)
- ✅ 설명 요약 (200자 이상)
- ✅ Firebase 저장
- ❌ URL 인덱스 업데이트 누락
- ❌ 제목 검증 없음
- ❌ 에러 메시지 불친절

**문제점**:
1. **URL 인덱스 업데이트 누락**: 카드 추가 후 `updateUrlIndex`를 호출하지 않아 중복 검사가 제대로 작동하지 않을 수 있음
2. **제목 검증 없음**: 빈 제목이나 너무 긴 제목에 대한 검증 없음
3. **에러 메시지**: `DUPLICATE_FOUND` 시 단순 에러 코드만 반환, 사용자 친화적 메시지 없음

## 🐛 발견된 버그

### 버그 1: URL 인덱스 업데이트 누락
**심각도**: 높음
**영향**: 중복 검사가 제대로 작동하지 않음

**현재 코드**:
```javascript
// background.js:397
const newKey = await push(path, { ...ideaData, createdAt: Date.now(), channelId: msg.channelId });
return { success: true, firebaseKey: newKey };
```

**문제**: `updateUrlIndex`를 호출하지 않아 URL 인덱스가 업데이트되지 않음

### 버그 2: 스크랩 변환 시 중복 검사 불가
**심각도**: 중간
**영향**: 스크랩에서 변환한 아이디어는 중복 검사가 안 됨

**현재 코드**:
```javascript
// scrapbookMode.js:747
sourceUrl: scrap.url || '', // origin.postUrl이 아님!
```

**문제**: `sourceUrl` 필드를 사용하지만 중복 검사는 `origin.postUrl`만 확인

### 버그 3: 에러 처리 불일치
**심각도**: 낮음
**영향**: 사용자 경험 저하

**현재 코드**:
```javascript
// background.js:386
if (dupCheck.exists) return { success: false, code: "DUPLICATE_FOUND", cardInfo: dupCheck };
```

**문제**: UI에서 `response?.error`만 확인하므로 `code`와 `cardInfo`를 활용하지 않음

## 🔧 개선 사항

### 개선 1: URL 인덱스 업데이트 추가
카드 추가 후 `updateUrlIndex`를 호출하여 중복 검사가 제대로 작동하도록 수정

### 개선 2: 제목 검증 추가
서버 측에서 제목 검증 추가 (빈 제목, 너무 긴 제목 등)

### 개선 3: 에러 메시지 개선
`DUPLICATE_FOUND` 에러 시 사용자 친화적 메시지와 중복된 카드 정보 제공

### 개선 4: 스크랩 변환 시 origin.postUrl 사용
스크랩 변환 시 `sourceUrl` 대신 `origin.postUrl` 사용하여 중복 검사 가능하도록 수정

### 개선 5: 제목 기반 중복 검사 추가
URL이 없는 직접 추가 카드에 대해서도 제목 기반 중복 검사 추가

## 📝 권장 수정 사항

1. **즉시 수정 필요**:
   - URL 인덱스 업데이트 추가
   - 스크랩 변환 시 `origin.postUrl` 사용

2. **단기 개선**:
   - 에러 메시지 개선
   - 제목 검증 추가

3. **장기 개선**:
   - 제목 기반 중복 검사
   - 중복된 카드로 이동 기능

