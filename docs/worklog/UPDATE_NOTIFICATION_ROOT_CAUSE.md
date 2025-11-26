# 업데이트 알림 중복 표시 실질적 원인 분석

## 📋 문제 상황

"Content Pilot이 업데이트되었습니다. 원활한 사용을 위해 페이지를 새로고침해주세요." 메시지가 실제 업데이트 없이도 계속 표시됨.

## 🔍 실질적 원인 분석

### 1. **서비스 워커 생명주기 문제**

Chrome Extension의 Service Worker는 다음과 같은 이유로 자주 재시작됩니다:

1. **비활성 상태 종료**: 30초 이상 비활성 상태면 Chrome이 자동으로 종료
2. **메모리 절약**: Chrome이 메모리 절약을 위해 종료
3. **에러 발생**: 서비스 워커에서 에러 발생 시 자동 재시작
4. **실제 업데이트**: 확장 프로그램이 실제로 업데이트됨

### 2. **`onDisconnect` 이벤트의 한계**

```javascript
port.onDisconnect.addListener(() => {
  // 이 리스너는 다음 경우 모두에서 발생:
  // 1. 실제 업데이트
  // 2. 서비스 워커 재시작 (비활성 상태 종료)
  // 3. 서비스 워커 에러로 인한 재시작
  // 4. 확장 프로그램 삭제
  // 5. Chrome이 메모리 절약을 위해 종료
});
```

**문제점**:
- 실제 업데이트와 단순 재시작을 구분하지 못함
- `chrome.runtime.lastError`를 확인하지 않음
- `chrome.runtime.onInstalled` 이벤트와 연동하지 않음

### 3. **여러 탭에서 동시 실행**

각 탭마다 `setupExtensionConnection()`이 독립적으로 실행되므로:
- 탭 A에서 연결이 끊어지면 알림 표시
- 탭 B에서도 연결이 끊어지면 또 알림 표시
- 각 탭이 독립적으로 알림을 표시함

### 4. **에러 메시지 미확인**

`chrome.runtime.lastError`를 확인하지 않아:
- "message port closed" (정상 종료)와 실제 에러를 구분하지 못함
- 실제 업데이트가 아닌 경우에도 알림 표시

## ✅ 해결 방법

### 1. **실제 업데이트 여부 확인**

```javascript
// background.js
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update") {
    // 업데이트 플래그 설정
    chrome.storage.local.set({
      extension_updated: true,
      extension_updated_time: Date.now()
    });
  }
});
```

### 2. **에러 메시지 확인**

```javascript
// content.js
port.onDisconnect.addListener(() => {
  const error = chrome.runtime.lastError;
  
  // "message port closed"는 정상적인 연결 종료
  if (error && error.message && error.message.includes("message port closed")) {
    Logger.debug("정상적인 연결 종료 (서비스 워커 재시작)");
    return; // 알림 표시하지 않음
  }
  
  // 실제 업데이트 여부 확인
  chrome.storage.local.get(['extension_updated'], (result) => {
    if (!result.extension_updated) {
      // 업데이트 플래그가 없으면 단순 재시작
      return;
    }
    
    // 업데이트 플래그 제거 (한 번만 알림)
    chrome.storage.local.remove(['extension_updated']);
    
    // 알림 표시
    showConfirmationToast(...);
  });
});
```

### 3. **확장 프로그램 존재 여부 확인**

```javascript
try {
  const extensionId = chrome.runtime.id;
  if (!extensionId) {
    // 확장 프로그램이 삭제된 경우
    return;
  }
} catch (e) {
  // chrome.runtime.id 접근 실패 = 확장 프로그램 제거됨
  return;
}
```

## 📊 개선 효과

### Before (문제)
- 서비스 워커가 재시작될 때마다 알림 표시
- 실제 업데이트가 아닌 경우에도 알림 표시
- 여러 탭에서 중복 알림 표시

### After (개선)
- ✅ 실제 업데이트인 경우에만 알림 표시
- ✅ 서비스 워커 재시작은 무시
- ✅ 에러 메시지 확인으로 정확한 감지
- ✅ 업데이트 플래그로 한 번만 알림 표시

## 🔧 추가 개선 사항

### 1. **타임아웃 설정**

업데이트 플래그에 타임아웃을 설정하여 오래된 플래그는 무시:

```javascript
chrome.storage.local.get(['extension_updated', 'extension_updated_time'], (result) => {
  const now = Date.now();
  const updatedTime = result.extension_updated_time || 0;
  
  // 1시간 이내의 업데이트만 유효
  if (now - updatedTime > 60 * 60 * 1000) {
    return; // 오래된 플래그는 무시
  }
  
  // 알림 표시
});
```

### 2. **브로드캐스트 메시지**

모든 탭에 업데이트 알림을 브로드캐스트하여 중복 방지:

```javascript
// background.js
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "update") {
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach((tab) => {
        chrome.tabs.sendMessage(tab.id, {
          action: "extension_updated"
        });
      });
    });
  }
});
```

## 📝 관련 파일

- `content.js`: 연결 모니터링 및 알림 표시
- `background.js`: 업데이트 감지 및 플래그 설정
- `js/utils.js`: `showConfirmationToast` 함수

## 🎯 결론

**실질적 원인**: 서비스 워커의 정상적인 재시작을 실제 업데이트로 오인하여 알림을 표시함.

**해결 방법**: 
1. `chrome.runtime.onInstalled` 이벤트와 연동하여 실제 업데이트만 감지
2. `chrome.runtime.lastError` 확인하여 정상 종료와 에러 구분
3. 업데이트 플래그를 사용하여 한 번만 알림 표시

