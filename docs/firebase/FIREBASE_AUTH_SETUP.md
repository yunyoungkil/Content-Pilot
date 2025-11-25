# Firebase Auth 설정 가이드

## `auth/configuration-not-found` 오류 해결

이 오류는 Firebase Console에서 Google Sign-in Provider가 제대로 설정되지 않았을 때 발생합니다.

### 해결 방법

1. **Firebase Console 접속**
   - https://console.firebase.google.com 접속
   - 프로젝트 선택: `content-pilot-7eb03`

2. **Authentication 설정**
   - 왼쪽 메뉴에서 "Authentication" 클릭
   - "Sign-in method" 탭 클릭

3. **Google Sign-in Provider 활성화**
   - "Google" 제공업체 클릭
   - "사용 설정" 토글을 켜기
   - **Web client ID** 입력:
     ```
     670273757107-180d6ap7makb2ch4nttomglavsgmkmtq.apps.googleusercontent.com
     ```
   - **Web client secret** 입력:
     - Google Cloud Console (https://console.cloud.google.com) 접속
     - 프로젝트 선택
     - "API 및 서비스" > "사용자 인증 정보" 이동
     - OAuth 2.0 클라이언트 ID에서 Client Secret 확인
   - "저장" 클릭

4. **확인**
   - Google Sign-in Provider가 "사용 설정됨" 상태인지 확인

---

## Access Token vs ID Token 문제

### 현재 상황

- `chrome.identity.getAuthToken()`은 **Access Token**을 반환합니다.
- Firebase Auth는 **ID Token**을 필요로 합니다.
- `GoogleAuthProvider.credential(null, accessToken)`은 작동하지 않을 수 있습니다.

### 해결 방법

#### 옵션 1: Firebase Console 설정 확인 (먼저 시도)

위의 Firebase Console 설정을 완료한 후 다시 시도해보세요.

#### 옵션 2: ID Token 획득 (백엔드 서버 필요)

Access Token을 ID Token으로 변환하려면 백엔드 서버가 필요합니다:

```javascript
// 백엔드 서버 예시 (Node.js)
const { OAuth2Client } = require('google-auth-library');

app.post('/exchange-token', async (req, res) => {
  const { accessToken } = req.body;
  
  // Access Token으로 사용자 정보 가져오기
  const oauth2Client = new OAuth2Client();
  oauth2Client.setCredentials({ access_token: accessToken });
  
  // ID Token 획득 (복잡한 과정)
  // ...
  
  res.json({ idToken });
});
```

#### 옵션 3: Custom Token 사용 (Firebase Admin SDK)

Firebase Admin SDK를 사용하여 Custom Token 생성:

```javascript
// 백엔드 서버 (Node.js)
const admin = require('firebase-admin');

app.post('/create-custom-token', async (req, res) => {
  const { googleUserId } = req.body;
  
  const customToken = await admin.auth().createCustomToken(googleUserId);
  res.json({ customToken });
});
```

그리고 클라이언트에서:

```javascript
import { signInWithCustomToken } from 'firebase/auth';

const customToken = await fetch('/create-custom-token', {
  method: 'POST',
  body: JSON.stringify({ googleUserId: userInfo.id })
}).then(r => r.json());

await signInWithCustomToken(firebaseAuth, customToken.customToken);
```

#### 옵션 4: 보안 규칙 조정 (임시 해결책)

Firebase Auth 없이도 작동하도록 보안 규칙 수정:

```json
{
  "rules": {
    "channels": {
      "$userId": {
        ".read": true,
        ".write": true
      }
    }
  }
}
```

**주의**: 프로덕션에서는 사용하지 마세요!

---

## 현재 구현 상태

- ✅ Google Access Token 획득: `chrome.identity.getAuthToken()` 사용
- ❌ Firebase Auth 로그인: `auth/configuration-not-found` 오류 발생
- ❌ Firebase Database 보안 규칙: `auth != null` 요구로 인해 `permission_denied` 발생

---

## 권장 사항

1. **즉시**: Firebase Console에서 Google Sign-in Provider 설정 확인
2. **단기**: 설정 후에도 작동하지 않으면 보안 규칙을 임시로 조정
3. **장기**: 백엔드 서버 구축하여 Custom Token 또는 ID Token 획득

