// js/services/firebaseService.js
// Firebase Storage 관련 서비스

// Firebase는 background.js에서 직접 로드됩니다.
// ES Modules에서는 importScripts()를 사용할 수 없으므로,
// firebaseService.js에서는 Firebase가 이미 로드되어 있다고 가정합니다.

export const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL:
    "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:12dc37c0bfd2fb1ac05320",
};

/**
 * Base64 데이터 URL을 Blob으로 변환하는 헬퍼 함수
 * @param {string} dataUrl - Base64 데이터 URL (예: "data:image/png;base64,...")
 * @returns {Blob} Blob 객체
 */
export function dataURLtoBlob(dataUrl) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

/**
 * Firebase Storage에 이미지를 업로드하고 다운로드 URL을 반환하는 함수
 * Firebase Storage REST API를 사용 (Service Worker 환경 호환)
 * @param {string} dataUrl - Base64 데이터 URL
 * @param {string} path - Storage 경로 (예: "thumbnails/userId/timestamp.png")
 * @param {string} userId - 사용자 ID
 * @returns {Promise<string>} 다운로드 URL
 */
export async function uploadImageToFirebaseStorage(dataUrl, path, userId) {
  try {
    // Base64 데이터 URL을 Blob으로 변환
    const blob = dataURLtoBlob(dataUrl);
    
    // Google OAuth 토큰 가져오기 (Firebase Storage 인증용)
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: false }, (authToken) => {
        if (chrome.runtime.lastError) {
          // interactive: false로 실패하면 interactive: true로 재시도
          chrome.identity.getAuthToken({ interactive: true }, (authToken2) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(authToken2);
            }
          });
        } else {
          resolve(authToken);
        }
      });
    });
    
    // Firebase Storage REST API를 사용하여 업로드
    const bucket = firebaseConfig.storageBucket;
    const encodedPath = encodeURIComponent(path);
    
    // 업로드 엔드포인트
    const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o?uploadType=media&name=${encodedPath}`;
    
    console.log('[Firebase Storage] 업로드 시작:', path);
    console.log('[Firebase Storage] 파일 크기:', blob.size, 'bytes');
    console.log('[Firebase Storage] 버킷:', bucket);
    
    // Blob을 Firebase Storage에 업로드
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': blob.type || 'image/png'
      },
      body: blob
    });
    
    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({}));
      const errorMessage = errorData.error?.message || uploadResponse.statusText;
      
      // 403 오류인 경우 상세한 오류 정보 로깅
      if (uploadResponse.status === 403) {
        console.error('[Firebase Storage] 403 Permission denied 오류 상세:');
        console.error('[Firebase Storage] - 오류 메시지:', errorMessage);
        console.error('[Firebase Storage] - 전체 오류 응답:', errorData);
        console.error('[Firebase Storage] - 업로드 경로:', path);
        console.error('[Firebase Storage] - 버킷:', bucket);
        console.error('[Firebase Storage] ⚠️ Firebase Storage 보안 규칙을 확인하세요.');
        console.error('[Firebase Storage] ⚠️ Google OAuth 토큰이 Firebase Storage에 접근할 수 있는 권한이 있는지 확인하세요.');
        console.error('[Firebase Storage] 💡 해결 방법:');
        console.error('[Firebase Storage]    1. Firebase Console > Storage > Rules에서 업로드 권한 확인');
        console.error('[Firebase Storage]    2. 또는 Firebase Authentication을 사용하여 Firebase ID 토큰 발급');
        console.error('[Firebase Storage]    3. 현재는 Base64 fallback으로 동작합니다.');
      }
      
      throw new Error(`Firebase Storage 업로드 실패 (${uploadResponse.status}): ${errorMessage}`);
    }
    
    const uploadResult = await uploadResponse.json();
    console.log('[Firebase Storage] 업로드 완료:', uploadResult);
    
    // 다운로드 URL 생성
    const downloadURL = `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodedPath}?alt=media&token=${uploadResult.downloadTokens || token}`;
    
    // Firebase Realtime Database에 메타데이터 저장 (참고용)
    // firebase는 전역 변수로 사용 (manifest.json의 importScripts로 로드됨)
    if (typeof firebase !== 'undefined' && firebase.database) {
      const timestamp = Date.now();
      const db = firebase.database();
      const imageDataRef = db.ref(`thumbnail_images/${userId}/${timestamp}`);
      const storagePath = `gs://${bucket}/${path}`;
      
      await imageDataRef.set({
        path: path,
        storagePath: storagePath,
        downloadURL: downloadURL,
        timestamp: timestamp,
        size: blob.size
      });
    } else {
      console.warn('[Firebase Storage] Firebase가 로드되지 않아 메타데이터를 저장하지 않습니다.');
    }
    
    console.log('[Firebase Storage] ✅ 이미지 업로드 및 메타데이터 저장 완료');
    console.log('[Firebase Storage] 다운로드 URL:', downloadURL);
    console.log('[Firebase Storage] Storage 경로:', storagePath);
    
    return downloadURL;
  } catch (error) {
    console.error('[Firebase Storage] 업로드 실패:', error);
    // 403 오류인 경우 추가 정보 제공
    if (error.message.includes('403') || error.message.includes('Permission denied')) {
      console.error('[Firebase Storage] 💡 403 오류 해결 방법:');
      console.error('[Firebase Storage]    - Firebase Console에서 Storage 보안 규칙 확인');
      console.error('[Firebase Storage]    - 현재는 Base64 데이터로 fallback하여 동작합니다.');
    }
    throw error;
  }
}

// firebaseConfig는 이미 7번째 줄에서 export const로 선언됨
// firebase는 importScripts로 전역 변수로 로드되므로 export 불가
// background.js에서 manifest.json의 importScripts로 로드됨

console.log('[System] firebaseService 모듈 로드 완료');

