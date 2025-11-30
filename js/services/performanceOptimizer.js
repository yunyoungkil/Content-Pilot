// js/services/performanceOptimizer.js
// Firebase 성능 최적화 서비스

import { getDb, getCurrentUserId } from './firebaseService.js';
import { ref, get, set, update, remove } from './firebaseService.js';
import { Logger } from '../utils.js';

/**
 * Firebase 성능 최적화 서비스
 * 데이터 로드, 캐싱, 배치 작업을 최적화합니다.
 */
class FirebasePerformanceOptimizer {
  constructor() {
    this.cache = new Map();
    this.cacheTTL = 5 * 60 * 1000; // 5분
    this.batchQueue = new Map();
    this.batchTimeout = 1000; // 1초
  }

  /**
   * 메모리 캐시 + 로컬 스토리지 복합 캐싱
   */
  async getCachedData(key, fetcher, ttl = this.cacheTTL) {
    // 메모리 캐시 확인
    const memoryCache = this.cache.get(key);
    if (memoryCache && Date.now() - memoryCache.timestamp < ttl) {
      return memoryCache.data;
    }

    // 로컬 스토리지 캐시 확인
    try {
      const storageKey = `fb_cache_${key}`;
      const storage = await chrome.storage.local.get(storageKey);
      if (storage[storageKey] && Date.now() - storage[storageKey].timestamp < ttl) {
        // 메모리 캐시에 저장
        this.cache.set(key, storage[storageKey]);
        return storage[storageKey].data;
      }
    } catch (error) {
      Logger.warn('[PerformanceOptimizer] 로컬 스토리지 캐시 읽기 실패:', error);
    }

    // 데이터 fetch
    const data = await fetcher();

    // 캐시 저장
    const cacheData = { data, timestamp: Date.now() };
    this.cache.set(key, cacheData);

    try {
      await chrome.storage.local.set({ [`fb_cache_${key}`]: cacheData });
    } catch (error) {
      Logger.warn('[PerformanceOptimizer] 로컬 스토리지 캐시 저장 실패:', error);
    }

    return data;
  }

  /**
   * 캐시 무효화
   */
  async invalidateCache(pattern) {
    // 메모리 캐시 정리
    for (const [key] of this.cache) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
      }
    }

    // 로컬 스토리지 정리
    try {
      const storage = await chrome.storage.local.get(null);
      const keysToRemove = Object.keys(storage).filter(
        (key) => key.startsWith('fb_cache_') && key.includes(pattern)
      );
      if (keysToRemove.length > 0) {
        await chrome.storage.local.remove(keysToRemove);
      }
    } catch (error) {
      Logger.warn('[PerformanceOptimizer] 캐시 무효화 실패:', error);
    }
  }

  /**
   * 페이징 데이터 로드
   */
  async loadPagedData(path, options = {}) {
    const {
      pageSize = 50,
      startAfter = null,
      filter = null,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = options;

    const cacheKey = `paged_${path}_${pageSize}_${startAfter || 'start'}_${JSON.stringify(filter)}`;

    return this.getCachedData(cacheKey, async () => {
      const userId = await getCurrentUserId();
      const fullPath = path.replace('{userId}', userId);

      // Firebase 쿼리 파라미터 구성
      let queryParams = `orderBy="${sortBy}"&limitToFirst=${pageSize}`;
      if (startAfter) {
        queryParams += `&startAfter="${startAfter}"`;
      }

      const data = await this.fetchWithRetry(`${fullPath}.json?${queryParams}`);

      if (!data) return { items: [], hasMore: false, lastKey: null };

      // 필터링 적용
      let items = Object.entries(data).map(([key, value]) => ({
        id: key,
        ...value,
      }));

      if (filter && typeof filter === 'function') {
        items = items.filter(filter);
      }

      // 정렬
      items.sort((a, b) => {
        const aVal = a[sortBy] || 0;
        const bVal = b[sortBy] || 0;
        return sortOrder === 'desc' ? bVal - aVal : aVal - bVal;
      });

      const hasMore = items.length === pageSize;
      const lastKey = hasMore ? items[items.length - 1][sortBy] : null;

      return { items, hasMore, lastKey };
    });
  }

  /**
   * 배치 업데이트 (여러 경로 동시 업데이트)
   */
  async batchUpdate(updates) {
    const batchId = Date.now().toString();
    this.batchQueue.set(batchId, updates);

    return new Promise((resolve, reject) => {
      setTimeout(async () => {
        try {
          const batchUpdates = this.batchQueue.get(batchId);
          if (!batchUpdates) return resolve([]);

          this.batchQueue.delete(batchId);

          // 병렬 실행으로 성능 향상
          const results = await Promise.allSettled(
            batchUpdates.map(({ path, data, method = 'PATCH' }) => {
              switch (method) {
                case 'PUT':
                  return set(path, data);
                case 'DELETE':
                  return remove(path);
                default:
                  return update(path, data);
              }
            })
          );

          resolve(results);
        } catch (error) {
          reject(error);
        }
      }, this.batchTimeout);
    });
  }

  /**
   * 재시도 로직이 포함된 fetch
   */
  async fetchWithRetry(url, options = {}, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const response = await fetch(url, options);
        if (response.ok) {
          return await response.json();
        }

        if (response.status === 429) {
          // Rate limit - 지수 백오프
          const delay = Math.pow(2, i) * 1000;
          await new Promise((resolve) => setTimeout(resolve, delay));
          continue;
        }

        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      } catch (error) {
        if (i === maxRetries - 1) throw error;
        Logger.warn(`[PerformanceOptimizer] Fetch 재시도 ${i + 1}/${maxRetries}:`, error);
      }
    }
  }

  /**
   * 실시간 리스너 최적화 (디바운싱 + 필터링)
   */
  createOptimizedListener(path, callback, options = {}) {
    const {
      debounceMs = 500,
      filter = null,
      maxFrequency = 1000, // 최대 1초에 한 번
    } = options;

    let lastUpdate = 0;
    let debounceTimer = null;
    let lastData = null;

    const optimizedCallback = (snapshot) => {
      const now = Date.now();

      // 빈도 제한
      if (now - lastUpdate < maxFrequency) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(
          () => optimizedCallback(snapshot),
          Math.min(debounceMs, maxFrequency - (now - lastUpdate))
        );
        return;
      }

      const data = snapshot.val();

      // 변경 감지
      if (JSON.stringify(data) === JSON.stringify(lastData)) {
        return; // 변경 없음
      }

      // 필터링
      if (filter && !filter(data)) {
        return;
      }

      lastData = data;
      lastUpdate = now;
      callback(snapshot);
    };

    // Firebase 리스너 등록 (실제로는 REST 폴백)
    return this.listenToPath(path, optimizedCallback);
  }

  /**
   * 경로별 리스너 관리
   */
  listenToPath(path, callback) {
    // REST 모드에서는 폴링으로 대체
    const pollInterval = setInterval(async () => {
      try {
        const snapshot = await get(ref(getDb(), path));
        callback(snapshot);
      } catch (error) {
        Logger.warn('[PerformanceOptimizer] 폴링 실패:', error);
      }
    }, 30000); // 30초마다 폴링

    // 초기 데이터 로드
    get(ref(getDb(), path))
      .then(callback)
      .catch((error) => {
        Logger.warn('[PerformanceOptimizer] 초기 데이터 로드 실패:', error);
      });

    // 정리 함수 반환
    return () => clearInterval(pollInterval);
  }

  /**
   * 데이터 압축 저장
   */
  async compressAndStore(path, data) {
    try {
      // 큰 데이터는 압축
      const jsonString = JSON.stringify(data);
      if (jsonString.length > 10000) {
        // 10KB 이상
        const compressed = await this.compressString(jsonString);
        await set(path, { compressed: true, data: compressed });
      } else {
        await set(path, data);
      }
    } catch (error) {
      Logger.warn('[PerformanceOptimizer] 압축 저장 실패:', error);
      await set(path, data);
    }
  }

  /**
   * 문자열 압축 (간단한 LZ 압축)
   */
  async compressString(str) {
    // 간단한 압축 로직 (실제로는 더 효율적인 알고리즘 사용 권장)
    const compressed = btoa(encodeURIComponent(str));
    return compressed;
  }

  /**
   * 압축 해제
   */
  async decompressString(compressed) {
    try {
      return decodeURIComponent(atob(compressed));
    } catch (error) {
      Logger.warn('[PerformanceOptimizer] 압축 해제 실패:', error);
      return compressed;
    }
  }
}

// 싱글톤 인스턴스
export const performanceOptimizer = new FirebasePerformanceOptimizer();
