# Firebase Database 보안 규칙 강화 가이드

## 현재 상황

현재 Firebase Database는 REST API를 사용하고 있으며, Google OAuth Access Token을 사용하여 인증하고 있습니다.

## 보안 규칙 설정

Firebase Console에서 다음 보안 규칙을 설정해야 합니다:

```json
{
  "rules": {
    "channels": {
      "$userId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "kanban": {
      "$userId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "scraps": {
      "$userId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "thumbnail_images": {
      "$userId": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    },
    "canvases": {
      ".read": true,
      ".write": true
    }
  }
}
```

**참고**: Service Worker 환경에서는 Firebase Auth가 제한적이므로, 현재는 인증된 사용자(`auth != null`)만 접근 가능하도록 설정합니다. 사용자별 데이터 분리는 애플리케이션 레벨에서 `$userId` 경로를 통해 처리됩니다.

## 보안 규칙 설명

### 사용자별 데이터 보호
- `channels`, `kanban`, `scraps`, `thumbnail_images`: 인증된 사용자만 접근 가능
  - `auth != null`: Firebase Auth로 인증된 사용자만 접근 가능
  - 사용자별 데이터 분리는 애플리케이션 레벨에서 `$userId` 경로를 통해 처리됩니다
  - **주의**: Service Worker 환경에서는 Firebase Auth가 제한적이므로, 현재는 기본 인증 검사만 수행합니다

### 공개 데이터
- `canvases`: 모든 사용자가 읽고 쓸 수 있음
  - 다른 프로그램과 공유되는 데이터 경로
  - 공개 설정이 의도된 동작입니다

## 임시 보안 규칙 (개발용)

개발 중에는 다음 규칙을 사용할 수 있습니다 (프로덕션에서는 사용하지 마세요):

```json
{
  "rules": {
    ".read": "auth != null",
    ".write": "auth != null"
  }
}
```

## 주의사항

⚠️ **`canvases` 경로는 현재 공개로 설정되어 있습니다.**
- 모든 사용자가 읽고 쓸 수 있습니다.
- **다른 프로그램과 공유되는 데이터 경로입니다.**
- 공개 설정이 의도된 동작입니다 (다른 프로그램과의 호환성을 위해).
- 민감한 데이터가 포함되지 않도록 주의하세요.

### `canvases` 경로를 사용자별로 제한하려면:

다른 프로그램과 공유하지 않는 경우, 다음 규칙을 사용할 수 있습니다:

```json
"canvases": {
  "$userId": {
    ".read": "$userId === auth.uid || $userId === auth.token.email",
    ".write": "$userId === auth.uid || $userId === auth.token.email"
  }
}
```

또는 인증된 사용자만 접근 가능하도록:

```json
"canvases": {
  "$canvasId": {
    ".read": "auth != null",
    ".write": "auth != null && (data.child('ownerId').val() === auth.uid || !data.exists())"
  }
}
```

**참고**: 다른 프로그램과의 호환성을 위해 공개 설정을 유지해야 하는 경우, 현재 설정을 그대로 사용하세요.

## 완전한 Firebase Auth 통합 (권장)

완전한 Firebase Auth 통합을 위해서는:

1. **백엔드 서버 필요**: Chrome Extension의 Access Token을 ID Token으로 변환하는 서버가 필요합니다.
2. **Firebase Admin SDK**: 백엔드에서 Firebase Admin SDK를 사용하여 Custom Token을 생성합니다.
3. **Custom Token 발급**: 사용자가 로그인할 때 Custom Token을 발급받아 Firebase에 로그인합니다.

## 현재 구현 상태

- ✅ 토큰 마스킹 완료
- ✅ Firebase Auth 모듈 추가 완료
- ⚠️ Firebase Database 보안 규칙 설정 필요 (Firebase Console에서 수동 설정)
- ⚠️ 완전한 Firebase Auth 통합을 위해서는 백엔드 서버 필요

## 보안 규칙 테스트

1. Firebase Console → Realtime Database → Rules에서 위 규칙을 설정합니다.
2. 로그인하지 않은 상태에서 DB URL로 직접 접근 시도:
   ```
   https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app/channels.json
   ```
3. "Permission Denied" 오류가 반환되어야 합니다.

