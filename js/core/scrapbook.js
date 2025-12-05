// js/core/scrapbook.js
// 스크랩북 문맥 추출 강화 - Readability.js와 유사한 경량화 로직

/**
 * [Readability.js 경량화] 본문에서 핵심 문맥 추출
 * h1, h2, strong 태그 등 핵심 키워드에 가중치를 부여하여 중요 문장을 식별합니다.
 *
 * @param {HTMLElement|string} element - 추출할 DOM 요소 또는 HTML 문자열
 * @returns {Object} { text: string, highlights: Array<{text: string, score: number, startIndex: number, endIndex: number}> }
 */
import { Logger } from '../utils.js';

export function extractContextualContent(element) {
  // HTML 문자열인 경우 DOM으로 변환
  let rootElement;
  if (typeof element === 'string') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(element, 'text/html');
    rootElement = doc.body || doc.documentElement;
  } else {
    rootElement = element;
  }

  if (!rootElement) {
    return { text: '', highlights: [] };
  }

  // 1. 불필요한 요소 제거 (Readability.js 스타일)
  const unwantedSelectors = [
    'script',
    'style',
    'nav',
    'header',
    'footer',
    'aside',
    'advertisement',
    '.ad',
    '.ads',
    '.social-share',
    '.comment',
    '.comments',
    '.related',
    '.sidebar',
    '.menu',
  ];

  unwantedSelectors.forEach((selector) => {
    try {
      const elements = rootElement.querySelectorAll(selector);
      elements.forEach((el) => el.remove());
    } catch (e) {
      // selector 오류 무시
    }
  });

  // 2. 텍스트 노드와 부모 요소 정보 수집
  const textNodes = [];

  function collectTextNodes(node, parentTag = null, parentScore = 0) {
    if (!node) return;

    // 현재 노드의 태그와 가중치 확인
    let currentTag = parentTag;
    let currentScore = parentScore;

    if (node.nodeType === Node.ELEMENT_NODE) {
      const tagName = node.tagName ? node.tagName.toLowerCase() : '';
      currentTag = tagName;

      // 태그별 가중치
      if (tagName === 'h1') currentScore = 10;
      else if (tagName === 'h2') currentScore = 8;
      else if (tagName === 'h3') currentScore = 6;
      else if (tagName === 'h4') currentScore = 4;
      else if (tagName === 'strong' || tagName === 'b') currentScore = Math.max(currentScore, 5);
      else if (tagName === 'em') currentScore = Math.max(currentScore, 3);
      else if (tagName === 'blockquote') currentScore = Math.max(currentScore, 4);

      // 클래스/ID 기반 가중치 추가
      if (node.className) {
        const className = String(node.className).toLowerCase();
        if (className.includes('title') || className.includes('heading')) currentScore += 3;
        if (className.includes('summary') || className.includes('intro')) currentScore += 2;
        if (className.includes('highlight') || className.includes('important')) currentScore += 2;
      }

      if (node.id) {
        const id = String(node.id).toLowerCase();
        if (id.includes('title') || id.includes('heading')) currentScore += 3;
        if (id.includes('summary') || id.includes('intro')) currentScore += 2;
      }
    }

    // 자식 노드 순회
    if (node.childNodes) {
      for (let i = 0; i < node.childNodes.length; i++) {
        const child = node.childNodes[i];
        if (child.nodeType === Node.TEXT_NODE) {
          const text = child.textContent.trim();
          if (text.length > 0) {
            textNodes.push({
              text: text,
              tag: currentTag,
              baseScore: currentScore,
              element: child.parentElement,
            });
          }
        } else {
          collectTextNodes(child, currentTag, currentScore);
        }
      }
    }
  }

  collectTextNodes(rootElement);

  // 3. 전체 텍스트 추출
  const fullText = rootElement.innerText || rootElement.textContent || '';

  if (!fullText || fullText.trim().length === 0) {
    return { text: fullText, highlights: [] };
  }

  // 4. 문장 단위로 분리 및 하이라이트 식별
  // 더 유연한 문장 분리 (한국어 문장 종결 부호 포함)
  const sentenceRegex = /[.!?。！？]\s*/g;
  const sentences = fullText
    .split(sentenceRegex)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length > 5); // 최소 5자 이상만

  console.log('[extractContextualContent] 전체 문장 수:', sentences.length);
  console.log('[extractContextualContent] 전체 텍스트 길이:', fullText.length);

  if (sentences.length === 0) {
    console.warn('[extractContextualContent] 문장이 없음');
    return { text: fullText, highlights: [] };
  }

  const highlights = [];

  let currentIndex = 0;
  sentences.forEach((sentenceText, index) => {
    // 문장이 전체 텍스트에서 시작하는 위치 찾기
    const startIndex = fullText.indexOf(sentenceText, currentIndex);
    if (startIndex === -1) {
      currentIndex += sentenceText.length + 1;
      return;
    }
    const endIndex = startIndex + sentenceText.length;
    currentIndex = endIndex + 1;

    // 문장의 중요도 점수 계산
    let score = 0;

    // 1. 문장이 포함된 텍스트 노드의 부모 요소 가중치
    const matchingNode = textNodes.find((node) => {
      const nodeStart = fullText.indexOf(node.text, Math.max(0, startIndex - 100));
      return (
        nodeStart !== -1 && nodeStart <= startIndex && nodeStart + node.text.length >= endIndex
      );
    });

    if (matchingNode) {
      score += matchingNode.baseScore;
    }

    // 2. 문장 길이 (적절한 길이면 가점)
    const length = sentenceText.length;
    if (length >= 15 && length <= 200) score += 2;
    else if (length >= 10 && length < 15) score += 1;
    else if (length < 5 || length > 500) score -= 1;

    // 3. 키워드 밀도 (중요 단어 포함 여부)
    const importantKeywords = [
      '핵심',
      '중요',
      '결론',
      '요약',
      '정리',
      '비교',
      '분석',
      '결과',
      '방법',
      '팁',
      '꿀팁',
      '비밀',
      '주의',
      '필수',
    ];
    const lowerSentence = sentenceText.toLowerCase();
    importantKeywords.forEach((keyword) => {
      if (lowerSentence.includes(keyword)) score += 2;
    });

    // 4. 숫자나 통계 포함 (중요 정보일 가능성)
    if (/\d+/.test(sentenceText)) score += 1;

    // 5. 질문 형태 (독자 관심 유도)
    if (
      sentenceText.includes('?') ||
      sentenceText.includes('어떻게') ||
      sentenceText.includes('왜') ||
      sentenceText.includes('무엇')
    )
      score += 1;

    // 모든 문장에 최소 1점 부여 (너무 짧지 않은 경우)
    if (length >= 10) score = Math.max(score, 1);

    // 하이라이트 대상 문장 (점수 1 이상 - 거의 모든 문장이 선택되도록)
    highlights.push({
      text: sentenceText,
      score: score,
      index: index,
      startIndex: startIndex,
      endIndex: endIndex,
    });
  });

  console.log('[extractContextualContent] 하이라이트 후보 수:', highlights.length);
  console.log('[extractContextualContent] 점수 분포:', {
    min: Math.min(...highlights.map((h) => h.score)),
    max: Math.max(...highlights.map((h) => h.score)),
    avg: (highlights.reduce((sum, h) => sum + h.score, 0) / highlights.length).toFixed(2),
  });

  // 점수순으로 정렬 (상위 30%만 선택, 최소 1개, 최대 10개)
  highlights.sort((a, b) => b.score - a.score);
  const topCount = Math.max(
    1,
    Math.min(highlights.length, Math.max(1, Math.ceil(highlights.length * 0.3)), 10)
  );
  const topHighlights = highlights.slice(0, topCount);

  console.log('[extractContextualContent] 최종 선택된 하이라이트 수:', topHighlights.length);
  if (topHighlights.length > 0) {
    console.log('[extractContextualContent] 상위 하이라이트 예시:', {
      text: topHighlights[0].text.substring(0, 50) + '...',
      score: topHighlights[0].score,
    });
  } else {
    console.warn('[extractContextualContent] 하이라이트가 없음! 최소 1개는 선택해야 함');
    // 최소 1개는 무조건 선택 (가장 긴 문장)
    if (highlights.length > 0) {
      const longest = highlights.reduce((a, b) => (a.text.length > b.text.length ? a : b));
      topHighlights.push(longest);
      console.log(
        '[extractContextualContent] 최장 문장 선택:',
        longest.text.substring(0, 50) + '...'
      );
    }
  }

  return {
    text: fullText,
    highlights: topHighlights.map((h) => ({
      text: h.text,
      score: h.score,
      startIndex: h.startIndex,
      endIndex: h.endIndex,
    })),
  };
}

/**
 * 하이라이트 메타데이터를 HTML에 적용
 * @param {string} text - 원본 텍스트
 * @param {Array} highlights - 하이라이트 정보 배열
 * @returns {string} 하이라이트가 적용된 HTML
 */
export function applyHighlightsToHTML(text, highlights) {
  if (!highlights || highlights.length === 0) return text;

  // Normalize ranges and clamp to bounds. Ignore invalid ranges.
  const len = text ? text.length : 0;
  const ranges = (highlights || [])
    .map((h) => {
      const s = Number.isFinite(h.startIndex) ? h.startIndex : 0;
      const e = Number.isFinite(h.endIndex)
        ? h.endIndex
        : Math.min(len, s + (h.text ? String(h.text).length : 0));
      return {
        startIndex: Math.max(0, Math.min(len, s)),
        endIndex: Math.max(0, Math.min(len, e)),
        score: Number.isFinite(h.score) ? h.score : 1,
      };
    })
    .filter((r) => r.startIndex < r.endIndex);

  if (ranges.length === 0) return text;

  // Merge overlapping ranges to produce non-overlapping highlights
  ranges.sort((a, b) => a.startIndex - b.startIndex);
  const merged = [];
  for (const r of ranges) {
    if (merged.length === 0) {
      merged.push({ ...r });
      continue;
    }
    const last = merged[merged.length - 1];
    if (r.startIndex <= last.endIndex) {
      // overlap -> extend the previous segment
      last.endIndex = Math.max(last.endIndex, r.endIndex);
      last.score = Math.max(last.score, r.score);
    } else {
      merged.push({ ...r });
    }
  }

  // Build final HTML using merged ranges (single pass)
  let result = '';
  let prev = 0;
  for (const m of merged) {
    result += text.substring(prev, m.startIndex);
    const highlightedText = text.substring(m.startIndex, m.endIndex);
    result += `<mark class="scrap-highlight" data-score="${m.score}">${highlightedText}</mark>`;
    prev = m.endIndex;
  }
  result += text.substring(prev);
  return result;
}

/**
 * 스크랩 데이터에 하이라이트 메타데이터 추가
 * @param {Object} scrapData - 원본 스크랩 데이터
 * @returns {Object} 하이라이트가 추가된 스크랩 데이터
 */
export function enrichScrapWithHighlights(scrapData) {
  try {
    console.log('[enrichScrapWithHighlights] 시작. scrapData:', {
      hasText: !!scrapData.text,
      textLength: scrapData.text?.length || 0,
      hasHtml: !!scrapData.html,
      htmlLength: scrapData.html?.length || 0,
      hasSourceElement: !!scrapData._sourceElement,
    });

    // HTML 또는 텍스트에서 문맥 추출
    // DOM 요소가 직접 전달되는 경우를 우선 처리
    let source = scrapData.html || scrapData.text || '';
    let sourceElement = null;

    // DOM 요소가 있는 경우 (highlighter.js에서 전달)
    if (scrapData._sourceElement && scrapData._sourceElement.nodeType === Node.ELEMENT_NODE) {
      sourceElement = scrapData._sourceElement;
      source = scrapData.html || scrapData.text || '';
      console.log('[enrichScrapWithHighlights] DOM 요소 사용:', {
        tagName: sourceElement.tagName,
        textLength: sourceElement.innerText?.length || 0,
      });
    }

    if (!source && !sourceElement) {
      console.warn('[enrichScrapWithHighlights] 소스 데이터 없음');
      return scrapData;
    }

    // DOM 요소가 있으면 직접 사용, 없으면 HTML 문자열 사용
    console.log('[enrichScrapWithHighlights] extractContextualContent 호출 전');
    const contextual = sourceElement
      ? extractContextualContent(sourceElement)
      : extractContextualContent(source);

    console.log('[enrichScrapWithHighlights] 추출 결과:', {
      textLength: contextual.text?.length || 0,
      highlightsCount: contextual.highlights?.length || 0,
      highlights: contextual.highlights,
    });

    // 하이라이트 정보 추가
    const enrichedData = {
      ...scrapData,
      text: contextual.text || scrapData.text,
      highlights: contextual.highlights || [],
      hasHighlights: (contextual.highlights || []).length > 0,
    };

    console.log('[enrichScrapWithHighlights] 최종 결과:', {
      hasHighlights: enrichedData.hasHighlights,
      highlightsCount: enrichedData.highlights?.length || 0,
    });

    // 하이라이트가 적용된 HTML 생성 (선택적)
    if (scrapData.html && contextual.highlights && contextual.highlights.length > 0) {
      enrichedData.highlightedHtml = applyHighlightsToHTML(contextual.text, contextual.highlights);
    }

    return enrichedData;
  } catch (error) {
    console.error('[enrichScrapWithHighlights] 오류:', error);
    console.error('[enrichScrapWithHighlights] 스택:', error.stack);
    return scrapData; // 오류 시 원본 반환
  }
}

// 디버그 모드에서만 로그 출력
if (typeof Logger !== 'undefined' && Logger.isDebugMode()) {
  Logger.debug('[System] scrapbook 모듈 로드 완료');
}
