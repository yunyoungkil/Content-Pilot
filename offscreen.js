// offscreen.js (Lazy Loading 대응 시점으로 복원)

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

// --- 메시지 리스너 (background.js로부터 요청 처리) ---
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
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
    }
    return true;
});