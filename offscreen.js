// offscreen.js

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'parse_html_in_offscreen') {
        const htmlText = request.html;
        const baseUrl = request.baseUrl;
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText, "text/html");

        let thumbnail = doc.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';
        if (thumbnail) {
            thumbnail = new URL(thumbnail, baseUrl).href;
        }

        const description = doc.querySelector('meta[property="og:description"]')?.getAttribute('content') || '';

        const allImages = Array.from(doc.querySelectorAll('img'))
            .map(img => {
                let src = img.getAttribute('data-src') || img.getAttribute('src');
                if (src) {
                    try {
                        src = new URL(src, baseUrl).href;
                    } catch (e) {
                        if (!src.startsWith('data:')) src = '';
                    }
                }
                return { src: src || '', alt: img.alt || '' };
            })
            .filter(img => img.src);

        sendResponse({ success: true, thumbnail, description, allImages });
    }
    return true; // 비동기 응답
});