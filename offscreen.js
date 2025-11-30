// offscreen.js (Lazy Loading 대응 시점으로 복원)

import DOMPurify from 'dompurify';
import { marked } from 'marked';

// Debug: log immediately on script load so we can confirm the offscreen bundle
// actually executed and attached its message listeners.
try {
  console.debug('[Offscreen] offscreen.js loaded');
} catch (e) {
  console.debug('[Offscreen] offscreen.js loaded - console unavailable', e);
}

// --- 유틸리티 함수 ---

/**
 * HTML 정제 및 포매팅 로직 (기존 aiService.js 로직 이관 및 개선)
 * @param {string} text - 정제할 원본 텍스트
 * @returns {Promise<string>} 정제 및 포매팅된 HTML
 */
async function sanitizeAndFormatHtml(text) {
  if (!text) return '';

  // 0. 썸네일 정보 태그 제거 (본문에 포함되지 않도록 먼저 제거)
  // (aiService.js에서 이미 제거했지만, 안전장치로 여기서도 제거)
  let cleanedText = text.replace(/<썸네일정보>[\s\S]*?<\/썸네일정보>/g, '').trim();

  // 1. 마크다운 감지 및 변환
  // (기존의 복잡한 정규식 대신 marked가 안전하게 처리하도록 함)
  let html = cleanedText;
  // 마크다운 링크 패턴 개선: [텍스트](URL) 형식 감지 강화
  const isMarkdownCandidate =
    /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\[[^\]]+\]\([^)]+\)/m.test(cleanedText);

  if (isMarkdownCandidate) {
    // marked 옵션 설정: 줄바꿈 처리 등
    marked.use({ breaks: true, gfm: true });
    html = await marked.parse(cleanedText);
  } else {
    // 마크다운 후보가 아니어도 마크다운 링크만 있는 경우 처리
    // 예: "쿠진아트 에어프라이어를 사용하고 계신다면, [완벽 가이드] 쿠진아트 에어프라이어 그릴 오븐 청소 꿀팁 총정리!](https://...)"
    const markdownLinkPattern = /\[([^\]]+)\]\(([^)]+)\)/g;
    if (markdownLinkPattern.test(cleanedText)) {
      // marked로 마크다운 링크만 변환
      marked.use({ breaks: true, gfm: true });
      html = await marked.parse(cleanedText);
    }
  }

  // 2. DOMPurify를 통한 강력한 XSS 방어 (Sanitization)
  const cleanHtml = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'p',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'strong',
      'b',
      'i',
      'em',
      'mark',
      'span',
      'div',
      'a',
      'img',
      'blockquote',
      'code',
      'pre',
      'table',
      'thead',
      'tbody',
      'tr',
      'th',
      'td',
    ],
    ALLOWED_ATTR: [
      'href',
      'src',
      'alt',
      'title',
      'target',
      'rel',
      'style',
      'class',
      'id',
      'width',
      'height',
      'align',
    ],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'], // 위험 태그 명시적 차단
    FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'], // 이벤트 핸들러 차단
  });

  // 3. DOM 조작을 통한 스타일링 및 포매팅
  const parser = new DOMParser();
  const doc = parser.parseFromString(cleanHtml, 'text/html');
  const body = doc.body;

  // 3.1 링크 스타일링 및 보안 속성 추가
  body.querySelectorAll('a').forEach((a) => {
    a.style.textDecoration = 'none';

    // [수정] 제휴 링크 스타일 보존: 부모 span에 녹색 스타일이 있으면 유지
    const parentSpan = a.closest('span[style*="#2e7d32"], span[style*="rgb(46, 125, 50)"]');

    if (parentSpan) {
      // 제휴 링크인 경우: 부모 span의 스타일을 링크에 직접 적용
      const spanStyle = parentSpan.getAttribute('style') || '';
      const colorMatch = spanStyle.match(/color:\s*(#[0-9a-fA-F]{6}|rgb\([^)]+\))/);
      if (colorMatch) {
        a.style.color = colorMatch[1];
      } else {
        a.style.color = '#2e7d32'; // 기본 녹색
      }
      // span의 스타일이 링크에 적용되었으므로 span은 제거하지 않고 유지 (시각적 강조)
    } else {
      // 제휴 링크가 아니면 기본 파란색 적용
      a.style.color = '#1a73e8';
    }

    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener noreferrer'); // 보안 강화
  });

  // 3.2 "참고 자료 (1)" 같은 불필요한 텍스트 노드 제거 (TreeWalker 사용)
  const walker = doc.createTreeWalker(body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    // 괄호나 대괄호로 감싸진 참고 자료 번호 패턴 제거
    if (/[\(\[]참고\s*자료\s*\d+[\)\]]/i.test(node.nodeValue)) {
      node.nodeValue = node.nodeValue.replace(/[\(\[]참고\s*자료\s*\d+[\)\]]/gi, '');
    }
  }

  // 3.3 중요 문장 하이라이팅 (<mark> 태그가 없는 경우 자동 적용)
  // 문단 전체가 아닌 중요한 문장만 하이라이팅
  if (!body.querySelector('mark')) {
    const importantKeywords = ['중요', '핵심', '요약', '결론', '주의', '필수', '반드시', '꼭'];
    let markCount = 0;

    // <p> 태그 내의 텍스트를 문장 단위로 하이라이팅
    body.querySelectorAll('p').forEach((p) => {
      if (markCount >= 2) return;

      // 이미 다른 태그가 복잡하게 섞인 경우 건너뜀
      const innerHTML = p.innerHTML;
      if (
        innerHTML.includes('<hr') ||
        innerHTML.includes('<img') ||
        innerHTML.includes('<a') ||
        innerHTML.includes('<mark')
      )
        return;

      const text = p.textContent || p.innerText || '';
      if (text.length < 20 || text.length > 500) return;

      for (const keyword of importantKeywords) {
        if (markCount >= 2) break;
        if (!text.includes(keyword)) continue;

        // 키워드가 포함된 문장 찾기 (마침표, 느낌표, 물음표로 구분)
        // 정규식으로 문장 경계 찾기
        const keywordIndex = text.indexOf(keyword);
        if (keywordIndex === -1) continue;

        // 문장 시작 찾기 (키워드 앞의 마지막 마침표/느낌표/물음표)
        let sentenceStart = 0;
        for (let i = keywordIndex - 1; i >= 0; i--) {
          if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
            sentenceStart = i + 1;
            break;
          }
        }

        // 문장 끝 찾기 (키워드 뒤의 첫 번째 마침표/느낌표/물음표)
        let sentenceEnd = text.length;
        for (let i = keywordIndex + keyword.length; i < text.length; i++) {
          if (text[i] === '.' || text[i] === '!' || text[i] === '?') {
            sentenceEnd = i + 1;
            break;
          }
        }

        const sentence = text.substring(sentenceStart, sentenceEnd).trim();

        if (sentence.length > 10 && sentence.length < 200) {
          // innerHTML에서 문장을 찾아 <mark> 태그로 감싸기
          const beforeText = text.substring(0, sentenceStart);
          const afterText = text.substring(sentenceEnd);

          // HTML 이스케이프 처리된 문장 찾기
          const escapedSentence = sentence.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(${escapedSentence})`, 'g');

          // innerHTML에서 문장만 교체 (HTML 태그는 유지)
          const newHTML = innerHTML.replace(regex, (match) => {
            // 이미 태그로 감싸져 있지 않은 경우만
            if (!match.includes('<mark') && !match.includes('</mark>')) {
              return `<mark style="background-color: rgba(255, 255, 204, 0.5); padding: 2px 4px; border-radius: 3px;">${match}</mark>`;
            }
            return match;
          });

          if (newHTML !== innerHTML) {
            p.innerHTML = newHTML;
            markCount++;
            break;
          }
        }
      }
    });
  }

  // 3.4 <hr> 태그 스타일링
  body.querySelectorAll('hr').forEach((hr) => {
    hr.style.border = 'none';
    hr.style.borderTop = '2px solid #e0e0e0';
    hr.style.margin = '24px 0 32px 0';
  });

  return body.innerHTML;
}

/**
 * 텍스트에서 불필요한 공백과 줄 바꿈을 제거하고 문단 구조를 유지합니다.
 */
function formatCleanText(text) {
  if (!text) return '';
  let processedText = text.replace(/\n\s*\n\s*\n/g, '__PARAGRAPH_BREAK__');
  processedText = processedText.replace(/\n/g, ' ');
  processedText = processedText.replace(/__PARAGRAPH_BREAK__/g, '\n');
  processedText = processedText.replace(/\s+/g, ' ').trim();
  return processedText;
}

/**
 * 다양한 방법으로 블로그 본문 요소를 찾아내는 함수
 */
function findContentElement(doc) {
  // 1. 주요 플랫폼의 명확한 본문 선택자 우선 탐색
  const specificSelectors = [
    '.se-main-container', // 네이버 블로그 (최신 에디터)
    '.contents_style', // 티스토리 (주요 스킨)
    '.article_view', // 티스토리 (구형 스킨)
    'article.post-content', // 워드프레스 등
  ];
  for (const selector of specificSelectors) {
    const element = doc.querySelector(selector);
    if (element) return element;
  }

  // 2. 일반적인 본문 컨테이너 선택자 탐색
  const genericSelectors = ['.entry-content', '.post-content', '.article_content', 'article'];
  for (const selector of genericSelectors) {
    const element = doc.querySelector(selector);
    if (element) return element;
  }

  // 3. 최후의 수단: 가장 텍스트가 많은 <div>를 본문으로 간주
  let largestElement = null;
  let maxTextLength = 0;
  doc.querySelectorAll('div').forEach((el) => {
    const textLength = el.innerText.trim().length;
    if (
      textLength > 1000 &&
      textLength > maxTextLength &&
      !/ad|banner|comment|footer|header|profile/i.test(el.id || el.className)
    ) {
      maxTextLength = textLength;
      largestElement = el;
    }
  });

  return largestElement || doc.body;
}

/**
 * 블로그 지표 및 텍스트를 추출하는 메인 함수
 */
function parseContentAndMetrics(doc, urlObj) {
  const host = urlObj.hostname;
  let commentSelector, likeSelector;

  // 플랫폼별 댓글/좋아요 선택자 설정
  if (host.includes('blog.naver.com')) {
    commentSelector = '#commentCount, ._commentCount';
    likeSelector = '.u_likeit_text_count';
  } else if (host.includes('tistory.com')) {
    commentSelector = '.txt_댓글, .comment-count, #commentCount, .link_comment';
    likeSelector = '.txt_like, .like_button .num';
  } else {
    // 기타 일반 블로그
    commentSelector = '.comments-count, #comments, .comment-count';
    likeSelector = '.like-count, .post-like-count, .like';
  }

  // 모든 지표 변수 초기화
  let textLength = 0,
    imageCount = 0,
    cleanText = '',
    readTimeInSeconds = 0,
    hasVideo = false,
    linkCount = 0;
  let allImages = [];

  const contentElement = findContentElement(doc);

  if (contentElement) {
    const contentClone = contentElement.cloneNode(true);
    const unnecessarySelectors = 'ins, script, style, .adsbygoogle, [id*="ad-"], .ad-section';
    contentClone.querySelectorAll(unnecessarySelectors).forEach((el) => el.remove());

    // ▼▼▼ [핵심 로직] data-src를 우선으로 확인하여 이미지를 수집합니다. ▼▼▼
    const images = contentClone.querySelectorAll('img');
    images.forEach((img) => {
      let imageUrl = '';
      const parentSpan = img.closest('span[data-url]'); // <img>를 감싸는 span[data-url] 태그 찾기
      const parentLink = img.closest('a.__se_image_link'); // <img>를 감싸는 a 태그 찾기

      // 1. (티스토리) 부모 <span>의 data-url에 원본 URL이 있는지 최우선 확인
      if (parentSpan && parentSpan.dataset.url) {
        imageUrl = parentSpan.dataset.url;
      }
      // 2. (네이버) 부모 <a>의 data-linkdata에 원본 URL이 있는지 확인
      else if (parentLink && parentLink.dataset.linkdata) {
        try {
          const linkData = JSON.parse(parentLink.dataset.linkdata);
          if (linkData.src) imageUrl = linkData.src;
        } catch (e) {}
      }
      // 3. (티스토리 CDN) srcset에 CDN 주소가 있는지 확인
      if (!imageUrl) {
        const srcset = img.getAttribute('srcset');
        if (srcset && srcset.includes('daumcdn.net')) {
          imageUrl = srcset.split(',')[0].trim().split(' ')[0];
        }
      }
      // 4. 위의 방법으로 찾지 못했을 경우, 기존 속성들에서 URL 탐색
      if (!imageUrl) {
        imageUrl = img.getAttribute('data-lazy-src') || img.getAttribute('data-src') || img.src;
      }

      // 필터링 로직 (스티커, 지도 등 제외)
      const isIrrelevant = img.closest(
        '.se-module-usertool, .profile_area, .writer_info, [class*="profile"], [id*="profile"]'
      );
      const isSticker = img.classList.contains('se-sticker-image');
      const isDthumb = imageUrl && imageUrl.includes('dthumb-phinf.pstatic.net');
      const isStaticMap = imageUrl && imageUrl.includes('simg.pstatic.net');

      if (imageUrl && !isIrrelevant && !isSticker && !isDthumb && !isStaticMap) {
        const src = new URL(imageUrl, doc.baseURI).href;
        const alt = img.alt || '';
        allImages.push({ src, alt });
      }
    });
    imageCount = allImages.length;
    // ▲▲▲ 복원 완료 ▲▲▲

    cleanText = formatCleanText(contentClone.innerText);
    textLength = cleanText.length;
    linkCount = contentClone.querySelectorAll('a[href^="http"]').length;
    hasVideo =
      contentClone.querySelector('iframe[src*="youtube.com"], iframe[src*="vimeo.com"], video') !==
      null;

    if (textLength > 0) {
      const CPS = 25;
      readTimeInSeconds = Math.round(textLength / CPS);
    }
  }

  let commentCount = 0;
  const commentCountElement = doc.querySelector(commentSelector);
  if (commentCountElement) {
    commentCount = parseInt(commentCountElement.innerText.match(/\d+/)?.[0] || '0', 10);
  }

  let likeCount = 0;
  const likeCountElement = doc.querySelector(likeSelector);
  if (likeCountElement) {
    likeCount = parseInt(likeCountElement.innerText.match(/\d+/)?.[0] || '0', 10);
  }

  return {
    metrics: {
      commentCount,
      textLength,
      imageCount,
      likeCount,
      readTimeInSeconds,
      hasVideo,
      linkCount,
      allImages,
    },
    cleanText: cleanText,
  };
}

/**
 * 이미지 리사이징 함수 (Offscreen에서 실행)
 * @param {string} imageDataUrl - 원본 이미지 DataURL
 * @param {number} maxWidth - 최대 너비
 * @param {number} maxHeight - 최대 높이
 * @param {number} quality - JPEG 품질 (0-1)
 * @returns {Promise<string>} 리사이즈된 이미지 DataURL
 */
async function resizeImage(imageDataUrl, maxWidth, maxHeight, quality = 0.9) {
  return new Promise((resolve, reject) => {
    // DataURL 유효성 검사
    if (!imageDataUrl || typeof imageDataUrl !== 'string') {
      reject(new Error('유효하지 않은 이미지 데이터 URL'));
      return;
    }

    if (!imageDataUrl.startsWith('data:image/')) {
      reject(new Error('DataURL 형식이 올바르지 않습니다. data:image/로 시작해야 합니다.'));
      return;
    }

    const img = new Image();

    img.onload = () => {
      try {
        const startTime = performance.now();

        // 원본 비율 유지하면서 리사이즈
        let width = img.width;
        let height = img.height;

        if (width > maxWidth || height > maxHeight) {
          const ratio = Math.min(maxWidth / width, maxHeight / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }

        // 캔버스에 그리기
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        if (!ctx) {
          reject(new Error('캔버스 컨텍스트를 가져올 수 없습니다.'));
          return;
        }

        // 고품질 리사이징
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        // DataURL로 변환
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        const elapsed = Math.round(performance.now() - startTime);

        console.log(
          `⚡ [Offscreen] 이미지 리사이징 완료: ${img.width}x${img.height} → ${width}x${height} (${elapsed}ms)`
        );
        resolve(dataUrl);
      } catch (error) {
        console.error('[Offscreen] 이미지 처리 중 오류:', error);
        reject(new Error(`이미지 처리 실패: ${error.message}`));
      }
    };

    img.onerror = (error) => {
      console.error('[Offscreen] 이미지 로드 실패:', error);
      console.error('[Offscreen] DataURL 길이:', imageDataUrl ? imageDataUrl.length : 0);
      console.error(
        '[Offscreen] DataURL 시작 부분:',
        imageDataUrl ? imageDataUrl.substring(0, 100) : 'null'
      );
      reject(new Error(`이미지 로드 실패: DataURL이 유효하지 않거나 손상되었을 수 있습니다.`));
    };

    // CORS 문제 방지를 위해 crossOrigin 설정
    img.crossOrigin = 'anonymous';
    img.src = imageDataUrl;
  });
}

/**
 * 템플릿 렌더링 함수 (Offscreen에서 실행)
 * @param {Object} templateData - 템플릿 데이터
 * @param {number} canvasWidth - 캔버스 너비
 * @param {number} canvasHeight - 캔버스 높이
 * @param {Object} dynamicText - 동적 텍스트
 * @returns {Promise<string>} 렌더링된 이미지 DataURL
 */
async function renderTemplateInOffscreen(
  templateData,
  canvasWidth,
  canvasHeight,
  dynamicText = {}
) {
  const startTime = performance.now();

  try {
    // 캔버스 생성
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');

    // 템플릿 렌더링 로직은 복잡하므로,
    // 일단 기본적인 배경과 텍스트만 처리
    // (전체 렌더링 로직은 thumbnailGenerator.js에서 처리)

    // 배경 렌더링
    if (templateData.background) {
      const bg = templateData.background;
      if (bg.type === 'color') {
        ctx.fillStyle = bg.value || '#000000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else if (bg.type === 'gradient') {
        const gradient = ctx.createLinearGradient(0, 0, canvasWidth, canvasHeight);
        // 간단한 그라디언트 파싱 (실제로는 더 복잡할 수 있음)
        ctx.fillStyle = bg.value || '#000000';
        ctx.fillRect(0, 0, canvasWidth, canvasHeight);
      } else if (bg.type === 'image' && bg.value) {
        // 이미지 배경 로드
        await new Promise((resolve, reject) => {
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => {
            ctx.drawImage(img, 0, 0, canvasWidth, canvasHeight);
            resolve();
          };
          img.onerror = reject;
          img.src = bg.value;
        });
      }
    }

    // 텍스트 레이어 렌더링 (간단한 버전)
    if (templateData.layers) {
      for (const layer of templateData.layers) {
        if (layer.type === 'text' && layer.text) {
          const x = layer.x > 1 ? layer.x : layer.x * canvasWidth;
          const y = layer.y > 1 ? layer.y : layer.y * canvasHeight;
          const fontSize = (layer.styles?.fontRatio || 0.1) * canvasHeight;

          ctx.save();
          ctx.font = `${layer.styles?.fontWeight || 'normal'} ${fontSize}px ${
            layer.styles?.fontFamily || 'Arial'
          }`;
          ctx.fillStyle = layer.styles?.fill || '#FFFFFF';
          ctx.textAlign = layer.styles?.align || 'center';
          ctx.textBaseline = layer.styles?.baseline || 'middle';
          ctx.fillText(layer.text, x, y);
          ctx.restore();
        }
      }
    }

    // DataURL로 변환
    const dataUrl = canvas.toDataURL('image/png', 1.0);
    const elapsed = Math.round(performance.now() - startTime);

    console.log(`⚡ [Offscreen] 템플릿 렌더링 완료: ${canvasWidth}x${canvasHeight} (${elapsed}ms)`);
    return dataUrl;
  } catch (error) {
    console.error('[Offscreen] 템플릿 렌더링 실패:', error);
    throw error;
  }
}

/**
 * 썸네일 합성 함수 (배경 이미지 + 텍스트)
 * @param {string} imageUrl - AI가 만든 배경 이미지 URL
 * @param {string} text - 삽입할 한글 문구
 * @param {string} textPosition - 텍스트 위치 ("top", "center", "bottom", 기본값: "bottom")
 * @returns {Promise<string>} 합성된 이미지 DataURL
 */

/**
 * 이미지를 찌그러뜨리지 않고 캔버스 비율에 맞춰 중앙 크롭(Cover)하여 그리는 함수
 */
function drawImageProp(ctx, img, x, y, w, h, offsetX, offsetY) {
  if (arguments.length === 2) {
    x = y = 0;
    w = ctx.canvas.width;
    h = ctx.canvas.height;
  }

  // 기본값 설정
  offsetX = typeof offsetX === 'number' ? offsetX : 0.5; // 0.5 = 중앙 정렬
  offsetY = typeof offsetY === 'number' ? offsetY : 0.5;

  // 1. 비율 유지를 위한 소스 크롭 영역 계산
  let iw = img.width,
    ih = img.height,
    r = Math.min(w / iw, h / ih),
    nw = iw * r, // 새로운 너비 (비율 유지)
    nh = ih * r, // 새로운 높이 (비율 유지)
    cx,
    cy,
    cw,
    ch,
    ar = 1;

  // 2. 비율 비교 (가로로 더 넓은지, 세로로 더 긴지)
  if (nw < w) ar = w / nw;
  if (Math.abs(ar - 1) < 1e-14 && nh < h) ar = h / nh;
  nw *= ar;
  nh *= ar;

  // 3. 소스 이미지에서 가져올 영역(Source Rect) 계산
  cw = iw / (nw / w);
  ch = ih / (nh / h);
  cx = (iw - cw) * offsetX;
  cy = (ih - ch) * offsetY;

  // 4. 캔버스에 그리기 (왜곡 없이 크롭됨)
  // ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
  if (cx < 0) cx = 0;
  if (cy < 0) cy = 0;
  if (cw > iw) cw = iw;
  if (ch > ih) ch = ih;

  ctx.drawImage(img, cx, cy, cw, ch, x, y, w, h);
}

/**
 * 썸네일 합성 함수 (수정됨)
 */
async function composeThumbnail(imageUrl, text) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const width = 1920;
      const height = 1080;

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');

      // [수정된 부분] 단순 drawImage 대신 drawImageProp 사용
      // 기존: ctx.drawImage(img, 0, 0, width, height); -> 왜곡 발생
      // 변경: 비율 유지하며 꽉 채우기 (Center Crop)
      drawImageProp(ctx, img, 0, 0, width, height);

      // --- 이하 텍스트/그라데이션 로직은 기존과 동일 ---

      // 2. 가독성을 위한 어두운 그라데이션
      const gradient = ctx.createLinearGradient(0, height * 0.6, 0, height);
      gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
      gradient.addColorStop(1, 'rgba(0, 0, 0, 0.7)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, height * 0.6, width, height * 0.4);

      // 3. 텍스트 설정
      const fontSize = 120;
      ctx.font = `900 ${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      // 4. 텍스트 스타일
      const tx = width / 2;
      const ty = height * 0.85;

      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 20;
      ctx.shadowOffsetX = 5;
      ctx.shadowOffsetY = 5;

      ctx.strokeStyle = 'black';
      ctx.lineWidth = 12;
      ctx.strokeText(text, tx, ty);

      ctx.shadowColor = 'transparent';
      ctx.fillStyle = 'white';
      ctx.fillText(text, tx, ty);

      resolve(canvas.toDataURL('image/png'));
    };

    img.onerror = (e) => reject(new Error('이미지 로드 실패'));
    img.src = imageUrl;
  });
}

/**
 * 이미지 크롭 함수 (중앙 기준 Center Crop)
 * @param {string} imageDataUrl - DataURL 형식의 이미지
 * @param {number} targetRatio - 목표 비율 (1 = 1:1, 1.33 = 4:3, 1.77 = 16:9)
 * @returns {Promise<string>} 크롭된 이미지의 DataURL
 */
async function cropImage(imageDataUrl, targetRatio) {
  return new Promise((resolve, reject) => {
    const img = new Image();

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      const originalWidth = img.width;
      const originalHeight = img.height;
      const originalRatio = originalWidth / originalHeight;

      let cropWidth, cropHeight, cropX, cropY;

      if (originalRatio > targetRatio) {
        // 원본이 더 넓음 → 높이 기준으로 크롭
        cropHeight = originalHeight;
        cropWidth = originalHeight * targetRatio;
        cropX = (originalWidth - cropWidth) / 2; // 중앙 정렬
        cropY = 0;
      } else {
        // 원본이 더 높음 → 너비 기준으로 크롭
        cropWidth = originalWidth;
        cropHeight = originalWidth / targetRatio;
        cropX = 0;
        cropY = (originalHeight - cropHeight) / 2; // 중앙 정렬
      }

      // Canvas 크기 설정
      canvas.width = cropWidth;
      canvas.height = cropHeight;

      // 이미지 크롭 및 그리기
      ctx.drawImage(
        img,
        cropX,
        cropY,
        cropWidth,
        cropHeight, // 소스 영역
        0,
        0,
        cropWidth,
        cropHeight // 대상 영역
      );

      // DataURL로 변환
      const croppedDataUrl = canvas.toDataURL('image/png');
      resolve(croppedDataUrl);
    };

    img.onerror = (error) => {
      reject(new Error('이미지 로드 실패: ' + error.message));
    };

    img.src = imageDataUrl;
  });
}

// Unified request handler so we can support both runtime messages and port messages
function safeSendReply(sendReply, payload) {
  // Always attempt to close the original message channel (sendReply)
  // If that fails (throws or sendReply isn't available), fall back to
  // chrome.runtime.sendMessage as a best-effort attempt to deliver the
  // reply so background won't keep a message channel open forever.
  try {
    if (typeof sendReply === 'function') {
      try {
        sendReply(payload);
        return;
      } catch (e) {
        // continue to fallback below
      }
    }
  } catch (e) {}

  try {
    chrome.runtime.sendMessage(payload).catch(() => {});
  } catch (e) {
    console.debug('[Offscreen] runtime.sendMessage fallback failed', e);
  }
}

// When we want to send the final response for long-running tasks we
// prefer posting back over an active port (if connected) and fall back
// to runtime.sendMessage if needed.
let activeOffscreenPort = null;

function sendFinalResponse(response) {
  try {
    if (activeOffscreenPort) {
      try {
        console.debug('[Offscreen] sendFinalResponse: using port to post', {
          action: response && response.action,
          ts: Date.now(),
          size: response && JSON.stringify(response).length,
        });
        activeOffscreenPort.postMessage(response);
        return;
      } catch (e) {
        console.debug(
          '[Offscreen] active port postMessage failed, falling back',
          response && response.action,
          e && e.message
        );
      }
    } else {
      try {
        console.debug('[Offscreen] sendFinalResponse: no active port, using runtime.sendMessage', {
          action: response && response.action,
          ts: Date.now(),
          size: response && JSON.stringify(response).length,
        });
      } catch (e) {}
    }
  } catch (e) {}

  try {
    chrome.runtime.sendMessage(response).catch(() => {});
  } catch (e) {}
}

function handleRequest(request, sendReply) {
  try {
    console.debug('[Offscreen] request received', request && request.action);
  } catch (e) {
    console.debug('[Offscreen] request received -', request && request.action);
  }

  if (!request || !request.action) return false;

  // ping
  if (request.action === 'offscreen_ping') {
    try {
      console.debug('[Offscreen] received offscreen_ping, replying');
      safeSendReply(sendReply, { action: 'offscreen_ping_response', ready: true });
    } catch (e) {
      console.error('[Offscreen] offscreen_ping handler error', e);
      safeSendReply(sendReply, { action: 'offscreen_ping_response', ready: true });
    }
    return false;
  }

  // sanitize
  if (request.action === 'sanitize_html_in_offscreen') {
    try {
      console.debug('[Offscreen] sanitize_html_in_offscreen received (via request)', {
        via: 'runtime',
        ts: Date.now(),
      });
    } catch (e) {}
    // ACK immediately to close any runtime message channel instead of
    // returning true and relying on sendResponse later (which can lead
    // to "channel closed" warnings).
    safeSendReply(sendReply, { action: 'sanitize_html_in_offscreen_ack' });

    // For debugging: support a fast echo path when request.debugEcho is set.
    if (request.debugEcho) {
      try {
        console.debug(
          '[Offscreen] sanitize_html_in_offscreen debugEcho -> immediate echo response'
        );
      } catch (e) {}
      sendFinalResponse({
        action: 'sanitize_html_in_offscreen_response',
        success: true,
        cleanedHtml: request.rawText || '',
      });
      return false;
    }

    sanitizeAndFormatHtml(request.rawText)
      .then((cleanedHtml) => {
        try {
          console.debug('[Offscreen] sanitize complete — preparing final response', {
            ts: Date.now(),
            length: cleanedHtml ? cleanedHtml.length : 0,
          });
        } catch (e) {}
        sendFinalResponse({
          action: 'sanitize_html_in_offscreen_response',
          success: true,
          cleanedHtml,
        });
      })
      .catch((error) => {
        try {
          console.debug(
            '[Offscreen] sanitize failed — preparing error response',
            error && error.message
          );
        } catch (e) {}
        sendFinalResponse({
          action: 'sanitize_html_in_offscreen_response',
          success: false,
          error: error.message,
        });
      });

    return false;
  }
  // parse_html_in_offscreen
  if (request.action === 'parse_html_in_offscreen') {
    try {
      try {
        console.debug('[Offscreen] parse_html_in_offscreen received', { ts: Date.now() });
      } catch (e) {}

      // immediate ack to close runtime channel; final response will be
      // delivered via port (preferred) or runtime.sendMessage fallback.
      safeSendReply(sendReply, { action: 'parse_html_in_offscreen_ack' });

      (async () => {
        try {
          const html = request.html || '';
          const baseUrl = request.baseUrl || document.baseURI;
          const parser = new DOMParser();
          const doc = parser.parseFromString(html, 'text/html');
          const urlObj = new URL(baseUrl, document.baseURI);

          // thumbnail: prefer og:image, else first image in doc
          const metaOg =
            doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
          const firstImg = doc.querySelector('img')?.getAttribute('src') || '';
          const thumbnail = metaOg || firstImg || '';

          const description =
            doc.querySelector('meta[name="description"]')?.getAttribute('content') || '';

          const metaTags = [];
          const keywordsMeta =
            doc.querySelector('meta[name="keywords"]')?.getAttribute('content') || '';
          if (keywordsMeta) {
            const keywords = keywordsMeta
              .split(/[,，、;；\s]+/)
              .map((k) => k.trim())
              .filter(Boolean);
            metaTags.push(...keywords);
          }

          const articleTags = doc.querySelectorAll('meta[property^="article:tag"]');
          articleTags.forEach((tag) => {
            const content = tag.getAttribute('content');
            if (content && !metaTags.includes(content)) metaTags.push(content);
          });

          const categoryLinks = doc.querySelectorAll(
            'a[href*="/category/"], a[href*="/c/"], a[href*="/tag/"], a[href*="/tags/"]'
          );
          categoryLinks.forEach((link) => {
            const href = link.getAttribute('href') || '';
            const text = (link.textContent || '').trim();
            if (text && text.length > 0 && text.length < 50) {
              const match = href.match(/\/(?:category|c|tag|tags)\/([^\/\?]+)/);
              if (match && match[1]) {
                const tagName = decodeURIComponent(match[1]);
                if (tagName && !metaTags.includes(tagName)) metaTags.push(tagName);
              } else if (!metaTags.includes(text)) metaTags.push(text);
            }
          });

          const uniqueTags = [...new Set(metaTags.map((t) => t.trim()).filter(Boolean))];

          const { metrics, cleanText } = parseContentAndMetrics(doc, urlObj);

          sendFinalResponse({
            action: 'parse_html_in_offscreen_response',
            success: true,
            thumbnail: thumbnail ? new URL(thumbnail, baseUrl).href : '',
            description,
            metrics,
            cleanText,
            metaTags: uniqueTags.length > 0 ? uniqueTags : null,
          });
        } catch (err) {
          console.error('[Offscreen] parse_html_in_offscreen error', err);
          sendFinalResponse({
            action: 'parse_html_in_offscreen_response',
            success: false,
            error: err && err.message ? err.message : String(err),
          });
        }
      })();

      return false;
    } catch (e) {
      console.error('[Offscreen] parse_html_in_offscreen outer error', e);
      safeSendReply(sendReply, { action: 'parse_html_in_offscreen_ack' });
      sendFinalResponse({
        action: 'parse_html_in_offscreen_response',
        success: false,
        error: e && e.message ? e.message : String(e),
      });
      return false;
    }
  }

  // resize
  if (request.action === 'resize_image_in_offscreen') {
    const { imageDataUrl, maxWidth, maxHeight, quality } = request;
    // acknowledge and process async, final response goes via port/runtime
    safeSendReply(sendReply, { action: 'resize_image_in_offscreen_ack' });
    resizeImage(imageDataUrl, maxWidth, maxHeight, quality)
      .then((dataUrl) =>
        sendFinalResponse({ action: 'resize_image_in_offscreen_response', success: true, dataUrl })
      )
      .catch((error) =>
        sendFinalResponse({
          action: 'resize_image_in_offscreen_response',
          success: false,
          error: error.message,
        })
      );
    return false;
  }

  // render_template
  if (request.action === 'render_template_in_offscreen') {
    const { templateData, canvasWidth, canvasHeight, dynamicText } = request;
    safeSendReply(sendReply, { action: 'render_template_in_offscreen_ack' });
    renderTemplateInOffscreen(templateData, canvasWidth, canvasHeight, dynamicText)
      .then((dataUrl) =>
        sendFinalResponse({
          action: 'render_template_in_offscreen_response',
          success: true,
          dataUrl,
        })
      )
      .catch((error) =>
        sendFinalResponse({
          action: 'render_template_in_offscreen_response',
          success: false,
          error: error.message,
        })
      );
    return false;
  }

  // crop
  if (request.action === 'crop_image_in_offscreen') {
    const { imageDataUrl, targetRatio } = request;
    if (!imageDataUrl || !targetRatio) {
      safeSendReply(sendReply, {
        action: 'crop_image_in_offscreen_ack',
        success: false,
        error: 'imageDataUrl과 targetRatio가 필요합니다.',
      });
      sendFinalResponse({
        action: 'crop_image_in_offscreen_response',
        success: false,
        error: 'imageDataUrl과 targetRatio가 필요합니다.',
      });
      return false;
    }
    safeSendReply(sendReply, { action: 'crop_image_in_offscreen_ack' });
    cropImage(imageDataUrl, targetRatio)
      .then((croppedDataUrl) =>
        sendFinalResponse({
          action: 'crop_image_in_offscreen_response',
          success: true,
          dataUrl: croppedDataUrl,
        })
      )
      .catch((error) =>
        sendFinalResponse({
          action: 'crop_image_in_offscreen_response',
          success: false,
          error: error.message,
        })
      );
    return false;
  }

  // compose thumbnail
  if (request.action === 'compose_thumbnail_in_offscreen') {
    const { imageUrl, text, textPosition } = request;
    if (!imageUrl || !text) {
      safeSendReply(sendReply, {
        action: 'compose_thumbnail_in_offscreen_ack',
        success: false,
        error: 'imageUrl과 text가 필요합니다.',
      });
      sendFinalResponse({
        action: 'compose_thumbnail_in_offscreen_response',
        success: false,
        error: 'imageUrl과 text가 필요합니다.',
      });
      return false;
    }
    safeSendReply(sendReply, { action: 'compose_thumbnail_in_offscreen_ack' });
    composeThumbnail(imageUrl, text, textPosition || 'bottom')
      .then((dataUrl) =>
        sendFinalResponse({
          action: 'compose_thumbnail_in_offscreen_response',
          success: true,
          dataUrl,
        })
      )
      .catch((error) =>
        sendFinalResponse({
          action: 'compose_thumbnail_in_offscreen_response',
          success: false,
          error: error.message,
        })
      );
    return false;
  }

  // debug / validation: simple echo endpoint to verify port/runtimemessaging
  if (request.action === 'debug_echo') {
    try {
      console.debug('[Offscreen] debug_echo received — replying with echo', {
        ts: Date.now(),
        payloadSize: request && typeof request === 'object' ? JSON.stringify(request).length : 0,
      });
    } catch (e) {}

    // close channel immediately
    safeSendReply(sendReply, { action: 'debug_echo_ack', ts: Date.now() });

    // final reply uses sendFinalResponse so the background should receive via port
    sendFinalResponse({ action: 'debug_echo_response', success: true, echo: request });
    // fall through to the final return below
  }

  return false;
}

// Wire runtime.onMessage to the unified handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Use the native sendResponse callback when available so the
  // original message channel receives the reply. handleRequest may
  // perform asynchronous work and call sendResponse later — in that
  // case we must return true to keep the message channel open.
  try {
    handleRequest(request, sendResponse);
    // We purposely do not return true because for long-running tasks
    // we send an immediate ACK and deliver the final result via
    // sendFinalResponse (port or runtime.sendMessage). This avoids
    // the "listener indicated an asynchronous response" warning.
    return false;
  } catch (e) {
    // fallback: attempt to send a reply via sendResponse synchronously
    try {
      sendResponse({ success: false, error: e.message || 'Handler error' });
    } catch (err) {}
    return false;
  }
});

// mark handlers ready so an external beacon can check this flag instead of
// assuming runtime listeners are active immediately after page load.
try {
  window.__offscreen_handlers_installed = true;
  console.debug('[Offscreen] handlers installed flag set', new Date().toISOString());
} catch (e) {}

// Also support port-based messages from the background (preferred channel)
chrome.runtime.onConnect.addListener((port) => {
  if (!port || port.name !== 'offscreen-init') return;
  try {
    // Record active port so sendFinalResponse can use it
    activeOffscreenPort = port;
    port.onDisconnect.addListener(() => {
      try {
        activeOffscreenPort = null;
      } catch (e) {}
    });

    // Immediately send a small handshake so background can observe
    // that this offscreen page connected and installed its port handlers.
    try {
      port.postMessage({ action: 'offscreen_port_attached', ts: Date.now() });
      console.debug('[Offscreen] port handshake sent: offscreen_port_attached');
    } catch (e) {
      console.debug('[Offscreen] failed sending port handshake', e && e.message);
    }

    port.onMessage.addListener((msg) => {
      try {
        // Log receipt immediately with timestamp + action + rough payload size
        const payloadSize = msg && typeof msg === 'object' ? JSON.stringify(msg).length : 0;
        console.debug('[Offscreen] port.onMessage received', {
          action: msg && msg.action,
          ts: Date.now(),
          size: payloadSize,
        });
      } catch (e) {
        console.debug('[Offscreen] port.onMessage receipt log failed', e && e.message);
      }

      handleRequest(msg, (resp) => {
        try {
          port.postMessage(resp);
        } catch (e) {
          console.debug('[Offscreen] port.postMessage response failed', e && e.message);
        }
      });
    });
  } catch (e) {
    console.debug('[Offscreen] port onConnect handler error', e);
  }
  try {
    // port listener registration confirms handlers are ready
    window.__offscreen_handlers_installed = true;
  } catch (e) {}
});

// --- 오프스크린 준비 완료 메시지 전송 ---
// DOM 로드 완료 후 백그라운드에 준비 완료 알림
function sendReadyMessage() {
  const payload = { action: 'offscreen_ready', ts: Date.now() };
  try {
    // sendMessage may throw synchronously in some contexts; catch both sync and async failures
    chrome.runtime.sendMessage(payload).catch((err) => {
      try {
        console.error(
          '[Offscreen] 준비 완료 메시지 전송 실패 (async):',
          err && err.stack ? err.stack : err,
          payload
        );
      } catch (e) {
        console.error('[Offscreen] 준비 완료 메시지 전송 실패 (async) - logging failed', e);
      }
    });
    try {
      console.debug('[Offscreen] sendReadyMessage invoked', payload);
    } catch (e) {}
  } catch (err) {
    try {
      console.error(
        '[Offscreen] sendReadyMessage threw (sync):',
        err && err.stack ? err.stack : err,
        payload
      );
    } catch (e) {}
    try {
      // best-effort fallback
      chrome.runtime.sendMessage(payload).catch(() => {});
    } catch (e) {}
  }
}

// Also open a persistent port to signal readiness in a way that
// is robust against race conditions where runtime.sendMessage may
// be missed because listeners haven't been registered yet.
function connectAndSendReady() {
  try {
    const port = chrome.runtime.connect({ name: 'offscreen-init' });
    // record as active port
    activeOffscreenPort = port;
    port.onDisconnect.addListener(() => {
      try {
        activeOffscreenPort = null;
      } catch (e) {}
    });
    // send ready beacon on the port and also listen on the port for
    // incoming requests from background (so background can use port.postMessage)
    try {
      port.postMessage({ action: 'offscreen_ready', ts: Date.now() });
      console.debug('[Offscreen] connectAndSendReady: port.postMessage sent');
    } catch (e) {
      console.error(
        '[Offscreen] connectAndSendReady port.postMessage failed:',
        e && e.stack ? e.stack : e
      );
    }
    try {
      port.onMessage.addListener((msg) => {
        console.debug('[Offscreen] port.onMessage received', msg && msg.action);
        // respond to messages coming over the port using the same handler
        handleRequest(msg, (resp) => {
          try {
            port.postMessage(resp);
          } catch (e) {}
        });
      });
    } catch (e) {
      console.error(
        '[Offscreen] failed to attach port.onMessage listener',
        e && e.stack ? e.stack : e
      );
    }
    console.debug(
      '[Offscreen] connected to background via port and sent ready',
      new Date().toISOString()
    );
  } catch (e) {
    console.error('[Offscreen] connectAndSendReady failed', e && e.stack ? e.stack : e);
  }
}

// DOM 로드 완료 이벤트
// Also fire immediately (attempt, may fail if runtime listener not active yet)
try {
  sendReadyMessage();
  connectAndSendReady();
} catch (e) {
  console.error(
    '[Offscreen] initial sendReadyMessage/connect failed (non-fatal)',
    e && e.stack ? e.stack : e
  );
}

// DOM 로드 완료 이벤트
document.addEventListener('DOMContentLoaded', () => {
  // 추가 지연으로 안전하게
  setTimeout(() => {
    try {
      console.debug('[Offscreen] DOMContentLoaded -> sending ready');
      sendReadyMessage();
      connectAndSendReady();
    } catch (e) {
      console.error('[Offscreen] DOMContentLoaded handlers failed', e && e.stack ? e.stack : e);
    }
  }, 1000);
});

// window load 이벤트
window.addEventListener('load', () => {
  setTimeout(() => {
    try {
      console.debug('[Offscreen] window.load -> sending ready');
      sendReadyMessage();
      connectAndSendReady();
    } catch (e) {
      console.error('[Offscreen] window.load handlers failed', e && e.stack ? e.stack : e);
    }
  }, 1000);
});
