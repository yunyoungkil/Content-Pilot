// 유틸리티 함수 모음

/**
 * [Global Logger] 전역 로깅 시스템
 * 개발 모드에서만 로그를 출력하고, 로그 레벨에 따라 색상을 다르게 표시합니다.
 */
export const Logger = {
  // DEBUG 모드 체크 (localStorage 또는 URL 파라미터)
  isDebugMode: () => {
    try {
      // Service Worker 환경 체크
      if (typeof self !== 'undefined' && self.constructor?.name === 'ServiceWorkerGlobalScope') {
        // Service Worker에서는 항상 디버그 모드 (개발 중)
        return true;
      }

      // window가 없는 환경 (Service Worker 등)
      if (typeof window === 'undefined') {
        return true; // Service Worker는 기본적으로 디버그 모드
      }

      // URL 파라미터로 DEBUG=true 체크
      try {
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.get('DEBUG') === 'true') return true;
      } catch (e) {
        // window.location 접근 불가 (cross-origin 등)
      }

      // localStorage 체크
      try {
        const debugMode = localStorage.getItem('CP_DEBUG_MODE');
        if (debugMode === 'true') return true;
      } catch (e) {
        // localStorage 접근 불가
      }

      // 개발 환경 자동 감지 (localhost 또는 확장 프로그램)
      try {
        if (
          window.location.protocol === 'chrome-extension:' ||
          window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1'
        ) {
          return true;
        }
      } catch (e) {
        // window.location 접근 불가
      }

      return false;
    } catch (e) {
      // 모든 체크 실패 시 기본적으로 true (개발 편의성)
      return true;
    }
  },

  /**
   * INFO 레벨 로그 (일반 정보, 회색)
   */
  info: (...args) => {
    if (!Logger.isDebugMode()) return;
    const style = 'color: #888; font-weight: normal;';
    console.log(`%c[INFO]`, style, ...args);
  },

  /**
   * WARN 레벨 로그 (경고, 노란색)
   */
  warn: (...args) => {
    if (!Logger.isDebugMode()) return;
    const style = 'color: #FFA500; font-weight: 600;';
    console.warn(`%c[WARN]`, style, ...args);
  },

  /**
   * ERROR 레벨 로그 (에러, 빨간색 배경)
   */
  error: (...args) => {
    // 에러는 항상 출력 (프로덕션에서도)
    const style =
      'background: #FF4444; color: #FFFFFF; padding: 2px 6px; border-radius: 3px; font-weight: bold;';
    console.error(`%c[ERROR]`, style, ...args);
  },

  /**
   * BIZ 레벨 로그 (비즈니스 로직, 금색)
   * 저장, 생성, 삭제 등 중요한 비즈니스 액션에 사용
   */
  biz: (...args) => {
    if (!Logger.isDebugMode()) return;
    const style = 'color: #FFD700; font-weight: 700; text-shadow: 0 0 3px rgba(255, 215, 0, 0.5);';
    console.log(`%c💰 [BIZ]`, style, ...args);
  },

  /**
   * DEBUG 레벨 로그 (상세 디버깅 정보, 파란색)
   */
  debug: (...args) => {
    if (!Logger.isDebugMode()) return;
    const style = 'color: #4A90E2; font-weight: normal; font-style: italic;';
    console.log(`%c[DEBUG]`, style, ...args);
  },

  /**
   * 성능 측정 시작
   */
  time: (label) => {
    if (!Logger.isDebugMode()) return;
    console.time(`[PERF] ${label}`);
  },

  /**
   * 성능 측정 종료
   */
  timeEnd: (label) => {
    if (!Logger.isDebugMode()) return;
    console.timeEnd(`[PERF] ${label}`);
  },

  /**
   * 그룹 시작
   */
  group: (label) => {
    if (!Logger.isDebugMode()) return;
    console.group(`%c[GROUP] ${label}`, 'color: #888; font-weight: bold;');
  },

  /**
   * 그룹 종료
   */
  groupEnd: () => {
    if (!Logger.isDebugMode()) return;
    console.groupEnd();
  },
};

// 전역 토스트(모달) 함수 (중복 방지, 어디서든 호출 가능)
export function showToast(msg) {
  let toast = document.getElementById('cp-toast-modal');
  if (toast) toast.remove();
  toast = document.createElement('div');
  toast.id = 'cp-toast-modal';
  toast.textContent = msg;
  toast.style.position = 'fixed';
  toast.style.left = '50%';
  toast.style.top = '60px';
  toast.style.transform = 'translateX(-50%)';
  toast.style.background = 'rgba(34,34,34,0.97)';
  toast.style.color = '#fff';
  toast.style.fontSize = '15px';
  toast.style.fontWeight = '600';
  toast.style.padding = '13px 32px';
  toast.style.borderRadius = '10px';
  toast.style.boxShadow = '0 2px 12px rgba(0,0,0,0.13)';
  toast.style.zIndex = '2147483647'; /* 모든 모달보다 위에 표시 */
  toast.style.opacity = '0';
  toast.style.transition = 'opacity 0.3s';
  document.body.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '1';
  }, 10);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => {
      toast.remove();
    }, 350);
  }, 1200);
}

// Persistent loading toast / progress UI
export function showLoadingToast(message = '로딩 중...', options = {}) {
  // options: id (string), dismissible (bool), progress (0-100)
  const id = options.id || 'cp-loading-toast-modal';
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.style.position = 'fixed';
    el.style.left = '50%';
    el.style.top = '60px';
    el.style.transform = 'translateX(-50%)';
    el.style.background = 'rgba(34,34,34,0.97)';
    el.style.color = '#fff';
    el.style.fontSize = '15px';
    el.style.fontWeight = '600';
    el.style.padding = '10px 18px';
    el.style.borderRadius = '10px';
    el.style.boxShadow = '0 2px 12px rgba(0,0,0,0.13)';
    el.style.zIndex = '2147483647';
    el.style.display = 'flex';
    el.style.alignItems = 'center';
    el.style.gap = '10px';

    const spinner = document.createElement('div');
    spinner.className = 'cp-loading-spinner';
    spinner.style.width = '16px';
    spinner.style.height = '16px';
    spinner.style.border = '2px solid rgba(255,255,255,0.2)';
    spinner.style.borderTop = '2px solid #fff';
    spinner.style.borderRadius = '50%';
    spinner.style.animation = 'cp-spin 1s linear infinite';
    spinner.style.flex = 'none';

    const txt = document.createElement('span');
    txt.className = 'cp-loading-toast-message';
    txt.textContent = message;

    el.appendChild(spinner);
    el.appendChild(txt);

    // optional progress bar
    if (typeof options.progress === 'number') {
      const barWrap = document.createElement('div');
      barWrap.style.width = '160px';
      barWrap.style.height = '6px';
      barWrap.style.background = 'rgba(255,255,255,0.08)';
      barWrap.style.borderRadius = '6px';
      barWrap.style.overflow = 'hidden';
      barWrap.style.marginLeft = '10px';
      barWrap.style.flex = 'none';
      const bar = document.createElement('div');
      bar.className = 'cp-loading-progress-bar';
      bar.style.height = '100%';
      bar.style.width = `${Math.min(Math.max(options.progress, 0), 100)}%`;
      bar.style.background = '#fff';
      bar.style.opacity = '0.9';
      barWrap.appendChild(bar);
      el.appendChild(barWrap);
    }
    document.body.appendChild(el);
  } else {
    const span = el.querySelector('.cp-loading-toast-message');
    if (span) span.textContent = message;
    const bar = el.querySelector('.cp-loading-progress-bar');
    if (bar && typeof options.progress === 'number') {
      bar.style.width = `${Math.min(Math.max(options.progress, 0), 100)}%`;
    }
  }
}

export function updateLoadingToast(message, progress, id = 'cp-loading-toast-modal') {
  const el = document.getElementById(id);
  if (!el) return;
  const span = el.querySelector('.cp-loading-toast-message');
  if (span && message) span.textContent = message;
  const bar = el.querySelector('.cp-loading-progress-bar');
  if (bar && typeof progress === 'number')
    bar.style.width = `${Math.min(Math.max(progress, 0), 100)}%`;
}

export function hideLoadingToast(id = 'cp-loading-toast-modal') {
  const el = document.getElementById(id);
  if (el) el.remove();
}

// simple spinner animation rule for cp-loading-spinner (keeps simple runtime insertion)
if (typeof document !== 'undefined' && !document.getElementById('cp-loading-spinner-style')) {
  const style = document.createElement('style');
  style.id = 'cp-loading-spinner-style';
  style.textContent = `@keyframes cp-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`;
  document.head && document.head.appendChild(style);
}

// 긴 링크를 줄여서 보여주는 함수
export function shortenLink(url, maxLength = 40) {
  if (!url) return '';
  if (url.length <= maxLength) return url;
  const urlObj = (() => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  })();
  if (urlObj) {
    const host = urlObj.host;
    const path =
      urlObj.pathname.length > 16
        ? urlObj.pathname.slice(0, 12) + '...' + urlObj.pathname.slice(-4)
        : urlObj.pathname;
    return host + path;
  }
  return url.slice(0, 25) + '...' + url.slice(-10);
}

/**
 * 디바운싱 함수 - 연속된 함수 호출을 제한하여 성능 최적화
 * @param {Function} func - 디바운싱할 함수
 * @param {number} delay - 지연 시간 (밀리초)
 * @returns {Function} 디바운싱된 함수
 */
export function debounce(func, delay) {
  let timeoutId;
  return function (...args) {
    const context = this;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func.apply(context, args), delay);
  };
}

/**
 * 쓰로틀링 함수 - 함수 호출 빈도를 제한하여 성능 최적화
 * @param {Function} func - 쓰로틀링할 함수
 * @param {number} limit - 제한 시간 (밀리초)
 * @returns {Function} 쓰로틀링된 함수
 */
export function throttle(func, limit) {
  let inThrottle;
  return function (...args) {
    const context = this;
    if (!inThrottle) {
      func.apply(context, args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}
export function showConfirmationToast(message, onConfirm) {
  // 혹시 이전에 떠 있던 확인 창이 있다면 제거
  const existingToast = document.getElementById('cp-confirm-toast');
  if (existingToast) {
    Logger.debug('[showConfirmationToast] 기존 토스트 제거');
    existingToast.remove();
    // 기존 토스트를 제거한 후에도 계속 진행하여 새 메시지 표시
  }

  const toast = document.createElement('div');
  toast.id = 'cp-confirm-toast';
  toast.style.cssText = `
    position: fixed;
    bottom: 36px;
    left: 50%;
    transform: translateX(-50%) translateY(100px); /* 시작 위치 */
    opacity: 0;
    background: #323232;
    color: #fff;
    padding: 16px 24px;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.25);
    z-index: 2147483647; /* 모든 모달보다 위에 표시 */
    display: flex;
    align-items: center;
    gap: 20px;
    font-size: 15px;
    transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
  `;

  // onConfirm이 있으면 확인 버튼 표시, 없으면 단순 알림으로 취소 버튼만 표시
  const hasConfirmAction = onConfirm && typeof onConfirm === 'function';

  toast.innerHTML = `
    <span>${message}</span>
    <div class="cp-confirm-actions" style="display: flex; gap: 8px;">
      ${hasConfirmAction ? '<button id="cp-confirm-yes" style="background: #4285F4; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer; font-weight: 600;">확인</button>' : ''}
      <button id="cp-confirm-no" style="background: #5f6368; color: white; border: none; padding: 8px 16px; border-radius: 5px; cursor: pointer;">${hasConfirmAction ? '취소' : '닫기'}</button>
    </div>
  `;

  document.body.appendChild(toast);

  // 나타나는 애니메이션
  setTimeout(() => {
    toast.style.transform = 'translateX(-50%) translateY(0)';
    toast.style.opacity = '1';
  }, 50);

  const closeToast = () => {
    toast.style.transform = 'translateX(-50%) translateY(100px)';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 400);
  };

  // 확인 버튼이 있는 경우에만 이벤트 리스너 추가
  if (hasConfirmAction) {
    const confirmBtn = toast.querySelector('#cp-confirm-yes');
    if (confirmBtn) {
      confirmBtn.onclick = () => {
        onConfirm(); // 확인 버튼 클릭 시 전달받은 함수 실행
        closeToast();
      };
    }
  }

  // 취소/닫기 버튼
  const cancelBtn = toast.querySelector('#cp-confirm-no');
  if (cancelBtn) {
    cancelBtn.onclick = closeToast;
  }
}
