// offscreen.js

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
 * 다양한 방법으로 티스토리 본문 요소를 찾아내는 함수
 */
function findTistoryContentElement(doc) {
    const commonSelectors = ['.contents_style', '.article_view', '.entry-content', '#content', '.post-content', '.article_content'];
    for (const selector of commonSelectors) {
        const element = doc.querySelector(selector);
        if (element) return element;
    }
    const articleElement = doc.querySelector('article');
    if (articleElement) return articleElement;
    
    let largestElement = null;
    let maxTextLength = 0;
    doc.querySelectorAll('div[id*="content"], div[class*="content"], div[id*="post"], div[class*="post"]').forEach(el => {
        const textLength = el.innerText.trim().length;
        if (textLength > maxTextLength) {
            maxTextLength = textLength;
            largestElement = el;
        }
    });
    if (largestElement) return largestElement;
    return doc.body;
}

/**
 * 블로그 플랫폼별로 다른 CSS 선택자를 사용하여 데이터(지표 및 텍스트)를 추출하는 함수
 */
function parseContentAndMetrics(doc, urlObj) {
    const host = urlObj.hostname;
    let contentElement, commentSelector, likeSelector;

    if (host.includes("blog.naver.com")) {
        contentElement = doc.querySelector('.se-viewer') || doc.querySelector('.se-main-container');
        commentSelector = '#commentCount, ._commentCount';
        likeSelector = 'u_likeit_text_count';
    } else if (host.includes("tistory.com")) {
        contentElement = findTistoryContentElement(doc);
        commentSelector = '.txt_댓글, .comment-count, #commentCount, .link_comment, [id^="commentCount"]';
        likeSelector = '.txt_like';
    } else {
        contentElement = findTistoryContentElement(doc);
        commentSelector = '.comments-count, #comments, .comment-count, [id^="comment-"]';
        likeSelector = '.like-count, .btn-like, .post-like-count, .lb-count, .likebtn-button';
    }

    let textLength = 0, imageCount = 0, cleanText = '';
    if (contentElement) {
        const contentClone = contentElement.cloneNode(true);
        const unnecessarySelectors = 'ins.adsbygoogle, div[id*="ad-"], .ad-section, .ssp_adcontent_inner, .se-module-oglink, script, style, .another_category';
        contentClone.querySelectorAll(unnecessarySelectors).forEach(el => el.remove());
        cleanText = formatCleanText(contentClone.innerText);
        textLength = cleanText.length;
        imageCount = contentClone.querySelectorAll('img').length;
    }
    
    let commentCount = 0;
    const commentCountElement = doc.querySelector(commentSelector);
    if (commentCountElement) {
        const countMatch = commentCountElement.innerText.match(/\d+/);
        commentCount = countMatch ? parseInt(countMatch[0], 10) : 0;
    } else if (host.includes("tistory.com")) {
        const allElements = doc.querySelectorAll('span, a, p, div');
        for (const el of allElements) {
            const textMatch = el.innerText.match(/댓글\s*(\d+)/);
            if (textMatch && textMatch[1]) {
                commentCount = parseInt(textMatch[1], 10);
                break; 
            }
        }
    }

    let likeCount = 0;
    const likeCountElement = doc.querySelector(likeSelector);
    if (likeCountElement) {
        const countMatch = likeCountElement.innerText.match(/\d+/);
        likeCount = countMatch ? parseInt(countMatch[0], 10) : 0;
        console.log(`[Offscreen] 수신된 좋아요 수:`, likeCount);
    } else {
        // 요소를 찾지 못했을 경우에도 로그를 남겨 디버깅을 돕습니다.
        console.log(`[Offscreen] '좋아요' 요소를 찾지 못했습니다. 사용된 선택자:`, likeSelector);
    }
    
    
    return {
        metrics: { commentCount, textLength, imageCount, likeCount },
        cleanText: cleanText 
    };
}


// --- 메시지 리스너 (background.js로부터 요청 처리) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'parse_html_in_offscreen') {
        // --- ▼▼▼ [핵심 수정] 변수명을 'html'로 통일하고 콘솔 로그 추가 ▼▼▼ ---
        const { html, baseUrl } = request;
          //console.log(`[Offscreen] Background로부터 다음 URL의 HTML 데이터를 수신했습니다:`, baseUrl);
          //console.log(`[Offscreen] 수신된 HTML 원본:`, html);
        
        try {
            const urlObj = new URL(baseUrl);
            const doc = new DOMParser().parseFromString(html, "text/html");

            const thumbnail = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
            const description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';
            
            const { metrics, cleanText } = parseContentAndMetrics(doc, urlObj);

            // 최종 파싱 결과도 콘솔에 출력
            console.log('[Offscreen] 파싱 완료된 데이터:', { metrics, cleanText });

            sendResponse({ 
                success: true, 
                thumbnail: thumbnail ? new URL(thumbnail, baseUrl).href : '', 
                description, 
                metrics,
                cleanText
            });

        } catch (error) {
            // 에러 발생 시 콘솔에 기록
            console.error('[Offscreen] 파싱 중 오류 발생:', error);
            sendResponse({ success: false, error: error.message });
        }
        // --- ▲▲▲ 수정 완료 ▲▲▲ ---
    }
    return true; // 비동기 응답을 위해 항상 true 반환
});