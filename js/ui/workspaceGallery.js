// workspaceGallery.js
// This module contains the image gallery rendering and related helpers
// extracted from workspaceMode.js so it can be lazy-loaded on demand.

let galleryImageObserver = null;
let galleryRuntimeMessageHandlerAttached = false;

export function ensureGalleryImageObserver() {
  if (galleryImageObserver) return galleryImageObserver;

  galleryImageObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const img = entry.target;
        const src = img.dataset && img.dataset.src;
        if (!src) {
          galleryImageObserver.unobserve(img);
          return;
        }
        img.src = src;
        img.classList.remove('lazy-loading');
        galleryImageObserver.unobserve(img);
      });
    },
    { root: null, rootMargin: '200px 0px', threshold: 0.01 }
  );

  return galleryImageObserver;
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

// Main exported function: renders gallery into resourceLibrary area using the
// same API that used to exist in workspaceMode.js. The caller can optionally
// pass ensureGalleryGridClickHandler to maintain click delegation without a
// module dependency cycle.
export async function updateImageGalleryFromAllScraps(
  resourceLibrary,
  allScraps,
  sendCommand,
  ideaData = null,
  ensureGalleryGridClickHandler = null
) {
  const imageGalleryArea = resourceLibrary.querySelector('.image-gallery-area');
  if (!imageGalleryArea) return;

  if (!imageGalleryArea.querySelector('.image-gallery-header')) {
    imageGalleryArea.innerHTML = `
    <div class="image-gallery-header" style="flex-shrink: 0; padding: 12px; border-bottom: 1px solid #e9ecef; display: flex; flex-direction: column; gap: 12px;">
      <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
        <input type="text" id="image-search-input" placeholder="이미지 검색..." 
          style="flex: 1; min-width: 150px; padding: 6px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 13px;">
        <button id="filter-by-draft-btn" title="초안 내용에 맞는 이미지만 보기" 
          style="padding: 6px 12px; border: 1px solid #dadce0; background: #fff; border-radius: 6px; cursor: pointer; font-size: 12px; white-space: nowrap; display: flex; align-items: center; gap: 4px;">
          <span>📝</span>
          <span>초안 필터</span>
        </button>
        <span id="image-count" style="font-size: 12px; color: #666; white-space: nowrap;">0개</span>
      </div>
      <div class="gallery-filter-tabs" style="display: flex; gap: 4px; border-bottom: 1px solid #e0e0e0;">
        <button class="gallery-filter-tab active" data-filter="ALL" style="padding: 6px 12px; border: none; background: #4285f4; color: white; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 12px; font-weight: 500;">전체</button>
        <button class="gallery-filter-tab" data-filter="SCRAP" style="padding: 6px 12px; border: none; background: #f1f3f4; color: #5f6368; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 12px; font-weight: 500;">스크랩</button>
        <button class="gallery-filter-tab" data-filter="STORAGE" style="padding: 6px 12px; border: none; background: #f1f3f4; color: #5f6368; border-radius: 4px 4px 0 0; cursor: pointer; font-size: 12px; font-weight: 500;">스토리지</button>
      </div>
    </div>
    <div class="image-gallery-grid" style="flex: 1; min-height: 0; min-width: 0; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; padding: 12px; overflow-y: auto; grid-auto-rows: auto;"></div>
    <div id="image-preview-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.9); z-index: 10000; align-items: center; justify-content: center; padding: 20px;">
      <div style="position: relative; max-width: 90vw; max-height: 90vh; display: flex; flex-direction: column; align-items: center;">
        <button id="close-preview" style="position: absolute; top: 10px; right: 10px; background: rgba(255,255,255,0.9); border: none; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: 500; z-index: 10001; box-shadow: 0 2px 8px rgba(0,0,0,0.2); transition: all 0.2s;">닫기</button>
        <img id="preview-image" src="" style="max-width: 100%; max-height: calc(90vh - 80px); object-fit: contain; border-radius: 8px;">
        <div id="image-metadata" style="margin-top: 12px; background: rgba(0,0,0,0.6); color: #fff; padding: 10px 16px; border-radius: 8px; font-size: 12px; max-width: 100%; text-align: center; -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px);"></div>
      </div>
    </div>
  `;
  }

  const imageGalleryGrid = imageGalleryArea.querySelector('.image-gallery-grid');
  const searchInput = imageGalleryArea.querySelector('#image-search-input');
  const filterByDraftBtn = imageGalleryArea.querySelector('#filter-by-draft-btn');
  const imageCount = imageGalleryArea.querySelector('#image-count');
  const galleryFilterTabs = imageGalleryArea.querySelectorAll('.gallery-filter-tab');
  const previewModal = imageGalleryArea.querySelector('#image-preview-modal');
  const previewImage = imageGalleryArea.querySelector('#preview-image');
  const imageMetadata = imageGalleryArea.querySelector('#image-metadata');
  const closePreview = imageGalleryArea.querySelector('#close-preview');

  let currentFilter = 'ALL';
  let isDraftFilterActive = false;
  let allImageData = [];
  let draftContentText = '';

  imageGalleryGrid.innerHTML = "<p style='text-align:center;color:#888;padding:20px;'>이미지를 불러오는 중...</p>";

  function adjustGridColumns() {
    const containerWidth = imageGalleryGrid.offsetWidth;
    let columns;

    if (containerWidth >= 800) {
      columns = 6;
    } else if (containerWidth >= 600) {
      columns = 4;
    } else if (containerWidth >= 400) {
      columns = 3;
    } else {
      columns = 2;
    }

    imageGalleryGrid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  }

  adjustGridColumns();
  if (!imageGalleryArea.dataset.cpResizeListenerAttached) {
    window.addEventListener('resize', adjustGridColumns);
    imageGalleryArea.dataset.cpResizeListenerAttached = '1';
  }

  function loadUnifiedGallery(filter = 'ALL') {
    chrome.runtime.sendMessage(
      {
        action: 'get_unified_gallery',
        data: { filter },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Gallery] 통합 갤러리 로드 실패:', chrome.runtime.lastError);
          imageGalleryGrid.innerHTML = "<p style='text-align:center;color:#888;padding:20px;'>갤러리를 불러올 수 없습니다.</p>";
          return;
        }

        if (response && response.success && Array.isArray(response.images)) {
          allImageData = response.images;
          renderFilteredImages(allImageData, currentFilter, isDraftFilterActive, draftContentText);
          setTimeout(adjustGridColumns, 100);
        } else {
          console.warn('[Gallery] 통합 갤러리 응답 실패:', response);
          imageGalleryGrid.innerHTML = "<p style='text-align:center;color:#888;padding:20px;'>갤러리를 불러올 수 없습니다.</p>";
        }
      }
    );

    if (!galleryRuntimeMessageHandlerAttached) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.action === 'scrap_image_removed') {
          loadUnifiedGallery(currentFilter);
        }
      });
      galleryRuntimeMessageHandlerAttached = true;
    }
  }

  function renderFilteredImages(images, filter, draftFilterActive, draftText) {
    let filteredImages = images;
    if (filter !== 'ALL') filteredImages = filteredImages.filter((img) => img.source === filter);

    if (draftFilterActive && draftText) {
      const draftWords = draftText.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      filteredImages = filteredImages.filter((img) => {
        const imgText = (img.title || '').toLowerCase();
        return draftWords.some((word) => imgText.includes(word));
      });
    }

    const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
    if (searchTerm) {
      filteredImages = filteredImages.filter(
        (img) =>
          (img.title || '').toLowerCase().includes(searchTerm) ||
          (img.tags || []).some((tag) => tag.toLowerCase().includes(searchTerm))
      );
    }

    renderImages(filteredImages);
  }

  function renderImages(images) {
    if (images.length === 0) {
      imageGalleryGrid.innerHTML = "<p style='text-align:center;color:#888;padding:20px;'>이미지가 없습니다.</p>";
      imageCount.textContent = '0개';
      return;
    }

    imageCount.textContent = `${images.length}개`;
    imageGalleryGrid.innerHTML = '';

    const fragment = document.createDocumentFragment();

    const shownPerScrap = {};
    const totalPerScrap = {};
    images.forEach((it) => {
      const sId = it.scrapId || it.id;
      if (sId) {
        shownPerScrap[sId] = (shownPerScrap[sId] || 0) + 1;
        const origin = it.originData || {};
        const total = Array.isArray(origin.allImages) ? origin.allImages.length : 1;
        totalPerScrap[sId] = Math.max(totalPerScrap[sId] || 0, total);
      }
    });

    const seenPerScrap = {};

    images.forEach((imgData) => {
      const div = document.createElement('div');
      div.className = 'gallery-thumb-wrap';
      div.style.cssText = 'position: relative; cursor: pointer; border-radius: 8px; overflow: hidden; background: #f5f5f5; min-width: 0; min-height: 88px; box-sizing: border-box;';

      const sourceBadge = document.createElement('div');
      sourceBadge.style.cssText = 'position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.6); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; z-index: 5;';
      sourceBadge.textContent = imgData.source === 'SCRAP' ? '스크랩' : '스토리지';
      div.appendChild(sourceBadge);

      const effectiveScrapId = imgData.scrapId || imgData.id;

      const img = document.createElement('img');
      img.className = 'gallery-thumb';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.style.cssText = 'width:100%;height:88px;object-fit:cover;display:block;';
      img.dataset.src = imgData.url || imgData.thumbnail || '';
      img.classList.add('lazy-loading');
      try {
        ensureGalleryImageObserver().observe(img);
      } catch (e) {
        img.src = img.dataset.src;
      }

      img.onerror = () => {
        img.style.display = 'none';
        div.style.background = '#f0f0f0';
        const errorText = document.createElement('div');
        errorText.textContent = '이미지 로드 실패';
        errorText.style.cssText = 'display:flex;align-items:center;justify-content:center;height:100%;color:#999;font-size:12px;';
        div.appendChild(errorText);

        try {
          chrome.runtime.sendMessage({ action: 'fetch_image_as_base64', url: img.dataset?.src || img.src || imgData.url }, (response) => {
            if (response && response.success && response.dataUrl) {
              img.onerror = null;
              img.src = response.dataUrl;
              img.style.display = 'block';
              if (errorText.parentNode) errorText.parentNode.removeChild(errorText);
            }
          });
        } catch (e) {
          // ignore
        }
      };

      if (imgData.source === 'SCRAP' && effectiveScrapId) {
        const delBtn = document.createElement('button');
        delBtn.className = 'workspace-image-delete-btn';
        delBtn.title = '이미지 삭제';
        delBtn.style.cssText = 'position:absolute; top:4px; right:4px; width:20px; height:20px; border:none; border-radius:50%; background: rgba(255,255,255,0.9); color:#666; cursor:pointer; font-size:14px; display:flex;align-items:center;justify-content:center;z-index:10;';
        delBtn.innerHTML = '×';
        delBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          if (!confirm('이 이미지를 삭제하시겠습니까?')) return;
          const displayedUrl = img.dataset?.src || img.src;

          const removedItem = allScraps.find((it) => it.url === displayedUrl || it.thumbnail === displayedUrl);

          const getAllFromOrigin = (origin) => {
            if (!origin) return [];
            const out = [];
            if (origin.image) out.push(origin.image);
            if (Array.isArray(origin.allImages)) out.push(...origin.allImages);
            if (Array.isArray(origin.images)) out.push(...origin.images);
            return [...new Set(out.filter(Boolean))];
          };

          const normalizeForMatch = (u) => {
            if (!u) return '';
            try {
              if (u.startsWith('data:')) return u;
              const clean = u.replace(/&amp;/g, '&');
              const parsed = new URL(clean);
              let p = parsed.pathname || '';
              try {
                p = decodeURIComponent(p);
              } catch (e) {
                void 0;
              }
              return (parsed.hostname + p).replace(/\/$/, '').toLowerCase();
            } catch (e) {
              return u.replace(/&amp;/g, '&').replace(/\/$/, '').toLowerCase();
            }
          };

          let canonicalDeleteUrl = displayedUrl;
          if (removedItem && removedItem.originData) {
            const originList = getAllFromOrigin(removedItem.originData);
            const matched = originList.find((o) => normalizeForMatch(o) === normalizeForMatch(displayedUrl));
            if (matched) canonicalDeleteUrl = matched;
          }

          chrome.runtime.sendMessage({ action: 'remove_scrap_image', data: { imageUrl: canonicalDeleteUrl, scrapId: effectiveScrapId } }, (response) => {
            if (response && response.success && response.changed) {
              try {
                const matchIndex = allImageData.findIndex((it) => it.url === canonicalDeleteUrl || it.thumbnail === canonicalDeleteUrl);
                if (matchIndex !== -1) {
                  const removedItem = allImageData[matchIndex];
                  const scrapKey = removedItem.scrapId || removedItem.id;
                  const origin = removedItem.originData || {};
                  let originImages = getAllFromOrigin(origin);

                  const displayed = allImageData.filter((it) => (it.scrapId || it.id) === scrapKey).map((it) => it.url || it.thumbnail).map((d) => normalizeForMatch(d));
                  const normalizedDelete = normalizeForMatch(canonicalDeleteUrl);
                  originImages = originImages.filter((o) => normalizeForMatch(o) !== normalizedDelete);

                  let candidate = null;
                  for (const o of originImages) {
                    const normO = normalizeForMatch(o);
                    if (!displayed.includes(normO) && normO !== normalizedDelete) {
                      candidate = o;
                      break;
                    }
                  }

                  if (candidate) {
                    const newEntry = {
                      id: `${scrapKey}::${Date.now()}`,
                      scrapId: scrapKey,
                      source: removedItem.source || 'SCRAP',
                      url: candidate,
                      thumbnail: candidate,
                      originData: origin,
                      timestamp: removedItem.timestamp || Date.now(),
                    };
                    allImageData.splice(matchIndex, 1, newEntry);
                  } else {
                    allImageData.splice(matchIndex, 1);
                  }
                }
                renderFilteredImages(allImageData, currentFilter, isDraftFilterActive, draftContentText);
                showToast('✅ 이미지가 삭제되었습니다.');
              } catch (e) {
                if (div.parentNode) div.parentNode.removeChild(div);
                showToast('✅ 이미지가 삭제되었습니다.');
              }
            } else if (response && response.success && !response.changed) {
              showToast('⚠️ 삭제 대상이 데이터베이스에서 발견되지 않았습니다.', 'warning');
            } else {
              showToast('❌ 이미지 삭제에 실패했습니다.', 'error');
            }
          });
        });

        div.appendChild(delBtn);
      }

      div.appendChild(img);

      const scrapKey = imgData.scrapId || imgData.id;
      if (scrapKey) seenPerScrap[scrapKey] = (seenPerScrap[scrapKey] || 0) + 1;

      const isLastShown = scrapKey && seenPerScrap[scrapKey] === shownPerScrap[scrapKey];
      const totalCount = scrapKey ? totalPerScrap[scrapKey] || 0 : 0;
      const shownCount = scrapKey ? shownPerScrap[scrapKey] || 0 : 0;
      const extra = totalCount - shownCount;
      if (isLastShown && extra > 0) {
        const overlay = document.createElement('div');
        overlay.className = 'gallery-more-overlay';
        overlay.textContent = `+${extra}`;
        overlay.title = `${extra}개 추가 이미지`;
        overlay.style.cssText = 'position:absolute; right:6px; bottom:6px; background: rgba(0,0,0,0.6); color: #fff; padding: 4px 6px; border-radius: 12px; font-size: 11px; z-index: 12;';
        div.appendChild(overlay);
      }

      fragment.appendChild(div);
    });
    imageGalleryGrid.appendChild(fragment);

    try {
      setTimeout(() => {
        const lazyImgs = imageGalleryGrid.querySelectorAll('img.lazy-loading');
        if (!lazyImgs || lazyImgs.length === 0) return;
        const gridRect = imageGalleryGrid.getBoundingClientRect();
        lazyImgs.forEach((img) => {
          try {
            const r = img.getBoundingClientRect();
            if (r.top < gridRect.bottom + 200 && r.bottom > gridRect.top - 200) {
              const src = img.dataset && img.dataset.src;
              if (src) {
                img.src = src;
                img.classList.remove('lazy-loading');
                try {
                  if (galleryImageObserver) galleryImageObserver.unobserve(img);
                } catch (_) {
                  void 0;
                }
              }
            }
          } catch (_) {
            void 0;
          }
        });
      }, 30);
    } catch (e) {
      /* ignore */
    }

    // ensure delegated click handler — prefer caller-provided implementation to avoid cycles
    if (typeof ensureGalleryGridClickHandler === 'function') {
      ensureGalleryGridClickHandler(imageGalleryGrid, sendCommand);
    }
  }

  galleryFilterTabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      galleryFilterTabs.forEach((t) => {
        t.classList.remove('active');
        t.style.background = '#f1f3f4';
        t.style.color = '#5f6368';
      });
      tab.classList.add('active');
      tab.style.background = '#4285f4';
      tab.style.color = 'white';

      currentFilter = tab.dataset.filter;
      loadUnifiedGallery(currentFilter);
    });
  });

  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderFilteredImages(allImageData, currentFilter, isDraftFilterActive, draftContentText);
    });
  }

  if (filterByDraftBtn) {
    filterByDraftBtn.addEventListener('click', async () => {
      if (!isDraftFilterActive) {
        draftContentText = await getDraftContent();
        if (!draftContentText || draftContentText.length < 10) {
          alert('초안 내용이 부족합니다.');
          return;
        }

        filterByDraftBtn.style.background = '#e8f0fe';
        filterByDraftBtn.style.borderColor = '#1a73e8';
        const spanText = filterByDraftBtn.querySelector('span:last-child');
        if (spanText) spanText.textContent = '초안 필터 ON';
        isDraftFilterActive = true;
      } else {
        filterByDraftBtn.style.background = '#fff';
        filterByDraftBtn.style.borderColor = '#dadce0';
        const spanText = filterByDraftBtn.querySelector('span:last-child');
        if (spanText) spanText.textContent = '초안 필터';
        isDraftFilterActive = false;
        draftContentText = '';
      }
      renderFilteredImages(allImageData, currentFilter, isDraftFilterActive, draftContentText);
    });
  }

  if (closePreview) {
    closePreview.addEventListener('click', () => {
      previewModal.style.display = 'none';
    });
  }

  if (previewModal) {
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) previewModal.style.display = 'none';
    });
  }

  async function getDraftContent() {
    return new Promise((resolve) => {
      const editorIframe = document.querySelector('#quill-editor-iframe');
      if (!editorIframe || !editorIframe.contentWindow) {
        resolve('');
        return;
      }

      const messageId = `get-draft-${Date.now()}`;
      const handler = (event) => {
        if (event.data.action === 'content-response' && event.data.requestId === messageId) {
          window.removeEventListener('message', handler);
          resolve((event.data.data?.html || '').replace(/<[^>]*>/g, '').trim());
        }
      };
      window.addEventListener('message', handler);
      editorIframe.contentWindow.postMessage({ action: 'get-content', requestId: messageId }, '*');
      setTimeout(() => {
        window.removeEventListener('message', handler);
        resolve('');
      }, 2000);
    });
  }

  loadUnifiedGallery(currentFilter);
}
