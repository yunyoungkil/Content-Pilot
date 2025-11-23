// js/ui/baseView.js
// BaseView: 모든 UI 모드의 기본 클래스
// 모드 전환 시 메모리 누수 방지를 위한 cleanup 메커니즘 제공

import { Logger } from '../utils.js';

/**
 * BaseView 클래스
 * 모든 UI 모드가 상속받아야 하는 기본 클래스
 */
export class BaseView {
  constructor(container) {
    this.container = container;
    this.eventListeners = []; // 등록된 이벤트 리스너 추적
    this.intervals = []; // 등록된 interval 추적
    this.timeouts = []; // 등록된 timeout 추적
    this.observers = []; // 등록된 observer 추적
    this.isDestroyed = false;
    this.createdAt = Date.now();
    
    Logger.debug(`[BaseView] ${this.constructor.name} 인스턴스 생성됨`);
  }

  /**
   * 이벤트 리스너 등록 (자동 추적)
   * @param {HTMLElement|Window|Document} target - 이벤트 타겟
   * @param {string} event - 이벤트 타입
   * @param {Function} handler - 이벤트 핸들러
   * @param {Object} options - 이벤트 옵션
   */
  addEventListener(target, event, handler, options = false) {
    if (this.isDestroyed) {
      Logger.warn(`[BaseView] ${this.constructor.name}는 이미 destroy되었습니다. 이벤트 리스너 추가 무시.`);
      return;
    }

    target.addEventListener(event, handler, options);
    this.eventListeners.push({ target, event, handler, options });
    
    Logger.debug(`[BaseView] ${this.constructor.name} 이벤트 리스너 추가: ${event} on ${target.constructor.name || target.nodeName}`);
  }

  /**
   * Interval 등록 (자동 추적)
   * @param {Function} callback - 콜백 함수
   * @param {number} delay - 지연 시간 (ms)
   * @returns {number} interval ID
   */
  setInterval(callback, delay) {
    if (this.isDestroyed) {
      Logger.warn(`[BaseView] ${this.constructor.name}는 이미 destroy되었습니다. interval 추가 무시.`);
      return null;
    }

    const id = setInterval(callback, delay);
    this.intervals.push(id);
    
    Logger.debug(`[BaseView] ${this.constructor.name} interval 등록: ${delay}ms`);
    return id;
  }

  /**
   * Timeout 등록 (자동 추적)
   * @param {Function} callback - 콜백 함수
   * @param {number} delay - 지연 시간 (ms)
   * @returns {number} timeout ID
   */
  setTimeout(callback, delay) {
    if (this.isDestroyed) {
      Logger.warn(`[BaseView] ${this.constructor.name}는 이미 destroy되었습니다. timeout 추가 무시.`);
      return null;
    }

    const id = setTimeout(callback, delay);
    this.timeouts.push(id);
    
    Logger.debug(`[BaseView] ${this.constructor.name} timeout 등록: ${delay}ms`);
    return id;
  }

  /**
   * MutationObserver 등록 (자동 추적)
   * @param {HTMLElement} target - 관찰 대상
   * @param {Function} callback - 콜백 함수
   * @param {Object} options - 옵션
   * @returns {MutationObserver} observer 인스턴스
   */
  observeMutation(target, callback, options = {}) {
    if (this.isDestroyed) {
      Logger.warn(`[BaseView] ${this.constructor.name}는 이미 destroy되었습니다. observer 추가 무시.`);
      return null;
    }

    const observer = new MutationObserver(callback);
    observer.observe(target, options);
    this.observers.push(observer);
    
    Logger.debug(`[BaseView] ${this.constructor.name} MutationObserver 등록`);
    return observer;
  }

  /**
   * cleanup: 모든 리스너와 타이머 정리
   * 하위 클래스에서 override 가능
   */
  cleanup() {
    if (this.isDestroyed) {
      Logger.warn(`[BaseView] ${this.constructor.name}는 이미 cleanup되었습니다.`);
      return;
    }

    Logger.debug(`[BaseView] ${this.constructor.name} cleanup 시작...`);

    // 이벤트 리스너 제거
    this.eventListeners.forEach(({ target, event, handler, options }) => {
      try {
        target.removeEventListener(event, handler, options);
        Logger.debug(`[BaseView] 이벤트 리스너 제거: ${event} on ${target.constructor.name || target.nodeName}`);
      } catch (error) {
        Logger.error(`[BaseView] 이벤트 리스너 제거 실패:`, error);
      }
    });
    this.eventListeners = [];

    // Interval 정리
    this.intervals.forEach(id => {
      try {
        clearInterval(id);
        Logger.debug(`[BaseView] interval 제거: ${id}`);
      } catch (error) {
        Logger.error(`[BaseView] interval 제거 실패:`, error);
      }
    });
    this.intervals = [];

    // Timeout 정리
    this.timeouts.forEach(id => {
      try {
        clearTimeout(id);
        Logger.debug(`[BaseView] timeout 제거: ${id}`);
      } catch (error) {
        Logger.error(`[BaseView] timeout 제거 실패:`, error);
      }
    });
    this.timeouts = [];

    // Observer 정리
    this.observers.forEach(observer => {
      try {
        observer.disconnect();
        Logger.debug(`[BaseView] MutationObserver 제거`);
      } catch (error) {
        Logger.error(`[BaseView] MutationObserver 제거 실패:`, error);
      }
    });
    this.observers = [];

    Logger.debug(`[BaseView] ${this.constructor.name} cleanup 완료`);
  }

  /**
   * destroy: 뷰 파괴 (cleanup + 추가 정리)
   * 하위 클래스에서 override하여 추가 정리 로직 구현 가능
   */
  destroy() {
    if (this.isDestroyed) {
      Logger.warn(`[BaseView] ${this.constructor.name}는 이미 destroy되었습니다.`);
      return;
    }

    const lifetime = Date.now() - this.createdAt;
    Logger.info(`[BaseView] ${this.constructor.name} destroy 시작 (생존 시간: ${lifetime}ms)`);

    // 하위 클래스의 추가 정리 로직 실행 (override 가능)
    this.onDestroy();

    // 기본 cleanup 실행
    this.cleanup();

    // DOM 정리 (컨테이너 내용 제거)
    if (this.container) {
      try {
        this.container.innerHTML = '';
        Logger.debug(`[BaseView] ${this.constructor.name} 컨테이너 내용 제거 완료`);
      } catch (error) {
        Logger.error(`[BaseView] 컨테이너 정리 실패:`, error);
      }
    }

    this.isDestroyed = true;
    Logger.info(`[BaseView] ${this.constructor.name} destroy 완료`);
  }

  /**
   * onDestroy: 하위 클래스에서 override하여 추가 정리 로직 구현
   * 기본 구현은 비어있음
   */
  onDestroy() {
    // 하위 클래스에서 override
  }

  /**
   * 뷰가 활성화될 때 호출 (모드 전환 시)
   * 하위 클래스에서 override 가능
   */
  onActivate() {
    Logger.debug(`[BaseView] ${this.constructor.name} 활성화됨`);
  }

  /**
   * 뷰가 비활성화될 때 호출 (모드 전환 시)
   * 하위 클래스에서 override 가능
   */
  onDeactivate() {
    Logger.debug(`[BaseView] ${this.constructor.name} 비활성화됨`);
  }
}

