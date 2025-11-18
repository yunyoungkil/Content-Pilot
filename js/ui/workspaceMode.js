import { shortenLink, showToast } from "../utils.js";
import { marked } from "marked";

// -----------------------------------------------------------------------------
// 1. 이미지 갤러리 관련 함수들
// -----------------------------------------------------------------------------

function updateImageGallery(resourceLibrary, linkedScrapsData, sendCommand) {
  const imageGalleryGrid = resourceLibrary.querySelector(".image-gallery-grid");
  if (!imageGalleryGrid) return;
  const imageUrls = renderImageGallery(linkedScrapsData);
  if (imageUrls.length === 0) {
    imageGalleryGrid.innerHTML =
      "<p>이미지 자료가 없습니다.<br>스크랩 객체에 image/allImages 필드가 포함되어 있는지 확인하세요.</p>";
    return;
  }
  imageGalleryGrid.innerHTML = imageUrls
    .map(
      (url) => `
      <div class="gallery-thumb-wrap">
        <img src="${url}" class="gallery-thumb" style="width:100%;height:88px;object-fit:cover;border-radius:8px;cursor:pointer;box-shadow:0 1px 6px rgba(0,0,0,0.08);" alt="자료 이미지">
      </div>
    `
    )
    .join("");
  imageGalleryGrid.querySelectorAll(".gallery-thumb").forEach((img) => {
    img.addEventListener("click", () => {
      sendCommand("insert-image", { url: img.src });
      sendCommand("focus");
    });
  });
}

function renderImageGallery(linkedScrapsData) {
  const imageSet = new Set();
  linkedScrapsData.forEach((scrap) => {
    if (scrap.image) imageSet.add(scrap.image);
    if (Array.isArray(scrap.allImages)) {
      scrap.allImages.forEach((url) => imageSet.add(url));
    }
  });
  return Array.from(imageSet);
}

function updateImageGalleryFromAllScraps(resourceLibrary, allScraps, sendCommand, ideaData = null) {
  const imageGalleryArea = resourceLibrary.querySelector(".image-gallery-area");
  if (!imageGalleryArea) return;
  
  if (!imageGalleryArea.querySelector(".image-gallery-header")) {
    imageGalleryArea.innerHTML = `
      <div class="image-gallery-header" style="flex-shrink: 0; padding: 12px; border-bottom: 1px solid #e9ecef; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <input type="text" id="image-search-input" placeholder="이미지 검색..." 
          style="flex: 1; min-width: 150px; padding: 6px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
        <button id="filter-by-draft-btn" title="초안 내용에 맞는 이미지만 보기" 
          style="padding: 6px 12px; border: 1px solid #dadce0; background: #fff; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
          <span>📝</span>
          <span>초안 필터</span>
        </button>
        <span id="image-count" style="font-size: 12px; color: #666; white-space: nowrap;">0개</span>
      </div>
      <div class="image-gallery-grid" style="flex: 1; min-height: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 12px; padding: 12px; overflow-y: auto; overflow-x: hidden;"></div>
      <div id="image-preview-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 10000; align-items: center; justify-content: center; padding: 20px;">
        <div style="position: relative; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; align-items: center;">
          <button id="close-preview" style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.9); border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; z-index: 10001; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: all 0.2s;">닫기</button>
          <img id="preview-image" src="" style="max-width: 100%; max-height: calc(90vh - 80px); object-fit: contain; border-radius: 8px;">
          <div id="image-metadata" style="margin-top: 12px; background: rgba(0,0,0,0.6); color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 12px; max-width: 100%; text-align: center; backdrop-filter: blur(10px);"></div>
        </div>
      </div>
    `;
  }
  
  const imageGalleryGrid = imageGalleryArea.querySelector(".image-gallery-grid");
  const searchInput = imageGalleryArea.querySelector("#image-search-input");
  const filterByDraftBtn = imageGalleryArea.querySelector("#filter-by-draft-btn");
  const imageCount = imageGalleryArea.querySelector("#image-count");
  const previewModal = imageGalleryArea.querySelector("#image-preview-modal");
  const previewImage = imageGalleryArea.querySelector("#preview-image");
  const imageMetadata = imageGalleryArea.querySelector("#image-metadata");
  const closePreview = imageGalleryArea.querySelector("#close-preview");
  
  let isDraftFilterActive = false;
  let allImageData = []; 
  let draftContentText = ""; 
  
  imageGalleryGrid.innerHTML = "<p style='text-align:center;color:#888;padding:20px;'>이미지를 불러오는 중...</p>";
  
  const imageDataMap = new Map(); 
  
  const isValidImageUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed.length === 0) return false;
    const invalidPatterns = [
      /sync\.smartadserver\.com/i, /getuid/i, /usersync/i, /pixel/i, 
      /tracking/i, /analytics/i, /beacon/i, /\.js(\?|$)/i, /\.css(\?|$)/i, /\.html(\?|$)/i,
    ];
    if (invalidPatterns.some(pattern => pattern.test(trimmed))) return false;
    return trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/');
  };
  
  const normalizeImageUrl = (url, baseUrl) => {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (trimmed.length === 0) return null;
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/')) {
      return trimmed;
    }
    if (trimmed.startsWith('//')) {
      return 'https:' + trimmed;
    }
    if (trimmed.startsWith('/') && baseUrl) {
      try { return new URL(trimmed, new URL(baseUrl).origin).href; } catch (e) { return null; }
    }
    if (!trimmed.startsWith('http') && baseUrl) {
      try { return new URL(trimmed, baseUrl).href; } catch (e) { return null; }
    }
    return null;
  };

  allScraps.forEach((scrap) => {
    const baseUrl = scrap.url || window.location.href;
    const processUrl = (url) => {
      const normalized = normalizeImageUrl(url, baseUrl);
      if (normalized && isValidImageUrl(normalized) && !imageDataMap.has(normalized)) {
        imageDataMap.set(normalized, {
          url: normalized,
          source: "스크랩",
          title: scrap.text?.substring(0, 50) || scrap.url || "스크랩 이미지",
          url_source: scrap.url || "",
          timestamp: scrap.timestamp || Date.now(),
          scrapId: scrap.id
        });
      }
    };
    if (scrap.image) processUrl(scrap.image);
    if (Array.isArray(scrap.allImages)) scrap.allImages.forEach(processUrl);
    if (Array.isArray(scrap.images)) scrap.images.forEach(processUrl);
  });
  
  chrome.runtime.sendMessage({ action: "get_canvas_images" }, (canvasResponse) => {
    if (canvasResponse && canvasResponse.success && Array.isArray(canvasResponse.images)) {
      canvasResponse.images.forEach((imageUrl) => {
        const normalized = normalizeImageUrl(imageUrl, window.location.href);
        if (normalized && isValidImageUrl(normalized) && !imageDataMap.has(normalized)) {
          imageDataMap.set(normalized, {
            url: normalized,
            source: "캔버스",
            title: "편집된 이미지",
            url_source: "",
            timestamp: Date.now()
          });
        }
      });
    }
    
    const allImages = Array.from(imageDataMap.values());
    allImageData = allImages; 
    
    function extractTextFromDraft(html) {
      if (!html) return "";
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      let text = tempDiv.textContent || tempDiv.innerText || "";
      text = text.replace(/\s+/g, " ").trim();
      return text;
    }
    
    function calculateRelevance(imageData, draftText) {
      if (!draftText || draftText.length < 10) return 0; 
      const draftWords = draftText.toLowerCase().split(/\s+/).filter(w => w.length > 2); 
      if (draftWords.length === 0) return 0;
      
      let score = 0;
      const searchText = ((imageData.title || "") + " " + (imageData.url_source || "") + " " + (imageData.url || "")).toLowerCase();
      
      draftWords.forEach(word => { if (searchText.includes(word)) score += 1; });
      
      try {
        if (imageData.url) {
          const urlDomain = new URL(imageData.url).hostname;
          if (urlDomain && draftText.toLowerCase().includes(urlDomain.split(".")[0])) score += 0.5;
        }
      } catch (e) {}
      
      return Math.min(score / Math.max(draftWords.length, 1), 1);
    }
    
    function filterImagesByDraft(images, draftText) {
      if (!draftText || draftText.length < 10) return images; 
      return images
        .map(img => ({ ...img, relevance: calculateRelevance(img, draftText) }))
        .filter(img => img.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance);
    }
    
    function renderImages(images) {
      if (images.length === 0) {
        imageGalleryGrid.innerHTML = "<p style='text-align:center;color:#888;padding:20px;'>이미지가 없습니다.</p>";
        imageCount.textContent = "0개";
        return;
      }
      
      imageCount.textContent = `${images.length}개`;
      const escapeHtml = (str) => {
        if (!str) return '';
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
      };

      imageGalleryGrid.innerHTML = images.map((imgData) => {
        const escapedUrl = escapeHtml(imgData.url);
        const escapedTitle = escapeHtml(imgData.title || '이미지');
        return `
          <div class="gallery-thumb-wrap" draggable="true" data-image-url="${escapedUrl}" 
            data-title="${escapedTitle}" data-source="${imgData.source}" data-url-source="${escapeHtml(imgData.url_source || '')}"
            data-timestamp="${imgData.timestamp}" data-scrap-id="${imgData.scrapId || ''}"
            style="position: relative; cursor: pointer;">
            <img src="${escapedUrl}" class="gallery-thumb" style="width:100%;height:88px;object-fit:cover;border-radius:8px;cursor:move;" alt="${escapedTitle}" loading="lazy" onerror="this.style.display='none';">
            ${imgData.source === '스크랩' && imgData.scrapId ? `
              <button class="gallery-image-delete-btn" data-scrap-id="${imgData.scrapId}" data-image-url="${escapedUrl}"
                style="position: absolute; top: 4px; right: 4px; background: rgba(234,67,53,0.9); color: #fff; border: none; width: 24px; height: 24px; opacity: 0; transition: opacity 0.2s;" title="삭제">×</button>
            ` : ''}
            <div class="gallery-thumb-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0); pointer-events: none; display: flex; align-items: center; justify-content: center;">
              <span class="gallery-preview-icon" style="opacity: 0; color: #fff; font-size: 24px; pointer-events: auto; cursor: pointer;">🔍</span>
            </div>
          </div>`;
      }).join("");
      
      imageGalleryGrid.querySelectorAll(".gallery-thumb-wrap").forEach((wrap) => {
        wrap.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", wrap.dataset.imageUrl);
          e.dataTransfer.effectAllowed = "copy";
        });

        const deleteBtn = wrap.querySelector(".gallery-image-delete-btn");
        if (deleteBtn) {
            wrap.addEventListener("mouseenter", () => deleteBtn.style.opacity = "1");
            wrap.addEventListener("mouseleave", () => deleteBtn.style.opacity = "0");
            deleteBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                if (confirm('이미지를 삭제하시겠습니까?')) {
                    chrome.runtime.sendMessage({ action: 'remove_scrap_image', data: { scrapId: deleteBtn.dataset.scrapId, imageUrl: deleteBtn.dataset.imageUrl } }, (res) => {
                        if (res && res.success) {
                            chrome.storage.local.get("activeChannelId", (res) => {
                                chrome.runtime.sendMessage({ action: "get_all_scraps", channelId: res.activeChannelId }, (r) => {
                                    if (r && r.success) updateImageGalleryFromAllScraps(resourceLibrary, r.scraps, sendCommand, ideaData);
                                });
                            });
                        }
                    });
                }
            });
        }

        const img = wrap.querySelector(".gallery-thumb");
        const icon = wrap.querySelector(".gallery-preview-icon");
        const overlay = wrap.querySelector(".gallery-thumb-overlay");
        
        if (overlay) {
             wrap.addEventListener("mouseenter", () => { overlay.style.background = "rgba(0,0,0,0.5)"; if(icon) icon.style.opacity = "1"; });
             wrap.addEventListener("mouseleave", () => { overlay.style.background = "rgba(0,0,0,0)"; if(icon) icon.style.opacity = "0"; });
        }
        
        const insertImage = (e) => {
             e.preventDefault(); e.stopPropagation();
             sendCommand("insert-image", { url: wrap.dataset.imageUrl });
             sendCommand("focus");
        };
        
        if (img) img.addEventListener("click", insertImage);
        if (icon) {
             icon.addEventListener("click", (e) => {
                 e.preventDefault(); e.stopPropagation();
                 showImagePreview({
                     url: wrap.dataset.imageUrl, title: wrap.dataset.title, source: wrap.dataset.source, 
                     url_source: wrap.dataset.urlSource, timestamp: wrap.dataset.timestamp
                 });
             });
        }
      });
    }
    
    function showImagePreview(imgData) {
      previewImage.src = imgData.url;
      const date = imgData.timestamp ? new Date(parseInt(imgData.timestamp)) : new Date();
      imageMetadata.innerHTML = `<div>${imgData.title}</div><div style="font-size:11px;opacity:0.8;">${imgData.source} | ${date.toLocaleDateString()}</div>`;
      previewModal.style.display = "flex";
    }
    
    closePreview.addEventListener("click", () => previewModal.style.display = "none");
    previewModal.addEventListener("click", (e) => { if (e.target === previewModal) previewModal.style.display = "none"; });
    
    function getDraftContent() {
      return new Promise((resolve) => {
        if (ideaData && ideaData.draftContent) {
          const text = extractTextFromDraft(ideaData.draftContent);
          if (text.length >= 10) { resolve(text); return; }
        }
        const editorIframe = document.querySelector("#quill-editor-iframe");
        if (!editorIframe || !editorIframe.contentWindow) { resolve(""); return; }
        
        const messageId = `draft-${Date.now()}`;
        const handler = (event) => {
          if (event.data.action === "content-response" && event.data.requestId === messageId) {
            window.removeEventListener("message", handler);
            resolve(extractTextFromDraft(event.data.data?.html || ""));
          }
        };
        window.addEventListener("message", handler);
        editorIframe.contentWindow.postMessage({ action: "get-content", requestId: messageId }, "*");
        setTimeout(() => { window.removeEventListener("message", handler); resolve(""); }, 2000);
      });
    }
    
    async function toggleDraftFilter() {
      if (!isDraftFilterActive) {
        filterByDraftBtn.style.background = "#e8f0fe";
        filterByDraftBtn.style.borderColor = "#1a73e8";
        draftContentText = await getDraftContent();
        if (!draftContentText || draftContentText.length < 10) {
          alert("초안 내용이 부족합니다.");
          filterByDraftBtn.style.background = "#fff";
          filterByDraftBtn.style.borderColor = "#dadce0";
          return;
        }
        isDraftFilterActive = true;
        renderImages(filterImagesByDraft(allImages, draftContentText));
      } else {
        filterByDraftBtn.style.background = "#fff";
        filterByDraftBtn.style.borderColor = "#dadce0";
        isDraftFilterActive = false;
        renderImages(allImages);
      }
    }
    
    if (filterByDraftBtn) filterByDraftBtn.addEventListener("click", toggleDraftFilter);
    
    searchInput.addEventListener("input", (e) => {
      const term = e.target.value.toLowerCase().trim();
      const targetImages = isDraftFilterActive ? filterImagesByDraft(allImages, draftContentText) : allImages;
      if (!term) { renderImages(targetImages); return; }
      renderImages(targetImages.filter(img => (img.title||"").toLowerCase().includes(term) || (img.source||"").toLowerCase().includes(term)));
    });
    
    renderImages(allImages);
  });
}



// -----------------------------------------------------------------------------
// 2. 헬퍼 함수들 (반드시 최상위 레벨에 있어야 함)
// -----------------------------------------------------------------------------

function createScrapCard(scrap, isLinked) {
  const textContent = scrap.text || "(내용 없음)";
  const cleanedTitle = textContent.replace(/\s+/g, " ").trim();
  const displayTitle = cleanedTitle.substring(0, 10);
  
  if (isLinked) {
    return `<div class="scrap-card-item linked-scrap-item" data-scrap-id="${scrap.id}" data-text="${textContent.replace(/"/g, "&quot;")}" draggable="true" style="margin:0;">
        <div class="linked-scrap-tag"><span class="tag-text">${displayTitle}...</span></div>
      </div>`;
  }
  
  const tagsHtml = (scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0) 
      ? `<div class="card-tags">${scrap.tags.map(t => `<span class="tag">#${t}</span>`).join("")}</div>` : "";
  const previewText = textContent.length > 200 ? textContent.substring(0, 200) + "..." : textContent;
  const previewImage = scrap.image || (Array.isArray(scrap.allImages) && scrap.allImages.length > 0 ? scrap.allImages[0] : "");

  return `
    <div class="scrap-card-item" draggable="true" data-scrap-id="${scrap.id}" data-text="${textContent.replace(/"/g, "&quot;")}" 
         data-preview-text="${previewText.replace(/"/g, "&quot;").replace(/\n/g, " ")}" 
         data-preview-image="${previewImage.replace(/"/g, "&quot;")}" 
         data-preview-url="${(scrap.url || "").replace(/"/g, "&quot;")}">
        <div class="scrap-card">
            <button class="scrap-card-delete-btn unlink-scrap-btn" title="연결 해제">×</button>
            ${scrap.image ? `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image"></div>` : ""}
            <div class="scrap-card-info">
                <div class="scrap-card-title">${cleanedTitle.substring(0, 20)}...</div>
                <div class="scrap-card-snippet">${shortenLink(scrap.url, 25)}</div>
                ${tagsHtml}
            </div>
        </div>
    </div>`;
}

function buildPermalinkUrl(channelUrl, permalink, isTistory = null) {
  if (!channelUrl || !permalink) return '';
  try {
    const urlObj = new URL(channelUrl);
    const host = urlObj.hostname.toLowerCase();
    if (isTistory === true) return `${urlObj.origin}/entry/${permalink}`;
    if (isTistory === null && host.includes('tistory.com')) return `${urlObj.origin}/entry/${permalink}`;
    if (host.includes('blog.naver.com')) return permalink.startsWith('http') ? permalink : `${urlObj.origin}/${permalink}`;
    if (host.includes('brunch.co.kr')) {
      const pathMatch = urlObj.pathname.match(/^\/@([^\/]+)/);
      return pathMatch ? `${urlObj.origin}/@${pathMatch[1]}/${permalink}` : `${urlObj.origin}/${permalink}`;
    }
    return `${urlObj.origin.replace(/\/$/, '')}/${permalink}`;
  } catch (e) { return ''; }
}

function showPublishInfo(workspaceEl, permalink, tags, seoTitle, ideaData) {
  // 기존 패널 제거
  const existingInfo = workspaceEl.querySelector('.publish-info-panel');
  if (existingInfo) existingInfo.remove();
  
  // Firebase 업데이트
  if (ideaData && ideaData.id) {
    chrome.runtime.sendMessage({
      action: "update_kanban_card",
      data: {
        cardId: ideaData.id,
        status: ideaData.status || "ideas",
        updates: {
          publishInfo: { permalink: permalink || '', tags: tags || '', seoTitle: seoTitle || '', updatedAt: Date.now() }
        }
      }
    });
  }
  
  // 채널 정보 가져오기
  chrome.runtime.sendMessage({ action: "get_my_channels" }, (channelsResponse) => {
    const myChannels = channelsResponse?.channels?.myChannels?.blogs || [];
    const firstChannel = myChannels.length > 0 ? myChannels[0] : null;
    const channelUrl = firstChannel?.inputUrl || '';
    
    let isTistory = channelUrl.includes('tistory.com');
    let fullUrl = buildPermalinkUrl(channelUrl, permalink, isTistory);
    
    const publishInfoPanel = document.createElement('div');
    publishInfoPanel.className = 'publish-info-panel';
    publishInfoPanel.style.cssText = `padding: 16px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 8px; display: flex; flex-direction: column; gap: 12px; box-sizing: border-box;`;
    
    const ideaTitle = ideaData?.title || '';
    
    publishInfoPanel.innerHTML = `
      <div style="font-weight: 600; font-size: 14px; color: #333; margin-bottom: 4px;">📝 발행 정보</div>
      <div style="display: flex; flex-direction: column; gap: 12px;">
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">아이디어 제목</label>
          <input type="text" id="idea-title-input" value="${ideaTitle}" readonly style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
        </div>
        ${seoTitle ? `<div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">SEO 최적화 제목</label>
          <input type="text" id="seo-title-input" value="${seoTitle}" readonly style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
        </div>` : ''}
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">퍼머링크</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="permalink-input" value="${permalink || ''}" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
            ${fullUrl ? `<button id="connect-permalink-btn" style="padding: 6px 12px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🔗 연결</button>` : ''}
          </div>
          ${fullUrl ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">전체 URL: <span style="color: #1a73e8;">${fullUrl}</span></div>` : ''}
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">태그</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="tags-input" value="${tags || ''}" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
            <button id="copy-tags-btn" style="padding: 6px 12px; background: #fff; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 12px;">📋 복사</button>
          </div>
        </div>
      </div>
    `;
    
    const publishInfoArea = workspaceEl.querySelector('#publish-info-content');
    if (publishInfoArea) {
      publishInfoArea.innerHTML = '';
      publishInfoArea.appendChild(publishInfoPanel);
    }
    
    // 이벤트 리스너
    const connectBtn = publishInfoPanel.querySelector('#connect-permalink-btn');
    if (connectBtn && fullUrl) {
      connectBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({
          action: "link_published_url",
          data: { cardId: ideaData.id, url: fullUrl, status: "draft" } // 상태는 예시
        }, (res) => {
          if (res && res.success) alert("✅ 발행 URL이 연결되었습니다.");
          else alert("연결 실패: " + (res?.error || "오류"));
        });
      });
    }
    
    const copyTagsBtn = publishInfoPanel.querySelector('#copy-tags-btn');
    if (copyTagsBtn) {
      copyTagsBtn.addEventListener('click', () => {
        const tagsInput = publishInfoPanel.querySelector('#tags-input');
        if (tagsInput && tagsInput.value) {
          navigator.clipboard.writeText(tagsInput.value).then(() => alert("📋 태그 복사 완료"));
        }
      });
    }
  });
}



// -----------------------------------------------------------------------------
// 3. 메인 렌더링 함수 (renderWorkspace)
// -----------------------------------------------------------------------------

export function renderWorkspace(container, ideaData) {
  // 방어 코드
  ideaData.workspace = ideaData.workspace || {};
  ideaData.workspace.keywords = ideaData.workspace.keywords || [];
  ideaData.workspace.outline = ideaData.workspace.outline || [];
  ideaData.workspace.draft = ideaData.workspace.draft || "";
  ideaData.workspace.linkedScraps = ideaData.workspace.linkedScraps || {};

  if (!ideaData.tags && ideaData.workspace.keywords) ideaData.tags = ideaData.workspace.keywords;
  if (!ideaData.outline && ideaData.workspace.outline) ideaData.outline = ideaData.workspace.outline;
  
  if (ideaData.title && (!ideaData.tags || ideaData.tags.length <= 1)) {
     chrome.runtime.sendMessage({
        action: "generate_idea_briefing",
        data: {
          cardId: ideaData.id,
          title: ideaData.title,
          description: ideaData.description || "",
          generateMainKeywords: true
        }
     });
  }

  // 에디터 저장 리스너
  window.__cp_workspace_idea_id = ideaData.id;
  if (!window.__cp_workspace_save_listener) {
    window.addEventListener("message", (event) => {
      if (event.data?.action === "cp_save_draft" && event.data.content) {
        chrome.runtime.sendMessage({ action: "save_idea_draft", ideaId: window.__cp_workspace_idea_id, draft: event.data.content });
      }
    });
    window.__cp_workspace_save_listener = true;
  }

  const outlineHtml = (ideaData.outline?.length > 0) 
      ? ideaData.outline.map((item, i) => `<li class="outline-item" data-index="${i}"><span class="outline-text">${item}</span><button class="outline-delete-btn">×</button></li>`).join("") 
      : "<li class='outline-empty'>추천 목차가 없습니다.</li>";

  const tagsHtml = (ideaData.tags?.length > 0)
      ? ideaData.tags.filter(t => t !== "#AI-추천").map(k => `<span class="tag interactive-tag">${k}</span>`).join("")
      : "<span>주요 키워드 없음</span>";

  const longTailHtml = (ideaData.longTailKeywords?.length > 0)
      ? ideaData.longTailKeywords.map(k => `<span class="tag long-tail-keyword interactive-tag">${k}</span>`).join("")
      : "<span>롱테일 키워드 없음</span>";

  const searchHtml = (ideaData.recommendedKeywords?.length > 0)
      ? ideaData.recommendedKeywords.map(item => `<li><span class="recommended-keyword-item" data-keyword="${item.replace(/"/g, '&quot;')}">${item}</span></li>`).join("")
      : "<li>추천 검색어 없음</li>";

  const hasDraft = !!ideaData.draftContent;

  container.innerHTML = `
    <div class="workspace-container">
      <div id="main-editor-panel" class="workspace-column" style="display:flex; flex-direction:column;">
        <div id="workspace-title-header" style="padding:12px; border-bottom:1px solid #eee; background:#f8f9fa;">
            <input type="text" id="workspace-title-input" value="${ideaData.title || "제목 없음"}" style="width:100%; font-size:16px; border:none; background:transparent; font-weight:bold;">
            <button id="save-title-btn" style="display:none;">저장</button>
        </div>
        <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
            <button id="generate-draft-btn">📄 AI로 초안 생성하기</button>
            ${hasDraft ? `<button id="delete-draft-in-workspace" class="draft-delete-btn">❌ 초안 삭제</button>` : ""}
        </div>
        <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
            <iframe id="quill-editor-iframe" src="${chrome.runtime.getURL("editor.html")}" style="flex:1; width:100%; border:none;"></iframe>
            <div id="linked-scraps-section" style="height:150px; overflow-y:auto; border-top:1px solid #eee; padding:10px;">
                <div class="scrap-list linked-scraps-list empty-state" data-idea-id="${ideaData.id}">
                    <p>스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>
                </div>
            </div>
        </div>
      </div>

      <div id="resource-library-panel" class="workspace-column">
        <div class="resource-tabs">
            <button class="resource-tab-btn active" data-tab="publish-info">📝</button>
            <button class="resource-tab-btn" data-tab="ai-briefing">✨</button>
            <button class="resource-tab-btn" data-tab="outline">📄</button>
            <button class="resource-tab-btn" data-tab="recommended-keywords">🔍</button>
            <button class="resource-tab-btn" data-tab="all-scraps">📖</button>
            <button class="resource-tab-btn" data-tab="image-gallery">🖼️</button>
        </div>
        
        <div class="resource-content-area publish-info-area" id="publish-info-area" style="display:block;"><div id="publish-info-content"></div></div>
        <div class="resource-content-area ai-briefing-area" id="ai-briefing-area" style="display:none;">
            <div class="editor-keyword-section"><div class="keyword-list">${tagsHtml} ${longTailHtml}</div></div>
        </div>
        <div class="resource-content-area outline-area" id="outline-area" style="display:none;">
            <ul class="outline-list">${outlineHtml}</ul>
            <button id="add-outline-item-btn">➕ 추가</button>
        </div>
        <div class="resource-content-area recommended-keywords-area" id="recommended-keywords-area" style="display:none;">
            <ul>${searchHtml}</ul>
        </div>
        <div class="resource-content-area all-scraps-area" id="all-scraps-list-container" style="display:none;">
            <input type="text" id="scrap-search-input" placeholder="스크랩 검색" style="width:100%; margin-bottom:10px;">
            <div class="scrap-list all-scraps-list"></div>
        </div>
        <div class="resource-content-area image-gallery-area" id="image-gallery-list-container" style="display:none;">
            <div class="image-gallery-grid"></div>
        </div>
      </div>
    </div>
  `;

  addWorkspaceEventListeners(container.querySelector(".workspace-container"), ideaData);
  
  if (ideaData && (ideaData.publishInfo || ideaData.seoTitle)) {
      setTimeout(() => showPublishInfo(container.querySelector(".workspace-container"), ideaData.publishInfo?.permalink, ideaData.publishInfo?.tags, ideaData.seoTitle, ideaData), 200);
  }
}

function addWorkspaceEventListeners(workspaceEl, ideaData) {
    const tabBtns = workspaceEl.querySelectorAll(".resource-tab-btn");
    const allScrapsList = workspaceEl.querySelector(".all-scraps-list");
    const linkedScrapsList = workspaceEl.querySelector(".linked-scraps-list");
    const editorIframe = workspaceEl.querySelector("#quill-editor-iframe");
    const resourceLibrary = workspaceEl.querySelector("#resource-library-panel");

    function sendCommand(action, data = {}) {
        if (editorIframe.contentWindow) editorIframe.contentWindow.postMessage({ action, data }, "*");
    }

    tabBtns.forEach(btn => {
        btn.addEventListener("click", () => {
            tabBtns.forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            workspaceEl.querySelectorAll(".resource-content-area").forEach(el => el.style.display = "none");
            
            const tab = btn.dataset.tab;
            const target = workspaceEl.querySelector(`.${tab}-area`) || workspaceEl.querySelector(`#${tab}-area`) || workspaceEl.querySelector(`#${tab}-list-container`);
            if (target) target.style.display = "block";
            
            if (tab === "all-scraps") {
                 chrome.storage.local.get("activeChannelId", (res) => {
                    chrome.runtime.sendMessage({ action: "get_all_scraps", channelId: res.activeChannelId }, (r) => {
                        if (r && r.success) {
                            window.__cp_scrap_filter.allScraps = r.scraps;
                            window.__cp_updateScrapList(r.scraps, allScrapsList, linkedScrapsList, ideaData);
                        }
                    });
                 });
            } else if (tab === "image-gallery") {
                 chrome.storage.local.get("activeChannelId", (res) => {
                    chrome.runtime.sendMessage({ action: "get_all_scraps", channelId: res.activeChannelId }, (r) => {
                        if (r && r.success) updateImageGalleryFromAllScraps(resourceLibrary, r.scraps, sendCommand, ideaData);
                    });
                 });
            } else if (tab === "publish-info" && ideaData.publishInfo) {
                 showPublishInfo(workspaceEl, ideaData.publishInfo.permalink, ideaData.publishInfo.tags, ideaData.seoTitle, ideaData);
            }
        });
    });

    window.addEventListener("message", (event) => {
        if (event.source !== editorIframe.contentWindow) return;
        const { action, data } = event.data;
        if (action === "editor-ready") {
             if (ideaData.draftContent) sendCommand("set-content", { html: marked.parse(ideaData.draftContent) });
        }
    });
    
    workspaceEl.addEventListener("click", (e) => {
        if (e.target.classList.contains("interactive-tag")) {
            const text = e.target.classList.contains("long-tail-keyword") ? ` ${e.target.textContent} ` : `\n\n## ${e.target.textContent}\n\n`;
            sendCommand("insert-text", { text });
            sendCommand("focus");
        } else if (e.target.classList.contains("recommended-keyword-item")) {
            sendCommand("insert-text", { text: `\n\n## ${e.target.textContent}\n\n` });
            sendCommand("focus");
            showToast(`✅ "${e.target.textContent}" 목차를 본문에 추가했습니다.`);
        }
    });

    if (allScrapsList) {
        allScrapsList.addEventListener("dragstart", (e) => {
            const card = e.target.closest(".scrap-card-item");
            if(card) e.dataTransfer.setData("application/json", JSON.stringify({ id: card.dataset.scrapId, text: card.dataset.text }));
        });
    }
    
    workspaceEl.addEventListener("dragover", e => e.preventDefault());
    workspaceEl.addEventListener("drop", (e) => {
        e.preventDefault();
        const data = e.dataTransfer.getData("application/json");
        if (!data) return;
        const scrapData = JSON.parse(data);
        
        if (linkedScrapsList.contains(e.target)) {
             chrome.runtime.sendMessage({ action: "link_scrap_to_idea", data: { ideaId: ideaData.id, scrapId: scrapData.id, status: ideaData.status } }, (res) => {
                 if (res && res.success) {
                     linkedScrapsList.insertAdjacentHTML("beforeend", createScrapCard(scrapData, true));
                     ideaData.linkedScraps.push(scrapData.id);
                 }
             });
        } else if (e.target.closest("#main-editor-panel")) {
             sendCommand("insert-text", { text: `\n\n--- (참고) ---\n${scrapData.text}\n\n` });
        }
    });
}

window.__cp_scrap_filter = { keyword: null, searchText: null, allScraps: [] };
window.__cp_filterScraps = function(scraps, keyword, searchText) {
    if (!keyword && !searchText) return scraps;
    const term = (keyword || searchText).toLowerCase();
    return scraps.filter(s => (s.text||"").toLowerCase().includes(term) || (s.tags||[]).some(t=>t.toLowerCase().includes(term)));
};
window.__cp_updateScrapList = function(filtered, allCont, linkedCont, ideaData) {
    if (filtered.length > 0) {
        allCont.innerHTML = filtered.map(s => createScrapCard(s, false)).join("");
    } else {
        allCont.innerHTML = "<p>검색 결과가 없습니다.</p>";
    }
};
