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
    return `<div class="scrap-card-item linked-scrap-item" data-scrap-id="${scrap.id}" data-text="${textContent.replace(/"/g, "&quot;")}" draggable="true" style="margin:0; flex-shrink:0; position:relative;">
        <div class="linked-scrap-tag"><span class="tag-text">${displayTitle}...</span></div>
        <button class="unlink-scrap-btn" data-scrap-id="${scrap.id}" title="연결 해제" style="position:absolute; top:-6px; right:-6px; background:#d93025; color:#fff; border:none; border-radius:50%; width:18px; height:18px; line-height:18px; text-align:center; cursor:pointer; font-size:12px; font-weight:bold; opacity:0.8; transition:opacity 0.2s; z-index:10;">×</button>
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
  
  // 파라미터 정규화 (null, undefined 처리)
  permalink = permalink || '';
  tags = tags || '';
  seoTitle = seoTitle || '';
  
  // Firebase 업데이트 (값이 있을 때만)
  if (ideaData && ideaData.id) {
    const updates = {};
    if (permalink !== undefined) {
      updates['publishInfo.permalink'] = permalink;
    }
    if (tags !== undefined) {
      updates['publishInfo.tags'] = tags;
    }
    if (seoTitle !== undefined) {
      updates.seoTitle = seoTitle;
      updates['publishInfo.seoTitle'] = seoTitle;
    }
    if (Object.keys(updates).length > 0) {
      updates['publishInfo.updatedAt'] = Date.now();
      
      chrome.runtime.sendMessage({
        action: "update_kanban_card",
        data: {
          cardId: ideaData.id,
          status: ideaData.status || "ideas",
          updates: updates
        }
      }, (response) => {
        if (response && !response.success) {
          console.error('[Workspace] 발행 정보 저장 실패:', response);
        }
      });
    }
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
    } else {
      // publish-info-content가 없으면 publish-info-area에 직접 추가
      const publishInfoAreaContainer = workspaceEl.querySelector('#publish-info-area');
      if (publishInfoAreaContainer) {
        publishInfoAreaContainer.innerHTML = '';
        publishInfoAreaContainer.appendChild(publishInfoPanel);
      }
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
  
  // linkedScraps를 배열로 정규화 (Firebase에서 객체로 올 수 있음)
  if (ideaData.linkedScraps) {
    if (!Array.isArray(ideaData.linkedScraps) && typeof ideaData.linkedScraps === 'object') {
      ideaData.linkedScraps = Object.keys(ideaData.linkedScraps);
    }
  } else {
    ideaData.linkedScraps = [];
  }

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
            <div id="linked-scraps-section" style="height:150px; overflow-x:auto; overflow-y:hidden; border-top:1px solid #eee; padding:10px;">
                <div class="scrap-list linked-scraps-list empty-state" data-idea-id="${ideaData.id}" style="display:flex; flex-wrap:nowrap; gap:8px; align-items:center;">
                    <p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>
                </div>
            </div>
        </div>
      </div>

      <div id="resource-library-panel" class="workspace-column">
        <div class="resource-tabs">
            <button class="resource-tab-btn active" data-tab="publish-info" title="발행 정보">📝</button>
            <button class="resource-tab-btn" data-tab="ai-briefing" title="AI 브리핑">✨</button>
            <button class="resource-tab-btn" data-tab="outline" title="목차">📄</button>
            <button class="resource-tab-btn" data-tab="recommended-keywords" title="추천 검색어">🔍</button>
            <button class="resource-tab-btn" data-tab="all-scraps" title="모든 스크랩">📖</button>
            <button class="resource-tab-btn" data-tab="image-gallery" title="이미지 갤러리">🖼️</button>
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
            <ul id="recommended-keywords-list">${searchHtml}</ul>
        </div>
        <div class="resource-content-area all-scraps-area" id="all-scraps-list-container" style="display:none;">
            <div style="padding: 12px; border-bottom: 1px solid #e9ecef; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                <input type="text" id="scrap-search-input" placeholder="스크랩 검색" style="flex: 1; min-width: 150px; padding: 6px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
                <button id="filter-scrap-by-draft-btn" title="초안 내용에 맞는 스크랩만 보기" 
                  style="padding: 6px 12px; border: 1px solid #dadce0; background: #fff; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
                  <span>📝</span>
                  <span>초안 필터</span>
                </button>
            </div>
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
    
    // 연결된 스크랩 목록 초기 렌더링
    if (linkedScrapsList && ideaData.linkedScraps && ideaData.linkedScraps.length > 0) {
        chrome.storage.local.get("activeChannelId", (res) => {
            chrome.runtime.sendMessage({ action: "get_all_scraps", channelId: res.activeChannelId }, (r) => {
                if (r && r.success && r.scraps) {
                    // 연결된 스크랩만 필터링
                    const linkedScraps = r.scraps.filter(s => ideaData.linkedScraps.includes(s.id));
                    if (linkedScraps.length > 0) {
                        linkedScrapsList.classList.remove("empty-state");
                        linkedScrapsList.innerHTML = linkedScraps.map(s => createScrapCard(s, true)).join("");
                        // 연결된 스크랩에 이벤트 리스너 설정
                        linkedScrapsList.querySelectorAll(".linked-scrap-item").forEach(item => {
                            setupLinkedScrapItem(item);
                            // 연결 해제 버튼 클릭 이벤트
                            const unlinkBtn = item.querySelector('.unlink-scrap-btn');
                            if (unlinkBtn) {
                                unlinkBtn.addEventListener('click', (e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const scrapId = unlinkBtn.dataset.scrapId || item.dataset.scrapId;
                                    if (scrapId) {
                                        chrome.runtime.sendMessage({ 
                                            action: "unlink_scrap_from_idea", 
                                            data: { 
                                                ideaId: ideaData.id, 
                                                scrapId: scrapId, 
                                                status: ideaData.status 
                                            } 
                                        }, (res) => {
                                            if (res && res.success) {
                                                item.remove();
                                                // 연결된 스크랩이 없으면 empty-state 복원
                                                if (linkedScrapsList.children.length === 0) {
                                                    linkedScrapsList.classList.add("empty-state");
                                                    linkedScrapsList.innerHTML = '<p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>';
                                                }
                                                // ideaData에서도 제거
                                                if (ideaData.linkedScraps) {
                                                    if (Array.isArray(ideaData.linkedScraps)) {
                                                        const index = ideaData.linkedScraps.indexOf(scrapId);
                                                        if (index > -1) {
                                                            ideaData.linkedScraps.splice(index, 1);
                                                        }
                                                    } else if (typeof ideaData.linkedScraps === 'object') {
                                                        delete ideaData.linkedScraps[scrapId];
                                                    }
                                                }
                                                showToast("✅ 스크랩 연결이 해제되었습니다.");
                                            } else {
                                                console.error('[Workspace] 스크랩 연결 해제 실패:', res);
                                                showToast("❌ 스크랩 연결 해제에 실패했습니다.");
                                            }
                                        });
                                    }
                                });
                            }
                        });
                    }
                }
            });
        });
    }

    function sendCommand(action, data = {}) {
        try {
            if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage({ action, data }, "*");
            }
        } catch (error) {
            console.error('[Workspace] sendCommand 오류:', error);
        }
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
            } else if (tab === "publish-info") {
                 // publish-info 탭 클릭 시 Firebase에서 최신 데이터 가져오기
                 chrome.runtime.sendMessage({
                     action: "get_kanban_card_status",
                     data: { cardId: ideaData.id }
                 }, (statusResponse) => {
                     if (statusResponse && statusResponse.success) {
                         const status = statusResponse.status || ideaData.status || "ideas";
                         // Firebase에서 최신 카드 데이터 가져오기
                         chrome.runtime.sendMessage({
                             action: "get_kanban_data"
                         }, (kanbanResponse) => {
                             if (kanbanResponse && kanbanResponse.success && kanbanResponse.data) {
                                 const cardData = kanbanResponse.data[status]?.[ideaData.id];
                                 if (cardData) {
                                     // 최신 데이터로 ideaData 업데이트
                                     if (cardData.publishInfo) ideaData.publishInfo = cardData.publishInfo;
                                     if (cardData.seoTitle) ideaData.seoTitle = cardData.seoTitle;
                                     
                                     const publishInfo = ideaData.publishInfo || {};
                                     showPublishInfo(workspaceEl, publishInfo.permalink, publishInfo.tags, ideaData.seoTitle || publishInfo.seoTitle, ideaData);
                                 } else {
                                     // 카드 데이터가 없으면 기존 데이터 사용
                                     const publishInfo = ideaData.publishInfo || {};
                                     showPublishInfo(workspaceEl, publishInfo.permalink, publishInfo.tags, ideaData.seoTitle, ideaData);
                                 }
                             } else {
                                 // Firebase 조회 실패 시 기존 데이터 사용
                                 const publishInfo = ideaData.publishInfo || {};
                                 showPublishInfo(workspaceEl, publishInfo.permalink, publishInfo.tags, ideaData.seoTitle, ideaData);
                             }
                         });
                     } else {
                         // 상태 조회 실패 시 기존 데이터 사용
                         const publishInfo = ideaData.publishInfo || {};
                         showPublishInfo(workspaceEl, publishInfo.permalink, publishInfo.tags, ideaData.seoTitle, ideaData);
                     }
                 });
            }
        });
    });

    // 제목 저장 기능
    const titleInput = workspaceEl.querySelector("#workspace-title-input");
    const saveTitleBtn = workspaceEl.querySelector("#save-title-btn");
    if (titleInput && saveTitleBtn) {
        let titleChanged = false;
        
        titleInput.addEventListener("input", () => {
            titleChanged = true;
            saveTitleBtn.style.display = "inline-block";
        });
        
        titleInput.addEventListener("blur", () => {
            if (titleChanged) {
                const newTitle = titleInput.value.trim();
                if (newTitle && newTitle !== ideaData.title) {
                    chrome.runtime.sendMessage({
                        action: "update_kanban_card",
                        data: {
                            cardId: ideaData.id,
                            status: ideaData.status || "ideas",
                            updates: {
                                title: newTitle
                            }
                        }
                    }, (response) => {
                        if (response && response.success) {
                            ideaData.title = newTitle;
                            saveTitleBtn.style.display = "none";
                            titleChanged = false;
                            showToast("✅ 제목이 저장되었습니다.");
                        } else {
                            console.error('[Workspace] 제목 저장 실패:', response);
                            showToast("❌ 제목 저장에 실패했습니다.");
                        }
                    });
                } else {
                    saveTitleBtn.style.display = "none";
                    titleChanged = false;
                }
            }
        });
        
        saveTitleBtn.addEventListener("click", () => {
            const newTitle = titleInput.value.trim();
            if (newTitle && newTitle !== ideaData.title) {
                chrome.runtime.sendMessage({
                    action: "update_kanban_card",
                    data: {
                        cardId: ideaData.id,
                        status: ideaData.status || "ideas",
                        updates: {
                            title: newTitle
                        }
                    }
                }, (response) => {
                    if (response && response.success) {
                        ideaData.title = newTitle;
                        saveTitleBtn.style.display = "none";
                        titleChanged = false;
                        showToast("✅ 제목이 저장되었습니다.");
                    } else {
                        console.error('[Workspace] 제목 저장 실패:', response);
                        showToast("❌ 제목 저장에 실패했습니다.");
                    }
                });
            } else {
                saveTitleBtn.style.display = "none";
                titleChanged = false;
            }
        });
    }
    
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
        } else if (e.target.classList.contains("recommended-keyword-item") || e.target.closest(".recommended-keyword-item")) {
            e.preventDefault();
            e.stopPropagation();
            // 추천 검색어 클릭 시 웹 검색
            const keywordEl = e.target.classList.contains("recommended-keyword-item") ? e.target : e.target.closest(".recommended-keyword-item");
            const keyword = keywordEl ? keywordEl.textContent.trim() : "";
            if (keyword) {
                const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(keyword)}`;
                // chrome.tabs API가 사용 가능한지 확인
                if (chrome && chrome.tabs && chrome.tabs.create) {
                    chrome.tabs.create({ url: searchUrl });
                    showToast(`🔍 "${keyword}" 검색 중...`);
                } else {
                    // chrome.tabs가 없으면 새 창으로 열기
                    window.open(searchUrl, '_blank');
                    showToast(`🔍 "${keyword}" 검색 중...`);
                }
            }
        } else if (e.target.id === "generate-draft-btn" || e.target.closest("#generate-draft-btn")) {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.target.id === "generate-draft-btn" ? e.target : e.target.closest("#generate-draft-btn");
            if (!btn) return;
            
            // 버튼 비활성화 및 로딩 표시
            btn.disabled = true;
            const originalText = btn.textContent;
            btn.textContent = "⏳ 초안 생성 중...";
            
            // 현재 에디터 내용 가져오기
            const editorIframe = workspaceEl.querySelector("#quill-editor-iframe");
            if (!editorIframe || !editorIframe.contentWindow) {
                alert("에디터가 준비되지 않았습니다.");
                btn.disabled = false;
                btn.textContent = originalText;
                return;
            }
            
            // 에디터에서 현재 내용 가져오기
            const messageId = `get-content-${Date.now()}`;
            const getContentPromise = new Promise((resolve) => {
                const handler = (event) => {
                    if (event.data.action === "content-response" && event.data.requestId === messageId) {
                        window.removeEventListener("message", handler);
                        resolve(event.data.data?.html || "");
                    }
                };
                window.addEventListener("message", handler);
                editorIframe.contentWindow.postMessage({ action: "get-content", requestId: messageId }, "*");
                setTimeout(() => {
                    window.removeEventListener("message", handler);
                    resolve("");
                }, 2000);
            });
            
            getContentPromise.then(async (currentDraftHtml) => {
                // HTML을 텍스트로 변환 (HTML 태그 제거)
                let currentDraft = "";
                if (currentDraftHtml) {
                    const tempDiv = document.createElement("div");
                    tempDiv.innerHTML = currentDraftHtml;
                    currentDraft = tempDiv.textContent || tempDiv.innerText || "";
                }
                
                // 연결된 스크랩 데이터 가져오기
                // linkedScraps는 Firebase에서 객체로 저장되지만, 코드에서는 배열로도 사용 가능
                let linkedScrapsIds = [];
                if (ideaData.linkedScraps) {
                    if (Array.isArray(ideaData.linkedScraps)) {
                        linkedScrapsIds = ideaData.linkedScraps;
                    } else if (typeof ideaData.linkedScraps === 'object') {
                        linkedScrapsIds = Object.keys(ideaData.linkedScraps);
                    }
                } else if (ideaData.workspace?.linkedScraps) {
                    if (Array.isArray(ideaData.workspace.linkedScraps)) {
                        linkedScrapsIds = ideaData.workspace.linkedScraps;
                    } else if (typeof ideaData.workspace.linkedScraps === 'object') {
                        linkedScrapsIds = Object.keys(ideaData.workspace.linkedScraps);
                    }
                }
                const linkedScrapsContent = [];
                
                if (linkedScrapsIds.length > 0) {
                    // 모든 스크랩 가져오기
                    const { activeChannelId } = await chrome.storage.local.get("activeChannelId");
                    await new Promise((resolve) => {
                        chrome.runtime.sendMessage({ action: "get_all_scraps", channelId: activeChannelId }, (response) => {
                            if (response && response.success && response.scraps) {
                                // 연결된 스크랩만 필터링
                                linkedScrapsIds.forEach(scrapId => {
                                    const scrap = response.scraps.find(s => s.id === scrapId);
                                    if (scrap) {
                                        linkedScrapsContent.push({
                                            title: scrap.title || scrap.text?.substring(0, 50) || "스크랩",
                                            url: scrap.url || "",
                                            text: scrap.text || scrap.cleanText || ""
                                        });
                                    }
                                });
                            }
                            resolve();
                        });
                    });
                }
                
                // 아이디어 데이터 준비
                const draftData = {
                    title: ideaData.title || "",
                    description: ideaData.description || "",
                    tags: ideaData.tags || ideaData.workspace?.keywords || [],
                    outline: ideaData.outline || ideaData.workspace?.outline || [],
                    longTailKeywords: ideaData.longTailKeywords || [],
                    recommendedSearches: ideaData.recommendedKeywords || [],
                    currentDraft: currentDraft || "",
                    linkedScrapsContent: linkedScrapsContent
                };
                
                // AI 초안 생성 요청
                chrome.runtime.sendMessage({
                    action: "generate_draft_from_idea",
                    data: draftData
                }, (response) => {
                    btn.disabled = false;
                    btn.textContent = originalText;
                    
                    if (response && response.success && response.draft) {
                        // 마크다운 코드 블록 제거 (```markdown ... ``` 형식)
                        let draftText = response.draft;
                        // 마크다운 코드 블록 제거
                        draftText = draftText.replace(/^```markdown\s*\n?/i, '');
                        draftText = draftText.replace(/^```\s*\n?/i, '');
                        draftText = draftText.replace(/\n?```\s*$/i, '');
                        draftText = draftText.trim();
                        
                        // 마크다운을 HTML로 변환하여 에디터에 설정
                        const htmlContent = marked.parse(draftText);
                        sendCommand("set-content", { html: htmlContent });
                        sendCommand("focus");
                        
                        // 초안 저장
                        chrome.runtime.sendMessage({
                            action: "save_idea_draft",
                            ideaId: ideaData.id,
                            draft: response.draft
                        });
                        
                        // 발행 정보 업데이트 (permalink, tags, seoTitle, thumbnailInfo)
                        if (response.permalink || response.tags || response.seoTitle || response.thumbnailInfo) {
                            const updates = {};
                            if (response.permalink) updates['publishInfo.permalink'] = response.permalink;
                            if (response.tags) updates['publishInfo.tags'] = response.tags;
                            if (response.seoTitle) updates.seoTitle = response.seoTitle;
                            if (response.thumbnailInfo) updates['publishInfo.thumbnailInfo'] = response.thumbnailInfo;
                            
                            // ideaData 먼저 업데이트
                            if (!ideaData.publishInfo) ideaData.publishInfo = {};
                            if (response.permalink) ideaData.publishInfo.permalink = response.permalink;
                            if (response.tags) ideaData.publishInfo.tags = response.tags;
                            if (response.thumbnailInfo) ideaData.publishInfo.thumbnailInfo = response.thumbnailInfo;
                            if (response.seoTitle) ideaData.seoTitle = response.seoTitle;
                            
                            // 발행 정보 UI 업데이트 (Firebase 업데이트와 독립적으로)
                            setTimeout(() => {
                                const publishInfo = {
                                    permalink: response.permalink || ideaData.publishInfo?.permalink || '',
                                    tags: response.tags || ideaData.publishInfo?.tags || '',
                                    thumbnailInfo: response.thumbnailInfo || ideaData.publishInfo?.thumbnailInfo
                                };
                                showPublishInfo(workspaceEl, publishInfo.permalink, publishInfo.tags, response.seoTitle || ideaData.seoTitle || '', ideaData);
                            }, 200);
                            
                            // Firebase 업데이트 (에러 처리 포함, 응답 없어도 계속 진행)
                            // 응답을 기다리지 않고 비동기로 처리
                            setTimeout(() => {
                                try {
                                    chrome.runtime.sendMessage({
                                        action: "update_kanban_card",
                                        data: {
                                            cardId: ideaData.id,
                                            status: ideaData.status || "ideas",
                                            updates: updates
                                        }
                                    }, (updateResponse) => {
                                        // chrome.runtime.lastError는 콜백 내부에서만 체크 가능
                                        if (chrome.runtime.lastError) {
                                            // 메시지 포트가 닫힌 경우는 무시 (UI는 이미 업데이트됨)
                                            const errorMsg = chrome.runtime.lastError.message || '';
                                            if (!errorMsg.includes('port closed') && !errorMsg.includes('message channel closed')) {
                                                console.error('[Workspace] 발행 정보 업데이트 오류:', errorMsg);
                                            }
                                        } else if (updateResponse && !updateResponse.success) {
                                            console.error('[Workspace] 발행 정보 업데이트 실패:', updateResponse);
                                        }
                                    });
                                } catch (error) {
                                    // 메시지 채널 관련 오류는 무시
                                    if (!error.message || (!error.message.includes('message channel') && !error.message.includes('port closed'))) {
                                        console.error('[Workspace] 발행 정보 업데이트 예외:', error);
                                    }
                                }
                            }, 0);
                        }
                        
                        // 초안 삭제 버튼 동적 추가
                        const buttonContainer = workspaceEl.querySelector("#workspace-title-header").nextElementSibling;
                        if (buttonContainer && !buttonContainer.querySelector("#delete-draft-in-workspace")) {
                            const deleteBtn = document.createElement("button");
                            deleteBtn.id = "delete-draft-in-workspace";
                            deleteBtn.className = "draft-delete-btn";
                            deleteBtn.textContent = "❌ 초안 삭제";
                            buttonContainer.appendChild(deleteBtn);
                        }
                        
                        showToast("✅ AI 초안이 생성되었습니다!");
                    } else {
                        const errorMsg = response?.error || "초안 생성에 실패했습니다.";
                        alert(`❌ ${errorMsg}`);
                        console.error("[Workspace] AI 초안 생성 실패:", response);
                    }
                });
            });
        } else if (e.target.id === "delete-draft-in-workspace" || e.target.closest("#delete-draft-in-workspace")) {
            e.preventDefault();
            e.stopPropagation();
            const deleteBtn = e.target.id === "delete-draft-in-workspace" ? e.target : e.target.closest("#delete-draft-in-workspace");
            if (!deleteBtn) return;
            
            if (confirm("초안을 삭제하시겠습니까?")) {
                // 에디터 즉시 초기화
                const editorIframe = workspaceEl.querySelector("#quill-editor-iframe");
                if (editorIframe && editorIframe.contentWindow) {
                    // 에디터에 직접 메시지 전송 (여러 번 시도하여 확실하게)
                    const clearEditor = () => {
                        try {
                            editorIframe.contentWindow.postMessage({ 
                                action: "set-content", 
                                data: { html: "" } 
                            }, "*");
                        } catch (err) {
                            console.error('[Workspace] 에디터 초기화 오류:', err);
                        }
                    };
                    
                    clearEditor();
                    // 에디터가 준비될 때까지 재시도
                    setTimeout(clearEditor, 50);
                    setTimeout(clearEditor, 150);
                    setTimeout(clearEditor, 300);
                    
                    // 포커스도 전송
                    setTimeout(() => {
                        try {
                            editorIframe.contentWindow.postMessage({ 
                                action: "focus" 
                            }, "*");
                        } catch (err) {
                            console.error('[Workspace] 에디터 포커스 오류:', err);
                        }
                    }, 200);
                }
                
                // Firebase에서 초안과 발행 정보 모두 삭제
                chrome.runtime.sendMessage({
                    action: "delete_draft_and_publish_info",
                    data: {
                        ideaId: ideaData.id,
                        status: ideaData.status || "ideas"
                    }
                }, (response) => {
                    if (response && response.success) {
                        // ideaData에서도 제거
                        ideaData.draftContent = "";
                        if (ideaData.publishInfo) {
                            ideaData.publishInfo = {};
                        }
                        ideaData.seoTitle = "";
                        
                        // 발행 정보 UI 즉시 업데이트
                        const publishInfoArea = workspaceEl.querySelector("#publish-info-area");
                        if (publishInfoArea) {
                            showPublishInfo(workspaceEl, "", "", "", ideaData);
                        }
                        
                        // 초안 삭제 버튼 제거
                        if (deleteBtn && deleteBtn.parentNode) {
                            deleteBtn.parentNode.removeChild(deleteBtn);
                        }
                        showToast("✅ 초안과 발행 정보가 삭제되었습니다.");
                    } else {
                        console.error('[Workspace] 초안 삭제 실패:', response);
                        showToast("❌ 초안 삭제에 실패했습니다.");
                    }
                });
            }
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
        
        if (linkedScrapsList.contains(e.target) || e.target.closest(".linked-scraps-list")) {
             chrome.runtime.sendMessage({ action: "link_scrap_to_idea", data: { ideaId: ideaData.id, scrapId: scrapData.id, status: ideaData.status } }, (res) => {
                 if (res && res.success) {
                     const emptyState = linkedScrapsList.querySelector(".empty-state p");
                     if (emptyState) emptyState.remove();
                     linkedScrapsList.classList.remove("empty-state");
                     linkedScrapsList.insertAdjacentHTML("beforeend", createScrapCard(scrapData, true));
                     // linkedScraps를 배열로 초기화 (객체인 경우 배열로 변환)
                     if (!ideaData.linkedScraps) {
                         ideaData.linkedScraps = [];
                     } else if (!Array.isArray(ideaData.linkedScraps)) {
                         // 객체인 경우 배열로 변환
                         ideaData.linkedScraps = Object.keys(ideaData.linkedScraps);
                     }
                     if (!ideaData.linkedScraps.includes(scrapData.id)) {
                         ideaData.linkedScraps.push(scrapData.id);
                     }
                     // 새로 추가된 스크랩에 이벤트 리스너 추가
                     const newScrapItem = linkedScrapsList.querySelector(`[data-scrap-id="${scrapData.id}"]`);
                     if (newScrapItem) {
                         setupLinkedScrapItem(newScrapItem);
                         
                         // 연결 해제 버튼 클릭 이벤트
                         const unlinkBtn = newScrapItem.querySelector('.unlink-scrap-btn');
                         if (unlinkBtn) {
                             unlinkBtn.addEventListener('click', (e) => {
                                 e.preventDefault();
                                 e.stopPropagation();
                                 const scrapId = unlinkBtn.dataset.scrapId || newScrapItem.dataset.scrapId;
                                 if (scrapId) {
                                     chrome.runtime.sendMessage({ 
                                         action: "unlink_scrap_from_idea", 
                                         data: { 
                                             ideaId: ideaData.id, 
                                             scrapId: scrapId, 
                                             status: ideaData.status 
                                         } 
                                     }, (res) => {
                                         if (res && res.success) {
                                             newScrapItem.remove();
                                             // 연결된 스크랩이 없으면 empty-state 복원
                                             if (linkedScrapsList.children.length === 0) {
                                                 linkedScrapsList.classList.add("empty-state");
                                                 linkedScrapsList.innerHTML = '<p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>';
                                             }
                                             // ideaData에서도 제거
                                             if (ideaData.linkedScraps) {
                                                 if (Array.isArray(ideaData.linkedScraps)) {
                                                     const index = ideaData.linkedScraps.indexOf(scrapId);
                                                     if (index > -1) {
                                                         ideaData.linkedScraps.splice(index, 1);
                                                     }
                                                 } else if (typeof ideaData.linkedScraps === 'object') {
                                                     delete ideaData.linkedScraps[scrapId];
                                                 }
                                             }
                                             showToast("✅ 스크랩 연결이 해제되었습니다.");
                                         } else {
                                             console.error('[Workspace] 스크랩 연결 해제 실패:', res);
                                             showToast("❌ 스크랩 연결 해제에 실패했습니다.");
                                         }
                                     });
                                 }
                             });
                         }
                     }
                 }
             });
        } else if (e.target.closest("#main-editor-panel")) {
             sendCommand("insert-text", { text: `\n\n--- (참고) ---\n${scrapData.text}\n\n` });
        }
    });
    
    // 연결된 스크랩 아이템에 이벤트 리스너 설정 (중복 방지)
    const linkedScrapItems = new WeakSet();
    function setupLinkedScrapItem(item) {
        if (!item || linkedScrapItems.has(item)) return;
        linkedScrapItems.add(item);
        
        // 드래그 시작 이벤트
        item.addEventListener("dragstart", (e) => {
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/json", JSON.stringify({ 
                id: item.dataset.scrapId, 
                text: item.dataset.text,
                isLinked: true 
            }));
            item.style.opacity = "0.5";
        });
        
        // 드래그 종료 이벤트
        item.addEventListener("dragend", (e) => {
            item.style.opacity = "1";
            // 드롭이 linked-scraps-list 외부에서 발생했는지 확인
            setTimeout(() => {
                const relatedTarget = document.elementFromPoint(e.clientX, e.clientY);
                if (!relatedTarget || (!linkedScrapsList.contains(relatedTarget) && !relatedTarget.closest(".linked-scraps-list"))) {
                    // 외부로 드래그된 경우 삭제 (confirm 없이)
                    const scrapId = item.dataset.scrapId;
                    if (scrapId) {
                        chrome.runtime.sendMessage({ 
                            action: "unlink_scrap_from_idea", 
                            data: { 
                                ideaId: ideaData.id, 
                                scrapId: scrapId, 
                                status: ideaData.status 
                            } 
                        }, (res) => {
                            if (res && res.success) {
                                item.remove();
                                // 연결된 스크랩이 없으면 empty-state 복원
                                if (linkedScrapsList.children.length === 0) {
                                    linkedScrapsList.classList.add("empty-state");
                                    linkedScrapsList.innerHTML = '<p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>';
                                }
                                // ideaData에서도 제거
                                if (ideaData.linkedScraps) {
                                    if (Array.isArray(ideaData.linkedScraps)) {
                                        const index = ideaData.linkedScraps.indexOf(scrapId);
                                        if (index > -1) {
                                            ideaData.linkedScraps.splice(index, 1);
                                        }
                                    } else if (typeof ideaData.linkedScraps === 'object') {
                                        // 객체인 경우 해당 키 삭제
                                        delete ideaData.linkedScraps[scrapId];
                                    }
                                }
                                showToast("✅ 스크랩 연결이 해제되었습니다.");
                            }
                        });
                    }
                }
            }, 10);
        });
    }
    
    // 기존 연결된 스크랩에 이벤트 리스너 설정
    linkedScrapsList.querySelectorAll(".linked-scrap-item").forEach(item => {
        setupLinkedScrapItem(item);
        
        // 연결 해제 버튼 클릭 이벤트
        const unlinkBtn = item.querySelector('.unlink-scrap-btn');
        if (unlinkBtn) {
            unlinkBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                const scrapId = unlinkBtn.dataset.scrapId || item.dataset.scrapId;
                if (scrapId) {
                    chrome.runtime.sendMessage({ 
                        action: "unlink_scrap_from_idea", 
                        data: { 
                            ideaId: ideaData.id, 
                            scrapId: scrapId, 
                            status: ideaData.status 
                        } 
                    }, (res) => {
                        if (res && res.success) {
                            item.remove();
                            // 연결된 스크랩이 없으면 empty-state 복원
                            if (linkedScrapsList.children.length === 0) {
                                linkedScrapsList.classList.add("empty-state");
                                linkedScrapsList.innerHTML = '<p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>';
                            }
                            // ideaData에서도 제거
                            if (ideaData.linkedScraps) {
                                if (Array.isArray(ideaData.linkedScraps)) {
                                    const index = ideaData.linkedScraps.indexOf(scrapId);
                                    if (index > -1) {
                                        ideaData.linkedScraps.splice(index, 1);
                                    }
                                } else if (typeof ideaData.linkedScraps === 'object') {
                                    delete ideaData.linkedScraps[scrapId];
                                }
                            }
                            showToast("✅ 스크랩 연결이 해제되었습니다.");
                        } else {
                            console.error('[Workspace] 스크랩 연결 해제 실패:', res);
                            showToast("❌ 스크랩 연결 해제에 실패했습니다.");
                        }
                    });
                }
            });
        }
    });

    // 목차 더블클릭 편집 기능
    workspaceEl.querySelectorAll('.outline-item .outline-text').forEach(textEl => {
        textEl.addEventListener('dblclick', (e) => {
            e.stopPropagation();
            const listItem = textEl.closest('.outline-item');
            const index = parseInt(listItem.dataset.index);
            const currentText = textEl.textContent;
            
            const input = document.createElement('input');
            input.type = 'text';
            input.value = currentText;
            input.style.cssText = 'width:100%; padding:4px; border:1px solid #4285f4; border-radius:4px; font-size:13px;';
            
            textEl.style.display = 'none';
            listItem.insertBefore(input, textEl);
            input.focus();
            input.select();
            
            const saveEdit = () => {
                const newText = input.value.trim();
                if (newText && newText !== currentText) {
                    const outline = ideaData.outline || ideaData.workspace?.outline || [];
                    outline[index] = newText;
                    chrome.runtime.sendMessage({
                        action: "update_kanban_card",
                        data: {
                            cardId: ideaData.id,
                            status: ideaData.status || "ideas",
                            updates: {
                                outline: outline,
                                'workspace.outline': outline
                            }
                        }
                    }, () => {
                        textEl.textContent = newText;
                        textEl.style.display = '';
                        input.remove();
                        showToast("✅ 목차가 수정되었습니다.");
                    });
                } else {
                    textEl.style.display = '';
                    input.remove();
                }
            };
            
            input.addEventListener('blur', saveEdit);
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveEdit();
                } else if (e.key === 'Escape') {
                    textEl.style.display = '';
                    input.remove();
                }
            });
        });
    });
    
    // 목차 삭제 버튼
    workspaceEl.querySelectorAll('.outline-delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const listItem = btn.closest('.outline-item');
            const index = parseInt(listItem.dataset.index);
            
            if (confirm('이 목차 항목을 삭제하시겠습니까?')) {
                const outline = ideaData.outline || ideaData.workspace?.outline || [];
                outline.splice(index, 1);
                chrome.runtime.sendMessage({
                    action: "update_kanban_card",
                    data: {
                        cardId: ideaData.id,
                        status: ideaData.status || "ideas",
                        updates: {
                            outline: outline,
                            'workspace.outline': outline
                        }
                    }
                }, () => {
                    listItem.remove();
                    showToast("✅ 목차 항목이 삭제되었습니다.");
                });
            }
        });
    });
    
    // 목차 추가 버튼
    const addOutlineBtn = workspaceEl.querySelector('#add-outline-item-btn');
    if (addOutlineBtn) {
        addOutlineBtn.addEventListener('click', () => {
            const newItem = prompt('새 목차 항목을 입력하세요:');
            if (newItem && newItem.trim()) {
                const outline = ideaData.outline || ideaData.workspace?.outline || [];
                outline.push(newItem.trim());
                chrome.runtime.sendMessage({
                    action: "update_kanban_card",
                    data: {
                        cardId: ideaData.id,
                        status: ideaData.status || "ideas",
                        updates: {
                            outline: outline,
                            'workspace.outline': outline
                        }
                    }
                }, () => {
                    const outlineList = workspaceEl.querySelector('.outline-list');
                    if (outlineList) {
                        const emptyItem = outlineList.querySelector('.outline-empty');
                        if (emptyItem) emptyItem.remove();
                        const newLi = document.createElement('li');
                        newLi.className = 'outline-item';
                        newLi.dataset.index = outline.length - 1;
                        newLi.innerHTML = `<span class="outline-text">${newItem.trim()}</span><button class="outline-delete-btn">×</button>`;
                        outlineList.appendChild(newLi);
                        
                        // 새로 추가된 항목에 이벤트 리스너 추가
                        const newTextEl = newLi.querySelector('.outline-text');
                        newTextEl.addEventListener('dblclick', (e) => {
                            e.stopPropagation();
                            const listItem = newTextEl.closest('.outline-item');
                            const index = parseInt(listItem.dataset.index);
                            const currentText = newTextEl.textContent;
                            
                            const input = document.createElement('input');
                            input.type = 'text';
                            input.value = currentText;
                            input.style.cssText = 'width:100%; padding:4px; border:1px solid #4285f4; border-radius:4px; font-size:13px;';
                            
                            newTextEl.style.display = 'none';
                            listItem.insertBefore(input, newTextEl);
                            input.focus();
                            input.select();
                            
                            const saveEdit = () => {
                                const newText = input.value.trim();
                                if (newText && newText !== currentText) {
                                    const outline = ideaData.outline || ideaData.workspace?.outline || [];
                                    outline[index] = newText;
                                    chrome.runtime.sendMessage({
                                        action: "update_kanban_card",
                                        data: {
                                            cardId: ideaData.id,
                                            status: ideaData.status || "ideas",
                                            updates: {
                                                outline: outline,
                                                'workspace.outline': outline
                                            }
                                        }
                                    }, () => {
                                        newTextEl.textContent = newText;
                                        newTextEl.style.display = '';
                                        input.remove();
                                        showToast("✅ 목차가 수정되었습니다.");
                                    });
                                } else {
                                    newTextEl.style.display = '';
                                    input.remove();
                                }
                            };
                            
                            input.addEventListener('blur', saveEdit);
                            input.addEventListener('keydown', (e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    saveEdit();
                                } else if (e.key === 'Escape') {
                                    newTextEl.style.display = '';
                                    input.remove();
                                }
                            });
                        });
                        
                        const newDeleteBtn = newLi.querySelector('.outline-delete-btn');
                        newDeleteBtn.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const listItem = newDeleteBtn.closest('.outline-item');
                            const index = parseInt(listItem.dataset.index);
                            
                            if (confirm('이 목차 항목을 삭제하시겠습니까?')) {
                                const outline = ideaData.outline || ideaData.workspace?.outline || [];
                                outline.splice(index, 1);
                                chrome.runtime.sendMessage({
                                    action: "update_kanban_card",
                                    data: {
                                        cardId: ideaData.id,
                                        status: ideaData.status || "ideas",
                                        updates: {
                                            outline: outline,
                                            'workspace.outline': outline
                                        }
                                    }
                                }, () => {
                                    listItem.remove();
                                    if (outlineList.children.length === 0) {
                                        outlineList.innerHTML = "<li class='outline-empty'>추천 목차가 없습니다.</li>";
                                    }
                                    showToast("✅ 목차 항목이 삭제되었습니다.");
                                });
                            }
                        });
                    }
                    showToast("✅ 목차 항목이 추가되었습니다.");
                });
            }
        });
    }
    
    // 스크랩 초안 필터 기능
    const filterScrapByDraftBtn = workspaceEl.querySelector('#filter-scrap-by-draft-btn');
    const scrapSearchInput = workspaceEl.querySelector('#scrap-search-input');
    let isScrapDraftFilterActive = false;
    let scrapDraftContentText = "";
    
    function extractTextFromDraft(html) {
        if (!html) return "";
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = html;
        let text = tempDiv.textContent || tempDiv.innerText || "";
        text = text.replace(/\s+/g, " ").trim();
        return text;
    }
    
    function getDraftContentForScrapFilter() {
        return new Promise((resolve) => {
            if (ideaData && ideaData.draftContent) {
                const text = extractTextFromDraft(ideaData.draftContent);
                if (text.length >= 10) { resolve(text); return; }
            }
            const editorIframe = workspaceEl.querySelector("#quill-editor-iframe");
            if (!editorIframe || !editorIframe.contentWindow) { resolve(""); return; }
            
            const messageId = `draft-scrap-${Date.now()}`;
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
    
    function getFilterTextFromIdeaData() {
        // AI 브리핑, 추천 목차, 추천 검색어로 필터 텍스트 생성
        const parts = [];
        
        // 제목과 설명
        if (ideaData.title) parts.push(ideaData.title);
        if (ideaData.description) parts.push(ideaData.description);
        
        // 태그 (AI 브리핑의 주요 키워드)
        if (ideaData.tags && Array.isArray(ideaData.tags)) {
            ideaData.tags.filter(t => t !== '#AI-추천').forEach(tag => {
                parts.push(tag.replace(/^#/, ''));
            });
        }
        
        // 목차
        if (ideaData.outline && Array.isArray(ideaData.outline)) {
            ideaData.outline.forEach(item => parts.push(item));
        }
        
        // 추천 검색어
        if (ideaData.recommendedKeywords && Array.isArray(ideaData.recommendedKeywords)) {
            ideaData.recommendedKeywords.forEach(keyword => parts.push(keyword));
        }
        
        // 롱테일 키워드
        if (ideaData.longTailKeywords && Array.isArray(ideaData.longTailKeywords)) {
            ideaData.longTailKeywords.forEach(keyword => parts.push(keyword));
        }
        
        return parts.join(' ');
    }
    
    function calculateScrapRelevance(scrap, filterText) {
        if (!filterText || filterText.length < 3) return 0;
        const filterWords = filterText.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        if (filterWords.length === 0) return 0;
        
        let score = 0;
        const scrapText = ((scrap.text || "") + " " + (scrap.url || "")).toLowerCase();
        
        filterWords.forEach(word => {
            if (scrapText.includes(word)) score += 1;
        });
        
        // 태그 매칭
        if (scrap.tags && Array.isArray(scrap.tags)) {
            scrap.tags.forEach(tag => {
                if (filterText.toLowerCase().includes(tag.toLowerCase())) score += 0.5;
            });
        }
        
        return Math.min(score / Math.max(filterWords.length, 1), 1);
    }
    
    function filterScrapsByDraft(scraps, filterText) {
        if (!filterText || filterText.length < 3) return scraps;
        return scraps
            .map(scrap => ({ ...scrap, relevance: calculateScrapRelevance(scrap, filterText) }))
            .filter(scrap => scrap.relevance > 0)
            .sort((a, b) => b.relevance - a.relevance);
    }
    
    function updateScrapList() {
        if (!window.__cp_scrap_filter.allScraps || window.__cp_scrap_filter.allScraps.length === 0) return;
        
        const searchTerm = scrapSearchInput ? scrapSearchInput.value.toLowerCase().trim() : '';
        window.__cp_scrap_filter.searchText = searchTerm;
        
        let filtered;
        if (isScrapDraftFilterActive && scrapDraftContentText) {
            const draftFiltered = filterScrapsByDraft(window.__cp_scrap_filter.allScraps, scrapDraftContentText);
            filtered = searchTerm 
                ? draftFiltered.filter(s => (s.text||"").toLowerCase().includes(searchTerm) || (s.tags||[]).some(t=>t.toLowerCase().includes(searchTerm)))
                : draftFiltered;
        } else {
            filtered = window.__cp_filterScraps(
                window.__cp_scrap_filter.allScraps,
                window.__cp_scrap_filter.keyword,
                searchTerm
            );
        }
        window.__cp_updateScrapList(filtered, allScrapsList, linkedScrapsList, ideaData);
    }
    
    if (filterScrapByDraftBtn) {
        filterScrapByDraftBtn.addEventListener('click', async () => {
            if (!isScrapDraftFilterActive) {
                filterScrapByDraftBtn.style.background = "#e8f0fe";
                filterScrapByDraftBtn.style.borderColor = "#1a73e8";
                
                // 먼저 에디터 내용 확인
                scrapDraftContentText = await getDraftContentForScrapFilter();
                
                // 에디터 내용이 없으면 AI 브리핑/목차/검색어로 필터
                if (!scrapDraftContentText || scrapDraftContentText.length < 10) {
                    scrapDraftContentText = getFilterTextFromIdeaData();
                    if (!scrapDraftContentText || scrapDraftContentText.length < 3) {
                        alert("초안 내용 또는 아이디어 정보가 부족합니다.");
                        filterScrapByDraftBtn.style.background = "#fff";
                        filterScrapByDraftBtn.style.borderColor = "#dadce0";
                        return;
                    }
                }
                
                isScrapDraftFilterActive = true;
                updateScrapList();
            } else {
                filterScrapByDraftBtn.style.background = "#fff";
                filterScrapByDraftBtn.style.borderColor = "#dadce0";
                isScrapDraftFilterActive = false;
                scrapDraftContentText = "";
                updateScrapList();
            }
        });
    }
    
    // 스크랩 검색 필터 기능
    if (scrapSearchInput) {
        scrapSearchInput.addEventListener('input', () => {
            updateScrapList();
        });
    }

    // [신규] 채널 변경 감지 -> 워크스페이스 스크랩 목록 새로고침
    chrome.storage.onChanged.addListener((changes, namespace) => {
        if (namespace === "local" && changes.activeChannelId) {
            console.log("[Workspace] 채널 변경 감지, 스크랩 목록 새로고침");
            // 현재 활성화된 탭이 'all-scraps' 또는 'image-gallery'인 경우에만 새로고침
            const activeTab = workspaceEl.querySelector(".resource-tab-btn.active");
            if (activeTab) {
                const tab = activeTab.dataset.tab;
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
                }
            }
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
