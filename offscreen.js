// offscreen.js (Lazy Loading 대응 시점으로 복원)

import DOMPurify from 'dompurify';
import { marked } from 'marked';

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
    const isMarkdownCandidate = /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\[.*\]\(.*\)/m.test(cleanedText);
    
    if (isMarkdownCandidate) {
        // marked 옵션 설정: 줄바꿈 처리 등
        marked.use({ breaks: true, gfm: true });
        html = await marked.parse(cleanedText);
    }

    // 2. DOMPurify를 통한 강력한 XSS 방어 (Sanitization)
    const cleanHtml = DOMPurify.sanitize(html, {
        ALLOWED_TAGS: [
            'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'hr', 'ul', 'ol', 'li', 
            'strong', 'b', 'i', 'em', 'mark', 'span', 'div', 'a', 'img', 'blockquote', 
            'code', 'pre', 'table', 'thead', 'tbody', 'tr', 'th', 'td'
        ],
        ALLOWED_ATTR: [
            'href', 'src', 'alt', 'title', 'target', 'rel', 'style', 'class', 'id', 
            'width', 'height', 'align'
        ],
        FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'form', 'style'], // 위험 태그 명시적 차단
        FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'], // 이벤트 핸들러 차단
    });

    // 3. DOM 조작을 통한 스타일링 및 포매팅
    const parser = new DOMParser();
    const doc = parser.parseFromString(cleanHtml, 'text/html');
    const body = doc.body;

    // 3.1 링크 스타일링 및 보안 속성 추가
    body.querySelectorAll('a').forEach(a => {
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
    if (!body.querySelector('mark')) {
        const importantKeywords = ['중요', '핵심', '요약', '결론', '주의', '필수'];
        let markCount = 0;
        
        // 텍스트 노드를 순회하며 키워드가 포함된 문장 찾기 (단순화된 로직)
        // 실제로는 DOM 구조를 깨지 않기 위해 주의가 필요함. 
        // 여기서는 안전하게 <p> 태그 내의 텍스트만 대상으로 함
        body.querySelectorAll('p').forEach(p => {
            if (markCount >= 2) return;
            const text = p.innerHTML; // innerHTML 사용 (태그 포함 유지)
            
            // 이미 다른 태그가 복잡하게 섞인 경우 건너뜀
            if (text.includes('<hr') || text.includes('<img')) return;

            for (const keyword of importantKeywords) {
                if (text.includes(keyword) && text.length > 20 && markCount < 2) {
                    p.style.backgroundColor = 'rgba(255, 255, 204, 0.5)';
                    p.style.padding = '4px';
                    p.style.borderRadius = '4px';
                    markCount++;
                    break; 
                }
            }
        });
    }

    // 3.4 <hr> 태그 스타일링
    body.querySelectorAll('hr').forEach(hr => {
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
        '.contents_style',    // 티스토리 (주요 스킨)
        '.article_view',      // 티스토리 (구형 스킨)
        'article.post-content'// 워드프레스 등
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
    doc.querySelectorAll('div').forEach(el => {
        const textLength = el.innerText.trim().length;
        if (textLength > 1000 && textLength > maxTextLength && !/ad|banner|comment|footer|header|profile/i.test(el.id || el.className)) {
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
    if (host.includes("blog.naver.com")) {
        commentSelector = '#commentCount, ._commentCount';
        likeSelector = '.u_likeit_text_count';
    } else if (host.includes("tistory.com")) {
        commentSelector = '.txt_댓글, .comment-count, #commentCount, .link_comment';
        likeSelector = '.txt_like, .like_button .num';
    } else { // 기타 일반 블로그
        commentSelector = '.comments-count, #comments, .comment-count';
        likeSelector = '.like-count, .post-like-count, .like';
    }

    // 모든 지표 변수 초기화
    let textLength = 0, imageCount = 0, cleanText = '', readTimeInSeconds = 0, hasVideo = false, linkCount = 0;
    let allImages = [];
    
    const contentElement = findContentElement(doc);

    if (contentElement) {
        const contentClone = contentElement.cloneNode(true);
        const unnecessarySelectors = 'ins, script, style, .adsbygoogle, [id*="ad-"], .ad-section';
        contentClone.querySelectorAll(unnecessarySelectors).forEach(el => el.remove());
        
        // ▼▼▼ [핵심 로직] data-src를 우선으로 확인하여 이미지를 수집합니다. ▼▼▼
        const images = contentClone.querySelectorAll('img');
        images.forEach(img => {
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
    const isIrrelevant = img.closest('.se-module-usertool, .profile_area, .writer_info, [class*="profile"], [id*="profile"]');
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
        hasVideo = contentClone.querySelector('iframe[src*="youtube.com"], iframe[src*="vimeo.com"], video') !== null;

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
        metrics: { commentCount, textLength, imageCount, likeCount, readTimeInSeconds, hasVideo, linkCount, allImages },
        cleanText: cleanText 
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
                
                console.log(`⚡ [Offscreen] 이미지 리사이징 완료: ${img.width}x${img.height} → ${width}x${height} (${elapsed}ms)`);
                resolve(dataUrl);
            } catch (error) {
                console.error('[Offscreen] 이미지 처리 중 오류:', error);
                reject(new Error(`이미지 처리 실패: ${error.message}`));
            }
        };
        
        img.onerror = (error) => {
            console.error('[Offscreen] 이미지 로드 실패:', error);
            console.error('[Offscreen] DataURL 길이:', imageDataUrl ? imageDataUrl.length : 0);
            console.error('[Offscreen] DataURL 시작 부분:', imageDataUrl ? imageDataUrl.substring(0, 100) : 'null');
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
async function renderTemplateInOffscreen(templateData, canvasWidth, canvasHeight, dynamicText = {}) {
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
                    ctx.font = `${layer.styles?.fontWeight || 'normal'} ${fontSize}px ${layer.styles?.fontFamily || 'Arial'}`;
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

// --- 메시지 리스너 (background.js로부터 요청 처리) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // [신규] HTML 정제 및 포매팅 요청 처리
    if (request.action === 'sanitize_html_in_offscreen') {
        sanitizeAndFormatHtml(request.rawText)
            .then(cleanedHtml => {
                chrome.runtime.sendMessage({
                    action: 'sanitize_html_in_offscreen_response',
                    success: true,
                    cleanedHtml
                });
            })
            .catch(error => {
                console.error('[Offscreen] HTML 정제 중 오류:', error);
                chrome.runtime.sendMessage({
                    action: 'sanitize_html_in_offscreen_response',
                    success: false,
                    error: error.message
                });
            });
        return true; // 비동기 응답
    }
    
    if (request.action === 'parse_html_in_offscreen') {
        const { html, baseUrl } = request;
        try {
            const urlObj = new URL(baseUrl);
            const doc = new DOMParser().parseFromString(html, "text/html");

            const thumbnail = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
            const description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
            
            const { metrics, cleanText } = parseContentAndMetrics(doc, urlObj);

            sendResponse({ 
                success: true, 
                thumbnail: thumbnail ? new URL(thumbnail, baseUrl).href : '', 
                description, 
                metrics,
                cleanText
            });

        } catch (error) {
            console.error('[Offscreen] 파싱 중 오류 발생:', error);
            sendResponse({ success: false, error: error.message });
        }
        return true;
    }
    
    if (request.action === 'resize_image_in_offscreen') {
        const { imageDataUrl, maxWidth, maxHeight, quality } = request;
        resizeImage(imageDataUrl, maxWidth, maxHeight, quality)
            .then(dataUrl => {
                // background.js로 응답 전송
                chrome.runtime.sendMessage({
                    action: 'resize_image_in_offscreen_response',
                    success: true,
                    dataUrl
                });
            })
            .catch(error => {
                chrome.runtime.sendMessage({
                    action: 'resize_image_in_offscreen_response',
                    success: false,
                    error: error.message
                });
            });
        return true; // 비동기 응답
    }
    
    if (request.action === 'render_template_in_offscreen') {
        const { templateData, canvasWidth, canvasHeight, dynamicText } = request;
        renderTemplateInOffscreen(templateData, canvasWidth, canvasHeight, dynamicText)
            .then(dataUrl => {
                // background.js로 응답 전송
                chrome.runtime.sendMessage({
                    action: 'render_template_in_offscreen_response',
                    success: true,
                    dataUrl
                });
            })
            .catch(error => {
                chrome.runtime.sendMessage({
                    action: 'render_template_in_offscreen_response',
                    success: false,
                    error: error.message
                });
            });
        return true; // 비동기 응답
    }
    
    return false;
});