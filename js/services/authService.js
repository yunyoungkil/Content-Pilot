// js/services/authService.js
// Google OAuth 인증 관련 서비스

import { Logger } from '../utils.js';

// 토큰 만료 시간 상수 (Google OAuth 토큰은 일반적으로 1시간 유효)
const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000; // 5분 버퍼 (만료 5분 전에 갱신)
const TOKEN_DEFAULT_EXPIRY = 60 * 60 * 1000; // 기본 1시간

// 토큰 갱신 중복 호출 방지 (Promise Singleton 패턴)
let refreshTokenPromise = null;
let isRefreshing = false;

/**
 * 토큰 만료 시간을 스토리지에 저장
 * @param {string} token - Google OAuth 토큰
 * @param {number} expiryTime - 만료 시간 (밀리초, 선택사항)
 */
async function saveTokenExpiry(token, expiryTime = null) {
  const expiry = expiryTime || Date.now() + TOKEN_DEFAULT_EXPIRY;
  await chrome.storage.local.set({
    googleAuthToken: token,
    googleAuthTokenExpiry: expiry,
    googleAuthTokenIssued: Date.now(),
  });
  console.log('🔑 [Auth] 토큰 만료 시간 저장:', new Date(expiry).toLocaleString());
}

/**
 * 저장된 토큰의 유효성 검사
 * @returns {Promise<{valid: boolean, token: string|null, needsRefresh: boolean}>}
 */
export async function validateStoredToken() {
  try {
    const storage = await chrome.storage.local.get([
      'googleAuthToken',
      'googleAuthTokenExpiry',
      'googleAuthTokenIssued',
    ]);

    if (!storage.googleAuthToken) {
      return { valid: false, token: null, needsRefresh: false };
    }

    const now = Date.now();
    const expiry =
      storage.googleAuthTokenExpiry || storage.googleAuthTokenIssued + TOKEN_DEFAULT_EXPIRY;
    const timeUntilExpiry = expiry - now;

    // 만료 시간이 지났거나 곧 만료될 예정인 경우
    if (timeUntilExpiry <= TOKEN_EXPIRY_BUFFER) {
      console.log('🔑 [Auth] 토큰 만료 임박 또는 만료됨. 갱신 필요.');
      return { valid: false, token: storage.googleAuthToken, needsRefresh: true };
    }

    // 토큰이 유효한지 실제 API 호출로 검증
    try {
      const testResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${storage.googleAuthToken}` },
      });

      if (testResponse.ok) {
        console.log('🔑 [Auth] 저장된 토큰 유효성 검사 통과');
        return { valid: true, token: storage.googleAuthToken, needsRefresh: false };
      } else if (testResponse.status === 401) {
        console.log('🔑 [Auth] 저장된 토큰이 만료됨 (401 응답)');
        return { valid: false, token: storage.googleAuthToken, needsRefresh: true };
      }
    } catch (e) {
      console.warn('🔑 [Auth] 토큰 검증 중 오류:', e);
      // 네트워크 오류 등은 토큰 자체의 문제가 아닐 수 있으므로 유효하다고 간주
      return { valid: true, token: storage.googleAuthToken, needsRefresh: false };
    }

    return { valid: true, token: storage.googleAuthToken, needsRefresh: false };
  } catch (error) {
    console.error('[validateStoredToken] 오류:', error);
    return { valid: false, token: null, needsRefresh: false };
  }
}

/**
 * 토큰 갱신 (Silent Refresh) - 경합 조건 방지
 * @param {boolean} interactive - 사용자 상호작용 필요 여부
 * @returns {Promise<{success: boolean, token: string|null, error?: string}>}
 */
export async function refreshAuthToken(interactive = false) {
  // 이미 갱신 중이면 기존 Promise 반환 (Singleton 패턴)
  if (isRefreshing && refreshTokenPromise) {
    Logger.debug('🔑 [Auth] 토큰 갱신 중... 기존 요청 대기');
    return refreshTokenPromise;
  }

  // 새 갱신 프로세스 시작
  isRefreshing = true;
  refreshTokenPromise = (async () => {
    try {
      console.log('🔑 [Auth] 토큰 갱신 시도 (interactive:', interactive, ')');

      // 기존 토큰 제거 (캐시 무효화)
      const storage = await chrome.storage.local.get('googleAuthToken');
      if (storage.googleAuthToken) {
        try {
          // 토큰이 문자열인지 확인
          const tokenToRemove =
            typeof storage.googleAuthToken === 'string'
              ? storage.googleAuthToken
              : storage.googleAuthToken?.token || String(storage.googleAuthToken);

          if (tokenToRemove && typeof tokenToRemove === 'string') {
            await chrome.identity.removeCachedAuthToken({ token: tokenToRemove });
          } else {
            Logger.warn('[refreshAuthToken] 유효하지 않은 토큰 형식, 제거 건너뜀');
          }
        } catch (e) {
          Logger.warn('[refreshAuthToken] 기존 토큰 제거 실패:', e);
        }
      }

      // 새 토큰 발급
      const authToken = await new Promise((resolve, reject) => {
        chrome.identity.getAuthToken({ interactive }, (token) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(token);
          }
        });
      });

      Logger.debug('[refreshAuthToken] 토큰 타입:', typeof authToken);
      // 보안: 토큰은 최대 5자만 표시하고 나머지는 마스킹
      if (authToken && typeof authToken === 'string') {
        const masked =
          authToken.length > 5
            ? authToken.substring(0, 5) + '***' + authToken.substring(authToken.length - 3)
            : '***';
        Logger.debug('[refreshAuthToken] 토큰 (마스킹됨):', masked);
      } else {
        Logger.debug('[refreshAuthToken] 토큰 값:', authToken ? '***' : 'null');
      }

      if (!authToken) {
        throw new Error('토큰 발급 실패');
      }

      // 토큰이 문자열인지 확인하고 변환
      const token = typeof authToken === 'string' ? authToken : String(authToken);

      if (!token || token === 'undefined' || token === 'null' || token.trim() === '') {
        Logger.error('[refreshAuthToken] 유효하지 않은 토큰:', {
          originalType: typeof authToken,
          originalValue: authToken,
          convertedValue: token,
        });
        throw new Error('유효하지 않은 토큰 형식입니다.');
      }

      // 토큰 만료 시간 저장
      await saveTokenExpiry(token);

      // 사용자 정보도 함께 업데이트 (토큰이 새로 발급되었으므로)
      try {
        const userInfo = await fetchUserInfo(token);
        await chrome.storage.local.set({
          googleUserEmail: userInfo.email,
          googleUserId: userInfo.id,
          googleUserName: userInfo.name,
        });
      } catch (e) {
        Logger.warn('[refreshAuthToken] 사용자 정보 업데이트 실패:', e);
      }

      // Firebase Auth에도 로그인 시도
      try {
        const { signInToFirebaseWithGoogleToken } = await import('./firebaseService.js');
        const firebaseAuthResult = await signInToFirebaseWithGoogleToken(token);
        if (firebaseAuthResult.success) {
          Logger.info('[refreshAuthToken] Firebase Auth 갱신 성공');
        } else {
          Logger.warn('[refreshAuthToken] Firebase Auth 갱신 실패:', firebaseAuthResult.error);
        }
      } catch (e) {
        Logger.warn('[refreshAuthToken] Firebase Auth 갱신 시도 중 오류:', e);
      }

      console.log('🔑 [Auth] 토큰 갱신 성공');
      return { success: true, token };
    } catch (error) {
      console.error('[refreshAuthToken] 오류:', error);
      return { success: false, token: null, error: error.message };
    } finally {
      // 갱신 완료 후 플래그 초기화
      isRefreshing = false;
      refreshTokenPromise = null;
    }
  })();

  return refreshTokenPromise;
}

/**
 * 유효한 토큰 가져오기 (필요시 자동 갱신)
 * @param {boolean} forceInteractive - 강제로 사용자 상호작용 요구
 * @returns {Promise<string|null>} 유효한 토큰 또는 null
 */
export async function getValidToken(forceInteractive = false) {
  try {
    // 저장된 토큰 검증
    const validation = await validateStoredToken();

    if (validation.valid && !validation.needsRefresh) {
      console.log('🔑 [Auth] 저장된 토큰 사용');
      return validation.token;
    }

    // 토큰 갱신 필요
    if (validation.needsRefresh || !validation.token) {
      console.log('🔑 [Auth] 토큰 갱신 필요');

      // 먼저 silent refresh 시도
      let refreshResult = await refreshAuthToken(false);

      // silent refresh 실패 시 interactive 모드로 재시도
      if (!refreshResult.success && !forceInteractive) {
        console.log('🔑 [Auth] Silent refresh 실패, interactive 모드로 재시도');
        refreshResult = await refreshAuthToken(true);
      }

      if (refreshResult.success) {
        Logger.biz('🔑 [AUTH RESTORED] 토큰 갱신 완료');
        return refreshResult.token;
      } else {
        console.error('🔑 [Auth] 토큰 갱신 실패');
        return null;
      }
    }

    return validation.token;
  } catch (error) {
    console.error('[getValidToken] 오류:', error);
    return null;
  }
}

/**
 * GA4 속성 목록을 가져오는 함수
 * @param {string} token - Google OAuth 토큰
 * @returns {Promise<Array>} GA4 속성 목록
 */
export async function fetchGaProperties(token) {
  const API_URL = 'https://analyticsadmin.googleapis.com/v1beta/accountSummaries';
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error('GA4 속성 목록을 가져오는데 실패했습니다.');

  const data = await response.json();
  const properties = [];
  data.accountSummaries?.forEach((account) => {
    account.propertySummaries?.forEach((prop) => {
      properties.push({
        id: prop.property.split('/')[1], // "properties/12345"에서 숫자만 추출
        name: prop.displayName,
      });
    });
  });
  return properties;
}

/**
 * AdSense 계정 ID를 가져오는 함수
 * @param {string} token - Google OAuth 토큰
 * @returns {Promise<string|null>} AdSense 계정 ID (없으면 null)
 */
export async function fetchAdSenseAccountId(token) {
  const API_URL = 'https://adsense.googleapis.com/v2/accounts';
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null; // 애드센스 계정이 없는 경우 오류 대신 null 반환

  const data = await response.json();
  if (data.accounts && data.accounts.length > 0) {
    return data.accounts[0].name.split('/')[1]; // "accounts/12345"에서 숫자만 추출
  }
  return null;
}

/**
 * Google 사용자 정보 가져오기
 * @param {string} token - Google OAuth 토큰
 * @returns {Promise<{email: string, id: string, name: string}>} 사용자 정보
 */
async function fetchUserInfo(token) {
  if (!token || typeof token !== 'string') {
    Logger.error('[fetchUserInfo] 유효하지 않은 토큰:', typeof token);
    throw new Error('유효하지 않은 토큰입니다.');
  }

  try {
    Logger.info('[fetchUserInfo] 사용자 정보 요청 시작');
    // 보안: 토큰 길이만 로깅 (값은 마스킹)
    Logger.debug('[fetchUserInfo] 토큰 길이:', token.length);
    Logger.debug(
      '[fetchUserInfo] 토큰 (마스킹됨):',
      token.length > 5 ? token.substring(0, 5) + '***' + token.substring(token.length - 3) : '***'
    );

    // Google OAuth2 UserInfo API 호출
    const apiUrl = 'https://www.googleapis.com/oauth2/v3/userinfo';
    const response = await fetch(apiUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    Logger.debug(`[fetchUserInfo] API 응답 상태: ${response.status} ${response.statusText}`);

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      let errorData = {};
      try {
        errorData = JSON.parse(errorText);
      } catch (e) {
        // JSON 파싱 실패 시 텍스트 그대로 사용
      }

      Logger.error(`[fetchUserInfo] API 오류 (${response.status}):`, errorData || errorText);

      // 401 Unauthorized인 경우 토큰 문제
      if (response.status === 401) {
        throw new Error('인증 토큰이 유효하지 않거나 만료되었습니다. 다시 로그인해주세요.');
      }

      throw new Error(
        `사용자 정보 가져오기 실패 (${response.status}): ${errorData.error?.message || errorText.substring(0, 100)}`
      );
    }

    const userInfo = await response.json();
    Logger.debug('[fetchUserInfo] API 응답 데이터:', {
      email: userInfo.email,
      sub: userInfo.sub,
      name: userInfo.name,
      id: userInfo.id,
      verified_email: userInfo.verified_email,
    });

    // 필수 필드 확인
    if (!userInfo.email && !userInfo.sub) {
      Logger.error('[fetchUserInfo] 이메일 또는 sub이 없음. 전체 응답:', userInfo);
      throw new Error('사용자 정보에 이메일 또는 ID가 없습니다. OAuth 스코프를 확인해주세요.');
    }

    const result = {
      email: userInfo.email || null,
      id: userInfo.sub || userInfo.id || null,
      name: userInfo.name || userInfo.email || 'Unknown User',
    };

    if (!result.email) {
      // sub을 이메일로 사용할 수 없으므로 에러
      Logger.error('[fetchUserInfo] 이메일이 없음. sub만 있음:', userInfo.sub);
      throw new Error(
        '사용자 이메일을 가져올 수 없습니다. OAuth 스코프에 userinfo.email이 포함되어 있는지 확인해주세요.'
      );
    }

    Logger.info(`[fetchUserInfo] ✅ 사용자 정보 가져오기 성공: ${result.email} (${result.name})`);
    return result;
  } catch (error) {
    Logger.error('[fetchUserInfo] ❌ 오류 발생:', error);
    // 보안: 토큰 값은 마스킹하여 로깅
    if (token && typeof token === 'string') {
      const masked =
        token.length > 5
          ? token.substring(0, 5) + '***' + token.substring(token.length - 3)
          : '***';
      Logger.error('[fetchUserInfo] 토큰 (마스킹됨):', masked, '길이:', token.length);
    } else {
      Logger.error('[fetchUserInfo] 토큰:', token ? '***' : 'null');
    }

    // 에러를 다시 throw하여 상위에서 처리하도록 함
    throw error;
  }
}

/**
 * Google OAuth 인증 시작
 * @returns {Promise<Object>} 인증 결과
 */
export async function startGoogleAuth() {
  try {
    Logger.info('[startGoogleAuth] Google 로그인 시작');

    // Promise 기반으로 토큰 가져오기
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive: true }, (authToken) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(authToken);
        }
      });
    });

    Logger.debug('[startGoogleAuth] 토큰 타입:', typeof token);
    // 보안: 토큰은 최대 5자만 표시하고 나머지는 마스킹
    if (token && typeof token === 'string') {
      const masked =
        token.length > 5
          ? token.substring(0, 5) + '***' + token.substring(token.length - 3)
          : '***';
      Logger.debug('[startGoogleAuth] 토큰 (마스킹됨):', masked);
    } else {
      Logger.debug('[startGoogleAuth] 토큰 값:', token ? '***' : 'null');
    }

    if (!token) {
      throw new Error('토큰을 가져올 수 없습니다.');
    }

    // 토큰이 문자열이 아니면 문자열로 변환 시도
    const tokenString = typeof token === 'string' ? token : String(token);

    if (!tokenString || tokenString === 'undefined' || tokenString === 'null') {
      throw new Error('유효하지 않은 토큰입니다.');
    }

    // 보안: 토큰 길이만 로깅 (값은 마스킹)
    Logger.debug('[startGoogleAuth] 토큰 발급 성공, 길이:', tokenString.length);

    // 토큰 만료 시간 저장
    await saveTokenExpiry(tokenString);

    // 사용자 정보 가져오기 (이메일 기반 USER_ID 설정)
    let userInfo;
    try {
      userInfo = await fetchUserInfo(tokenString);
      Logger.info(`[startGoogleAuth] 사용자 정보 가져오기 성공: ${userInfo.email}`);
    } catch (error) {
      Logger.error('[startGoogleAuth] 사용자 정보 가져오기 실패:', error);
      // 사용자 정보 가져오기 실패 시에도 로그인은 성공으로 처리하되, 경고 표시
      throw new Error(`로그인은 성공했지만 사용자 정보를 가져올 수 없습니다: ${error.message}`);
    }

    // GA4 속성 및 AdSense 계정 ID 가져오기
    const [properties, adSenseId] = await Promise.all([
      fetchGaProperties(token).catch((e) => {
        Logger.warn('[startGoogleAuth] GA4 속성 가져오기 실패:', e);
        return [];
      }),
      fetchAdSenseAccountId(token).catch((e) => {
        Logger.warn('[startGoogleAuth] AdSense 계정 ID 가져오기 실패:', e);
        return null;
      }),
    ]);

    // 사용자 정보와 함께 저장
    await chrome.storage.local.set({
      googleUserEmail: userInfo.email,
      googleUserId: userInfo.id,
      googleUserName: userInfo.name,
      adSenseAccountId: adSenseId,
      gaProperties: properties,
    });

    // Firebase Auth에 로그인 (Google Access Token 사용)
    try {
      const { signInToFirebaseWithGoogleToken } = await import('./firebaseService.js');
      const firebaseAuthResult = await signInToFirebaseWithGoogleToken(tokenString);

      if (firebaseAuthResult.success) {
        Logger.biz(
          `[Firebase Auth] ✅ Firebase 인증 성공: ${firebaseAuthResult.user.email} (UID: ${firebaseAuthResult.user.uid})`
        );
      } else {
        Logger.warn(`[Firebase Auth] ⚠️ Firebase 인증 실패: ${firebaseAuthResult.error}`);
        Logger.warn(`[Firebase Auth] 코드: ${firebaseAuthResult.code || 'unknown'}`);

        // Access Token만으로 실패한 경우 경고
        if (
          firebaseAuthResult.error?.includes('ID token') ||
          firebaseAuthResult.code === 'auth/invalid-credential'
        ) {
          Logger.warn(
            '[Firebase Auth] 💡 Access Token만으로는 인증할 수 없을 수 있습니다. ID Token이 필요할 수 있습니다.'
          );
        }
      }
    } catch (e) {
      Logger.warn('[Firebase Auth] Firebase 인증 시도 중 오류:', e);
    }

    Logger.biz(`🔑 [Auth] 로그인 성공: ${userInfo.email} (ID: ${userInfo.id})`);
    console.log('🔑 [Auth] 로그인 성공, 토큰 만료 시간 저장 완료');

    // UI 호환성을 위해 data 객체도 포함
    return {
      success: true,
      token: tokenString,
      properties,
      adSenseId,
      userInfo,
      data: {
        email: userInfo.email,
        gaProperties: properties,
        adSenseAccountId: adSenseId,
      },
    };
  } catch (error) {
    Logger.error('[startGoogleAuth] 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Google OAuth 인증 해제
 * @returns {Promise<Object>} 해제 결과
 */
export async function revokeGoogleAuth() {
  try {
    const storage = await chrome.storage.local.get('googleAuthToken');
    const googleAuthToken = storage.googleAuthToken;

    if (googleAuthToken) {
      try {
        // 1. Google OAuth 서버에서 토큰 무효화 (선택적, 실패해도 계속 진행)
        try {
          const tokenToRevoke =
            typeof googleAuthToken === 'string'
              ? googleAuthToken
              : googleAuthToken?.token || String(googleAuthToken);
          if (tokenToRevoke && typeof tokenToRevoke === 'string') {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${tokenToRevoke}`);
          }
        } catch (e) {
          Logger.warn('[revokeGoogleAuth] OAuth 서버 토큰 무효화 실패 (무시):', e);
        }

        // 2. 토큰이 문자열인지 확인하고 Chrome의 인증 캐시에서 제거
        const tokenToRemove =
          typeof googleAuthToken === 'string'
            ? googleAuthToken
            : googleAuthToken?.token || String(googleAuthToken);

        if (tokenToRemove && typeof tokenToRemove === 'string') {
          await chrome.identity.removeCachedAuthToken({ token: tokenToRemove });
        } else {
          Logger.warn('[revokeGoogleAuth] 유효하지 않은 토큰 형식, 제거 건너뜀');
        }
      } catch (e) {
        Logger.warn('[revokeGoogleAuth] 토큰 제거 실패:', e);
      }
    }

    // 3. storage에 저장된 모든 관련 정보 삭제
    await chrome.storage.local.remove([
      'googleAuthToken',
      'googleAuthTokenExpiry',
      'googleAuthTokenIssued',
      'googleUserEmail',
      'googleUserId',
      'googleUserName',
      'adSenseAccountId',
      'gaProperties',
      'selectedGaPropertyId',
    ]);

    Logger.biz('🔑 [Auth] 로그아웃 완료 - 모든 사용자 정보 삭제됨');
    return { success: true };
  } catch (error) {
    Logger.error('[revokeGoogleAuth] 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Service Worker 재시작 시 세션 복원
 * @returns {Promise<boolean>} 복원 성공 여부
 */
export async function restoreAuthSession() {
  try {
    console.log('🔑 [Auth] 세션 복원 시도');
    const validation = await validateStoredToken();

    if (validation.valid && !validation.needsRefresh) {
      // Ensure we have user info in storage. If a valid token exists but the
      // chrome.storage doesn't contain googleUserEmail/googleUserId (possible
      // when storage was cleared or we upgraded versions), fetch user info and
      // persist it so other services that rely on getCurrentUserId() behave
      // correctly and avoid falling back to `default_user`.
      try {
        const userInfo = await fetchUserInfo(validation.token);
        if (userInfo && userInfo.email && userInfo.id) {
          await chrome.storage.local.set({
            googleUserEmail: userInfo.email,
            googleUserId: userInfo.id,
            googleUserName: userInfo.name || userInfo.email,
          });
          Logger.biz('[restoreAuthSession] 사용자 정보 복원 및 저장 완료');
        }
      } catch (e) {
        Logger.warn('[restoreAuthSession] 사용자 정보 복원 실패 (무시):', e);
      }

      // Firebase Auth에도 로그인 시도
      try {
        const { signInToFirebaseWithGoogleToken } = await import('./firebaseService.js');
        const firebaseAuthResult = await signInToFirebaseWithGoogleToken(validation.token);
        if (firebaseAuthResult.success) {
          Logger.biz('🔑 [AUTH RESTORED] 저장된 세션 및 Firebase Auth 복원 성공');
        } else {
          Logger.warn('🔑 [AUTH RESTORED] 저장된 세션 복원 성공 (Firebase Auth 실패)');
        }
      } catch (e) {
        Logger.warn('[restoreAuthSession] Firebase Auth 복원 실패:', e);
      }

      Logger.biz('🔑 [AUTH RESTORED] 저장된 세션 복원 성공');
      return true;
    }

    // 토큰이 만료되었거나 없으면 silent refresh 시도
    if (validation.needsRefresh) {
      const refreshResult = await refreshAuthToken(false);
      if (refreshResult.success) {
        // Firebase Auth에도 로그인 시도
        try {
          const { signInToFirebaseWithGoogleToken } = await import('./firebaseService.js');
          const firebaseAuthResult = await signInToFirebaseWithGoogleToken(refreshResult.token);
          if (firebaseAuthResult.success) {
            Logger.biz('🔑 [AUTH RESTORED] 토큰 갱신 및 Firebase Auth 복원 성공');
          } else {
            Logger.warn('🔑 [AUTH RESTORED] 토큰 갱신 성공 (Firebase Auth 실패)');
          }
        } catch (e) {
          Logger.warn('[restoreAuthSession] Firebase Auth 복원 실패:', e);
        }

        Logger.biz('🔑 [AUTH RESTORED] 토큰 갱신으로 세션 복원 성공');
        return true;
      }
    }

    console.log('🔑 [Auth] 세션 복원 실패 - 사용자 로그인 필요');
    return false;
  } catch (error) {
    console.error('[restoreAuthSession] 오류:', error);
    return false;
  }
}

console.log('[System] authService 모듈 로드 완료');
