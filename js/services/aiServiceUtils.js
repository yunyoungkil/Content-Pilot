// js/services/aiServiceUtils.js

import { Logger } from '../utils.js';
import { API_CONFIG } from './aiServiceConfig.js';

/**
 * AI Service Utilities
 * 재시도 로직, JSON 파싱, Result 타입 등 공통 유틸리티 함수들
 */

/**
 * Result 타입 클래스 - 성공/실패 결과를 표준화
 */
export class Result {
  constructor(success, data = null, error = null) {
    this.success = success;
    this.data = data;
    this.error = error;
  }

  static success(data) {
    return new Result(true, data);
  }

  static failure(error) {
    return new Result(false, null, error);
  }

  static fromPromise(promise) {
    return promise.then((data) => Result.success(data)).catch((error) => Result.failure(error));
  }
}

/**
 * 재시도 로직을 포함한 비동기 함수 실행
 * @param {Function} fn - 실행할 비동기 함수
 * @param {Object} options - 재시도 옵션
 * @returns {Promise} 실행 결과
 */
export async function retryWithBackoff(fn, options = {}) {
  const {
    maxRetries = API_CONFIG.MAX_RETRIES,
    baseDelay = API_CONFIG.RETRY_DELAY_BASE,
    multiplier = API_CONFIG.RETRY_DELAY_MULTIPLIER,
    shouldRetry = () => true,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries && shouldRetry(error)) {
        const delay = baseDelay * Math.pow(multiplier, attempt);
        Logger.debug(`[retryWithBackoff] 재시도 ${attempt + 1}/${maxRetries} - ${delay}ms 대기`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

/**
 * API 호출을 위한 재시도 래퍼
 * @param {Function} apiCall - API 호출 함수
 * @param {string} operationName - 작업 이름 (로깅용)
 * @returns {Promise} API 호출 결과
 */
export async function retryApiCall(apiCall, operationName = 'API call') {
  return retryWithBackoff(apiCall, {
    shouldRetry: (error) => {
      // 특정 에러는 재시도하지 않음
      const nonRetryableErrors = [
        'Gemini API 키가 없습니다',
        'API key not valid',
        'Please pass a valid API key',
      ];

      return !nonRetryableErrors.some((msg) => error.message?.includes(msg));
    },
  });
}

/**
 * 안전한 JSON 파싱 - 다양한 포맷 지원
 * @param {string} jsonString - 파싱할 JSON 문자열
 * @param {Object} options - 파싱 옵션
 * @returns {Result} 파싱 결과
 */
export function safeJsonParse(jsonString, options = {}) {
  const { context = 'JSON parsing' } = options;

  if (!jsonString || typeof jsonString !== 'string') {
    return Result.failure(new Error(`${context}: 입력이 문자열이 아닙니다`));
  }

  const trimmed = jsonString.trim();

  // 직접 JSON 파싱 시도
  try {
    const parsed = JSON.parse(trimmed);
    return Result.success(parsed);
  } catch (e1) {
    Logger.debug(`[${context}] 직접 파싱 실패, 다른 방법 시도`);

    // 배열 패턴 추출 시도
    const arrayMatch = trimmed.match(/\[[\s\S]*?\]/);
    if (arrayMatch) {
      try {
        const parsed = JSON.parse(arrayMatch[0]);
        return Result.success(parsed);
      } catch (e2) {
        Logger.debug(`[${context}] 배열 패턴 파싱 실패`);
      }
    }

    // 마크다운 코드 블록에서 추출 시도
    const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (codeBlockMatch) {
      try {
        const parsed = JSON.parse(codeBlockMatch[1]);
        return Result.success(parsed);
      } catch (e3) {
        Logger.debug(`[${context}] 코드 블록 파싱 실패`);
      }
    }

    // 모든 파싱 시도 실패
    return Result.failure(new Error(`${context}: 유효한 JSON 형식을 찾을 수 없습니다`));
  }
}

/**
 * 배열을 안전하게 필터링하고 변환
 * @param {Array} array - 입력 배열
 * @param {Function} mapper - 변환 함수
 * @param {Function} filter - 필터 함수
 * @param {Object} options - 옵션
 * @returns {Array} 변환된 배열
 */
export function safeArrayTransform(array, mapper = (x) => x, filter = (x) => true, options = {}) {
  const { maxLength = Infinity, context = 'array transform' } = options;

  if (!Array.isArray(array)) {
    Logger.warn(`[${context}] 입력이 배열이 아닙니다:`, typeof array);
    return [];
  }

  try {
    return array
      .map((item, index) => {
        try {
          return mapper(item, index);
        } catch (error) {
          Logger.warn(`[${context}] 항목 변환 실패 (인덱스 ${index}):`, error);
          return null;
        }
      })
      .filter((item, index) => {
        if (item === null) return false;
        try {
          return filter(item, index);
        } catch (error) {
          Logger.warn(`[${context}] 항목 필터링 실패 (인덱스 ${index}):`, error);
          return false;
        }
      })
      .slice(0, maxLength);
  } catch (error) {
    Logger.error(`[${context}] 배열 변환 전체 실패:`, error);
    return [];
  }
}

/**
 * 텍스트를 안전하게 정리
 * @param {string} text - 정리할 텍스트
 * @param {Object} options - 정리 옵션
 * @returns {string} 정리된 텍스트
 */
export function sanitizeText(text, options = {}) {
  const { trim = true, removeMarkdownCodeBlocks = true, context = 'text sanitization' } = options;

  if (!text || typeof text !== 'string') {
    Logger.warn(`[${context}] 입력이 문자열이 아닙니다:`, typeof text);
    return '';
  }

  let sanitized = text;

  // 마크다운 코드 블록 제거
  if (removeMarkdownCodeBlocks) {
    sanitized = sanitized
      .replace(/^```markdown\s*\n?/i, '')
      .replace(/^```md\s*\n?/i, '')
      .replace(/^```\s*\n?/i, '')
      .replace(/\n?```\s*$/i, '')
      .replace(/\n?```markdown\s*$/i, '')
      .replace(/\n?```md\s*$/i, '');
  }

  // 앞뒤 공백 제거
  if (trim) {
    sanitized = sanitized.trim();
  }

  return sanitized;
}

/**
 * 프롬프트를 최적화 (길이 제한 및 요약)
 * @param {string} prompt - 원본 프롬프트
 * @param {Object} options - 최적화 옵션
 * @returns {string} 최적화된 프롬프트
 */
export function optimizePrompt(prompt, options = {}) {
  const {
    maxLength = API_CONFIG.MAX_PROMPT_LENGTH,
    summaryLength = API_CONFIG.OPTIMIZED_PROMPT_LENGTH,
    context = 'prompt optimization',
  } = options;

  if (!prompt || typeof prompt !== 'string') {
    Logger.warn(`[${context}] 입력이 문자열이 아닙니다`);
    return '';
  }

  if (prompt.length <= maxLength) {
    return prompt;
  }

  Logger.warn(`[${context}] 프롬프트가 너무 깁니다 (${prompt.length}자). 요약합니다.`);

  // 간단한 요약: 앞부분만 유지하고 축소 표시 추가
  const optimized =
    prompt.substring(0, summaryLength) +
    '\n\n[프롬프트가 길어 축소되었습니다. 핵심 내용만 포함합니다.]';

  return optimized;
}

/**
 * 타임아웃이 있는 Promise 생성
 * @param {Promise} promise - 원본 Promise
 * @param {number} timeoutMs - 타임아웃 시간 (밀리초)
 * @returns {Promise} 타임아웃이 적용된 Promise
 */
export function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * 비동기 작업의 진행률을 추적하는 헬퍼
 * @param {Array<Function>} tasks - 실행할 작업 함수들
 * @param {Function} onProgress - 진행률 콜백 (0-100)
 * @returns {Promise<Array>} 모든 작업의 결과
 */
export async function trackProgress(tasks, onProgress = null) {
  const results = [];
  const totalTasks = tasks.length;

  for (let i = 0; i < totalTasks; i++) {
    try {
      const result = await tasks[i]();
      results.push(result);
    } catch (error) {
      Logger.error(`[trackProgress] 작업 ${i + 1} 실패:`, error);
      results.push(null);
    }

    if (onProgress) {
      const progress = Math.round(((i + 1) / totalTasks) * 100);
      try {
        onProgress(progress);
      } catch (callbackError) {
        Logger.warn('[trackProgress] 진행률 콜백 실패:', callbackError);
      }
    }
  }

  return results;
}

/**
 * 동시 실행을 제한하는 헬퍼
 * @param {Array<Function>} tasks - 실행할 작업 함수들
 * @param {number} maxConcurrent - 최대 동시 실행 수
 * @returns {Promise<Array>} 모든 작업의 결과
 */
export async function limitConcurrency(tasks, maxConcurrent = API_CONFIG.MAX_CONCURRENT_REQUESTS) {
  const results = [];
  const executing = [];

  for (const task of tasks) {
    const promise = task().then((result) => {
      results.push(result);
      return result;
    });

    results.push(promise);

    if (executing.length >= maxConcurrent) {
      await Promise.race(executing);
    }

    const cleanup = promise.finally(() => {
      executing.splice(executing.indexOf(cleanup), 1);
    });
    executing.push(cleanup);
  }

  await Promise.all(executing);
  return results;
}
