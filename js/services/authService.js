// js/services/authService.js
// Google OAuth 인증 관련 서비스

import { Logger } from '../utils.js';

// 토큰 만료 시간 상수 (Google OAuth 토큰은 일반적으로 1시간 유효)
const TOKEN_EXPIRY_BUFFER = 5 * 60 * 1000; // 5분 버퍼 (만료 5분 전에 갱신)
const TOKEN_DEFAULT_EXPIRY = 60 * 60 * 1000; // 기본 1시간

/**
 * 토큰 만료 시간을 스토리지에 저장
 * @param {string} token - Google OAuth 토큰
 * @param {number} expiryTime - 만료 시간 (밀리초, 선택사항)
 */
async function saveTokenExpiry(token, expiryTime = null) {
  const expiry = expiryTime || (Date.now() + TOKEN_DEFAULT_EXPIRY);
  await chrome.storage.local.set({
    googleAuthToken: token,
    googleAuthTokenExpiry: expiry,
    googleAuthTokenIssued: Date.now()
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
      'googleAuthTokenIssued'
    ]);

    if (!storage.googleAuthToken) {
      return { valid: false, token: null, needsRefresh: false };
    }

    const now = Date.now();
    const expiry = storage.googleAuthTokenExpiry || (storage.googleAuthTokenIssued + TOKEN_DEFAULT_EXPIRY);
    const timeUntilExpiry = expiry - now;

    // 만료 시간이 지났거나 곧 만료될 예정인 경우
    if (timeUntilExpiry <= TOKEN_EXPIRY_BUFFER) {
      console.log('🔑 [Auth] 토큰 만료 임박 또는 만료됨. 갱신 필요.');
      return { valid: false, token: storage.googleAuthToken, needsRefresh: true };
    }

    // 토큰이 유효한지 실제 API 호출로 검증
    try {
      const testResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${storage.googleAuthToken}` }
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
 * 토큰 갱신 (Silent Refresh)
 * @param {boolean} interactive - 사용자 상호작용 필요 여부
 * @returns {Promise<{success: boolean, token: string|null, error?: string}>}
 */
export async function refreshAuthToken(interactive = false) {
  try {
    console.log('🔑 [Auth] 토큰 갱신 시도 (interactive:', interactive, ')');
    
    // 기존 토큰 제거 (캐시 무효화)
    const storage = await chrome.storage.local.get('googleAuthToken');
    if (storage.googleAuthToken && typeof storage.googleAuthToken === 'string') {
      try {
        await new Promise((resolve) => {
          chrome.identity.removeCachedAuthToken({ token: storage.googleAuthToken }, resolve);
        });
      } catch (e) {
        console.warn('[refreshAuthToken] 기존 토큰 제거 실패:', e);
      }
    }

    // 새 토큰 발급
    const token = await new Promise((resolve, reject) => {
      chrome.identity.getAuthToken({ interactive }, (authToken) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(authToken);
        }
      });
    });

    if (!token) {
      throw new Error('토큰 발급 실패');
    }

    // 토큰 만료 시간 저장
    await saveTokenExpiry(token);
    
    console.log('🔑 [Auth] 토큰 갱신 성공');
    return { success: true, token };
  } catch (error) {
    console.error('[refreshAuthToken] 오류:', error);
    return { success: false, token: null, error: error.message };
  }
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
  const API_URL =
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("GA4 속성 목록을 가져오는데 실패했습니다.");

  const data = await response.json();
  const properties = [];
  data.accountSummaries?.forEach((account) => {
    account.propertySummaries?.forEach((prop) => {
      properties.push({
        id: prop.property.split("/")[1], // "properties/12345"에서 숫자만 추출
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
  const API_URL = "https://adsense.googleapis.com/v2/accounts";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null; // 애드센스 계정이 없는 경우 오류 대신 null 반환

  const data = await response.json();
  if (data.accounts && data.accounts.length > 0) {
    return data.accounts[0].name.split("/")[1]; // "accounts/12345"에서 숫자만 추출
  }
  return null;
}

/**
 * Google OAuth 인증 시작
 * @returns {Promise<Object>} 인증 결과
 */
export async function startGoogleAuth() {
  try {
    const token = await chrome.identity.getAuthToken({ interactive: true });
    
    // 사용자 이메일, GA4 속성 및 AdSense 계정 ID 가져오기
    const [userInfoResponse, properties, adSenseId] = await Promise.all([
      fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
        headers: { Authorization: `Bearer ${token}` }
      }).catch(() => null),
      fetchGaProperties(token).catch(() => []),
      fetchAdSenseAccountId(token).catch(() => null)
    ]);
    
    // 사용자 이메일 추출
    let userEmail = null;
    if (userInfoResponse && userInfoResponse.ok) {
      const userInfo = await userInfoResponse.json();
      userEmail = userInfo.email || null;
    }
    
    // 토큰 만료 시간 계산
    const expiry = Date.now() + TOKEN_DEFAULT_EXPIRY;
    
    // 모든 정보를 한 번에 chrome.storage에 저장 (중복 저장 방지)
    await chrome.storage.local.set({ 
      googleAuthToken: token,
      googleAuthTokenExpiry: expiry,
      googleAuthTokenIssued: Date.now(),
      googleUserEmail: userEmail,
      adSenseAccountId: adSenseId,
      gaProperties: properties 
    });
    
    console.log('🔑 [Auth] 로그인 성공, 토큰 만료 시간:', new Date(expiry).toLocaleString());
    
    // UI에서 기대하는 형식으로 반환
    return { 
      success: true, 
      data: {
        email: userEmail,
        gaProperties: properties,
        adSenseAccountId: adSenseId
      },
      token,
      properties,
      adSenseId
    };
  } catch (error) {
    console.error('[startGoogleAuth] 오류:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Google OAuth 인증 해제
 * @returns {Promise<Object>} 해제 결과
 */
export async function revokeGoogleAuth() {
  try {
    const { googleAuthToken } = await chrome.storage.local.get('googleAuthToken');
    
    if (googleAuthToken) {
      // 1. Google OAuth 서버에서 토큰 무효화 (선택적, 실패해도 계속 진행)
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${googleAuthToken}`);
      } catch (e) {
        console.warn('[revokeGoogleAuth] OAuth 서버 토큰 무효화 실패 (무시):', e);
      }
      
      // 2. Chrome의 인증 캐시에서 제거
      await chrome.identity.removeCachedAuthToken({ token: googleAuthToken });
    }
    
    // 3. storage에 저장된 모든 관련 정보 삭제
    await chrome.storage.local.remove([
      'googleAuthToken',
      'googleAuthTokenExpiry',
      'googleAuthTokenIssued',
      'googleUserEmail',
      'adSenseAccountId',
      'gaProperties',
      'selectedGaPropertyId'
    ]);
    
    console.log('🔑 [Auth] 로그아웃 완료');
    return { success: true };
  } catch (error) {
    console.error('[revokeGoogleAuth] 오류:', error);
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
      Logger.biz('🔑 [AUTH RESTORED] 저장된 세션 복원 성공');
      return true;
    }
    
    // 토큰이 만료되었거나 없으면 silent refresh 시도
    if (validation.needsRefresh) {
      const refreshResult = await refreshAuthToken(false);
      if (refreshResult.success) {
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

