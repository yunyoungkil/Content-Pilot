// 썸네일 생성 기능 제거됨

// 이미지 갤러리 렌더링 및 에디터 삽입 이벤트
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

// 이미지 데이터 집계 함수: 연결된 스크랩에서 image/allImages 필드 파싱, 중복 제거
function renderImageGallery(linkedScrapsData) {
  const imageSet = new Set();
  linkedScrapsData.forEach((scrap) => {
    if (scrap.image) imageSet.add(scrap.image);
    if (Array.isArray(scrap.allImages)) {
      scrap.allImages.forEach((url) => imageSet.add(url));
    }
  });
  let result = Array.from(imageSet);
  // 테스트: 이미지가 하나도 없으면 예시 이미지 추가
  if (result.length === 0) {
    result = [
      "https://dummyimage.com/240x160/4285f4/fff.png&text=No+Image",
      "https://dummyimage.com/240x160/1a73e8/fff.png&text=Sample+Image",
    ];
  }
  return result;
}

// 파이어베이스 전체 스크랩과 캔버스 데이터에서 이미지 갤러리 업데이트
function updateImageGalleryFromAllScraps(resourceLibrary, allScraps, sendCommand, ideaData = null) {
  const imageGalleryArea = resourceLibrary.querySelector(".image-gallery-area");
  if (!imageGalleryArea) return;
  
  // 이미지 갤러리 컨테이너 구조 생성
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
  let allImageData = []; // 전체 이미지 데이터 저장
  let draftContentText = ""; // 초안 내용 텍스트
  
  imageGalleryGrid.innerHTML = "<p style='text-align:center;color:#888;padding:20px;'>이미지를 불러오는 중...</p>";
  
  // 이미지 데이터 수집 (URL과 메타데이터 포함)
  const imageDataMap = new Map(); // URL을 키로, 메타데이터를 값으로
  
  // 이미지 URL 유효성 검사 함수
  const isValidImageUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed.length === 0) return false;
    
    // 실제 이미지가 아닌 URL 필터링
    const invalidPatterns = [
      /sync\.smartadserver\.com/i,  // 추적 스크립트
      /getuid/i,                     // 추적 스크립트
      /usersync/i,                   // 추적 스크립트
      /pixel/i,                      // 추적 픽셀
      /tracking/i,                   // 추적 URL
      /analytics/i,                  // 분석 스크립트
      /beacon/i,                     // 비콘
      /\.js(\?|$)/i,                 // JavaScript 파일
      /\.css(\?|$)/i,                // CSS 파일
      /\.html(\?|$)/i,               // HTML 파일
    ];
    
    // 유효하지 않은 패턴 체크
    if (invalidPatterns.some(pattern => pattern.test(trimmed))) {
      return false;
    }
    
    // 유효한 이미지 URL 형식 체크
    return trimmed.startsWith('http://') || 
           trimmed.startsWith('https://') || 
           trimmed.startsWith('data:image/');
  };
  
  // 이미지 URL 정규화 함수
  const normalizeImageUrl = (url, baseUrl) => {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (trimmed.length === 0) return null;
    
    // 이미 절대 경로인 경우
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://') || trimmed.startsWith('data:image/')) {
      return trimmed;
    }
    
    // 상대 경로인 경우 절대 경로로 변환
    if (trimmed.startsWith('//')) {
      return 'https:' + trimmed;
    }
    
    if (trimmed.startsWith('/') && baseUrl) {
      try {
        const base = new URL(baseUrl);
        return base.origin + trimmed;
      } catch (e) {
        return null;
      }
    }
    
    if (!trimmed.startsWith('http') && baseUrl) {
      try {
        return new URL(trimmed, baseUrl).href;
      } catch (e) {
        return null;
      }
    }
    
    return null;
  };

  // 스크랩에서 이미지 수집
  allScraps.forEach((scrap) => {
    const baseUrl = scrap.url || window.location.href;
    
    if (scrap.image) {
      const normalized = normalizeImageUrl(scrap.image, baseUrl);
      if (normalized && isValidImageUrl(normalized)) {
        imageDataMap.set(normalized, {
          url: normalized,
          source: "스크랩",
          title: scrap.text?.substring(0, 50) || scrap.url || "스크랩 이미지",
          url_source: scrap.url || "",
          timestamp: scrap.timestamp || Date.now(),
          scrapId: scrap.id
        });
      }
    }
    
    if (Array.isArray(scrap.allImages)) {
      scrap.allImages.forEach((url) => {
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
      });
    }
    
    // 하위 호환성: images 배열도 확인 (구버전 데이터)
    if (Array.isArray(scrap.images)) {
      scrap.images.forEach((url) => {
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
      });
    }
  });
  
  // Firebase 캔버스 데이터에서 이미지 가져오기
  chrome.runtime.sendMessage({ action: "get_canvas_images" }, (canvasResponse) => {
    if (canvasResponse && canvasResponse.success && Array.isArray(canvasResponse.images)) {
      canvasResponse.images.forEach((imageUrl) => {
        // 캔버스 이미지도 정규화 및 유효성 검사
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
    allImageData = allImages; // 전체 이미지 데이터 저장
    
    // 초안 내용에서 텍스트 추출 함수
    function extractTextFromDraft(html) {
      if (!html) return "";
      // HTML 태그 제거
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      let text = tempDiv.textContent || tempDiv.innerText || "";
      // 공백 정리
      text = text.replace(/\s+/g, " ").trim();
      return text;
    }
    
    // 초안 내용과 이미지 관련성 계산 함수
    function calculateRelevance(imageData, draftText) {
      if (!draftText || draftText.length < 10) return 0; // 초안 내용이 너무 짧으면 관련성 없음
      
      const draftWords = draftText.toLowerCase().split(/\s+/).filter(w => w.length > 2); // 2글자 이상 단어만
      if (draftWords.length === 0) return 0;
      
      let score = 0;
      const searchText = (
        (imageData.title || "") + " " +
        (imageData.url_source || "") + " " +
        (imageData.url || "")
      ).toLowerCase();
      
      // 키워드 매칭
      draftWords.forEach(word => {
        if (searchText.includes(word)) {
          score += 1;
        }
      });
      
      // URL 도메인 매칭 (예: blog.kakaocdn.net, daumcdn.net 등)
      try {
        if (imageData.url) {
          const urlDomain = new URL(imageData.url).hostname;
          if (urlDomain && draftText.toLowerCase().includes(urlDomain.split(".")[0])) {
            score += 0.5;
          }
        }
      } catch (e) {
        // URL 파싱 실패 시 무시
      }
      
      // 정규화된 점수 (0-1 사이)
      return Math.min(score / Math.max(draftWords.length, 1), 1);
    }
    
    // 초안 내용에 맞는 이미지 필터링 함수
    function filterImagesByDraft(images, draftText) {
      if (!draftText || draftText.length < 10) return images; // 초안 내용이 없거나 너무 짧으면 전체 반환
      
      const filtered = images
        .map(img => ({
          ...img,
          relevance: calculateRelevance(img, draftText)
        }))
        .filter(img => img.relevance > 0) // 관련성 점수가 0보다 큰 것만
        .sort((a, b) => b.relevance - a.relevance); // 관련성 높은 순으로 정렬
      
      return filtered;
    }
    
    // 이미지 렌더링 함수
    function renderImages(images) {
      if (images.length === 0) {
        imageGalleryGrid.innerHTML =
          "<p style='text-align:center;color:#888;padding:20px;'>이미지가 없습니다.</p>";
        imageCount.textContent = "0개";
        return;
      }
      
      imageCount.textContent = `${images.length}개`;
      
      // HTML 이스케이프 함수
      const escapeHtml = (str) => {
        if (!str) return '';
        return String(str)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#039;');
      };

      imageGalleryGrid.innerHTML = images
        .map(
          (imgData) => {
            const escapedUrl = escapeHtml(imgData.url);
            const escapedTitle = escapeHtml(imgData.title || '이미지');
            return `
          <div class="gallery-thumb-wrap" draggable="true" data-image-url="${escapedUrl}" 
            data-title="${escapedTitle}" 
            data-source="${imgData.source}" 
            data-url-source="${escapeHtml(imgData.url_source || '')}"
            data-timestamp="${imgData.timestamp}"
            data-scrap-id="${imgData.scrapId || ''}"
            style="position: relative; cursor: pointer;">
            <img src="${escapedUrl}" class="gallery-thumb" 
              style="width:100%;height:88px;object-fit:cover;border-radius:8px;cursor:move;box-shadow:0 1px 6px rgba(0,0,0,0.08);" 
              alt="${escapedTitle}"
              loading="lazy"
              onerror="this.onerror=null; this.style.display='none'; const errorDiv = this.parentElement.querySelector('.gallery-image-error'); if(errorDiv) errorDiv.style.display='flex';">
            <div class="gallery-image-error" style="display: none; position: absolute; inset: 0; background: #f5f5f5; align-items: center; justify-content: center; color: #999; font-size: 11px; text-align: center; border-radius: 8px;">로드 실패</div>
            ${imgData.source === '스크랩' && imgData.scrapId ? `
              <button class="gallery-image-delete-btn" data-scrap-id="${imgData.scrapId}" data-image-url="${escapedUrl}"
                style="position: absolute; top: 4px; right: 4px; background: rgba(234,67,53,0.9); color: #fff; border: none; border-radius: 4px; width: 24px; height: 24px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: bold; z-index: 10; opacity: 0; transition: opacity 0.2s;"
                title="이미지 삭제">
                ×
              </button>
            ` : ''}
            <div class="gallery-thumb-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0); transition: background 0.2s; border-radius: 8px; display: flex; align-items: center; justify-content: center; pointer-events: none;">
              <span class="gallery-preview-icon" style="opacity: 0; transition: opacity 0.2s; color: #fff; font-size: 24px; pointer-events: auto; cursor: pointer; padding: 8px; border-radius: 50%; background: rgba(0,0,0,0.3);">🔍</span>
            </div>
          </div>
        `;
          }
        )
        .join("");
      
      // 이미지 로드 확인 및 에러 처리
      imageGalleryGrid.querySelectorAll(".gallery-thumb").forEach((img) => {
        // 이미지가 이미 로드 완료된 경우 확인
        if (img.complete) {
          if (img.naturalHeight === 0 || img.naturalWidth === 0) {
            // 이미지 로드 실패
            img.style.display = 'none';
            const errorDiv = img.parentElement.querySelector('.gallery-image-error');
            if (errorDiv) {
              errorDiv.style.display = 'flex';
            }
          }
        }
        
        // 이미지 로드 성공 이벤트
        img.addEventListener('load', function() {
          this.style.display = 'block';
          const errorDiv = this.parentElement.querySelector('.gallery-image-error');
          if (errorDiv) {
            errorDiv.style.display = 'none';
          }
        }, { once: true });
        
        // 이미지 로드 실패 이벤트 (이미 onerror가 있지만 추가 처리)
        img.addEventListener('error', function() {
          const originalSrc = this.src;
          if (!originalSrc) return;
          
          // 이미 재시도한 경우는 무시
          if (this.dataset.retried === 'true') return;
          this.dataset.retried = 'true';
          
          // 재시도: Image 객체로 먼저 테스트
          setTimeout(() => {
            const testImg = new Image();
            testImg.onload = () => {
              // 테스트 성공 시 실제 img에 적용
              this.src = originalSrc;
              this.style.display = 'block';
            };
            testImg.onerror = () => {
              // 최종 실패
              this.style.display = 'none';
              const errorDiv = this.parentElement.querySelector('.gallery-image-error');
              if (errorDiv) {
                errorDiv.style.display = 'flex';
              }
            };
            testImg.src = originalSrc;
          }, 200);
        }, { once: true });
      });
      
      // 드래그앤드랍으로 이미지 삽입
      imageGalleryGrid.querySelectorAll(".gallery-thumb-wrap").forEach((wrap) => {
        wrap.addEventListener("dragstart", (e) => {
          e.dataTransfer.setData("text/plain", wrap.dataset.imageUrl);
          e.dataTransfer.effectAllowed = "copy";
        });
        
        // 삭제 버튼 이벤트
        const deleteBtn = wrap.querySelector(".gallery-image-delete-btn");
        if (deleteBtn) {
          deleteBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            const scrapId = deleteBtn.dataset.scrapId;
            const imageUrl = deleteBtn.dataset.imageUrl;
            
            if (confirm('이 이미지를 삭제하시겠습니까?')) {
              chrome.runtime.sendMessage({
                action: 'remove_scrap_image',
                data: { scrapId, imageUrl }
              }, (response) => {
                if (response && response.success) {
                  // 이미지 갤러리 새로고침
                  chrome.runtime.sendMessage({ action: "get_all_scraps" }, (response) => {
                    if (response && response.success) {
                      updateImageGalleryFromAllScraps(resourceLibrary, response.scraps, sendCommand, ideaData);
                    }
                  });
                } else {
                  alert('이미지 삭제에 실패했습니다: ' + (response?.error || '알 수 없는 오류'));
                }
              });
            }
          });
          
          // 삭제 버튼 hover 시 표시
          wrap.addEventListener("mouseenter", () => {
            if (deleteBtn) deleteBtn.style.opacity = "1";
          });
          wrap.addEventListener("mouseleave", () => {
            if (deleteBtn) deleteBtn.style.opacity = "0";
          });
        }
        
        // 이미지 클릭: 에디터에 삽입
        const img = wrap.querySelector(".gallery-thumb");
        if (img) {
          img.addEventListener("click", (e) => {
            // 삭제 버튼이나 에러 메시지 클릭은 무시
            if (e.target.closest(".gallery-image-delete-btn")) return;
            if (e.target.closest(".gallery-image-error")) return;
            // 미리보기 아이콘 클릭은 무시 (오버레이에서 처리)
            if (e.target.closest(".gallery-preview-icon")) return;
            
            e.stopPropagation();
            e.preventDefault();
            const imageUrl = wrap.dataset.imageUrl || img.src;
            if (imageUrl && imageUrl.startsWith("http")) {
              sendCommand("insert-image", { url: imageUrl });
              sendCommand("focus");
            }
          });
        }
        
        // 미리보기 (더블클릭 또는 미리보기 아이콘 클릭)
        const overlay = wrap.querySelector(".gallery-thumb-overlay");
        const previewIcon = overlay?.querySelector(".gallery-preview-icon");
        
        if (overlay) {
          wrap.addEventListener("mouseenter", () => {
            overlay.style.background = "rgba(0,0,0,0.5)";
            if (previewIcon) previewIcon.style.opacity = "1";
          });
          wrap.addEventListener("mouseleave", () => {
            overlay.style.background = "rgba(0,0,0,0)";
            if (previewIcon) previewIcon.style.opacity = "0";
          });
          
          // 더블클릭: 미리보기
          wrap.addEventListener("dblclick", (e) => {
            e.stopPropagation();
            e.preventDefault();
            const imgData = {
              url: wrap.dataset.imageUrl || img?.src,
              title: wrap.dataset.title,
              source: wrap.dataset.source,
              url_source: wrap.dataset.urlSource,
              timestamp: wrap.dataset.timestamp
            };
            showImagePreview(imgData);
          });
          
          // 미리보기 아이콘 클릭: 미리보기
          if (previewIcon) {
            previewIcon.addEventListener("click", (e) => {
              e.stopPropagation();
              e.preventDefault();
              const imgData = {
                url: wrap.dataset.imageUrl || img?.src,
                title: wrap.dataset.title,
                source: wrap.dataset.source,
                url_source: wrap.dataset.urlSource,
                timestamp: wrap.dataset.timestamp
              };
              showImagePreview(imgData);
            });
          }
        }
      });
    }
    
    // 이미지 미리보기 함수
    function showImagePreview(imgData) {
      previewImage.src = imgData.url;
      const date = imgData.timestamp ? new Date(parseInt(imgData.timestamp)) : new Date();
      imageMetadata.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 6px;">${imgData.title || '이미지'}</div>
        <div style="opacity: 0.9; font-size: 11px;">출처: ${imgData.source}${imgData.url_source ? ` | ${shortenLink(imgData.url_source, 30)}` : ''}</div>
        <div style="opacity: 0.8; font-size: 11px; margin-top: 4px;">날짜: ${date.toLocaleDateString('ko-KR')} ${date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</div>
      `;
      previewModal.style.display = "flex";
    }
    
    closePreview.addEventListener("click", () => {
      previewModal.style.display = "none";
    });
    
    previewModal.addEventListener("click", (e) => {
      if (e.target === previewModal) {
        previewModal.style.display = "none";
      }
    });
    
    // 초안 내용 가져오기 함수
    function getDraftContent() {
      return new Promise((resolve) => {
        // 1. 먼저 ideaData에서 draftContent 확인
        if (ideaData && ideaData.draftContent) {
          const text = extractTextFromDraft(ideaData.draftContent);
          if (text && text.length >= 10) {
            resolve(text);
            return;
          }
        }
        
        // 2. 에디터에서 내용 가져오기
        const editorIframe = document.querySelector("#quill-editor-iframe");
        if (!editorIframe || !editorIframe.contentWindow) {
          resolve("");
          return;
        }
        
        // 메시지 리스너 설정 (고유한 식별자 사용)
        const messageId = `draft-content-${Date.now()}-${Math.random()}`;
        const messageHandler = (event) => {
          if (event.source !== editorIframe.contentWindow) return;
          const { action, data, requestId } = event.data;
          
          if (action === "content-response" && requestId === messageId && data) {
            window.removeEventListener("message", messageHandler);
            const html = data.html || "";
            const text = extractTextFromDraft(html);
            resolve(text);
          }
        };
        
        window.addEventListener("message", messageHandler);
        
        // 에디터에 내용 요청 (고유 ID 포함)
        editorIframe.contentWindow.postMessage({ 
          action: "get-content",
          requestId: messageId
        }, "*");
        
        // 타임아웃 (5초 후 실패 처리)
        setTimeout(() => {
          window.removeEventListener("message", messageHandler);
          resolve("");
        }, 5000);
      });
    }
    
    // 초안 필터 토글 함수
    async function toggleDraftFilter() {
      if (!isDraftFilterActive) {
        // 필터 활성화
        filterByDraftBtn.style.background = "#e8f0fe";
        filterByDraftBtn.style.borderColor = "#1a73e8";
        filterByDraftBtn.querySelector("span:last-child").textContent = "초안 필터 ON";
        
        // 초안 내용 가져오기
        draftContentText = await getDraftContent();
        
        if (!draftContentText || draftContentText.length < 10) {
          alert("초안 내용이 없거나 너무 짧습니다. 초안을 작성한 후 다시 시도해주세요.");
          filterByDraftBtn.style.background = "#fff";
          filterByDraftBtn.style.borderColor = "#dadce0";
          filterByDraftBtn.querySelector("span:last-child").textContent = "초안 필터";
          return;
        }
        
        isDraftFilterActive = true;
        const filtered = filterImagesByDraft(allImages, draftContentText);
        renderImages(filtered);
      } else {
        // 필터 비활성화
        filterByDraftBtn.style.background = "#fff";
        filterByDraftBtn.style.borderColor = "#dadce0";
        filterByDraftBtn.querySelector("span:last-child").textContent = "초안 필터";
        isDraftFilterActive = false;
        renderImages(allImages);
      }
    }
    
    // 초안 필터 버튼 이벤트
    if (filterByDraftBtn) {
      filterByDraftBtn.addEventListener("click", toggleDraftFilter);
    }
    
    // 검색 기능 (초안 필터와 통합)
    searchInput.addEventListener("input", (e) => {
      const searchTerm = e.target.value.toLowerCase().trim();
      let imagesToRender = isDraftFilterActive 
        ? filterImagesByDraft(allImages, draftContentText)
        : allImages;
      
      if (!searchTerm) {
        renderImages(imagesToRender);
        return;
      }
      
      const filtered = imagesToRender.filter((img) => {
        return (img.title && img.title.toLowerCase().includes(searchTerm)) ||
               (img.url_source && img.url_source.toLowerCase().includes(searchTerm)) ||
               (img.source && img.source.toLowerCase().includes(searchTerm));
      });
      renderImages(filtered);
    });
    
    // 초기 렌더링
    renderImages(allImages);
  });
}
// js/ui/workspaceMode.js (수정 완료된 최종 버전)

import { shortenLink } from "../utils.js";
import { marked } from "marked";

export function renderWorkspace(container, ideaData) {
  ideaData.linkedScraps = Array.isArray(ideaData.linkedScraps)
    ? ideaData.linkedScraps
    : ideaData.linkedScraps
    ? Object.keys(ideaData.linkedScraps)
    : [];

  // --- 브리핑 데이터가 없으면 자동 생성 (각 필드별로 개별 체크) ---
  const needsOutline = !ideaData.outline || ideaData.outline.length === 0;
  const needsMainKeywords = !ideaData.tags || ideaData.tags.length <= 1 || (ideaData.tags.length === 1 && ideaData.tags[0] === '#AI-추천');
  const needsKeywords = !ideaData.recommendedKeywords || ideaData.recommendedKeywords.length === 0;
  const needsLongTail = !ideaData.longTailKeywords || ideaData.longTailKeywords.length === 0;
  
  // 브리핑 생성 진행률 표시 영역
  let briefingProgressEl = null;
  const createProgressIndicator = () => {
    const aiBriefingArea = workspaceEl.querySelector("#ai-briefing-area");
    if (!aiBriefingArea) return null;
    
    const existing = aiBriefingArea.querySelector(".briefing-progress-indicator");
    if (existing) return existing;
    
    const progressEl = document.createElement("div");
    progressEl.className = "briefing-progress-indicator";
    progressEl.style.cssText = `
      padding: 12px;
      background: #f0f7ff;
      border: 1px solid #b3d9ff;
      border-radius: 8px;
      margin-bottom: 12px;
      display: none;
    `;
    progressEl.innerHTML = `
      <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
        <div class="progress-spinner" style="width: 20px; height: 20px; border: 3px solid #e0e0e0; border-top-color: #4285f4; border-radius: 50%; animation: spin 1s linear infinite;"></div>
        <div style="flex: 1;">
          <div style="font-weight: 600; font-size: 13px; color: #333; margin-bottom: 4px;">브리핑 데이터 생성 중...</div>
          <div class="progress-text" style="font-size: 12px; color: #666;">초기화 중...</div>
        </div>
        <div class="progress-percentage" style="font-weight: 600; font-size: 14px; color: #4285f4;">0%</div>
      </div>
      <div class="progress-bar-container" style="height: 4px; background: #e0e0e0; border-radius: 2px; overflow: hidden;">
        <div class="progress-bar" style="height: 100%; background: #4285f4; width: 0%; transition: width 0.3s;"></div>
      </div>
      <style>
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      </style>
    `;
    aiBriefingArea.insertBefore(progressEl, aiBriefingArea.firstChild);
    return progressEl;
  };
  
  // 브리핑 진행률 리스너
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === "briefing_progress" && msg.cardId === ideaData.id) {
      if (!briefingProgressEl) {
        briefingProgressEl = createProgressIndicator();
      }
      if (briefingProgressEl && msg.progress) {
        const { completed, total, current, percentage } = msg.progress;
        briefingProgressEl.style.display = "block";
        briefingProgressEl.querySelector(".progress-text").textContent = `${current} (${completed}/${total})`;
        briefingProgressEl.querySelector(".progress-percentage").textContent = `${percentage}%`;
        briefingProgressEl.querySelector(".progress-bar").style.width = `${percentage}%`;
        
        if (completed >= total) {
          setTimeout(() => {
            if (briefingProgressEl) {
              briefingProgressEl.style.display = "none";
            }
          }, 1000);
        }
      }
    }
  });
  
  // 각 필드가 없으면 개별적으로 생성 요청
  if (ideaData.title && ideaData.description) {
    if (needsOutline || needsMainKeywords || needsKeywords || needsLongTail) {
      briefingProgressEl = createProgressIndicator();
      if (briefingProgressEl) {
        briefingProgressEl.style.display = "block";
      }
      
      chrome.runtime.sendMessage({
        action: "generate_idea_briefing",
        data: {
          cardId: ideaData.id,
          title: ideaData.title,
          description: ideaData.description,
          // 생성할 필드만 지정 (없는 것만 생성)
          generateOutline: needsOutline,
          generateMainKeywords: needsMainKeywords,
          generateKeywords: needsKeywords,
          generateLongTail: needsLongTail
        }
      }, (response) => {
        if (response && response.success) {
          // Firebase 실시간 업데이트를 통해 자동으로 UI가 갱신됨
          console.log("브리핑 데이터 생성 요청 완료");
        } else if (response && response.error) {
          console.error("브리핑 데이터 생성 실패:", response.error);
          if (briefingProgressEl) {
            briefingProgressEl.querySelector(".progress-text").textContent = `오류: ${response.error}`;
            briefingProgressEl.querySelector(".progress-text").style.color = "#ea4335";
            setTimeout(() => {
              if (briefingProgressEl) {
                briefingProgressEl.style.display = "none";
              }
            }, 3000);
          }
        }
      });
    }
  }

  // --- 에디터 draft 저장 메시지 수신 및 background로 전달 ---
  window.__cp_workspace_idea_id = ideaData.id;
  if (!window.__cp_workspace_save_listener) {
    window.addEventListener("message", function (event) {
      if (
        event.data &&
        event.data.action === "cp_save_draft" &&
        event.data.content
      ) {
        const draftContent = event.data.content;
        const ideaId = window.__cp_workspace_idea_id;
        if (ideaId) {
          chrome.runtime.sendMessage(
            {
              action: "save_idea_draft",
              ideaId: ideaId,
              draft: draftContent,
            },
            function (response) {
              // 저장 성공/실패에 따라 피드백 처리 가능 (선택)
            }
          );
        }
      }
    });
    window.__cp_workspace_save_listener = true;
  }
  const outlineHtml =
    ideaData.outline && ideaData.outline.length > 0
      ? ideaData.outline.map((item) => `<li>${item}</li>`).join("")
      : "<li>추천 목차가 없습니다.</li>";

  const KeywordsTagsHtml =
    ideaData.tags && ideaData.tags.length > 0
      ? ideaData.tags
          .filter((t) => t !== "#AI-추천")
          .map(
            (k) =>
              `<span class="tag interactive-tag" title="클릭하여 본문에 추가">${k}</span>`
          )
          .join("")
      : "<span>제안된 주요 키워드가 없습니다.</span>";

  const longTailKeywordsHtml =
    ideaData.longTailKeywords && ideaData.longTailKeywords.length > 0
      ? ideaData.longTailKeywords
          .map(
            (k) =>
              `<span class="tag long-tail-keyword interactive-tag" title="클릭하여 본문에 추가">${k}</span>`
          )
          .join("")
      : "<span>제안된 롱테일 키워드가 없습니다.</span>";

  const searchesHtml =
    ideaData.recommendedKeywords && ideaData.recommendedKeywords.length > 0
      ? ideaData.recommendedKeywords
          .map(
            (item) =>
              `<li><a href="https://www.google.com/search?q=${encodeURIComponent(
                item
              )}" target="_blank">${item}</a></li>`
          )
          .join("")
      : "<li>추천 검색어가 없습니다.</li>";

  const hasDraft = !!ideaData.draftContent;
  const draftActionsHtml = `
    <div id="draft-actions-header" style="display: flex; justify-content: space-between; align-items: center; padding-bottom: 12px; border-bottom: 1px solid #f0f0f0;">
      <button id="generate-draft-btn">
        📄 AI로 초안 생성하기
      </button>
      ${
        hasDraft
          ? `<button id="delete-draft-in-workspace" class="draft-delete-btn"
                  title="작성된 초안 내용을 완전히 삭제하고 아이디어 상태로 초기화합니다.">
             ❌ 초안 삭제
           </button>`
          : ""
      }
    </div>`;

  const editorKeywordSectionHtml = `
    <div class="editor-keyword-section">
      <div class="keyword-list">
        ${KeywordsTagsHtml} ${longTailKeywordsHtml}
      </div>
    </div>
  `;

  container.innerHTML = `
    <div class="workspace-container">
      <div id="main-editor-panel" class="workspace-column" style="display: flex; flex-direction: column; min-height: 0;">
        <div id="workspace-title-header" style="padding: 12px 16px; border-bottom: 1px solid #e9ecef; background: #f8f9fa; border-radius: 8px 8px 0 0;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <input type="text" id="workspace-title-input" value="${ideaData.title || "제목 없음"}" 
              style="flex: 1; font-size: 16px; font-weight: 600; color: #333; border: 1px solid transparent; background: transparent; padding: 4px 8px; border-radius: 4px; outline: none;"
              placeholder="제목을 입력하세요">
            <button id="save-title-btn" style="padding: 4px 12px; font-size: 12px; border: 1px solid #dadce0; background: #fff; border-radius: 4px; cursor: pointer; display: none;">저장</button>
          </div>
        </div>
        ${draftActionsHtml}
        <div style="flex: 1 1 0; min-height: 0; display: flex; flex-direction: column; gap: 8px;">
          <iframe id="quill-editor-iframe" src="${chrome.runtime.getURL(
            "editor.html"
          )}" frameborder="0" style="flex: 1 1 0; min-height: 0; width: 100%; display: block; border: 1.5px solid #e9ecef; border-radius: 8px; background: white; overflow: hidden;"></iframe>
          <div id="linked-scraps-section" style="flex-shrink: 0; margin-top: 0;">
            <div class="scrap-list linked-scraps-list empty-state" data-idea-id="${
              ideaData.id
            }">
              <p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>
            </div>
          </div>
        </div>
      </div>

      <div id="resource-library-panel" class="workspace-column">
        <div class="resource-tabs">
          <button class="resource-tab-btn active" data-tab="ai-briefing" style="font-weight:bold;" title="AI 브리핑">✨</button>
          <button class="resource-tab-btn" data-tab="outline" title="추천 목차">📄</button>
          <button class="resource-tab-btn" data-tab="recommended-keywords" title="추천 검색어">🔍</button>
          <button class="resource-tab-btn" data-tab="all-scraps" title="모든 스크랩">📖</button>
          <button class="resource-tab-btn" data-tab="image-gallery" title="이미지 갤러리">🖼️</button>
          <button class="resource-tab-btn" data-tab="publish-info" title="발행 정보">📝</button>
        </div>
        
        <div class="resource-content-area ai-briefing-area" id="ai-briefing-area" style="display: block;">
          ${editorKeywordSectionHtml}
        </div>
        
        <div class="resource-content-area outline-area" id="outline-area" style="display: none;">
          <div class="ai-briefing-content">
            <h4>추천 목차</h4>
            <ul class="outline-list">
              ${outlineHtml}
            </ul>
          </div>
        </div>
        
        <div class="resource-content-area recommended-keywords-area" id="recommended-keywords-area" style="display: none;">
          <div class="ai-briefing-content">
            <h4>추천 검색어</h4>
            <ul>
              ${searchesHtml}
            </ul>
          </div>
        </div>
        
        <div class="resource-content-area all-scraps-area" id="all-scraps-list-container" style="display: none;">
          <div class="scrap-list all-scraps-list">
            <p class="loading-scr랩">스크랩 목록을 불러오는 중...</p>
          </div>
        </div>
        
        <div class="resource-content-area image-gallery-area" id="image-gallery-list-container" style="display: none;">
          <div class="image-gallery-grid">
            <p class="loading-images">이미지 갤러리를 불러오는 중...</p>
          </div>
        </div>
        
        <div class="resource-content-area publish-info-area" id="publish-info-area" style="display: none;">
          <div id="publish-info-content" style="padding: 16px;">
            <p style="color: #666; font-size: 13px; text-align: center;">초안 생성 후 발행 정보가 여기에 표시됩니다.</p>
          </div>
        </div>
      </div>
    </div>
  `;

  chrome.runtime.sendMessage({ action: "get_all_scraps" }, (response) => {
    if (response && response.success) {
      const allScrapsContainer = container.querySelector(".all-scraps-list");
      const linkedScrapsContainer = container.querySelector(
        ".linked-scraps-list"
      );

      if (response.scraps.length > 0) {
        const allScrapsData = response.scraps;

        const linkedScrapsHtml = allScrapsData
          .filter((s) => ideaData.linkedScraps.includes(s.id))
          .map((s) => createScrapCard(s, true))
          .join("");

        const allScrapsHtml = allScrapsData
          .map((s) => createScrapCard(s, false))
          .join("");

        if (linkedScrapsHtml) {
          linkedScrapsContainer.innerHTML = linkedScrapsHtml;
          linkedScrapsContainer.classList.remove("empty-state");
        } else {
          linkedScrapsContainer.innerHTML =
            "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
          linkedScrapsContainer.classList.add("empty-state");
        }
        allScrapsContainer.innerHTML = allScrapsHtml;

        // 연결된 자료가 변경될 때 에디터 높이 재조정 메시지 전송
        const editorIframe = container.querySelector("#quill-editor-iframe");
        if (editorIframe && editorIframe.contentWindow) {
          editorIframe.contentWindow.postMessage(
            { action: "adjust-editor-height" },
            "*"
          );
        }
      } else {
        linkedScrapsContainer.innerHTML =
          "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
        linkedScrapsContainer.classList.add("empty-state");
        allScrapsContainer.innerHTML = "<p>자료 보관함이 비어있습니다.</p>";

        // 연결된 자료가 변경될 때 에디터 높이 재조정 메시지 전송
        const editorIframe = container.querySelector("#quill-editor-iframe");
        if (editorIframe && editorIframe.contentWindow) {
          editorIframe.contentWindow.postMessage(
            { action: "adjust-editor-height" },
            "*"
          );
        }
      }
    }
  });

  addWorkspaceEventListeners(
    container.querySelector(".workspace-container"),
    ideaData
  );
}

function createScrapCard(scrap, isLinked) {
  const textContent = scrap.text || "(내용 없음)";
  const cleanedTitle = textContent.replace(/\s+/g, " ").trim();
  const displayTitle = cleanedTitle.substring(0, 10);
  // 연결된 자료일 경우 태그형 UI 반환 (unlink 버튼 제거, 드래그만)
  if (isLinked) {
    return `
      <div class="scrap-card-item linked-scrap-item" data-scrap-id="${
        scrap.id
      }" data-text="${textContent.replace(
      /"/g,
      "&quot;"
    )}" draggable="true" style="margin:0;">
        <div class="linked-scrap-tag">
          <span class="tag-text">${displayTitle}...</span>
        </div>
      </div>
    `;
  }
  // ...기존 카드형 UI 반환 로직 유지
  const tagsHtml =
    scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
      ? `<div class=\"card-tags\">${scrap.tags
          .map((tag) => `<span class=\"tag\">#${tag}</span>`)
          .join("")}</div>`
      : "";
  const actionButton = `<button class=\"scrap-card-delete-btn unlink-scrap-btn\" title=\"연결 해제\">
         <svg xmlns=\"http://www.w3.org/2000/svg\" height=\"18\" viewBox=\"0 -960 960 960\" width=\"18\"><path d=\"m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z\"/></svg>
       </button>`;
  return `
    <div class=\"scrap-card-item\" draggable=\"true\" data-scrap-id=\"${
      scrap.id
    }\" data-text=\"${textContent.replace(/\"/g, "&quot;")}\">
        <div class=\"scrap-card\">
            ${actionButton}
            ${
              scrap.image
                ? `<div class=\"scrap-card-img-wrap\"><img src=\"${scrap.image}\" alt=\"scrap image\" referrerpolicy=\"no-referrer\"></div>`
                : ""
            }
            <div class=\"scrap-card-info\">
                <div class=\"scrap-card-title\">${cleanedTitle.substring(
                  0,
                  20
                )}...</div>
                <div class=\"scrap-card-snippet\">${shortenLink(
                  scrap.url,
                  25
                )}</div>
                ${tagsHtml}
            </div>
        </div>
    </div>
  `;
}

function addWorkspaceEventListeners(workspaceEl, ideaData) {
  // --- TUI Image Editor 동적 로더 (옵션) ---
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`script[src="${src}"]`)) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => resolve();
      s.onerror = (e) => reject(e);
      document.head.appendChild(s);
    });
  }
  function loadCSS(href) {
    return new Promise((resolve, reject) => {
      if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`))
        return resolve();
      const l = document.createElement("link");
      l.rel = "stylesheet";
      l.href = href;
      l.onload = () => resolve();
      l.onerror = (e) => reject(e);
      document.head.appendChild(l);
    });
  }
  async function ensureTuiEditorLoaded() {
    if (window.tui && window.tui.ImageEditor) return true;
    // 1. 로컬(lib/) 우선 로드 시도 (의존성 순서 중요)
    try {
      // 필수 의존성을 순서대로 로드
      await loadCSS(chrome.runtime.getURL("lib/tui-color-picker.min.css"));
      await loadCSS(chrome.runtime.getURL("lib/tui-image-editor.min.css"));
      // fabric.js 먼저 로드 (TUI Image Editor의 핵심 의존성)
      if (!window.fabric) {
        await loadScript(chrome.runtime.getURL("lib/fabric.min.js"));
      }
      // tui-code-snippet 로드
      if (!window.tui || !window.tui.util) {
        await loadScript(chrome.runtime.getURL("lib/tui-code-snippet.js"));
      }
      // tui-color-picker 로드
      if (!window.tui || !window.tui.colorPicker) {
        await loadScript(chrome.runtime.getURL("lib/tui-color-picker.min.js"));
      }
      // 마지막으로 TUI Image Editor 로드
      await loadScript(chrome.runtime.getURL("lib/tui-image-editor.min.js"));
      if (window.tui && window.tui.ImageEditor) return true;
    } catch (e) {
      console.warn("로컬 TUI Image Editor 로드 실패, CDN 시도", e);
    }
    // 2. window.CP_ENABLE_TUI_CDN === true일 때 CDN에서 로드
    if (!window.CP_ENABLE_TUI_CDN) return false;
    try {
      await loadCSS(
        "https://uicdn.toast.com/tui-color-picker/latest/tui-color-picker.css"
      );
      await loadCSS(
        "https://uicdn.toast.com/tui-image-editor/latest/tui-image-editor.css"
      );
      await loadScript(
        "https://cdnjs.cloudflare.com/ajax/libs/fabric.js/4.6.0/fabric.min.js"
      );
      await loadScript(
        "https://uicdn.toast.com/tui-code-snippet/latest/tui-code-snippet.js"
      );
      await loadScript(
        "https://uicdn.toast.com/tui-color-picker/latest/tui-color-picker.js"
      );
      await loadScript(
        "https://uicdn.toast.com/tui-image-editor/latest/tui-image-editor.js"
      );
      return !!(window.tui && window.tui.ImageEditor);
    } catch (e) {
      console.error("Failed to load TUI Editor libs", e);
      return false;
    }
  }
  // --- W-21/W-22/W-23: TUI 편집 모달 렌더링 유틸 ---
  function renderTUIEditorModal(imageUrl, sendCommand, onIframeReady) {
    if (!imageUrl) {
      window.parent.postMessage(
        {
          action: "cp_show_toast",
          message: "❗ 편집할 이미지 URL이 없습니다.",
        },
        "*"
      );
      return;
    }

    // 중복 모달 방지
    const existing = workspaceEl.querySelector(".cp-tui-modal-wrap");
    if (existing) {
      try {
        existing.remove();
      } catch (e) {}
    }

    // 모달 컨테이너 생성
    const modalWrap = document.createElement("div");
    modalWrap.className = "cp-tui-modal-wrap";
    modalWrap.innerHTML = `
      <div class="cp-modal-backdrop"></div>
      <div class="cp-modal">
        <div class="cp-modal-header">
          <div class="cp-modal-title">🎨 TUI 이미지 편집기</div>
          <button class="cp-modal-close" title="닫기">×</button>
        </div>
        <div class="cp-modal-body">
          <div id="cp-tui-editor-mount" class="cp-tui-editor-mount"></div>
        </div>
        <div class="cp-modal-footer">
          <button class="cp-btn cp-btn-secondary">취소</button>
          <button class="cp-btn cp-btn-primary">저장</button>
        </div>
      </div>`;

    workspaceEl.appendChild(modalWrap);
    // W-21.2: 모달 내부 클릭 이벤트 전파 차단
    modalWrap.addEventListener("click", (e) => {
      e.stopPropagation();
    });

    const btnClose = modalWrap.querySelector(".cp-modal-close");
    const btnCancel = modalWrap.querySelector(".cp-btn-secondary");
    const btnSave = modalWrap.querySelector(".cp-btn-primary");
    const mountEl = modalWrap.querySelector("#cp-tui-editor-mount");
    const backdrop = modalWrap.querySelector(".cp-modal-backdrop");

    const onKeydown = (e) => {
      if (e.key === "Escape") cleanup();
    };
    const cleanup = () => {
      try {
        modalWrap.remove();
      } catch (e) {}
      document.removeEventListener("keydown", onKeydown);
    };
    btnClose.onclick = btnCancel.onclick = cleanup;
    backdrop.onclick = function (e) {
      console.log("[CP] 백드롭 클릭됨, 모달 닫기 시도");
      cleanup();
    };
    document.addEventListener("keydown", onKeydown);

    // iframe 기반 TUI Image Editor 모달 구현
    const iframe = document.createElement("iframe");
    iframe.src = chrome.runtime.getURL("tui-editor.html");
    iframe.style.width = "calc(100% - 32px)";
    iframe.style.marginRight = "32px";
    iframe.style.height = "600px";
    iframe.style.border = "none";
    iframe.style.background = "#fff";
    iframe.style.position = "relative";
    iframe.style.zIndex = "9999"; // 백드롭(9998)보다 앞에 위치
    mountEl.appendChild(iframe);

    // iframe 로드 후 이미지 URL 전달 및 추가 콜백 실행
    iframe.onload = () => {
      iframe.contentWindow.postMessage(
        { action: "open-tui-editor", imageUrl },
        "*"
      );
      if (typeof onIframeReady === "function") {
        onIframeReady(iframe);
      }
    };

    // 저장 버튼 클릭 시 iframe에 편집 결과 요청
    btnSave.onclick = () => {
      iframe.contentWindow.postMessage({ action: "get-edited-image" }, "*");
    };

    // 부모 창에서 결과/범위 갱신 수신 후 Quill에 반영
    window.addEventListener("message", function onResult(event) {
      if (
        event.data &&
        event.data.action === "tui-editor-result" &&
        event.data.dataUrl
      ) {
        // 중복 삽입 방지: replace-edited-image 한 번만 호출
        sendCommand("replace-edited-image", { dataUrl: event.data.dataUrl });
        sendCommand("focus");
        window.parent.postMessage(
          {
            action: "cp_show_toast",
            message: "✅ 편집된 이미지로 교체했습니다.",
          },
          "*"
        );
        cleanup();
        window.removeEventListener("message", onResult);
      } else if (
        event.data &&
        event.data.action === "cp_update_editing_range" &&
        (event.data.data?.range || event.data.data?.url)
      ) {
        // TUI iframe에서 전달한 Range를 Quill iframe으로 전달
        if (editorIframe && editorIframe.contentWindow) {
          editorIframe.contentWindow.postMessage(
            {
              action: "cp_update_editing_range",
              data: { range: event.data.data.range, url: event.data.data.url },
            },
            "*"
          );
        }
      }
    });
  }
  const editorIframe = workspaceEl.querySelector("#quill-editor-iframe");
  const resourceLibrary = workspaceEl.querySelector("#resource-library-panel");
  const tabBtns = resourceLibrary.querySelectorAll(".resource-tab-btn");
  const allScrapsArea = resourceLibrary.querySelector(".all-scraps-area");
  const imageGalleryArea = resourceLibrary.querySelector(".image-gallery-area");
  const aiBriefingArea = resourceLibrary.querySelector("#ai-briefing-area");
  const outlineArea = resourceLibrary.querySelector("#outline-area");
  const recommendedKeywordsArea = resourceLibrary.querySelector("#recommended-keywords-area");
  
  // 제목 편집 기능
  const titleInput = workspaceEl.querySelector("#workspace-title-input");
  const saveTitleBtn = workspaceEl.querySelector("#save-title-btn");
  if (titleInput && saveTitleBtn) {
    let originalTitle = ideaData.title || "";
    
    titleInput.addEventListener("input", () => {
      if (titleInput.value !== originalTitle) {
        saveTitleBtn.style.display = "block";
      } else {
        saveTitleBtn.style.display = "none";
      }
    });
    
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        saveTitleBtn.click();
      }
    });
    
    saveTitleBtn.addEventListener("click", () => {
      const newTitle = titleInput.value.trim() || "제목 없음";
      chrome.runtime.sendMessage({
        action: "update_kanban_card",
        data: {
          cardId: ideaData.id,
          status: ideaData.status,
          updates: { title: newTitle }
        }
      }, (response) => {
        if (response && response.success) {
          originalTitle = newTitle;
          ideaData.title = newTitle;
          saveTitleBtn.style.display = "none";
          window.parent.postMessage({
            action: "cp_show_toast",
            message: "✅ 제목이 업데이트되었습니다."
          }, "*");
        } else {
          window.parent.postMessage({
            action: "cp_show_toast",
            message: "❌ 제목 업데이트 실패"
          }, "*");
      }
    });
  });
}

/**
 * 퍼머링크와 태그 정보를 표시하는 UI 생성
 */
function showPublishInfo(workspaceEl, permalink, tags, seoTitle, ideaData) {
  // 기존 퍼블리시 정보가 있으면 제거
  const existingInfo = workspaceEl.querySelector('.publish-info-panel');
  if (existingInfo) {
    existingInfo.remove();
  }
  
  // 채널 정보 가져오기
  chrome.runtime.sendMessage({ action: "get_my_channels" }, (channelsResponse) => {
    const myChannels = channelsResponse?.channels?.myChannels?.blogs || [];
    const firstChannel = myChannels.length > 0 ? myChannels[0] : null;
    const channelUrl = firstChannel?.inputUrl || '';
    
    // 퍼머링크와 채널 URL 조합
    const fullUrl = channelUrl && permalink 
      ? `${channelUrl.replace(/\/$/, '')}/${permalink}`
      : '';
    
    // 퍼블리시 정보 패널 생성
    const publishInfoPanel = document.createElement('div');
    publishInfoPanel.className = 'publish-info-panel';
    publishInfoPanel.style.cssText = `
      margin-top: 12px;
      padding: 16px;
      background: #f8f9fa;
      border: 1px solid #e9ecef;
      border-radius: 8px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    `;
    
    publishInfoPanel.innerHTML = `
      <div style="font-weight: 600; font-size: 14px; color: #333; margin-bottom: 4px;">
        📝 발행 정보
      </div>
      <div style="display: flex; flex-direction: column; gap: 8px;">
        ${seoTitle ? `
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">SEO 최적화 제목</label>
          <input type="text" id="seo-title-input" value="${seoTitle || ''}" 
            readonly
            style="width: 100%; padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
          <div style="font-size: 11px; color: #666; margin-top: 4px;">아이디어 제목과 분리된 검색 최적화 제목입니다.</div>
        </div>
        ` : ''}
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">퍼머링크</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="permalink-input" value="${permalink || ''}" 
              readonly
              style="flex: 1; padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
            ${fullUrl ? `<button id="connect-permalink-btn" class="connect-btn" style="padding: 6px 12px; border: 1px solid #4285f4; background: #4285f4; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap;">🔗 연결하기</button>` : ''}
          </div>
          ${fullUrl ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">전체 URL: <span style="color: #1a73e8;">${fullUrl}</span></div>` : ''}
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">태그 (쉼표 구분)</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="tags-input" value="${tags || ''}" 
              readonly
              style="flex: 1; padding: 6px 12px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
            <button id="copy-tags-btn" class="copy-btn" style="padding: 6px 12px; border: 1px solid #dadce0; background: #fff; border-radius: 4px; cursor: pointer; font-size: 12px; white-space: nowrap;">📋 복사</button>
          </div>
        </div>
      </div>
    `;
    
    // 오른쪽 탭의 발행 정보 영역에 삽입
    const publishInfoArea = workspaceEl.querySelector('#publish-info-content');
    if (publishInfoArea) {
      publishInfoArea.innerHTML = '';
      publishInfoArea.appendChild(publishInfoPanel);
    }
    
    // 연결하기 버튼 클릭 이벤트
    const connectBtn = publishInfoPanel.querySelector('#connect-permalink-btn');
    if (connectBtn && fullUrl) {
      connectBtn.addEventListener('click', () => {
        // 발행 완료 카드에 URL 연결
        const cardId = ideaData.id;
        // 현재 카드의 상태 확인
        chrome.runtime.sendMessage({
          action: "get_kanban_card_status",
          data: { cardId }
        }, (statusResponse) => {
          const currentStatus = statusResponse?.status || "draft";
          chrome.runtime.sendMessage({
            action: "link_published_url",
            data: {
              cardId: cardId,
              url: fullUrl,
              status: currentStatus
            }
          }, (response) => {
            if (response && response.success) {
              window.parent.postMessage({
                action: "cp_show_toast",
                message: "✅ 발행 URL이 연결되었습니다."
              }, "*");
            } else {
              alert("URL 연결에 실패했습니다: " + (response?.error || "알 수 없는 오류"));
            }
          });
        });
      });
    }
    
    // 태그 복사 버튼 클릭 이벤트
    const copyTagsBtn = publishInfoPanel.querySelector('#copy-tags-btn');
    if (copyTagsBtn) {
      copyTagsBtn.addEventListener('click', () => {
        const tagsInput = publishInfoPanel.querySelector('#tags-input');
        if (tagsInput && tagsInput.value) {
          navigator.clipboard.writeText(tagsInput.value).then(() => {
            copyTagsBtn.textContent = '✅ 복사됨';
            setTimeout(() => {
              copyTagsBtn.textContent = '📋 복사';
            }, 2000);
            window.parent.postMessage({
              action: "cp_show_toast",
              message: "📋 태그가 클립보드에 복사되었습니다."
            }, "*");
          }).catch(err => {
            console.error('태그 복사 실패:', err);
            alert("태그 복사에 실패했습니다.");
          });
        }
      });
    }
  });
}

/**
 * 이미지 플레이스홀더 이벤트 리스너 설정
 */
function setupImagePlaceholderListeners(workspaceEl, ideaData) {
  // 에디터 iframe 내부의 플레이스홀더에 접근
  const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
  if (!editorIframe || !editorIframe.contentWindow) return;
  
  // 에디터 내부 문서에 이벤트 위임
  const editorDoc = editorIframe.contentDocument || editorIframe.contentWindow.document;
  if (!editorDoc) return;
  
  // 이미지 프롬프트 추가 버튼 클릭
  editorDoc.addEventListener('click', (e) => {
    const addPromptBtn = e.target.closest('.add-image-prompt-btn');
    if (addPromptBtn) {
      e.preventDefault();
      e.stopPropagation();
      const placeholderId = addPromptBtn.dataset.placeholderId;
      const promptContent = editorDoc.querySelector(`.image-prompt-content[data-placeholder-id="${placeholderId}"]`);
      if (promptContent) {
        promptContent.style.display = 'block';
        const textarea = promptContent.querySelector('.image-prompt-textarea');
        if (textarea) {
          setTimeout(() => textarea.focus(), 100);
        }
      }
    }
    
    // 프롬프트 제거 버튼 클릭
    const removePromptBtn = e.target.closest('.remove-prompt-btn');
    if (removePromptBtn) {
      e.preventDefault();
      e.stopPropagation();
      const placeholderId = removePromptBtn.dataset.placeholderId;
      const promptContent = editorDoc.querySelector(`.image-prompt-content[data-placeholder-id="${placeholderId}"]`);
      if (promptContent) {
        promptContent.style.display = 'none';
        const textarea = promptContent.querySelector('.image-prompt-textarea');
        if (textarea) {
          textarea.value = '';
        }
      }
    }
    
    // 이미지 생성 버튼 클릭
    const generateImageBtn = e.target.closest('.generate-image-btn');
    if (generateImageBtn) {
      e.preventDefault();
      e.stopPropagation();
      const placeholderId = generateImageBtn.dataset.placeholderId;
      const textarea = editorDoc.querySelector(`.image-prompt-textarea[data-placeholder-id="${placeholderId}"]`);
      const placeholderEl = editorDoc.querySelector(`.img-placeholder[data-placeholder-id="${placeholderId}"]`);
      const placeholderType = placeholderEl?.dataset.placeholderType || 'body';
      
      if (textarea && textarea.value.trim()) {
        const prompt = textarea.value.trim();
        // 이미지 생성 프롬프트를 플레이스홀더에 저장
        if (placeholderEl) {
          placeholderEl.dataset.imagePrompt = prompt;
          placeholderEl.style.borderColor = '#34a853';
          placeholderEl.style.background = '#e8f5e9';
          
          // 프롬프트 내용 숨기기
          const promptContent = editorDoc.querySelector(`.image-prompt-content[data-placeholder-id="${placeholderId}"]`);
          if (promptContent) {
            promptContent.style.display = 'none';
          }
          
          // 플레이스홀더에 프롬프트 표시
          const promptDisplay = placeholderEl.querySelector('.prompt-display') || editorDoc.createElement('div');
          if (!promptDisplay.classList.contains('prompt-display')) {
            promptDisplay.className = 'prompt-display';
            promptDisplay.style.cssText = 'margin-top: 8px; padding: 8px; background: #fff; border: 1px solid #e9ecef; border-radius: 4px; font-size: 11px; color: #666;';
            placeholderEl.appendChild(promptDisplay);
          }
          promptDisplay.innerHTML = `<strong>프롬프트:</strong> ${prompt}`;
          
          window.parent.postMessage({
            action: "cp_show_toast",
            message: "✅ 이미지 생성 프롬프트가 추가되었습니다."
          }, "*");
        }
      } else {
        alert("이미지 생성 프롬프트를 입력해주세요.");
      }
    }
  });
}

  // 탭 전환 애니메이션을 위한 스타일 추가
  const tabStyle = document.createElement("style");
  tabStyle.textContent = `
    .resource-content-area {
      transition: opacity 0.2s ease-in-out, transform 0.2s ease-in-out;
    }
    .resource-content-area[style*="display: none"] {
      opacity: 0;
      transform: translateX(10px);
    }
    .resource-content-area[style*="display: block"] {
      opacity: 1;
      transform: translateX(0);
    }
  `;
  document.head.appendChild(tabStyle);
  
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      tabBtns.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const tab = btn.dataset.tab;
      
      // 모든 영역 숨기기 (애니메이션)
      const publishInfoArea = workspaceEl.querySelector("#publish-info-area");
      [aiBriefingArea, outlineArea, recommendedKeywordsArea, allScrapsArea, imageGalleryArea, publishInfoArea].forEach(area => {
        if (area) {
          area.style.opacity = "0";
          area.style.transform = "translateX(10px)";
          setTimeout(() => {
            area.style.display = "none";
          }, 200);
        }
      });
      
      // 선택된 탭에 따라 해당 영역 표시 (애니메이션)
      setTimeout(() => {
        let targetArea = null;
        if (tab === "ai-briefing") {
          targetArea = aiBriefingArea;
        } else if (tab === "outline") {
          targetArea = outlineArea;
        } else if (tab === "recommended-keywords") {
          targetArea = recommendedKeywordsArea;
        } else if (tab === "all-scraps") {
          targetArea = allScrapsArea;
        } else if (tab === "image-gallery") {
          targetArea = imageGalleryArea;
          // 파이어베이스 전체 스크랩에서 이미지 로드
          chrome.runtime.sendMessage({ action: "get_all_scraps" }, (response) => {
            if (response && response.success) {
              updateImageGalleryFromAllScraps(resourceLibrary, response.scraps, sendCommand, ideaData);
            }
          });
        } else if (tab === "publish-info") {
          targetArea = publishInfoArea;
        }
        
        if (targetArea) {
          targetArea.style.display = "block";
          setTimeout(() => {
            targetArea.style.opacity = "1";
            targetArea.style.transform = "translateX(0)";
          }, 10);
        }
      }, 200);
    });
  });
  
  // 키보드 단축키 지원
  workspaceEl.addEventListener("keydown", (e) => {
    // Ctrl/Cmd + 숫자로 탭 전환
    if ((e.ctrlKey || e.metaKey) && e.key >= "1" && e.key <= "5") {
      e.preventDefault();
      const tabIndex = parseInt(e.key) - 1;
      const tabs = ["ai-briefing", "outline", "recommended-keywords", "all-scraps", "image-gallery"];
      if (tabs[tabIndex]) {
        const targetBtn = Array.from(tabBtns).find(btn => btn.dataset.tab === tabs[tabIndex]);
        if (targetBtn) targetBtn.click();
      }
    }
    
    // Ctrl/Cmd + S로 초안 저장
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      saveCurrentDraft();
      window.parent.postMessage({
        action: "cp_show_toast",
        message: "💾 초안이 저장되었습니다."
      }, "*");
    }
  });

  const linkedScrapsList = workspaceEl.querySelector(".linked-scraps-list");
  // 주요 키워드, 롱테일 키워드 각각의 DOM을 분리해서 이벤트 적용
  const keywordSection = workspaceEl.querySelector(".editor-keyword-section");
  const mainKeywordList = keywordSection?.children[0]; // 주요 키워드
  const longTailKeywordList = keywordSection?.children[1]; // 롱테일 키워드
  const generateDraftBtn = workspaceEl.querySelector("#generate-draft-btn");
  const outlineList = workspaceEl.querySelector(".outline-list");
  const deleteDraftBtn = workspaceEl.querySelector(
    "#delete-draft-in-workspace"
  );

  let editorReady = false;
  let currentEditorContent = "";

  // iframe으로 명령 전송
  function sendCommand(action, data = {}) {
    if (editorReady && editorIframe.contentWindow) {
      editorIframe.contentWindow.postMessage({ action, data }, "*");
      // 이미지 삽입 시 바로 저장 트리거
      if (action === "insert-image") {
        setTimeout(() => {
          editorIframe.contentWindow.postMessage(
            { action: "get-content" },
            "*"
          );
        }, 100); // 이미지 렌더링 후 약간의 지연
      }
    }
  }

  // iframe으로부터 메시지 수신
  window.addEventListener("message", (event) => {
    if (event.source !== editorIframe.contentWindow) return;

    const { action, data } = event.data;

    switch (action) {
      case "editor-ready":
        editorReady = true;
        console.log("Editor is ready");

        // 초기 콘텐츠 설정 (Markdown → HTML 변환 지원)
        if (ideaData.draftContent) {
          const isLikelyMarkdown =
            /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|^>\s/m.test(
              ideaData.draftContent
            );
          const html = isLikelyMarkdown
            ? marked.parse(ideaData.draftContent)
            : ideaData.draftContent;
          sendCommand("set-content", { html });
        }
        break;

      case "content-changed":
        currentEditorContent = data.html;
        // 자동 저장 (디바운스 적용)
        clearTimeout(window._autoSaveTimeout);
        window._autoSaveTimeout = setTimeout(() => {
          saveCurrentDraft();
        }, 1000);
        break;

      case "selection-changed":
        // 선택 영역 변경 시 툴바 상태 업데이트 가능
        break;

      case "editor-error":
        console.error("Editor error:", data.error);
        break;
      case "cp_open_tui_editor": {
        // 수신 필드 호환: imageUrl 우선, 과거 imgSrc도 지원
        const tuiImageUrl =
          event.data?.currentImageUrl ||
          event.data?.imageUrl ||
          event.data?.imgSrc ||
          data?.currentImageUrl ||
          data?.imageUrl ||
          data?.imgSrc;
        // allDocumentImages가 있으면 iframe에 전달
        if (
          event.data?.allDocumentImages &&
          Array.isArray(event.data.allDocumentImages)
        ) {
          // 모달 생성 및 iframe 준비
          renderTUIEditorModal(tuiImageUrl, sendCommand, (iframe) => {
            iframe.contentWindow.postMessage(
              {
                action: "set-document-images",
                images: event.data.allDocumentImages,
              },
              "*"
            );
          });
        } else {
          renderTUIEditorModal(tuiImageUrl, sendCommand);
        }
        break;
      }
    }
  });

  // 현재 초안 저장
  function saveCurrentDraft() {
    if (currentEditorContent !== (ideaData.draftContent || "")) {
      console.log("Saving draft...");
      
      // 현재 제목, 태그, 롱테일 키워드, 목차, 추천 검색어 수집
      const currentTitle = titleInput ? titleInput.value.trim() : ideaData.title;
      const currentTags = ideaData.tags || [];
      const currentLongTailKeywords = ideaData.longTailKeywords || [];
      const currentOutline = ideaData.outline || [];
      const currentRecommendedSearches = ideaData.recommendedSearches || [];
      
      const saveData = {
        ideaId: ideaData.id,
        status: ideaData.status,
        draft: currentEditorContent,
        title: currentTitle,
        tags: currentTags,
        longTailKeywords: currentLongTailKeywords,
        outline: currentOutline,
        recommendedSearches: currentRecommendedSearches,
      };
      chrome.runtime.sendMessage(
        { action: "save_draft_content", data: saveData },
        (saveResponse) => {
          if (saveResponse && saveResponse.success) {
            ideaData.draftContent = currentEditorContent;
            ideaData.title = currentTitle;
            console.log("Draft saved successfully.");

            // ✨ K-6: 상태 자동 이동 후 클라이언트 메모리 업데이트 및 알림
            if (saveResponse.moved) {
              ideaData.status = saveResponse.newStatus; // 'ideas' -> 'in-progress'
              console.log(
                `Card moved to ${ideaData.status}, client status updated.`
              );
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: `✅ 초안 저장 및 '${ideaData.status}'로 자동 이동되었습니다.`,
                },
                "*"
              );
            }
          } else {
            console.error("Failed to save draft:", saveResponse.error);
            window.parent.postMessage(
              { action: "cp_show_toast", message: "❌ 초안 저장 실패" },
              "*"
            );
          }
        }
      );
    }
  }

  generateDraftBtn.addEventListener("click", () => {
    const originalText = generateDraftBtn.textContent;
    generateDraftBtn.textContent = "AI가 초안을 작성하는 중...";
    generateDraftBtn.disabled = true;
    
    // 로딩 애니메이션 추가
    generateDraftBtn.style.position = "relative";
    generateDraftBtn.style.overflow = "hidden";
    const loadingOverlay = document.createElement("div");
    loadingOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,0.3), transparent);
      animation: shimmer 1.5s infinite;
    `;
    generateDraftBtn.appendChild(loadingOverlay);
    
    const style = document.createElement("style");
    style.textContent = `
      @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
      }
    `;
    document.head.appendChild(style);

    // 1. '연결된 자료' 목록에서 스크랩 텍스트와 URL을 모두 수집합니다.
    // 실제 스크랩 데이터에서 URL을 가져오기 위해 Firebase에서 다시 조회
    chrome.runtime.sendMessage({ action: "get_all_scraps" }, (scrapsResponse) => {
      if (!scrapsResponse || !scrapsResponse.success) {
        alert("스크랩 데이터를 불러올 수 없습니다.");
        generateDraftBtn.textContent = originalText;
        generateDraftBtn.disabled = false;
        if (loadingOverlay.parentElement) loadingOverlay.remove();
        return;
      }
      
      const allScraps = scrapsResponse.scraps || [];
      const linkedScrapsContent = Array.from(
        linkedScrapsList.querySelectorAll(".scrap-card-item")
      ).map((cardItem) => {
        const scrapId = cardItem.dataset.scrapId;
        const scrap = allScraps.find(s => s.id === scrapId);
        return {
          text: cardItem.dataset.text || scrap?.text || "",
          url: scrap?.url || "",
          title: scrap?.text?.substring(0, 50) || "참고 자료"
        };
      });
      
      // 2. AI에게 보낼 모든 데이터를 하나의 객체로 통합합니다.
      const payload = {
        ...ideaData, // title, description, tags, outline, keywords 등 모든 아이디어 데이터
        currentDraft: currentEditorContent, // 현재 에디터에 작성된 내용
        linkedScrapsContent: linkedScrapsContent, // 연결된 자료의 텍스트와 URL 목록
      };

      // 3. 통합된 데이터를 background.js로 전송합니다.
      chrome.runtime.sendMessage(
        { action: "generate_draft_from_idea", data: payload },
        (response) => {
          generateDraftBtn.textContent = originalText;
          generateDraftBtn.disabled = false;
          if (loadingOverlay.parentElement) loadingOverlay.remove();
          
          if (response && response.success) {
            // iframe 에디터에 생성된 초안 설정 (Markdown → HTML 변환 지원)
            const isLikelyMarkdown =
              /(^|\n)\s{0,3}(#{1,6}\s)|\*\s|\-\s|\d+\.\s|`{1,3}|\*{1,2}[^*]+\*{1,2}|_{1,2}[^_]+_{1,2}|^>\s/m.test(
                response.draft || ""
              );
            let html = isLikelyMarkdown
              ? marked.parse(response.draft)
              : response.draft;
            
            // 제목이 포함되어 있지 않으면 h1으로 추가 (이중 체크)
            const title = ideaData.title || "";
            if (title) {
              const hasH1 = /<h1[^>]*>|<h1>/i.test(html);
              if (!hasH1) {
                html = `<h1>${title}</h1>\n<hr style="border: none; border-top: 2px solid #e0e0e0; margin: 24px 0 32px 0;">\n${html}`;
              } else {
                // h1이 있지만 구분선이 없으면 추가
                html = html.replace(/<\/h1>([^<]*?)(?=<[^/]|$)/gi, (match, afterH1) => {
                  const hasHr = /<hr|<hr\s|---/.test(afterH1);
                  if (!hasHr) {
                    return `</h1>\n<hr style="border: none; border-top: 2px solid #e0e0e0; margin: 24px 0 32px 0;">${afterH1}`;
                  }
                  return match;
                });
              }
            }
            
            // 가독성 포맷팅 후처리
            // "(참고 자료 X)" 같은 번호 표기 제거 (마크다운 파싱 후)
            const textNodes = [];
            let tagIndex = 0;
            const tagPlaceholder = '__TAG_PLACEHOLDER__';
            
            // HTML 태그를 임시로 치환하여 텍스트만 처리
            html = html.replace(/<[^>]+>/g, (match) => {
              textNodes[tagIndex] = match;
              return `${tagPlaceholder}${tagIndex++}${tagPlaceholder}`;
            });
            
            // 텍스트에서 참고 자료 번호 표기 제거
            html = html.replace(/\(참고\s*자료\s*\d+\)/gi, '');
            html = html.replace(/\[참고\s*자료\s*\d+\]/gi, '');
            html = html.replace(/참고\s*자료\s*\d+\s*에\s*따르면/gi, '');
            html = html.replace(/참고\s*자료\s*\d+\s*에서/gi, '');
            html = html.replace(/참고\s*자료\s*\d+\s*에\s*의하면/gi, '');
            html = html.replace(/참고\s*자료\s*\d+/gi, '');
            // 문장 중간에 있는 경우 처리
            html = html.replace(/\s*\(참고\s*자료\s*\d+\)\s*/gi, ' ');
            html = html.replace(/\s*\[참고\s*자료\s*\d+\]\s*/gi, ' ');
            // 빈 괄호 제거
            html = html.replace(/\(\s*\)/g, '');
            // 연속된 공백 정리 (줄바꿈은 유지)
            html = html.replace(/[ \t]{2,}/g, ' ');
            
            // 태그 복원
            html = html.replace(new RegExp(`${tagPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)${tagPlaceholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'g'), (match, index) => {
              return textNodes[parseInt(index)] || match;
            });
            
            // 링크 밑줄 제거 (이미 background.js에서 처리되었지만, 추가 보장)
            html = html.replace(/<a\s+([^>]*?)>/gi, (match, attrs) => {
              if (!attrs.includes('style=')) {
                return `<a ${attrs} style="text-decoration: none; color: #1a73e8;">`;
              } else if (!attrs.includes('text-decoration')) {
                return `<a ${attrs.replace(/style="([^"]*)"/, 'style="$1; text-decoration: none; color: #1a73e8;"')}>`;
              }
              return match;
            });
            
            // mark 태그 스타일 보장
            html = html.replace(/<mark([^>]*?)>/gi, (match, attrs) => {
              if (!attrs.includes('style=')) {
                return `<mark style="background-color: rgb(255, 255, 204); padding: 2px 4px; border-radius: 3px;">`;
              } else if (!attrs.includes('background-color')) {
                return `<mark ${attrs.replace(/style="([^"]*)"/, 'style="$1; background-color: rgb(255, 255, 204); padding: 2px 4px; border-radius: 3px;"')}>`;
              }
              return match;
            });
            
            // 이미지 플레이스홀더 처리 (<img-placeholder type="main" /> 또는 <img-placeholder type="body" />)
            html = html.replace(/<img-placeholder\s+type="(main|body)"\s*\/?>/gi, (match, type) => {
              const placeholderId = `img-placeholder-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
              const placeholderType = type === 'main' ? 'main' : 'body';
              const placeholderLabel = type === 'main' ? '메인 이미지' : '본문 이미지';
              return `<div class="img-placeholder" data-placeholder-id="${placeholderId}" data-placeholder-type="${placeholderType}" 
                style="border: 2px dashed #4285f4; border-radius: 8px; padding: 24px; margin: 16px 0; background: #f8f9fa; text-align: center; cursor: pointer; position: relative;">
                <div style="font-size: 14px; color: #4285f4; font-weight: 600; margin-bottom: 8px;">🖼️ ${placeholderLabel} 삽입 위치</div>
                <div style="font-size: 12px; color: #666; margin-bottom: 12px;">클릭하여 이미지 생성 프롬프트 추가</div>
                <button class="add-image-prompt-btn" data-placeholder-id="${placeholderId}" data-placeholder-type="${placeholderType}" 
                  style="padding: 6px 12px; border: 1px solid #4285f4; background: #4285f4; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px;">
                  이미지 생성 프롬프트 추가
                </button>
                <div class="image-prompt-content" data-placeholder-id="${placeholderId}" style="display: none; margin-top: 12px; padding: 12px; background: #fff; border: 1px solid #e9ecef; border-radius: 4px;">
                  <textarea class="image-prompt-textarea" data-placeholder-id="${placeholderId}" 
                    placeholder="이미지 생성 프롬프트를 입력하세요..." 
                    style="width: 100%; min-height: 60px; padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px; resize: vertical;"></textarea>
                  <div style="display: flex; gap: 8px; margin-top: 8px;">
                    <button class="generate-image-btn" data-placeholder-id="${placeholderId}" 
                      style="flex: 1; padding: 6px 12px; border: 1px solid #34a853; background: #34a853; color: #fff; border-radius: 4px; cursor: pointer; font-size: 12px;">
                      이미지 생성
                    </button>
                    <button class="remove-prompt-btn" data-placeholder-id="${placeholderId}" 
                      style="padding: 6px 12px; border: 1px solid #dadce0; background: #fff; border-radius: 4px; cursor: pointer; font-size: 12px;">
                      취소
                    </button>
                  </div>
                </div>
              </div>`;
            });
            
            currentEditorContent = html;
            sendCommand("set-content", { html });
            sendCommand("focus");
            
            // 이미지 플레이스홀더 이벤트 리스너 추가
            setTimeout(() => {
              setupImagePlaceholderListeners(workspaceEl, ideaData);
            }, 500);
            
            // 퍼머링크와 태그가 있으면 UI에 표시 (오른쪽 탭)
            if (response.permalink || response.tags || response.seoTitle) {
              showPublishInfo(workspaceEl, response.permalink, response.tags, response.seoTitle, ideaData);
            }
            
            // 자동 저장
            setTimeout(() => {
              saveCurrentDraft();
            }, 500);
          } else {
            alert("초안 생성에 실패했습니다: " + (response?.error || "알 수 없는 오류"));
          }
        }
      );
    });
  });

  // 추천 목차 클릭 시 에디터 내 해당 위치로 스크롤 이동
  if (outlineList) {
    outlineList.addEventListener("click", (e) => {
      if (e.target.tagName === "LI") {
        const outlineText = e.target.textContent.trim();
        // iframe 에디터에 스크롤 명령 전송
        sendCommand("scroll-to-text", { text: outlineText });
      }
    });
  }

  // 주요 키워드 클릭 시 에디터에 삽입 (커서 위치에 삽입)
  if (mainKeywordList) {
    mainKeywordList.addEventListener("click", (e) => {
      if (e.target.classList.contains("interactive-tag")) {
        const keyword = e.target.textContent.trim();
        // 현재 커서 위치에 제목 형식으로 삽입
        sendCommand("insert-text", { text: `\n\n## ${keyword}\n\n` });
        sendCommand("focus");
      }
    });
  }

  // 롱테일 키워드 클릭 시 에디터에 삽입 (커서 위치에 문맥에 맞게 삽입)
  if (longTailKeywordList) {
    longTailKeywordList.addEventListener("click", (e) => {
      if (e.target.classList.contains("interactive-tag")) {
        const keyword = e.target.textContent.trim();
        // 롱테일 키워드는 문맥에 맞게 삽입 (앞뒤 공백 포함)
        sendCommand("insert-text", { text: ` ${keyword} ` });
        sendCommand("focus");
      }
    });
  }

  // 썸네일 생성 및 AI 이미지 생성 기능 제거됨

  // 드래그앤드랍 삭제: 스크랩을 리스트 바깥에 드롭하면 연결 해제
  linkedScrapsList.addEventListener("dragstart", (e) => {
    const card = e.target.closest(".scrap-card-item");
    if (card) {
      e.dataTransfer.setData("text/plain", card.dataset.scrapId);
      card.classList.add("dragging");
    }
  });

  linkedScrapsList.addEventListener("dragend", (e) => {
    const card = e.target.closest(".scrap-card-item");
    if (card) card.classList.remove("dragging");
  });

  // document 전체에 drop/dragover 이벤트 등록 (환경 호환성 개선)
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    const scrapId = e.dataTransfer.getData("text/plain");
    // 리스트 바깥에서 drop된 경우만 삭제
    if (scrapId && !e.target.closest(".linked-scraps-list")) {
      const cardItem = linkedScrapsList.querySelector(
        `[data-scrap-id="${scrapId}"]`
      );
      if (!cardItem) return;
      const message = {
        action: "unlink_scrap_from_idea",
        data: {
          ideaId: ideaData.id,
          scrapId: scrapId,
          status: ideaData.status,
        },
      };
      chrome.runtime.sendMessage(message, (response) => {
        if (response && response.success) {
          cardItem.remove();
          if (ideaData.linkedScraps) {
            const index = ideaData.linkedScraps.indexOf(scrapId);
            if (index > -1) {
              ideaData.linkedScraps.splice(index, 1);
            }
          }
          if (linkedScrapsList.children.length === 0) {
            linkedScrapsList.innerHTML =
              "<p>스크랩을 이곳으로 끌어다 놓아 아이디어에 연결하세요.</p>";
            linkedScrapsList.classList.add("empty-state");
          }
        } else {
          alert(
            "스크랩 연결 해제에 실패했습니다: " +
              (response.error || "알 수 없는 오류")
          );
        }
      });
    }
  });

  // --- '연결된 자료' 툴팁 기능 (수정된 최종 버전) ---
  let tooltipTimeout;
  let activeTooltip = null;

  // 툴팁을 워크스페이스 최상단에 한 번만 생성
  const tooltip = document.createElement("div");
  tooltip.className = "scrap-tooltip";
  workspaceEl.appendChild(tooltip);

  linkedScrapsList.addEventListener("mouseover", (e) => {
    const cardItem = e.target.closest(".scrap-card-item");
    if (cardItem) {
      // 마우스가 다른 카드로 이동했을 때 이전 타이머 취소
      clearTimeout(tooltipTimeout);

      // 0.2초 지연 후 툴팁 표시
      tooltipTimeout = setTimeout(() => {
        const textContent = cardItem.dataset.text;
        if (textContent) {
          // 툴팁 내용 업데이트
          tooltip.innerHTML = `<p>${textContent}</p>`;

          // 툴팁 위치 계산
          const cardRect = cardItem.getBoundingClientRect();
          tooltip.style.left = `${cardRect.right + 12}px`;
          tooltip.style.top = `${cardRect.top}px`;

          // 툴팁 보이기
          tooltip.classList.add("visible");
          activeTooltip = cardItem; // 현재 툴팁이 활성화된 카드 저장
        }
      }, 200);
    }
  });

  linkedScrapsList.addEventListener("mouseout", (e) => {
    // 마우스가 목록 영역을 벗어나면 타이머 취소 및 툴팁 숨기기
    clearTimeout(tooltipTimeout);

    // 마우스가 실제로 다른 요소로 이동했는지 확인 (카드 내부 요소 이동 시 툴팁이 깜빡이는 현상 방지)
    if (!linkedScrapsList.contains(e.relatedTarget)) {
      tooltip.classList.remove("visible");
      activeTooltip = null;
    }
  });

  resourceLibrary.addEventListener("dragstart", (e) => {
    const cardItem = e.target.closest(".scrap-card-item");
    if (cardItem) {
      const card = cardItem.querySelector(".scrap-card");
      const imageEl = card.querySelector(".scrap-card-img-wrap img");
      const snippetEl = card.querySelector(".scrap-card-snippet");

      // 드래그 시 필요한 모든 스크랩 데이터를 객체로 만듭니다.
      const scrapData = {
        id: cardItem.dataset.scrapId,
        text: cardItem.dataset.text, // 에디터에 삽입될 텍스트
        image: imageEl ? imageEl.src : null,
        url: snippetEl ? snippetEl.textContent : "",
        tags: Array.from(card.querySelectorAll(".card-tags .tag")).map((t) =>
          t.textContent.replace("#", "")
        ),
      };

      // 데이터를 JSON 문자열 형태로 dataTransfer 객체에 저장합니다.
      e.dataTransfer.setData("application/json", JSON.stringify(scrapData));
      e.dataTransfer.effectAllowed = "copyLink";
      cardItem.style.opacity = "0.5";
    }
  });

  resourceLibrary.addEventListener("dragend", (e) => {
    const cardItem = e.target.closest(".scrap-card-item");
    if (cardItem) {
      cardItem.style.opacity = "1";
    }
  });

  workspaceEl.addEventListener("dragover", (e) => {
    const dropTarget = e.target;
    if (linkedScrapsList.contains(dropTarget)) {
      e.preventDefault();
      linkedScrapsList.classList.add("drag-over");
      e.dataTransfer.dropEffect = "link";
    }
  });

  workspaceEl.addEventListener("dragleave", (e) => {
    const target = e.target;
    if (linkedScrapsList.contains(target)) {
      target.classList.remove("drag-over");
    }
  });

  workspaceEl.addEventListener("drop", (e) => {
    e.preventDefault();

    // 이미지 갤러리에서 드래그한 이미지 URL 처리
    const imageUrl = e.dataTransfer.getData("text/plain");
    if (imageUrl && imageUrl.startsWith("http")) {
      // 에디터 영역에 이미지 삽입
      if (e.target.closest("#main-editor-panel") || e.target.closest("#quill-editor-iframe")) {
        sendCommand("insert-image", { url: imageUrl });
        sendCommand("focus");
        return;
      }
    }

    let scrapData;
    try {
      scrapData = JSON.parse(e.dataTransfer.getData("application/json"));
    } catch (error) {
      return;
    }

    if (!scrapData) return;

    // 1. 연결된 자료 영역에 드롭 우선 처리
    if (linkedScrapsList.contains(e.target)) {
      linkedScrapsList.classList.remove("drag-over");

      if (linkedScrapsList.querySelector(`[data-scrap-id="${scrapData.id}"]`)) {
        return;
      }

      const message = {
        action: "link_scrap_to_idea",
        data: {
          ideaId: ideaData.id,
          scrapId: scrapData.id,
          status: ideaData.status,
        },
      };
      chrome.runtime.sendMessage(message, (response) => {
        if (response && response.success) {
          const newLinkedCardHtml = createScrapCard(scrapData, true);
          const placeholder = linkedScrapsList.querySelector("p");
          if (placeholder) {
            placeholder.remove();
            linkedScrapsList.classList.remove("empty-state");
          }
          linkedScrapsList.insertAdjacentHTML("beforeend", newLinkedCardHtml);

          if (!ideaData.linkedScraps) ideaData.linkedScraps = [];
          ideaData.linkedScraps.push(scrapData.id);
        } else {
          alert(
            "스크랩 연결에 실패했습니다: " +
              (response.error || "알 수 없는 오류")
          );
        }
      });
      return;
    }

    // 2. 에디터 영역에 드롭
    if (e.target.closest("#main-editor-panel")) {
      // Quill 에디터에 텍스트 삽입 (스크랩 인용)
      const textToInsert = scrapData.text || "";
      sendCommand("insert-text", {
        text: `\n\n--- (스크랩 인용) ---\n${textToInsert}\n------------------\n\n`,
      });
      sendCommand("focus");
    }
  });

  // 에디터 iframe에 드래그앤드랍 이벤트 추가
  if (editorIframe) {
    editorIframe.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });

    editorIframe.addEventListener("drop", (e) => {
      e.preventDefault();
      const imageUrl = e.dataTransfer.getData("text/plain");
      if (imageUrl && imageUrl.startsWith("http")) {
        sendCommand("insert-image", { url: imageUrl });
        sendCommand("focus");
      }
    });
  }

  if (deleteDraftBtn) {
    deleteDraftBtn.addEventListener("click", () => {
      if (
        confirm(
          "경고: 현재 작성 중인 초안 내용이 완전히 삭제됩니다. 진행하시겠습니까?"
        )
      ) {
        chrome.runtime.sendMessage(
          {
            action: "delete_draft_content",
            data: { cardId: ideaData.id },
          },
          (response) => {
            if (response?.success) {
              ideaData.draftContent = null;
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: "✅ 초안이 삭제되었습니다. 기획 보드로 돌아갑니다.",
                },
                "*"
              );
              window.parent.postMessage(
                { action: "close-workspace-and-refresh" },
                "*"
              );
            } else {
              window.parent.postMessage(
                {
                  action: "cp_show_toast",
                  message: "❌ 초안 삭제 중 오류가 발생했습니다.",
                },
                "*"
              );
            }
          }
        );
      }
    });
  }


}
