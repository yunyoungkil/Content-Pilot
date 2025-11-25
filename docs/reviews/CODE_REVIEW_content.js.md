# 코드 리뷰: content.js

## 📋 개요
확장 프로그램 컨텍스트 무효화 감지 및 사용자 알림 로직에 대한 코드 리뷰

---

## ✅ 잘 구현된 부분

1. **이중 감지 메커니즘**
   - `chrome.runtime.connect`의 `onDisconnect` + 주기적 메시지 전송
   - 백업 메커니즘으로 안정성 향상

2. **사용자 경험 고려**
   - 자동 새로고침 제거
   - 사용자 동의 요청
   - 작성 중인 내용 보호

3. **에러 처리**
   - try-catch 블록으로 안전한 처리
   - `document.body` 존재 여부 확인

---

## ⚠️ 발견된 문제점

### 1. **중복 코드 (Critical)**
**위치**: `showReloadPrompt` 함수가 3곳에 중복 정의됨
- Line 61-110: `checkExtensionContext` 내부
- Line 299-347: `handleExtensionContextInvalidation` 내부  
- Line 552-584: `testExtensionContext` 내부

**문제**: 유지보수 어려움, 버그 수정 시 여러 곳 수정 필요

**해결 방안**: 공통 함수로 추출

### 2. **하드코딩된 시간 값**
**위치**: 
- Line 199: `timeSinceSetup < 3000` (3초)
- Line 243, 270: `timeSinceLastSuccess < 3000` (3초)
- Line 95, 154, 332, 575: `setTimeout(..., 3000)` (3초)
- Line 74, 109, 144, 159, 313, 346, 561: `setTimeout(..., 2000)` (2초)

**문제**: 매직 넘버, 변경 시 여러 곳 수정 필요

**해결 방안**: 상수로 정의
```javascript
const TIMING = {
  PAGE_RELOAD_THRESHOLD: 3000,  // 웹 페이지 새로고침 판단 임계값
  USER_SAVE_DELAY: 2000,         // 사용자 저장 시간
  RELOAD_DELAY: 3000             // 새로고침 지연 시간
};
```

### 3. **showToast duration 파라미터 오류**
**위치**: Line 141, 157
```javascript
showToast("...", 5000);  // ❌ showToast는 duration을 받지 않음
```

**문제**: `showToast` 함수는 duration 파라미터를 받지 않음 (js/utils.js 확인)

**해결 방안**: duration 파라미터 제거

### 4. **메모리 누수 가능성**
**위치**: Line 220-282
- `contextCheckInterval`이 정리되지 않을 수 있음
- `extensionPort`가 정리되지 않을 수 있음

**문제**: 페이지가 언로드될 때 interval과 port가 정리되지 않음

**해결 방안**: `beforeunload` 이벤트에서 정리

### 5. **과도한 디버깅 로그**
**위치**: 전체 파일
- 프로덕션 환경에서 불필요한 로그가 많음

**해결 방안**: 
- 개발 모드에서만 로그 출력
- 또는 로그 레벨 시스템 도입

### 6. **시간 기반 필터링의 한계**
**위치**: Line 199, 243, 270
- 3초 임계값이 모든 상황에 적합하지 않을 수 있음
- 느린 네트워크나 느린 기기에서 문제 발생 가능

**해결 방안**: 
- 더 정확한 감지 방법 고려
- 또는 사용자 설정 가능하도록

---

## 🔧 개선 제안

### 1. **공통 함수 추출**
```javascript
function createReloadPrompt() {
  return () => {
    // 공통 로직
  };
}
```

### 2. **상수 정의**
```javascript
const EXTENSION_CONTEXT_CONFIG = {
  PAGE_RELOAD_THRESHOLD_MS: 3000,
  USER_SAVE_DELAY_MS: 2000,
  RELOAD_DELAY_MS: 3000,
  PING_INTERVAL_MS: 2000
};
```

### 3. **리소스 정리**
```javascript
window.addEventListener('beforeunload', () => {
  if (contextCheckInterval) {
    clearInterval(contextCheckInterval);
  }
  if (extensionPort) {
    extensionPort.disconnect();
  }
});
```

### 4. **로깅 시스템**
```javascript
const DEBUG = false; // 또는 환경 변수로 제어

function debugLog(...args) {
  if (DEBUG) {
    console.log("[Content Pilot]", ...args);
  }
}
```

### 5. **더 정확한 감지 방법**
- `chrome.runtime.connect`의 `onDisconnect`만 사용
- 주기적 핑은 제거하거나 간격 늘리기 (5초 이상)
- 또는 `chrome.runtime.onConnect`를 background에서 사용하여 양방향 확인

---

## 📊 코드 메트릭

- **총 라인 수**: 612
- **중복 코드**: ~150 라인 (약 25%)
- **하드코딩된 값**: 7개
- **에러 처리**: 양호
- **주석**: 충분함

---

## 🎯 우선순위별 개선 사항

### High Priority
1. ✅ 중복 코드 제거
2. ✅ showToast duration 파라미터 제거
3. ✅ 메모리 누수 방지 (리소스 정리)

### Medium Priority
4. ⚠️ 하드코딩된 값 상수화
5. ⚠️ 디버깅 로그 정리

### Low Priority
6. 💡 시간 기반 필터링 개선
7. 💡 로깅 시스템 도입

---

## 📝 추가 고려사항

1. **테스트 코드 분리**: 테스트 함수들을 별도 파일로 분리 고려
2. **타입 안정성**: TypeScript 도입 고려 (선택사항)
3. **문서화**: JSDoc 주석 추가 고려

---

## ✅ 결론

전반적으로 잘 구현되었으나, 중복 코드 제거와 리소스 정리가 필요합니다.
핵심 기능은 정상 작동하지만, 유지보수성을 높이기 위한 리팩토링을 권장합니다.

