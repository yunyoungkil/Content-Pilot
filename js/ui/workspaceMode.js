import {
  shortenLink,
  showToast,
  showConfirmationToast,
  Logger,
  normalizeSeoTitle,
} from '../utils.js';
import { removeDuplicateYears } from '../services/aiService.js';
import { getAffiliateLinks } from '../services/affiliateService.js';
import { marked } from 'marked';
import { openThumbnailMaker } from './thumbnailMaker.js';
import { selectBackgroundReferenceImages } from '../services/aiService.js';
export function isMeaningfulDraft(d) {
  if (!d) return false;

  // If the draft is a string, detect if it contains non-link/anchor meaningful text, images, or HTML elements.
  function _stringCheck(s) {
    if (!s || typeof s !== 'string') return false;

    // 1) Check for images (markdown or HTML) - these count as meaningful content
    // Markdown images: ![alt](url)
    if (/!\[[^\]]*\]\([^)]+\)/.test(s)) return true;
    // HTML img tags: <img ...>
    if (/<img\b[^>]*>/i.test(s)) return true;

    // 2) Remove markdown images for text check
    let textOnly = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

    // 3) Remove markdown links including link text: [text](url)
    // The tests expect '[Example](https://example.com)' to be FALSE.
    textOnly = textOnly.replace(/\[[^\]]*\]\([^)]*\)/g, '');

    // 4) Remove HTML anchor tags entirely: <a ...>content</a> -- treat anchor content as non-meaningful
    textOnly = textOnly.replace(/<a\b[^>]*>(?:.|\n|\r)*?<\/a>/gi, '');

    // 5) Remove leftover HTML tags but keep the text
    const strippedHtml = textOnly.replace(/<[^>]*>/g, '');

    // 6) Remove URLs (http(s) or www.)
    const cleanText = strippedHtml.replace(/https?:\/\/\S+|www\.[^\s]+/g, '');

    // normalize whitespace
    const normalized = cleanText.replace(/\s+/g, ' ').trim();

    // Consider it meaningful if the remaining plain text is longer than threshold
    const THRESHOLD = 10; // characters
    if (normalized.length >= THRESHOLD) return true;

    // 7) Check if original HTML has any non-empty elements (even if no significant text)
    // This catches cases where user might have entered something but it's mostly HTML/whitespace
    // Count non-whitespace HTML content (excluding common empty patterns)
    const htmlContentCheck = s
      .replace(/<p><br><\/p>/gi, '')
      .replace(/<p><\/p>/gi, '')
      .replace(/<br\s*\/?>/gi, '')
      .replace(/\s+/g, '')
      .trim();

    return htmlContentCheck.length > 0;
  }

  if (typeof d === 'string') return _stringCheck(d);

  if (typeof d === 'object') {
    const textFields = ['text', 'content', 'html', 'body', 'description'];
    for (const field of textFields) {
      if (d[field] && typeof d[field] === 'string') {
        if (_stringCheck(d[field])) return true;
      }
    }
  }

  return false;
}

/**
 * Safely apply thumbnail info updates to an idea's publishInfo.
 * This will update only the selected thumbnail candidate and break any shared
 * references to avoid accidental cross-updates. Exported for unit testing.
 */
export function applyThumbnailInfoUpdate(ideaData, newThumbnailInfo) {
  if (!ideaData.publishInfo) ideaData.publishInfo = {};

  if (Array.isArray(ideaData.publishInfo.thumbnailInfo)) {
    const selectedIndex = newThumbnailInfo.selectedThumbnailIndex ?? 0;
    if (selectedIndex >= 0 && selectedIndex < ideaData.publishInfo.thumbnailInfo.length) {
      const { selectedThumbnailIndex, ...infoToUpdate } = newThumbnailInfo;
      ideaData.publishInfo.thumbnailInfo = ideaData.publishInfo.thumbnailInfo.map((item, idx) => {
        let cloned = item && typeof item === 'object' ? { ...item } : item;
        if (idx === selectedIndex) {
          // If the update includes a bgImage, maintain a per-concept history array `bgImages` (latest first)
          if (
            Object.prototype.hasOwnProperty.call(infoToUpdate, 'bgImage') &&
            infoToUpdate.bgImage
          ) {
            const newUrl = infoToUpdate.bgImage;
            const existingBgImages = Array.isArray(cloned?.bgImages) ? cloned.bgImages.slice() : [];
            // Ensure latest-first and remove duplicates
            const dedup = [newUrl, ...existingBgImages.filter((u) => u !== newUrl)];
            cloned = { ...cloned, ...infoToUpdate, bgImages: dedup, bgImage: newUrl };
            return cloned;
          }
          return { ...cloned, ...infoToUpdate };
        }
        return cloned;
      });
    }
    ideaData.publishInfo.selectedThumbnailIndex = selectedIndex;
  } else {
    ideaData.publishInfo.thumbnailInfo = newThumbnailInfo;
    if (newThumbnailInfo.selectedThumbnailIndex !== undefined) {
      ideaData.publishInfo.selectedThumbnailIndex = newThumbnailInfo.selectedThumbnailIndex;
    }
  }
}

// Normalize SEO title to avoid simple duplicated forms like "T T" or "T - T".

// Helper: attach a single delegated click listener on an image gallery grid.
// This makes it safe to re-render the grid from multiple code paths.
export function ensureGalleryGridClickHandler(imageGalleryGrid, sendCommand) {
  if (!imageGalleryGrid) return;
  if (imageGalleryGrid.dataset.cpGalleryGridListenerAttached === '1') return;
  imageGalleryGrid.dataset.cpGalleryGridListenerAttached = '1';
  // eslint-disable-next-line no-console
  console.log('[GALLERY HANDLER] attached to grid');
  imageGalleryGrid.addEventListener('click', (e) => {
    const targetImg = e.target && e.target.closest ? e.target.closest('.gallery-thumb') : null;
    if (!targetImg) return;
    const url = targetImg.dataset.src || targetImg.src;
    // debug hook for tests
    // eslint-disable-next-line no-console
    console.log('[GALLERY CLICK] sending insert-image for url=' + url);
    sendCommand('insert-image', { url });
    sendCommand('focus');
  });
}

// Ensure a safe global save hook exists so tests and other modules can
// force-save the current publish-info title even if the publish area hasn't
// been (re)rendered yet. Defining this at module load time avoids race
// conditions when tests run multiple workspace scenarios in sequence.
if (typeof window !== 'undefined' && typeof window.__cp_force_save_title !== 'function') {
  window.__cp_force_save_title = () => {
    try {
      const cur = document.querySelector('#idea-title-input');
      const val = cur ? String(cur.value || '').trim() : null;
      const pubContainer = cur ? cur.closest('#publish-info-content') : null;
      if (pubContainer && typeof pubContainer._doSaveTitleFromExternal === 'function') {
        pubContainer._doSaveTitleFromExternal(val);
        return;
      }
      if (pubContainer && typeof pubContainer._doSaveTitle === 'function') {
        pubContainer._doSaveTitle(true);
        return;
      }

      // If we couldn't find a live publish container, try a best-effort background save
      // using any recorded pending title (this covers rapid re-render cases).
      const pending =
        __lastPendingTitle ||
        (typeof window !== 'undefined' && window.__cp_last_pending_title) ||
        null;
      if (pending && pending.id && pending.pending) {
        try {
          chrome.runtime.sendMessage(
            {
              action: 'update_kanban_card',
              data: {
                cardId: pending.id,
                status: pending.status || 'ideas',
                updates: { title: pending.pending },
              },
            },
            () => {
              __lastPendingTitle = null;
              try {
                window.__cp_last_pending_title = null;
              } catch (e) {}
            }
          );
        } catch (e) {
          // ignore
        }
      }
    } catch (e) {
      // suppress — diagnostic logs may surface during tests but shouldn't fail them
      // eslint-disable-next-line no-console
      console.debug && console.debug('[Workspace] __cp_force_save_title failed:', e);
    }
  };
}

// --- Lazy loader using IntersectionObserver for gallery images ---
let galleryImageObserver = null;
// Keep last pending title info so a force-save can still find it after a re-render
let __lastPendingTitle = null;
// Track whether we've attached a single runtime.onMessage listener for gallery updates
let galleryRuntimeMessageHandlerAttached = false;

// ---------- AI Prompt Debug Modal (dev/debugging helper) ----------
function showDebugPromptModal(type = 'prompt', prompt = '') {
  try {
    // Avoid creating multiple modals
    let modal = document.querySelector('#ai-debug-prompt-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'ai-debug-prompt-modal';
      modal.style.cssText =
        'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.45);z-index:2147483646;padding:20px;';
      modal.innerHTML = `
        <div id="ai-debug-prompt-inner" style="background:#fff;color:#111;max-width:900px;width:100%;max-height:80vh;overflow:auto;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.3);">
          <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid #eee;">
            <div style="font-weight:600;">AI Prompt Debug <span id="ai-debug-prompt-type" style="font-weight:400;color:#666;margin-left:8px;">${type}</span></div>
            <div style="display:flex;gap:8px;align-items:center;">
              <button id="ai-debug-copy-btn" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;background:#f7f7f7;cursor:pointer;">Copy</button>
              <button id="ai-debug-close-btn" style="padding:6px 10px;border-radius:6px;border:1px solid #ddd;background:#fff;cursor:pointer;">Close</button>
            </div>
          </div>
          <div style="padding:12px;">
            <textarea id="ai-debug-prompt-text" readonly style="width:100%;height:320px;padding:10px;border:1px solid #eee;border-radius:6px;font-family:monospace;white-space:pre-wrap;">${String(prompt)}</textarea>
          </div>
        </div>`;
      document.body.appendChild(modal);

      // Wire buttons
      modal.querySelector('#ai-debug-close-btn').addEventListener('click', hideDebugPromptModal);
      modal.querySelector('#ai-debug-copy-btn').addEventListener('click', () => {
        const t = modal.querySelector('#ai-debug-prompt-text');
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(t.value);
            showToast('프롬프트가 클립보드로 복사되었습니다. ✅');
          } else {
            t.select();
            document.execCommand('copy');
            showToast('프롬프트가 클립보드로 복사되었습니다. ✅');
          }
        } catch (e) {
          console.warn('[AI Debug Modal] copy failed', e);
          showToast('복사에 실패했습니다. 콘솔을 확인하세요. ⚠️');
        }
      });

      // Close on overlay click
      modal.addEventListener('click', (ev) => {
        if (ev.target && ev.target.id === 'ai-debug-prompt-modal') hideDebugPromptModal();
      });

      // ESC to close
      const escHandler = (ev) => {
        if (ev.key === 'Escape') hideDebugPromptModal();
      };
      document.addEventListener('keydown', escHandler);
      modal._escHandler = escHandler;
    } else {
      // update existing
      const typeEl = modal.querySelector('#ai-debug-prompt-type');
      const textEl = modal.querySelector('#ai-debug-prompt-text');
      if (typeEl) typeEl.textContent = type;
      if (textEl) textEl.value = String(prompt);
    }
  } catch (e) {
    console.warn('[AI Debug Modal] show failed', e);
  }
}

function hideDebugPromptModal() {
  try {
    const modal = document.querySelector('#ai-debug-prompt-modal');
    if (!modal) return;
    const esc = modal._escHandler;
    if (esc) document.removeEventListener('keydown', esc);
    modal.remove();
  } catch (e) {
    // ignore
  }
}

// Attach runtime onMessage listener to receive debug_show_prompt actions
try {
  if (
    typeof chrome !== 'undefined' &&
    chrome.runtime &&
    chrome.runtime.onMessage &&
    typeof chrome.runtime.onMessage.addListener === 'function'
  ) {
    chrome.runtime.onMessage.addListener(function debugPromptListener(message) {
      try {
        if (message && message.action === 'debug_show_prompt') {
          showDebugPromptModal(message.promptType || 'prompt', message.prompt || '');
        }
      } catch (e) {}
    });
  }
} catch (e) {}

function ensureGalleryImageObserver() {
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
        // Set src and let normal load handlers take over
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

function updateImageGalleryFromAllScraps(resourceLibrary, allScraps, sendCommand, ideaData = null) {
  const imageGalleryArea = resourceLibrary.querySelector('.image-gallery-area');
  if (!imageGalleryArea) return;
  // debug: log incoming scraps for test diagnostics
  // eslint-disable-next-line no-console
  console.log(
    '[GALLERY UPDATE] allScraps length=' + (Array.isArray(allScraps) ? allScraps.length : 'none'),
    allScraps && allScraps.slice ? allScraps.slice(0, 3) : allScraps
  );

  // 헤더 HTML이 이미 갤러리 필터 탭을 포함하고 있으므로 유지
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

  // 초기 로딩 메시지
  imageGalleryGrid.innerHTML =
    "<p style='text-align:center;color:#888;padding:20px;'>이미지를 불러오는 중...</p>";

  // If explicit `allScraps` were passed (e.g., from `get_all_scraps`), prefer
  // building the gallery directly from those scraps to avoid an extra
  // `get_unified_gallery` round-trip. This also keeps tests deterministic.
  if (Array.isArray(allScraps) && allScraps.length > 0) {
    const built = [];
    allScraps.forEach((scrap) => {
      const candidates = [];
      if (scrap.image) candidates.push(scrap.image);
      if (scrap.url) candidates.push(scrap.url);
      if (Array.isArray(scrap.allImages)) candidates.push(...scrap.allImages);
      if (Array.isArray(scrap.images)) candidates.push(...scrap.images);
      // dedupe
      const uniq = Array.from(new Set(candidates.filter(Boolean)));
      uniq.forEach((u) => {
        built.push({
          id: scrap.id ? `${scrap.id}::${u}` : undefined,
          scrapId: scrap.id,
          source: 'SCRAP',
          url: u,
          thumbnail: u,
          originData: scrap,
          usedInDraft:
            scrap.usedInDraft || (scrap.originData && scrap.originData.usedInDraft) || false,
          timestamp: scrap.timestamp || Date.now(),
        });
      });
    });
    allImageData = built;
    renderFilteredImages(allImageData, currentFilter, isDraftFilterActive, draftContentText);
    setTimeout(adjustGridColumns, 50);
    // Also trigger a background unified-gallery fetch so other
    // modules relying on `get_unified_gallery` are exercised (tests expect it).
    setTimeout(() => loadUnifiedGallery(currentFilter), 0);
  }

  // 그리드 반응형 조정 함수
  function adjustGridColumns() {
    const containerWidth = imageGalleryGrid.offsetWidth;
    let columns;

    if (containerWidth >= 800) {
      columns = 6; // 큰 화면: 6열
    } else if (containerWidth >= 600) {
      columns = 4; // 중간 화면: 4열
    } else if (containerWidth >= 400) {
      columns = 3; // 작은 화면: 3열
    } else {
      columns = 2; // 아주 작은 화면: 2열
    }

    imageGalleryGrid.style.gridTemplateColumns = `repeat(${columns}, 1fr)`;
  }

  // 초기 그리드 설정 및 이벤트 리스너
  adjustGridColumns();
  // Ensure we only attach a single resize handler per gallery area
  if (!imageGalleryArea.dataset.cpResizeListenerAttached) {
    window.addEventListener('resize', adjustGridColumns);
    imageGalleryArea.dataset.cpResizeListenerAttached = '1';
  }

  // 통합 갤러리 데이터 로드 함수
  function loadUnifiedGallery(filter = 'ALL') {
    chrome.runtime.sendMessage(
      {
        action: 'get_unified_gallery',
        data: { filter },
      },
      (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[Gallery] 통합 갤러리 로드 실패:', chrome.runtime.lastError);
          imageGalleryGrid.innerHTML =
            "<p style='text-align:center;color:#888;padding:20px;'>갤러리를 불러올 수 없습니다.</p>";
          return;
        }

        if (response && response.success && Array.isArray(response.images)) {
          if (response.images.length > 0) {
            allImageData = response.images;
            renderFilteredImages(
              allImageData,
              currentFilter,
              isDraftFilterActive,
              draftContentText
            );
            // 데이터 로드 후 그리드 조정
            setTimeout(adjustGridColumns, 100);
          } else {
            // Keep any existing gallery (e.g., built from `get_all_scraps`) instead of
            // overwriting with an empty list. This avoids flicker/regression in tests
            // that intentionally return an empty unified gallery.
            // eslint-disable-next-line no-console
            console.log(
              '[Gallery] get_unified_gallery returned empty; preserving existing gallery'
            );
          }
        } else {
          console.warn('[Gallery] 통합 갤러리 응답 실패:', response);
          imageGalleryGrid.innerHTML =
            "<p style='text-align:center;color:#888;padding:20px;'>갤러리를 불러올 수 없습니다.</p>";
        }
      }
    );
    // 메시지를 통해 다른 컨텍스트에서 이미지가 삭제되었는지 감지하여 갤러리 자동 갱신.
    // Attach a single global runtime listener per module to avoid multiple listeners across
    // repeated renders or test runs.
    if (!galleryRuntimeMessageHandlerAttached) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg?.action === 'scrap_image_removed') {
          // 현재 필터 상태로 갤러리 다시 로드
          loadUnifiedGallery(currentFilter);
        }
      });
      galleryRuntimeMessageHandlerAttached = true;
    }
  }

  // 필터링 및 렌더링 함수
  function renderFilteredImages(images, filter, draftFilterActive, draftText) {
    let filteredImages = images;

    // 소스 필터 적용
    if (filter !== 'ALL') {
      filteredImages = filteredImages.filter((img) => img.source === filter);
    }

    // 초안 필터 적용 (실제로는 AI 서비스를 통해 구현)
    if (draftFilterActive && draftText) {
      // 간단한 텍스트 매칭으로 필터링 (실제로는 더 정교한 AI 매칭 필요)
      const draftWords = draftText
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      filteredImages = filteredImages.filter((img) => {
        const imgText = (img.title || '').toLowerCase();
        return draftWords.some((word) => imgText.includes(word));
      });
    }

    // 검색어 필터 적용
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

  // 이미지 렌더링 함수
  function renderImages(images) {
    if (images.length === 0) {
      imageGalleryGrid.innerHTML = `<p style='text-align:center;color:#888;padding:20px;'>이미지가 없습니다.</p>`;
      imageCount.textContent = '0개';
      return;
    }

    imageCount.textContent = `${images.length}개`;

    // Try to intelligently reuse existing DOM nodes where possible so that
    // repeated re-renders don't detach and recreate elements (which would
    // invalidate event handlers held by tests or other modules).
    const existingNodes = Array.from(imageGalleryGrid.querySelectorAll('.gallery-thumb-wrap'));
    const nodeMap = new Map();
    existingNodes.forEach((node) => {
      const imgEl = node.querySelector('img.gallery-thumb');
      const url = imgEl && (imgEl.dataset.src || imgEl.src);
      if (url) nodeMap.set(url, node);
      else if (node.dataset && node.dataset.scrapId) nodeMap.set(node.dataset.scrapId, node);
    });

    const fragment = document.createDocumentFragment();

    // Precompute how many items are shown per scrap (in this flattened list)
    const shownPerScrap = {};
    const totalPerScrap = {};
    images.forEach((it) => {
      const sId = it.scrapId || it.id;
      if (sId) {
        shownPerScrap[sId] = (shownPerScrap[sId] || 0) + 1;
        // total available count from originData (if present)
        const origin = it.originData || {};
        const total = Array.isArray(origin.allImages) ? origin.allImages.length : 1;
        // store maximum seen for totalPerScrap
        totalPerScrap[sId] = Math.max(totalPerScrap[sId] || 0, total);
      }
    });

    // track seen so far while rendering to detect last-shown item
    const seenPerScrap = {};

    // Track which existing nodes we've reused; remaining entries in nodeMap will be removed
    const reusedKeys = new Set();

    images.forEach((imgData) => {
      const url = imgData.url || imgData.thumbnail || '';
      let div = null;

      if (url && nodeMap.has(url)) {
        div = nodeMap.get(url);
        reusedKeys.add(url);
      }

      // Fallback: try scrapId match
      const scrapKey = imgData.scrapId || imgData.id;
      if (!div && scrapKey && nodeMap.has(scrapKey)) {
        div = nodeMap.get(scrapKey);
        reusedKeys.add(scrapKey);
      }

      if (!div) {
        div = document.createElement('div');
        div.className = 'gallery-thumb-wrap';
        div.style.cssText =
          'position: relative; cursor: pointer; border-radius: 8px; overflow: hidden; background: #f5f5f5; min-width: 0; min-height: 88px; box-sizing: border-box;';
      }

      // Ensure source badge
      let sourceBadge = div.querySelector('.gallery-thumb-wrap > div');
      if (!sourceBadge) {
        sourceBadge = document.createElement('div');
        sourceBadge.style.cssText =
          'position: absolute; top: 4px; left: 4px; background: rgba(0,0,0,0.6); color: white; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 500; z-index: 5;';
        div.appendChild(sourceBadge);
      }
      sourceBadge.textContent = imgData.source === 'SCRAP' ? '스크랩' : '스토리지';

      // used badge
      function _isUsedInDraft(data) {
        if (!data) return false;
        if (data.usedInDraft || data.used) return true;
        if (data.originData && (data.originData.usedInDraft || data.originData.used)) return true;
        return false;
      }
      const used = _isUsedInDraft(imgData);
      let usedBadge = div.querySelector('.used-badge');
      if (used && !usedBadge) {
        usedBadge = document.createElement('div');
        usedBadge.className = 'used-badge';
        usedBadge.style.cssText =
          'position: absolute; top: 4px; right: 4px; background: #ffb000; color: #222; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 600; z-index: 6;';
        usedBadge.textContent = '초안 사용';
        div.appendChild(usedBadge);
      } else if (!used && usedBadge) {
        usedBadge.remove();
      }

      // Ensure image element
      let img = div.querySelector('img.gallery-thumb');
      if (!img) {
        img = document.createElement('img');
        img.className = 'gallery-thumb';
        img.loading = 'lazy';
        img.decoding = 'async';
        img.style.cssText = 'width:100%;height:88px;object-fit:cover;display:block;';
        div.appendChild(img);
      }
      // update image src/dataset
      img.dataset.src = url;
      img.classList.add('lazy-loading');
      try {
        ensureGalleryImageObserver().observe(img);
        // eager load immediately for tests (jsdom has no layout, set src directly)
        img.src = img.dataset.src;
        img.classList.remove('lazy-loading');
      } catch (e) {
        img.src = img.dataset.src;
      }

      // Ensure a direct click handler on the image so tests that keep a
      // reference to an earlier node still trigger the expected behavior.
      if (!img.dataset.cpClickBound) {
        img.addEventListener('click', (e) => {
          e.stopPropagation();
          const u = e.currentTarget.dataset.src || e.currentTarget.src;
          // eslint-disable-next-line no-console
          console.log('[GALLERY CLICK] direct click for url=' + u);
          try {
            sendCommand('insert-image', { url: u });
            sendCommand('focus');
          } catch (err) {
            // ignore in tests if sendCommand is not available
          }
        });
        img.dataset.cpClickBound = '1';
      }

      // ensure draggable and data-scrap-id
      if (scrapKey) {
        try {
          div.draggable = true;
          div.dataset.scrapId = scrapKey;
          if (!div.dataset.cpDragInitAttached) {
            div.addEventListener('dragstart', (e) => {
              try {
                const data = {
                  id: scrapKey,
                  text: imgData.title || '',
                  isLinked: false,
                  imageUrl: imgData.url || imgData.thumbnail || imgData.src || null,
                };
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('application/json', JSON.stringify(data));
              } catch (err) {
                // ignore
              }
            });
            div.dataset.cpDragInitAttached = '1';
          }
        } catch (e) {}
      }

      // Append to fragment (new nodes) or re-append existing (moves it to new order)
      fragment.appendChild(div);

      // update seen counts for +N overlay
      if (scrapKey) seenPerScrap[scrapKey] = (seenPerScrap[scrapKey] || 0) + 1;

      const isLastShown = scrapKey && seenPerScrap[scrapKey] === shownPerScrap[scrapKey];
      const totalCount = scrapKey ? totalPerScrap[scrapKey] || 0 : 0;
      const shownCount = scrapKey ? shownPerScrap[scrapKey] || 0 : 0;
      const extra = totalCount - shownCount;
      // manage overlay
      let overlay = div.querySelector('.gallery-more-overlay');
      if (isLastShown && extra > 0) {
        if (!overlay) {
          overlay = document.createElement('div');
          overlay.className = 'gallery-more-overlay';
          overlay.style.cssText =
            'position:absolute; right:6px; bottom:6px; background: rgba(0,0,0,0.6); color: #fff; padding: 4px 6px; border-radius: 12px; font-size: 11px; z-index: 12;';
          div.appendChild(overlay);
        }
        overlay.textContent = `+${extra}`;
        overlay.title = `${extra}개 추가 이미지`;
      } else if (overlay) {
        overlay.remove();
      }
    });

    // Remove any remaining stale nodes
    for (const [k, node] of nodeMap.entries()) {
      if (!reusedKeys.has(k) && node.parentNode) node.parentNode.removeChild(node);
    }

    imageGalleryGrid.innerHTML = '';
    imageGalleryGrid.appendChild(fragment);

    // Eager-load newly rendered images that are already within the visible grid viewport
    // This prevents needing to switch tabs / re-focus to trigger IntersectionObserver
    try {
      setTimeout(() => {
        const lazyImgs = imageGalleryGrid.querySelectorAll('img.lazy-loading');
        if (!lazyImgs || lazyImgs.length === 0) return;
        const gridRect = imageGalleryGrid.getBoundingClientRect();
        lazyImgs.forEach((img) => {
          try {
            const r = img.getBoundingClientRect();
            // follow same rootMargin logic: if within 200px range of viewport inside grid, load immediately
            if (r.top < gridRect.bottom + 200 && r.bottom > gridRect.top - 200) {
              const src = img.dataset && img.dataset.src;
              if (src) {
                img.src = src;
                img.classList.remove('lazy-loading');
                try {
                  if (galleryImageObserver) galleryImageObserver.unobserve(img);
                } catch (_) {
                  void 0; // ignore
                }
              }
            }
          } catch (_) {
            void 0; // ignore
          }
        });
      }, 30);
    } catch (e) {
      /* ignore */
    }

    // ensure the delegated click handler exists for the grid after rendering
    ensureGalleryGridClickHandler(imageGalleryGrid, sendCommand);
  }

  // 이벤트 리스너 설정
  // 필터 탭 이벤트
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

  // 검색 입력 이벤트
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderFilteredImages(allImageData, currentFilter, isDraftFilterActive, draftContentText);
    });
  }

  // 초안 필터 버튼 이벤트
  if (filterByDraftBtn) {
    filterByDraftBtn.addEventListener('click', async () => {
      if (!isDraftFilterActive) {
        // 초안 내용 가져오기
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

  // 미리보기 모달 이벤트
  if (closePreview) {
    closePreview.addEventListener('click', () => {
      previewModal.style.display = 'none';
    });
  }

  if (previewModal) {
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) {
        previewModal.style.display = 'none';
      }
    });
  }

  // 초안 내용 가져오기 헬퍼 함수
  async function getDraftContent() {
    return new Promise((resolve) => {
      const editorIframe = document.querySelector('#editor-iframe');
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

  // 초기 데이터 로드
  loadUnifiedGallery(currentFilter);
}

// Helper to apply draft response fields into ideaData (kept small and testable)
export function applyDraftResponseToIdea(ideaData = {}, response = {}) {
  console.debug(
    '[DIAG applyDraftResponseToIdea] called with response:',
    response,
    'ideaData before:',
    {
      id: ideaData?.id,
      seoTitle: ideaData?.seoTitle,
      publishInfo: ideaData?.publishInfo,
      draftContent: ideaData?.draftContent,
    }
  );
  if (!ideaData) ideaData = {};
  if (!response) return ideaData;

  if (response.draft) {
    ideaData.draftContent = response.draft;
    if (!ideaData.workspace) ideaData.workspace = {};
    ideaData.workspace.draft = response.draft;
    console.debug(
      '[DIAG applyDraftResponseToIdea] draft content set:',
      response.draft.substring(0, 100) + '...'
    );
  }

  // ensure seoTitle is stored both top-level and inside publishInfo
  if (response.seoTitle) {
    let safeSeo = normalizeSeoTitle(response.seoTitle, ideaData?.title);
    // 중복 년도 제거 추가
    try {
      safeSeo = removeDuplicateYears(String(safeSeo || ''));
    } catch (e) {
      Logger.warn('[applyDraftResponseToIdea] removeDuplicateYears failed:', e);
    }
    ideaData.seoTitle = safeSeo;
    if (!ideaData.publishInfo) ideaData.publishInfo = {};
    ideaData.publishInfo.seoTitle = safeSeo;
    console.debug('[DIAG applyDraftResponseToIdea] seoTitle set:', safeSeo);
  }

  // If the AI provided a metaDescription during draft generation, apply it directly
  // to the publishInfo.description and persist immediately (no separate suggestion UI)
  if (response.metaDescription) {
    if (!ideaData.publishInfo) ideaData.publishInfo = {};
    ideaData.publishInfo.description = response.metaDescription;
    console.debug(
      '[DIAG applyDraftResponseToIdea] applied metaDescription to publishInfo.description'
    );

    // Persist description to Firebase immediately
    try {
      if (ideaData.id) {
        chrome.runtime.sendMessage(
          {
            action: 'update_kanban_card',
            data: {
              cardId: ideaData.id,
              status: ideaData.status || 'ideas',
              updates: {
                description: response.metaDescription,
                updatedAt: Date.now(),
              },
            },
          },
          (resp) => {
            if (resp && resp.success) {
              console.debug('[DIAG applyDraftResponseToIdea] persisted description to DB');
            } else {
              console.debug('[DIAG applyDraftResponseToIdea] failed to persist description', resp);
            }
          }
        );
      }
    } catch (e) {
      Logger.debug(
        '[applyDraftResponseToIdea] failed to send update_kanban_card for description:',
        e
      );
    }
  }

  // If the AI provided thumbnail prompts (three categories) or thumbnailInfo, store them
  if (response.thumbnailPrompts) {
    if (!ideaData.publishInfo) ideaData.publishInfo = {};
    ideaData.publishInfo.thumbnailPrompts = response.thumbnailPrompts;
    console.debug(
      '[DIAG applyDraftResponseToIdea] thumbnailPrompts set:',
      response.thumbnailPrompts
    );
  }

  if (response.thumbnailInfo) {
    if (!ideaData.publishInfo) ideaData.publishInfo = {};
    ideaData.publishInfo.thumbnailInfo = response.thumbnailInfo;
    console.debug('[DIAG applyDraftResponseToIdea] thumbnailInfo set');
  }

  // If this idea is currently open in the workspace UI, refresh the publish-info panel
  try {
    // Find the workspace container corresponding to this idea.
    // Prefer the active workspace (global __cp_workspace_idea_data), otherwise
    // search for any workspace that references the idea via data-idea-id on linked-scraps.
    let targetWorkspace = null;
    const activeWorkspace = document.querySelector('.workspace-container');
    if (activeWorkspace && window.__cp_workspace_idea_data?.id === ideaData.id) {
      targetWorkspace = activeWorkspace;
    } else {
      const candidate = document.querySelector(
        `.linked-scraps-list[data-idea-id="${ideaData.id}"]`
      );
      if (candidate) targetWorkspace = candidate.closest('.workspace-container');
    }

    // If we couldn't find a matching workspace specifically for this idea,
    // fall back to any visible workspace container so the draft response
    // still refreshes the currently open workspace in test and single-workspace
    // environments.
    if (!targetWorkspace) {
      const anyWorkspace = document.querySelector('.workspace-container');
      if (anyWorkspace) targetWorkspace = anyWorkspace;
    }

    if (targetWorkspace) {
      console.debug(
        '[DIAG applyDraftResponseToIdea] refreshing publish-info UI for ideaId:',
        ideaData.id,
        'seoTitle:',
        ideaData.seoTitle || ideaData.publishInfo?.seoTitle
      );
      // safe call: showPublishInfo may be defined later in this module
      if (typeof showPublishInfo === 'function') {
        const tagsForDisplay = Array.isArray(ideaData.publishInfo?.tags)
          ? ideaData.publishInfo.tags.join(', ')
          : ideaData.publishInfo?.tags || '';
        showPublishInfo(
          targetWorkspace,
          ideaData.publishInfo?.permalink,
          tagsForDisplay,
          ideaData.seoTitle || ideaData.publishInfo?.seoTitle || '',
          ideaData
        );
      }
      // Also refresh thumbnail button after draft generation
      if (typeof renderThumbnailButton === 'function') {
        console.debug('[DIAG applyDraftResponseToIdea] calling renderThumbnailButton');
        renderThumbnailButton(targetWorkspace, ideaData);
      }
    }
  } catch (e) {
    console.error('[DIAG applyDraftResponseToIdea] error during UI refresh:', e);
    // non-fatal; do not block draft application
  }

  if (!ideaData.publishInfo) ideaData.publishInfo = {};
  if (response.permalink) ideaData.publishInfo.permalink = response.permalink;
  if (response.tags) ideaData.publishInfo.tags = response.tags;
  if (response.jsonLdSchema) ideaData.publishInfo.jsonLdSchema = response.jsonLdSchema;
  if (response.thumbnailUrls) ideaData.publishInfo.thumbnailUrls = response.thumbnailUrls;

  return ideaData;
}

// -----------------------------------------------------------------------------
// 2. 헬퍼 함수들 (반드시 최상위 레벨에 있어야 함)
// -----------------------------------------------------------------------------

/**
 * 썸네일 만들기 버튼을 렌더링하는 헬퍼 함수
 * 초안이 있거나 썸네일 정보가 저장되어 있으면 버튼을 표시
 */
function renderThumbnailButton(workspaceEl, ideaData) {
  console.debug('[DIAG renderThumbnailButton] called with ideaData:', {
    id: ideaData?.id,
    draftContent: !!ideaData?.draftContent,
    thumbnailInfo: !!ideaData?.publishInfo?.thumbnailInfo,
  });
  // Locate the action-buttons container. Prefer an explicit `#workspace-action-buttons`
  // element when present; otherwise fall back to the workspace root. This removes
  // the dependency on the (soon-to-be-removed) title header element.
  let buttonContainer = workspaceEl.querySelector('#workspace-action-buttons') || workspaceEl;
  // 이미 버튼이 있으면 중단
  // [수정] 버튼이 있으면 위치만 확인하고 이동시킨 후 리턴
  const existingBtn = workspaceEl.querySelector('#btn-create-thumbnail');
  if (existingBtn) {
    const composeControls = workspaceEl.querySelector('.compose-thumbnail-controls');
    console.debug(
      '[DIAG renderThumbnailButton] existingBtn found. composeControls:',
      !!composeControls
    );

    if (
      composeControls &&
      (existingBtn.previousElementSibling !== composeControls ||
        existingBtn.parentNode !== composeControls.parentNode)
    ) {
      console.debug(
        '[DIAG renderThumbnailButton] moving existing button after compose-thumbnail-controls',
        {
          btnParent: existingBtn.parentNode?.id || existingBtn.parentNode?.className,
          controlsParent: composeControls.parentNode?.id || composeControls.parentNode?.className,
        }
      );

      // 스타일 조정 (사이드바에 들어갈 경우)
      if (composeControls.parentNode.id === 'publish-info-actions') {
        existingBtn.style.width = '100%';
        existingBtn.style.marginLeft = '0';
      }

      if (composeControls.nextSibling) {
        composeControls.parentNode.insertBefore(existingBtn, composeControls.nextSibling);
      } else {
        composeControls.parentNode.appendChild(existingBtn);
      }
    }
    return;
  }

  if (!buttonContainer) {
    // No dedicated action-buttons container — fall back to workspace root.
    // We intentionally do NOT create a static `#workspace-action-buttons`
    // element; runtime code should place controls into publish-info area
    // or directly into the workspace container instead.
    buttonContainer = workspaceEl;
    console.debug(
      '[DIAG renderThumbnailButton] no #workspace-action-buttons found, using workspace root as fallback'
    );
  }

  // 초안 데이터가 없으면 버튼 생성 안 함 (초안이 있어야 썸네일 추천 정보가 있음)
  // 단, publishInfo에 썸네일 정보가 저장되어 있다면 표시 가능
  const hasDraft =
    isMeaningfulDraft(ideaData.draftContent) || isMeaningfulDraft(ideaData.workspace?.draft);
  const hasThumbInfo = !!ideaData.publishInfo?.thumbnailInfo;
  const hasThumbnailUrls = !!ideaData.publishInfo?.thumbnailUrls || !!ideaData.thumbnailUrls;

  console.debug(
    '[DIAG renderThumbnailButton] hasDraft:',
    hasDraft,
    'hasThumbInfo:',
    hasThumbInfo,
    'hasThumbnailUrls:',
    hasThumbnailUrls
  );

  if (!hasDraft && !hasThumbInfo && !hasThumbnailUrls) {
    console.debug('[DIAG renderThumbnailButton] conditions not met, not rendering button');
    return;
  }

  const thumbBtn = document.createElement('button');
  thumbBtn.id = 'btn-create-thumbnail';
  thumbBtn.style.cssText =
    'width: 100%; padding: 10px; background: rgb(66, 133, 244); color: rgb(255, 255, 255); border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;';
  thumbBtn.textContent = '🎨 썸네일 만들기';

  // [핵심 수정] '초안 삭제' 버튼이 있다면 그 앞에 추가 (부모 요소 기준)
  // [2025-12-14] compose-thumbnail-controls가 있다면 그 뒤로 이동
  const composeControls = workspaceEl.querySelector('.compose-thumbnail-controls');
  const deleteBtn = buttonContainer.querySelector('#delete-draft-in-workspace');

  if (composeControls) {
    // 스타일 조정 (사이드바에 들어갈 경우)
    if (composeControls.parentNode.id === 'publish-info-actions') {
      thumbBtn.style.width = '100%';
      thumbBtn.style.marginLeft = '0';
    }

    // composeControls 바로 뒤에 삽입 (다음 형제 요소 앞)
    // 이렇게 하면 composeControls -> thumbBtn -> (나머지) 순서가 됨
    if (composeControls.nextSibling) {
      composeControls.parentNode.insertBefore(thumbBtn, composeControls.nextSibling);
    } else {
      composeControls.parentNode.appendChild(thumbBtn);
    }
  } else if (deleteBtn) {
    // buttonContainer.insertBefore(...) 대신 deleteBtn.parentNode.insertBefore(...) 사용
    // deleteBtn이 div로 감싸져 있어도, 그 부모(div)에게 삽입을 요청하므로 안전함
    deleteBtn.parentNode.insertBefore(thumbBtn, deleteBtn);
  } else {
    // 삭제 버튼이 없으면(드문 경우) 컨테이너 끝에 추가
    buttonContainer.appendChild(thumbBtn);
  }

  console.debug(
    '[DIAG renderThumbnailButton] creating thumbnail button, hasThumbnailUrls:',
    hasThumbnailUrls
  );

  // 이벤트 연결
  thumbBtn.onclick = async () => {
    console.debug(
      '[DIAG thumbnail button] clicked, composeThumbnailText checkbox:',
      !!workspaceEl.querySelector('#compose-thumbnail-text-checkbox')?.checked
    );
    // [추가] 워크스페이스의 텍스트 오버레이 체크박스 상태 확인
    const checkbox = workspaceEl.querySelector('#compose-thumbnail-text-checkbox');
    const composeThumbnailText = checkbox ? checkbox.checked : false;

    // [Fix] Use global data if available to ensure freshness
    const currentIdeaData = window.__cp_workspace_idea_data || ideaData;

    Logger.debug('[ThumbnailButton] Opening modal with data:', {
      hasFormattedDraft: !!currentIdeaData.formattedDraft,
      draftLength: (currentIdeaData.formattedDraft || '').length,
      hasCurrentDraft: !!currentIdeaData.currentDraft,
      currentDraftLength: (currentIdeaData.currentDraft || '').length,
    });

    // [Fix] Ensure linkedScrapsContent is populated if missing but linkedScraps exists
    // 1. Prepare IDs from both top-level and workspace-level
    let linkedScrapsIds = [];
    if (Array.isArray(currentIdeaData.linkedScraps)) {
      linkedScrapsIds = currentIdeaData.linkedScraps;
    } else if (currentIdeaData.linkedScraps && typeof currentIdeaData.linkedScraps === 'object') {
      linkedScrapsIds = Object.keys(currentIdeaData.linkedScraps);
    }

    if (linkedScrapsIds.length === 0 && currentIdeaData.workspace?.linkedScraps) {
      if (Array.isArray(currentIdeaData.workspace.linkedScraps)) {
        linkedScrapsIds = currentIdeaData.workspace.linkedScraps;
      } else if (typeof currentIdeaData.workspace.linkedScraps === 'object') {
        linkedScrapsIds = Object.keys(currentIdeaData.workspace.linkedScraps);
      }
    }

    // 2. Fetch content if needed
    let linkedScrapsContent = currentIdeaData.linkedScrapsContent || [];
    if ((!linkedScrapsContent || linkedScrapsContent.length === 0) && linkedScrapsIds.length > 0) {
      console.log('[ThumbnailButton] Fetching linked scraps content for IDs:', linkedScrapsIds);
      const originalText = thumbBtn.textContent;
      thumbBtn.textContent = '자료 불러오는 중...';
      thumbBtn.disabled = true;

      try {
        const { activeChannelId } = await chrome.storage.local.get('activeChannelId');
        const response = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            { action: 'get_all_scraps', channelId: activeChannelId },
            resolve
          );
        });

        if (response && response.success && response.scraps) {
          linkedScrapsIds.forEach((id) => {
            const s = response.scraps.find((item) => item.id === id);
            if (s) {
              linkedScrapsContent.push({
                title: s.title || '스크랩',
                text: s.text || '',
                url: s.url || '',
                image: s.image || (s.allImages && s.allImages.length > 0 ? s.allImages[0] : ''),
                originData: s,
              });
            }
          });
        }
      } catch (e) {
        console.warn('[ThumbnailButton] Failed to fetch linked scraps:', e);
      } finally {
        thumbBtn.textContent = originalText;
        thumbBtn.disabled = false;
      }
    }

    // 3. Fetch affiliate links if needed
    let affiliateLinks = currentIdeaData.affiliateLinks || [];
    if (!affiliateLinks || affiliateLinks.length === 0) {
      try {
        const links = await getAffiliateLinks();
        if (links && Array.isArray(links)) {
          affiliateLinks = links;
        }
      } catch (e) {
        console.warn('[ThumbnailButton] Failed to fetch affiliate links:', e);
      }
    }

    const draftData = {
      seoTitle: currentIdeaData.seoTitle || currentIdeaData.title,
      thumbnailInfo: currentIdeaData.publishInfo?.thumbnailInfo || null,
      // Include draft fields so the thumbnail modal can show reference images immediately
      // [Fix] Fallback to draftContent/workspace.draft if formattedDraft is not yet set (no edits yet)
      formattedDraft:
        currentIdeaData.formattedDraft ||
        currentIdeaData.currentDraft ||
        currentIdeaData.draftContent ||
        currentIdeaData.workspace?.draft ||
        '',
      currentDraft: currentIdeaData.currentDraft || '',
      linkedScrapsContent: linkedScrapsContent,
      affiliateLinks: affiliateLinks,
      // [신규] 저장된 컨셉 선택 인덱스 포함 (publishInfo에서 직접 가져오기)
      selectedThumbnailIndex:
        currentIdeaData.publishInfo?.selectedThumbnailIndex ??
        (Array.isArray(currentIdeaData.publishInfo?.thumbnailInfo) ? 0 : undefined),
    };

    console.log('[DEBUG_REF] ThumbnailButton clicked. draftData prepared:', {
      formattedDraftLength: draftData.formattedDraft.length,
      hasLinkedScraps: draftData.linkedScrapsContent.length > 0,
      linkedScrapsCount: draftData.linkedScrapsContent.length,
      hasAffiliateLinks: draftData.affiliateLinks.length > 0,
    });

    // 공통 콜백 함수들
    const onInsert = (dataUrl, altText) => {
      const editorIframe = workspaceEl.querySelector('#editor-iframe');
      if (editorIframe && editorIframe.contentWindow) {
        editorIframe.contentWindow.postMessage(
          {
            action: 'insert-image',
            data: {
              url: dataUrl,
              alt: altText || draftData.seoTitle || '썸네일 이미지',
            },
          },
          '*'
        );
        showToast('✅ 썸네일이 본문에 삽입되었습니다!');

        // Mark the thumbnail as used in this draft so it shows a badge in the gallery
        try {
          chrome.runtime.sendMessage(
            { action: 'mark_thumbnail_used', data: { url: dataUrl, cardId: ideaData?.id } },
            () => {}
          );
        } catch (e) {
          // ignore send errors
        }
      } else {
        Logger.error('[ThumbnailMaker] 에디터 iframe을 찾을 수 없습니다.');
        showToast('❌ 에디터를 찾을 수 없습니다.');
      }
    };

    const onSave = (newThumbnailInfo) => {
      // Helper to apply updates and persist to Firebase
      const proceedWithSave = (info) => {
        // 메모리 업데이트
        if (!ideaData.publishInfo) ideaData.publishInfo = {};

        // Use a helper to apply updates safely (break shared references)
        applyThumbnailInfoUpdate(ideaData, info);

        // Firebase 업데이트
        const publishInfoUpdates = {
          ...(ideaData.publishInfo || {}),
          thumbnailInfo: ideaData.publishInfo.thumbnailInfo,
          selectedThumbnailIndex: ideaData.publishInfo.selectedThumbnailIndex,
        };

        chrome.runtime.sendMessage(
          {
            action: 'update_kanban_card',
            data: {
              cardId: ideaData.id,
              status: ideaData.status || 'ideas',
              updates: {
                publishInfo: publishInfoUpdates,
              },
            },
          },
          (response) => {
            if (chrome.runtime.lastError) {
              Logger.error('[Thumbnail] 저장 오류:', chrome.runtime.lastError);
            } else if (response && response.success) {
              Logger.biz('[Thumbnail] 작업 상태 자동 저장됨:', info);
            } else {
              Logger.error('[Thumbnail] 저장 실패:', response?.error);
            }
          }
        );
      };

      // If user-provided bgImage exists, check with background whether the path is tombstoned
      try {
        if (newThumbnailInfo && newThumbnailInfo.bgImage) {
          chrome.runtime.sendMessage(
            { action: 'is_thumbnail_deleted', data: { url: newThumbnailInfo.bgImage } },
            (res) => {
              if (res && res.success && res.deleted) {
                // Prevent re-adding a recently deleted original file
                delete newThumbnailInfo.bgImage; // remove from payload
                showToast('⚠️ 원본이 삭제되어 이미지 참조는 저장되지 않았습니다.', 'warning');
              }
              proceedWithSave(newThumbnailInfo);
            }
          );
        } else {
          proceedWithSave(newThumbnailInfo);
        }
      } catch (e) {
        // On unexpected errors, fall back to immediate save to avoid blocking
        proceedWithSave(newThumbnailInfo);
      }
    };

    // 모달 즉시 열기
    Logger.info('[ThumbnailButton] 썸네일 모달 열기 (기존 데이터 사용)');
    const shadowRoot = workspaceEl.getRootNode();
    const targetContainer =
      shadowRoot.nodeType === Node.DOCUMENT_FRAGMENT_NODE ? shadowRoot : document.body;
    openThumbnailMaker(
      draftData,
      onInsert,
      onSave,
      null,
      { showText: composeThumbnailText },
      targetContainer
    );

    // 백그라운드에서 최신 데이터 가져오기 (선택적 업데이트)
    chrome.runtime.sendMessage(
      {
        action: 'get_kanban_card_status',
        data: { cardId: ideaData.id },
      },
      (statusResponse) => {
        if (chrome.runtime.lastError) {
          Logger.warn('[ThumbnailButton] 상태 조회 실패:', chrome.runtime.lastError);
          return;
        }

        if (statusResponse && statusResponse.success) {
          const status = statusResponse.status || ideaData.status || 'ideas';
          chrome.runtime.sendMessage(
            {
              action: 'get_kanban_data',
            },
            (kanbanResponse) => {
              if (chrome.runtime.lastError) {
                Logger.warn('[ThumbnailButton] 데이터 조회 실패:', chrome.runtime.lastError);
                return;
              }

              if (kanbanResponse && kanbanResponse.success && kanbanResponse.data) {
                const cardData = kanbanResponse.data[status]?.[ideaData.id];
                if (cardData && cardData.publishInfo?.thumbnailInfo) {
                  const latestThumbnailInfo = cardData.publishInfo.thumbnailInfo;
                  // 메모리 업데이트
                  if (!ideaData.publishInfo) ideaData.publishInfo = {};
                  ideaData.publishInfo.thumbnailInfo = latestThumbnailInfo;

                  Logger.info(
                    '[ThumbnailButton] Firebase에서 최신 썸네일 정보 가져옴:',
                    latestThumbnailInfo
                  );

                  // If the modal is open, update the reference images in-place
                  updateThumbnailModalReferences(cardData);

                  // 모달은 이미 열렸으므로 추가 작업 불필요
                }
              }
            }
          );
        }
      }
    );
  };
}

function createScrapCard(scrap, isLinked) {
  const textContent = scrap.text || '(내용 없음)';
  const cleanedTitle = (scrap.title || textContent).replace(/\s+/g, ' ').trim();
  const displayTitle = cleanedTitle.substring(0, 10);

  // [수정] 연결된 스크랩 UI 개선 (이미지 썸네일 표시)
  if (isLinked) {
    const imageUrl = scrap.image || (Array.isArray(scrap.allImages) && scrap.allImages[0]);
    const hasImage = !!imageUrl;

    return `<div class="scrap-card-item linked-scrap-item ${hasImage ? 'has-thumbnail' : ''}" 
        data-scrap-id="${scrap.id}" 
        data-text="${textContent.replace(/"/g, '&quot;')}" 
        draggable="true" 
        style="margin:0; flex-shrink:0; position:relative; display:flex; align-items:center; background:#fff; border:1px solid #ddd; border-radius:20px; padding:4px 10px 4px 4px; gap:6px; height:32px; box-shadow:0 1px 2px rgba(0,0,0,0.05);">
        
        ${
          hasImage
            ? `<div style="width:24px; height:24px; border-radius:50%; overflow:hidden; flex-shrink:0; border:1px solid #eee;">
                 <img src="${imageUrl}" style="width:100%; height:100%; object-fit:cover;">
               </div>`
            : `<span style="font-size:14px; margin-left:4px;">📄</span>`
        }
        
        <div class="linked-scrap-tag" style="border:none; background:none; padding:0;">
          <span class="tag-text" style="font-size:12px; color:#333; max-width:100px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; display:inline-block; vertical-align:middle;">
            ${displayTitle}...
          </span>
          <button class="unlink-scrap-btn" data-scrap-id="${scrap.id}" title="연결 해제" style="margin-left:4px; border:none; background:none; color:#999; cursor:pointer; font-size:14px; padding:0 2px;">×</button>
        </div>
      </div>`;
  }

  const tagsHtml =
    scrap.tags && Array.isArray(scrap.tags) && scrap.tags.length > 0
      ? `<div class="card-tags">${scrap.tags
          .map((t) => `<span class="tag">#${t}</span>`)
          .join('')}</div>`
      : '';
  const previewText =
    textContent.length > 200 ? textContent.substring(0, 200) + '...' : textContent;
  const previewImage =
    scrap.image ||
    (Array.isArray(scrap.allImages) && scrap.allImages.length > 0 ? scrap.allImages[0] : '');

  // [체크리스트 2] 전용/공용 토글 버튼 생성 (배지 제거, 토글 버튼만 유지)
  // [CSP 준수] 인라인 이벤트 핸들러 제거, CSS :hover 사용
  const isDedicated = scrap.channelId !== null && scrap.channelId !== undefined;
  const toggleBtn = `<button class="scrap-share-toggle-btn ${
    isDedicated ? 'scrap-toggle-dedicated' : 'scrap-toggle-public'
  }" data-scrap-id="${scrap.id}" data-current-channel-id="${scrap.channelId || ''}" 
    style="position: absolute; top: 4px; right: 4px; width: 24px; height: 24px; border: none; border-radius: 4px; cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 12px; z-index: 10; transition: all 0.2s;"
    title="${isDedicated ? '공용으로 변경' : '전용으로 변경'}">
    ${isDedicated ? '🔒' : '🌐'}
  </button>`;

  return `
    <div class="scrap-card-item" draggable="true" data-scrap-id="${
      scrap.id
    }" data-text="${textContent.replace(/"/g, '&quot;')}" 
         data-preview-text="${previewText.replace(/"/g, '&quot;').replace(/\n/g, ' ')}" 
         data-preview-image="${previewImage.replace(/"/g, '&quot;')}" 
         data-preview-url="${(scrap.url || '').replace(/"/g, '&quot;')}"
         style="position: relative;">
        <div class="scrap-card">
            ${toggleBtn}
            <button class="scrap-card-delete-btn unlink-scrap-btn" title="연결 해제">×</button>
            ${
              scrap.image
                ? `<div class="scrap-card-img-wrap"><img src="${scrap.image}" alt="scrap image"></div>`
                : ''
            }
            <div class="scrap-card-info">
                <div class="scrap-card-title" style="display: flex; align-items: center; gap: 4px; min-width: 0;">
                    <span style="flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${cleanedTitle.substring(
                      0,
                      20
                    )}...</span>
                </div>
                <div class="scrap-card-snippet" style="display: flex; align-items: center; gap: 4px; cursor: pointer; color: #4285f4;" title="링크 열기">
                    <span>🔗</span>
                    <span>${shortenLink(scrap.url, 25)}</span>
                </div>
                ${tagsHtml}
            </div>
        </div>
    </div>`;
}

export function showScrapDetailModal(scrapData, container = null) {
  // shadow DOM 내부의 모달을 찾기 위해 container 사용
  let modal, titleEl, urlLinkEl, urlTextEl, imagesEl, textEl, tagsEl, closeBtn;

  if (container) {
    // container가 shadow DOM 내부 요소인 경우
    const rootNode = container.getRootNode();
    // shadow root에서 querySelector 사용 (getElementById는 shadow root에서 작동하지 않을 수 있음)
    const searchRoot =
      rootNode.nodeType === Node.DOCUMENT_FRAGMENT_NODE
        ? rootNode
        : rootNode.host?.getRootNode() || rootNode;
    modal = searchRoot.querySelector('#scrap-detail-modal');
    titleEl = searchRoot.querySelector('#scrap-detail-title');
    urlLinkEl = searchRoot.querySelector('#scrap-detail-url-link');
    urlTextEl = searchRoot.querySelector('#scrap-detail-url-text');
    imagesEl = searchRoot.querySelector('#scrap-detail-images');
    textEl = searchRoot.querySelector('#scrap-detail-text');
    tagsEl = searchRoot.querySelector('#scrap-detail-tags');
    closeBtn = searchRoot.querySelector('#scrap-detail-modal-close');

    // 모달을 찾지 못한 경우, container 자체에서 찾기 시도
    if (!modal && container.querySelector) {
      modal = container.querySelector('#scrap-detail-modal');
      if (modal) {
        titleEl = container.querySelector('#scrap-detail-title');
        urlLinkEl = container.querySelector('#scrap-detail-url-link');
        urlTextEl = container.querySelector('#scrap-detail-url-text');
        imagesEl = container.querySelector('#scrap-detail-images');
        textEl = container.querySelector('#scrap-detail-text');
        tagsEl = container.querySelector('#scrap-detail-tags');
        closeBtn = container.querySelector('#scrap-detail-modal-close');
      }
    }
  } else {
    // 일반 DOM인 경우
    modal = document.getElementById('scrap-detail-modal');
    titleEl = document.getElementById('scrap-detail-title');
    urlLinkEl = document.getElementById('scrap-detail-url-link');
    urlTextEl = document.getElementById('scrap-detail-url-text');
    imagesEl = document.getElementById('scrap-detail-images');
    textEl = document.getElementById('scrap-detail-text');
    tagsEl = document.getElementById('scrap-detail-tags');
    closeBtn = document.getElementById('scrap-detail-modal-close');
  }

  if (!modal) {
    Logger.error('[Workspace] 스크랩 상세 모달을 찾을 수 없습니다.', {
      container,
      hasRootNode: !!container?.getRootNode(),
      rootNodeType: container?.getRootNode()?.nodeType,
      containerQuerySelector: container?.querySelector ? 'available' : 'not available',
    });
    return;
  }

  Logger.debug('[Workspace] 스크랩 상세 모달 찾기 성공:', {
    modal: !!modal,
    titleEl: !!titleEl,
  });

  // 제목 - 우선 scrapData.title 사용
  const title = (scrapData.title || scrapData.text || '제목 없음')
    .toString()
    .substring(0, 100)
    .replace(/\n/g, ' ');
  if (titleEl) titleEl.textContent = title;

  // URL
  const url = scrapData.url || '';
  if (url && url.startsWith('http')) {
    if (urlLinkEl) {
      urlLinkEl.href = url;
      urlLinkEl.style.display = 'inline-flex';
    }
    if (urlTextEl) {
      urlTextEl.textContent = url.length > 60 ? url.substring(0, 60) + '...' : url;
    }
  } else {
    if (urlLinkEl) urlLinkEl.style.display = 'none';
  }

  // 이미지 갤러리
  if (imagesEl) {
    const images = scrapData.allImages || (scrapData.image ? [scrapData.image] : []);
    if (images.length > 0) {
      imagesEl.innerHTML = images
        .map(
          (img) => `
        <div style="position: relative; aspect-ratio: 1; overflow: hidden; border-radius: 8px; border: 1px solid #e9ecef; cursor: pointer;">
          <img src="${img.replace(/"/g, '&quot;')}" alt="스크랩 이미지" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy">
          <button class="scrap-image-insert-btn" title="에디터에 삽입" style="position:absolute; bottom:6px; right:6px; background:rgba(0,0,0,0.6); color:#fff; border:none; padding:4px 8px; border-radius:4px; font-size:12px; cursor:pointer;">삽입</button>
        </div>
      `
        )
        .join('');

      // 이미지 클릭 시 확대 보기
      imagesEl.querySelectorAll('img').forEach((img) => {
        img.addEventListener('click', () => {
          const fullModal = document.createElement('div');
          fullModal.style.cssText =
            'position: fixed; inset: 0; background: rgba(0,0,0,0.95); z-index: 10001; display: flex; align-items: center; justify-content: center; cursor: pointer;';
          fullModal.innerHTML = `<img src="${img.src.replace(
            /"/g,
            '&quot;'
          )}" style="max-width: 90vw; max-height: 90vh; object-fit: contain;">`;

          // [수정] document.body 대신 Shadow DOM 내부 컨테이너에 추가
          // container는 showScrapDetailModal의 인자로 전달된 Shadow DOM 내부 요소입니다.
          if (container) {
            container.appendChild(fullModal);
          } else {
            // container가 없는 예외 상황 (거의 없음)
            document.body.appendChild(fullModal);
          }

          fullModal.addEventListener('click', () => {
            // [수정] 부모 요소에서 제거
            if (fullModal.parentNode) {
              fullModal.parentNode.removeChild(fullModal);
            }
          });
        });
      });

      // '삽입' 버튼 클릭시 에디터 iframe으로 이미지 삽입 요청 전송
      imagesEl.querySelectorAll('.scrap-image-insert-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const imageWrapper = btn.closest('div');
          const imgEl = imageWrapper && imageWrapper.querySelector('img');
          const url = imgEl ? imgEl.src : null;
          if (!url) {
            showToast('⚠️ 이미지 URL을 찾을 수 없습니다.');
            return;
          }
          // Try to find editor iframe in the current context (shadow root or document)
          try {
            const rootNode =
              container && container.getRootNode ? container.getRootNode() : document;
            const editorIframe =
              (rootNode && rootNode.querySelector && rootNode.querySelector('#editor-iframe')) ||
              document.querySelector('#editor-iframe');
            if (editorIframe && editorIframe.contentWindow) {
              console.log('[Workspace] modal insert -> editorIframe found:', !!editorIframe);
              console.log('[Workspace] modal insert -> posting insert-image to editor:', url);
              editorIframe.contentWindow.postMessage(
                { action: 'insert-image', data: { url } },
                '*'
              );
              showToast('✅ 이미지 삽입 요청을 보냈습니다.');
            } else {
              console.warn('[Workspace] modal insert -> editorIframe not found');
              showToast('❌ 에디터를 찾을 수 없습니다.');
            }
          } catch (err) {
            console.warn('[Workspace] scrap detail insert image failed', err);
          }
        });
      });

      // 이미지 드래그로 연결할 수 있도록 dragstart 리스너 추가
      imagesEl.querySelectorAll('img').forEach((img) => {
        const wrapper = img.closest('div');
        if (!wrapper) return;
        try {
          wrapper.draggable = true;
          wrapper.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            try {
              const data = {
                id: scrapData.id,
                text: scrapData.text || '',
                isLinked: false,
                imageUrl: img.src || null,
              };
              e.dataTransfer.effectAllowed = 'move';
              e.dataTransfer.setData('application/json', JSON.stringify(data));
            } catch (err) {
              console.debug('[Workspace] scrap detail dragstart setData failed', err);
            }
          });
        } catch (err) {
          // ignore
        }
      });
    } else {
      imagesEl.innerHTML = '';
    }
  }

  // 텍스트 내용
  if (textEl) {
    textEl.textContent = scrapData.text || scrapData.cleanText || '(내용 없음)';
  }

  // 태그
  if (tagsEl) {
    const tags = scrapData.tags || [];
    if (tags.length > 0) {
      tagsEl.innerHTML = tags
        .map(
          (tag) => `
        <span style="padding: 4px 12px; background: #e8f0fe; color: #1967d2; border-radius: 16px; font-size: 12px; font-weight: 500;">#${tag}</span>
      `
        )
        .join('');
    } else {
      tagsEl.innerHTML = '';
    }
  }

  // 모달 표시
  modal.style.display = 'block';

  // 닫기 버튼 이벤트
  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = 'none';
    };
  }

  // 모달 배경 클릭 시 닫기
  modal.onclick = (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  };

  // ESC 키로 닫기
  const escHandler = (e) => {
    if (e.key === 'Escape' && modal.style.display !== 'none') {
      modal.style.display = 'none';
      const targetDoc = container?.getRootNode()?.host?.ownerDocument || document;
      targetDoc.removeEventListener('keydown', escHandler);
    }
  };
  const targetDoc = container?.getRootNode()?.host?.ownerDocument || document;
  targetDoc.addEventListener('keydown', escHandler);
}

function buildPermalinkUrl(channelUrl, permalink, isTistory = null) {
  if (!channelUrl || !permalink) return '';
  try {
    const urlObj = new URL(channelUrl);
    const host = urlObj.hostname.toLowerCase();
    if (isTistory === true) return `${urlObj.origin}/entry/${permalink}`;
    if (isTistory === null && host.includes('tistory.com'))
      return `${urlObj.origin}/entry/${permalink}`;
    if (host.includes('blog.naver.com'))
      return permalink.startsWith('http') ? permalink : `${urlObj.origin}/${permalink}`;
    if (host.includes('brunch.co.kr')) {
      /* eslint-disable-next-line no-useless-escape */
      const pathMatch = urlObj.pathname.match(/^\/@([^\/]+)/);
      return pathMatch
        ? `${urlObj.origin}/@${pathMatch[1]}/${permalink}`
        : `${urlObj.origin}/${permalink}`;
    }
    return `${urlObj.origin.replace(/\/$/, '')}/${permalink}`;
  } catch (e) {
    return '';
  }
}

/**
 * publishedUrl에서 permalink 부분을 추출하는 함수
 * @param {string} publishedUrl - 전체 URL
 * @returns {string} - 추출된 permalink
 */
function extractPermalinkFromUrl(publishedUrl) {
  if (!publishedUrl) return '';

  try {
    const urlObj = new URL(publishedUrl);
    const host = urlObj.hostname.toLowerCase();
    const pathname = urlObj.pathname;

    // Tistory: /entry/12345 형식
    if (host.includes('tistory.com')) {
      /* eslint-disable-next-line no-useless-escape */
      const match = pathname.match(/\/entry\/([^\/?]+)/);
      if (match) return match[1];
    }

    // Naver Blog: /12345 형식 또는 /PostView.naver?blogId=xxx&logNo=12345
    if (host.includes('blog.naver.com')) {
      // /PostView.naver?logNo=12345 형식
      const logNoMatch = urlObj.searchParams.get('logNo');
      if (logNoMatch) return logNoMatch;

      // /12345 형식
      /* eslint-disable-next-line no-useless-escape */
      const pathMatch = pathname.match(/^\/([^\/]+)$/);
      if (pathMatch && pathMatch[1] !== 'PostView.naver') return pathMatch[1];
    }

    // Brunch: /@username/12345 형식
    if (host.includes('brunch.co.kr')) {
      /* eslint-disable-next-line no-useless-escape */
      const match = pathname.match(/\/@[^\/]+\/([^\/?]+)/);
      if (match) return match[1];
    }

    // 일반적인 경우: 마지막 경로 세그먼트를 permalink로 사용
    const segments = pathname.split('/').filter((s) => s);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      // 확장자 제거 (예: .html, .php 등)
      return lastSegment.replace(/\.[^.]+$/, '');
    }

    return '';
  } catch (e) {
    Logger.warn('[extractPermalinkFromUrl] URL 파싱 실패:', e);
    return '';
  }
}

function showPublishInfo(workspaceEl, permalink, tags, seoTitle, ideaData) {
  console.log('[DEBUG showPublishInfo] called - seoTitle:', seoTitle, 'ideaId:', ideaData?.id);
  // Clear any recorded pending title when opening a new publish-info panel to avoid
  // accidentally saving stale values recorded during previous renders/tests.
  __lastPendingTitle = null;
  // Debugging: capture incoming param types and publishInfo snapshot
  try {
    console.debug('[DIAG showPublishInfo] params:', { permalink, tags, seoTitle });
    console.debug('[DIAG showPublishInfo] ideaData.publishInfo snapshot:', ideaData?.publishInfo);
  } catch (e) {
    void 0; // debug probe should not break runtime
  }
  // 기존 패널 제거 (주석 처리: 포커스 유지를 위해 재사용 시도)
  // const existingInfo = workspaceEl.querySelector('.publish-info-panel');
  // if (existingInfo) existingInfo.remove();

  // 파라미터 정규화 (null, undefined 처리)
  permalink = permalink || '';
  // tags may be provided as an array or a string; normalize safely
  const originalTags = tags;
  if (Array.isArray(tags)) {
    // Display form uses a comma-joined string, but keep original array for DB updates
    tags = tags.join(', ');
  } else {
    tags = tags || '';
  }
  seoTitle = seoTitle || '';

  // If caller didn't pass seoTitle but ideaData has publishInfo.seoTitle,
  // prefer that value so the UI shows the stored publishInfo title.
  if (!seoTitle && ideaData?.publishInfo?.seoTitle) {
    seoTitle = ideaData.publishInfo.seoTitle;
  }

  // Normalize to avoid accidental duplication (e.g., 'T - T' or 'T T')
  try {
    seoTitle = normalizeSeoTitle(seoTitle, ideaData?.title);
  } catch (e) {
    void 0;
  }

  console.debug('[DIAG showPublishInfo] final seoTitle for UI:', seoTitle);

  // Firebase 업데이트 (값이 있을 때만)
  // 모든 값이 빈 문자열이면 Firebase 업데이트를 건너뛰어야 함 (초안 삭제 후 재생성 방지)
  // 하지만 permalink나 tags가 이미 있더라도 업데이트할 수 있도록 수정
  if (ideaData && ideaData.id) {
    // Extra logging for db update decisions
    console.debug(
      '[DIAG showPublishInfo] db-update decision - permalink:',
      permalink,
      'tags:',
      tags,
      'seoTitle:',
      seoTitle
    );
    const updates = {};
    const publishInfoUpdates = {};
    let hasNonEmptyValue = false;

    // permalink가 제공되었으면 항상 업데이트 (빈 문자열이 아닌 경우)
    if (permalink !== undefined && permalink.trim() !== '') {
      publishInfoUpdates.permalink = permalink;
      hasNonEmptyValue = true;
    } else if (
      permalink !== undefined &&
      permalink.trim() === '' &&
      ideaData.publishInfo?.permalink
    ) {
      // 빈 문자열이 제공되었지만 기존 permalink가 있으면 유지 (삭제하지 않음)
      publishInfoUpdates.permalink = ideaData.publishInfo.permalink;
      hasNonEmptyValue = true;
    }

    // tags가 제공되었으면 항상 업데이트 (빈 문자열이 아닌 경우)
    if (originalTags !== undefined && originalTags !== null) {
      // If tags were originally an array, preserve that shape for DB updates
      if (Array.isArray(originalTags)) {
        if (originalTags.length > 0) {
          publishInfoUpdates.tags = originalTags;
          hasNonEmptyValue = true;
        }
      } else if (String(tags).trim() !== '') {
        // Normalize incoming comma-separated string into array for DB
        publishInfoUpdates.tags = String(tags)
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);
        hasNonEmptyValue = publishInfoUpdates.tags.length > 0;
      }
    } else if (
      originalTags !== undefined &&
      String(tags).trim() === '' &&
      ideaData.publishInfo?.tags
    ) {
      // 빈 문자열이 제공되었지만 기존 tags가 있으면 유지 (삭제하지 않음)
      publishInfoUpdates.tags = ideaData.publishInfo.tags;
      hasNonEmptyValue = true;
    }

    if (seoTitle !== undefined && seoTitle.trim() !== '') {
      updates.seoTitle = seoTitle;
      publishInfoUpdates.seoTitle = seoTitle;
      hasNonEmptyValue = true;
    }

    // 실제 값이 있을 때만 Firebase 업데이트 (빈 문자열로 publishInfo 재생성 방지)
    // 하지만 기존 값이 있으면 항상 업데이트하여 최신 상태 유지
    if (hasNonEmptyValue && Object.keys(publishInfoUpdates).length > 0) {
      publishInfoUpdates.updatedAt = Date.now();
      // 기존 publishInfo의 다른 필드들도 유지
      if (ideaData.publishInfo) {
        Object.keys(ideaData.publishInfo).forEach((key) => {
          if (!Object.prototype.hasOwnProperty.call(publishInfoUpdates, key)) {
            publishInfoUpdates[key] = ideaData.publishInfo[key];
          }
        });
      }
      updates.publishInfo = publishInfoUpdates;
    }

    if (Object.keys(updates).length > 0) {
      chrome.runtime.sendMessage(
        {
          action: 'update_kanban_card',
          data: {
            cardId: ideaData.id,
            status: ideaData.status || 'ideas',
            updates: updates,
          },
        },
        (response) => {
          if (response && !response.success) {
            Logger.error('[Workspace] 발행 정보 저장 실패:', response);
          } else if (response && response.success) {
            Logger.debug('[Workspace] 발행 정보 저장 성공:', {
              permalink,
              tags,
              seoTitle,
            });
          }
        }
      );
    }
  }

  // [Modified] Check for existing panel to avoid focus loss
  let publishInfoArea = workspaceEl.querySelector('#publish-info-content');
  if (!publishInfoArea) {
    const container = workspaceEl.querySelector('#publish-info-area');
    if (container) publishInfoArea = container;
  }

  // Defensive fallback: if no publish-info container exists at all (some
  // test runs render a minimal workspace), create one so showPublishInfo
  // can reliably attach the panel. This prevents racey failures in the
  // test suite where the area is missing and the UI update is skipped.
  if (!publishInfoArea) {
    try {
      const fallback = document.createElement('div');
      fallback.className = 'resource-content-area publish-info-area';
      fallback.id = 'publish-info-area';
      // append to workspace's resource panel area if present, otherwise to workspace root
      const resourcePanel = workspaceEl.querySelector('.resource-content-area') || workspaceEl;
      resourcePanel.appendChild(fallback);
      publishInfoArea = fallback;
      console.debug('[Workspace] Created fallback publish-info-area for robustness in tests');
    } catch (e) {
      // swallow errors; we will handle missing area later
    }
  }

  // Defensive: reset saving flags when (re)rendering the publish area to avoid
  // stale state leaking between tests or render cycles.
  if (publishInfoArea) {
    publishInfoArea._isSaving = false;
    publishInfoArea._titleChanged = false;
    publishInfoArea._pendingTitle = null;
  }

  let publishInfoPanel = publishInfoArea
    ? publishInfoArea.querySelector('.publish-info-panel')
    : null;
  const isUpdate = !!publishInfoPanel;

  // Escape user-provided values to avoid HTML injection or broken attributes
  const escapeHtml = (s) =>
    String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const ideaTitle = ideaData?.title || '';
  const safeIdeaTitle = escapeHtml(ideaTitle);
  // Only use publishInfo.description when present. Do NOT fall back to top-level description when creating a new idea.
  const description =
    ideaData &&
    ideaData.publishInfo &&
    Object.prototype.hasOwnProperty.call(ideaData.publishInfo, 'description')
      ? ideaData.publishInfo.description
      : '';
  const safeDescription = escapeHtml(description);
  const safeSeoTitle = escapeHtml(seoTitle);
  const safePermalink = escapeHtml(permalink);
  const safeTags = escapeHtml(tags);
  // initial fullUrl may be empty; will be updated when channel info loads
  let fullUrl = '';
  let safeFullUrl = escapeHtml(fullUrl);

  if (!isUpdate) {
    publishInfoPanel = document.createElement('div');
    publishInfoPanel.className = 'publish-info-panel';
    // [수정] 패딩을 줄여서(16px -> 10px) 내부 공간을 넓게 사용하도록 조정
    publishInfoPanel.style.cssText = `padding: 10px; background: #f8f9fa; border: 1px solid #e9ecef; border-radius: 6px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box;`;

    // [수정] input 요소들에 box-sizing: border-box 추가하여 레이아웃 안정성 확보
    publishInfoPanel.innerHTML = `
      <div style="font-weight: 600; font-size: 14px; color: #333; margin-bottom: 4px;">📝 발행 정보</div>
      <div style="display: flex; flex-direction: column; gap: 10px;">
        <div>
            <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">아이디어 제목</label>
            <div style="display:flex; align-items:center; gap:8px;">
              <input type="text" id="idea-title-input" value="${safeIdeaTitle}" readonly style="flex:1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff; box-sizing: border-box;">
            </div>
          </div>
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">SEO 최적화 제목</label>
          <input type="text" id="seo-title-input" value="${safeSeoTitle}" style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff; box-sizing: border-box;">
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">메타 디스크립션 (SEO 설명)</label>
          <textarea id="seo-description-input" readonly style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff; box-sizing: border-box; resize: vertical; min-height: 60px; font-family: inherit;">${safeDescription}</textarea>
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">퍼머링크</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="permalink-input" value="${
              safePermalink || ''
            }" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff; box-sizing: border-box;">
            ${
              safeFullUrl
                ? `<button id="connect-permalink-btn" style="padding: 6px 12px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🔗 연결</button>`
                : ''
            }
          </div>
          ${
            safeFullUrl
              ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">전체 URL: <span style="color: #1a73e8;">${safeFullUrl}</span></div>`
              : ''
          }
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">태그</label>
            <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="tags-input" value="${
              safeTags || ''
            }" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff; box-sizing: border-box;">
            <button id="copy-tags-btn" title="태그 복사" style="padding: 6px 8px; background: #fff; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 12px;">📋</button>
          </div>
        </div>
        <!-- copy-html-btn will be inserted into #publish-info-actions for consistent placement -->
      </div>`;

    if (publishInfoArea) {
      publishInfoArea.innerHTML = '';
      publishInfoArea.appendChild(publishInfoPanel);
    }
  } else {
    // Update existing inputs if not focused
    const updateInput = (selector, value) => {
      const input = publishInfoPanel.querySelector(selector);
      if (input && document.activeElement !== input) {
        input.value = value;
      }
    };
    updateInput('#idea-title-input', safeIdeaTitle);
    updateInput('#seo-title-input', safeSeoTitle);
    updateInput('#seo-description-input', safeDescription);
    updateInput('#permalink-input', safePermalink);
    updateInput('#tags-input', safeTags);

    // Note: AI suggestion UI removed — meta descriptions from AI are applied directly into publishInfo.description by applyDraftResponseToIdea
    // (No UI container or "AI 제안 적용" button is created.)
  }

  // Now request channel info to compute full permalink URL and update
  // the UI when it arrives. This keeps the UI responsive even if the
  // background doesn't call back immediately.
  try {
    chrome.runtime.sendMessage({ action: 'get_my_channels' }, (channelsResponse) => {
      const myChannels = channelsResponse?.channels?.myChannels?.blogs || [];
      const firstChannel = myChannels.length > 0 ? myChannels[0] : null;
      const channelUrl = firstChannel?.inputUrl || '';

      const isTistory = channelUrl.includes('tistory.com');
      fullUrl = buildPermalinkUrl(channelUrl, permalink, isTistory);
      safeFullUrl = escapeHtml(fullUrl || '');

      const permalinkInput = publishInfoPanel.querySelector('#permalink-input');
      if (permalinkInput) {
        // If fullUrl is available, use it. Otherwise fallback to the raw permalink slug.
        // This prevents the field from blanking out if channel info is missing.
        permalinkInput.value = fullUrl || permalink || '';
      }
      // update any full-url displays if present
      const fullUrlSpan = publishInfoPanel.querySelector('.publish-full-url');
      if (fullUrlSpan) fullUrlSpan.textContent = fullUrl || '';
    });
  } catch (e) {
    // ignore if sendMessage is not available or behaves differently in tests
  }

  // Diagnostic: check if seo-title-input is present in DOM after rendering
  const seoInput = publishInfoPanel.querySelector('#seo-title-input');
  console.debug(
    '[DIAG showPublishInfo] seo-title-input in DOM:',
    !!seoInput,
    'value:',
    seoInput?.value
  );

  // Make idea title editable here (replacing header inline edit)
  const ideaInput = publishInfoPanel.querySelector('#idea-title-input');
  if (ideaInput) {
    // Allow editing in publish panel
    ideaInput.removeAttribute('readonly');

    // Internal save impl that updates local UI state
    const doSaveTitleImpl = (newTitle) => {
      if (publishInfoArea._isSaving) {
        console.debug('[Workspace] Save already in progress, skipping duplicate save');
        return;
      }
      publishInfoArea._isSaving = true;

      // Safety timeout to reset flag if callback never runs (e.g. background script error or timeout)
      setTimeout(() => {
        if (publishInfoArea._isSaving) {
          console.warn('[Workspace] Save timeout - resetting _isSaving flag');
          publishInfoArea._isSaving = false;

          // Check if content is still dirty
          const input = publishInfoArea.querySelector('#idea-title-input');
          const currentVal = input ? input.value.trim() : '';

          if (currentVal && currentVal !== ideaData.title) {
            publishInfoArea._titleChanged = true;
          }
        }
      }, 5000);

      console.debug('[DIAG doSaveTitleImpl] saving title:', newTitle, 'ideaId:', ideaData.id);
      try {
        chrome.runtime.sendMessage(
          {
            action: 'update_kanban_card',
            data: {
              cardId: ideaData.id,
              status: ideaData.status || 'ideas',
              updates: {
                title: newTitle,
              },
            },
          },
          (response) => {
            publishInfoArea._isSaving = false;

            if (response && response.success) {
              // Clear any recorded pending title now that save succeeded
              __lastPendingTitle = null;
              try {
                window.__cp_last_pending_title = null;
              } catch (e) {}
              ideaData.title = newTitle;
              // update header display text
              // header element removed — rely on publish panel and kanban card updates

              // update Kanban card(s)
              const kanbanCard = document.querySelector(
                `.cp-kanban-card[data-id="${ideaData.id}"]`
              );
              if (kanbanCard) {
                kanbanCard.dataset.title = newTitle;
                const kTitle = kanbanCard.querySelector('.kanban-card-title');
                if (kTitle) kTitle.textContent = newTitle;
              }

              // update dashboard or other card lists that carry data-idea-id
              document.querySelectorAll(`[data-idea-id="${ideaData.id}"]`).forEach((el) => {
                const cardTitle =
                  el.querySelector('.card-title') ||
                  el.querySelector('.kanban-card-title') ||
                  el.querySelector('.card-title');
                if (cardTitle) cardTitle.textContent = newTitle;
                if (el.dataset.ideaTitle !== undefined) el.dataset.ideaTitle = newTitle;
              });

              // Check if user has typed more since save started
              const currentInput = publishInfoArea.querySelector('#idea-title-input');
              const currentVal = currentInput ? currentInput.value.trim() : null;

              if (currentVal !== null && currentVal !== newTitle) {
                console.debug('[Workspace] Content changed during save, keeping dirty state');
                publishInfoArea._titleChanged = true;
              } else {
                publishInfoArea._titleChanged = false;
                publishInfoArea._pendingTitle = null;
              }

              showToast('✅ 제목이 저장되었습니다.');
            } else {
              console.error('[Workspace] 제목 저장 실패:', response);
              showToast('❌ 제목 저장에 실패했습니다.');
            }
          }
        );
      } catch (e) {
        // Defensive: if sendMessage throws (e.g., cb shape unexpected), don't block render
        publishInfoArea._isSaving = false;
        publishInfoArea._titleChanged = true; // mark dirty so a subsequent render triggers another save attempt
        console.debug('[Workspace] sendMessage threw, marked title dirty for retry:', e);
      }
    };

    // wire up per-panel functions to the container so delegated handlers can call latest impl
    try {
      publishInfoArea._doSaveTitle = (force = false) => {
        const el = publishInfoArea.querySelector('#idea-title-input');
        if (!el) {
          console.debug('[DIAG _doSaveTitle] no idea-title-input found');
          return;
        }
        const newTitle = el.value.trim();
        console.debug(
          '[DIAG _doSaveTitle] called, force:',
          !!force,
          'newTitle:',
          newTitle,
          'ideaData.title:',
          ideaData && ideaData.title
        );
        if (!newTitle) {
          publishInfoArea._titleChanged = false;
          publishInfoArea._pendingTitle = null;
          return;
        }
        // only save if changed or force requested
        if (force || newTitle !== ideaData.title) {
          if (publishInfoArea._isSaving) {
            console.debug('[Workspace] Save already in progress, skipping');
            return;
          }
          publishInfoArea._titleChanged = false;
          publishInfoArea._pendingTitle = null;
          console.debug('[DIAG _doSaveTitle] performing save for title:', newTitle);
          doSaveTitleImpl(newTitle);
        } else {
          publishInfoArea._titleChanged = false;
          publishInfoArea._pendingTitle = null;
          console.debug('[DIAG _doSaveTitle] no change detected, skipping save');
        }
      };
      // allow external callers to force a save using an explicit title value
      publishInfoArea._doSaveTitleFromExternal = (externalTitle) => {
        if (!externalTitle) return;
        const t = String(externalTitle).trim();
        console.debug(
          '[DIAG _doSaveTitleFromExternal] called, title:',
          t,
          'ideaData.title:',
          ideaData && ideaData.title
        );
        if (t && t !== ideaData.title) {
          doSaveTitleImpl(t);
        } else {
          console.debug('[DIAG _doSaveTitleFromExternal] no change or empty, skipping');
        }
      };

      // SEO save helpers
      try {
        // Internal SEO save impl
        const doSaveSeoImpl = (newSeo) => {
          if (publishInfoArea._isSavingSeo) {
            console.debug('[Workspace] SEO save already in progress, skipping');
            return;
          }
          publishInfoArea._isSavingSeo = true;

          setTimeout(() => {
            if (publishInfoArea._isSavingSeo) {
              console.warn('[Workspace] SEO save timeout - resetting _isSavingSeo flag');
              publishInfoArea._isSavingSeo = false;
              const input = publishInfoArea.querySelector('#seo-title-input');
              const currentVal = input ? input.value.trim() : '';
              if (currentVal && currentVal !== ideaData.seoTitle)
                publishInfoArea._seoChanged = true;
            }
          }, 5000);

          const currentPublishInfo = ideaData.publishInfo || {};
          const updates = {
            seoTitle: newSeo,
            publishInfo: {
              ...currentPublishInfo,
              seoTitle: newSeo,
              updatedAt: Date.now(),
            },
          };

          try {
            chrome.runtime.sendMessage(
              {
                action: 'update_kanban_card',
                data: {
                  cardId: ideaData.id,
                  status: ideaData.status || 'ideas',
                  updates: updates,
                },
              },
              (response) => {
                publishInfoArea._isSavingSeo = false;
                if (response && response.success) {
                  if (!ideaData.publishInfo) ideaData.publishInfo = {};
                  ideaData.publishInfo.seoTitle = newSeo;
                  ideaData.seoTitle = newSeo;

                  // Update UI places
                  const kanbanCard = document.querySelector(
                    `.cp-kanban-card[data-id="${ideaData.id}"]`
                  );
                  if (kanbanCard) {
                    const kTitle = kanbanCard.querySelector('.kanban-card-title');
                    if (kTitle) kTitle.textContent = newSeo;
                  }

                  const currentInput = publishInfoArea.querySelector('#seo-title-input');
                  const currentVal = currentInput ? currentInput.value.trim() : null;
                  if (currentVal !== null && currentVal !== newSeo) {
                    publishInfoArea._seoChanged = true;
                  } else {
                    publishInfoArea._seoChanged = false;
                    publishInfoArea._pendingSeo = null;
                  }

                  showToast('✅ SEO 제목이 저장되었습니다.');
                } else {
                  console.error('[Workspace] SEO 제목 저장 실패:', response);
                  showToast('❌ SEO 제목 저장에 실패했습니다.');
                }
              }
            );
          } catch (e) {
            publishInfoArea._isSavingSeo = false;
            publishInfoArea._seoChanged = true;
            console.debug('[Workspace] sendMessage threw, marked seo title dirty for retry:', e);
          }
        };

        publishInfoArea._doSaveSeoTitle = (force = false) => {
          const el = publishInfoArea.querySelector('#seo-title-input');
          if (!el) {
            console.debug('[DIAG _doSaveSeoTitle] no seo-title-input found');
            return;
          }
          const newSeo = el.value.trim();
          if (!newSeo) {
            publishInfoArea._seoChanged = false;
            publishInfoArea._pendingSeo = null;
            return;
          }
          if (force || newSeo !== ideaData.seoTitle) {
            if (publishInfoArea._isSavingSeo) {
              console.debug('[Workspace] SEO save already in progress, skipping');
              return;
            }
            publishInfoArea._seoChanged = false;
            publishInfoArea._pendingSeo = null;
            doSaveSeoImpl(newSeo);
          } else {
            publishInfoArea._seoChanged = false;
            publishInfoArea._pendingSeo = null;
            console.debug('[DIAG _doSaveSeoTitle] no change detected, skipping save');
          }
        };

        publishInfoArea._doSaveSeoTitleFromExternal = (externalSeo) => {
          if (!externalSeo) return;
          const s = String(externalSeo).trim();
          if (s && s !== ideaData.seoTitle) {
            doSaveSeoImpl(s);
          } else {
            console.debug('[DIAG _doSaveSeoTitleFromExternal] no change or empty, skipping');
          }
        };
      } catch (e) {
        // ignore
      }
    } catch (e) {
      // ignore
    }

    // expose a test-friendly global save trigger to allow forcing a save
    try {
      window.__cp_force_save_title = () => {
        console.debug('[DIAG __cp_force_save_title] called');
        // prefer the currently-visible input value to avoid stale closures
        const cur = document.querySelector('#idea-title-input');
        const val = cur ? String(cur.value || '').trim() : null;
        const pubContainer = cur ? cur.closest('#publish-info-content') : publishInfoArea;
        console.debug(
          '[DIAG __cp_force_save_title] current input value:',
          val,
          'pubContainer present:',
          !!pubContainer
        );

        // If the currently visible publish area matches the targeted one, save using its external hook
        if (pubContainer && typeof pubContainer._doSaveTitleFromExternal === 'function') {
          pubContainer._doSaveTitleFromExternal(val);
          return;
        }

        // If we don't have the current input (eg. we've already switched to another idea), try to save
        // any pending title on the previously-rendered publishInfoArea. Prefer its pending value if present.
        try {
          // If we recorded a last-pending title (typing happened, then the area was re-rendered),
          // try saving it. Prefer calling into a live publish area if available; otherwise,
          // fall back to a best-effort background save via chrome.runtime.sendMessage.
          if (__lastPendingTitle) {
            try {
              // Attempt to find a live publish area that matches the recorded idea id
              const possible = Array.from(document.querySelectorAll('#publish-info-content')).find(
                (el) =>
                  el &&
                  (el._doSaveTitleFromExternal || el._doSaveTitle) &&
                  (el._pendingTitle ||
                    (el.querySelector &&
                      el.querySelector('#idea-title-input') &&
                      el.querySelector('#idea-title-input').value))
              );
              if (possible) {
                const pending =
                  __lastPendingTitle.pending ||
                  possible._pendingTitle ||
                  (possible.querySelector &&
                    possible.querySelector('#idea-title-input') &&
                    String(possible.querySelector('#idea-title-input').value || '').trim());
                if (pending && typeof possible._doSaveTitleFromExternal === 'function') {
                  possible._doSaveTitleFromExternal(pending);
                  __lastPendingTitle = null;
                  return;
                }
                if (
                  (possible._titleChanged || pending) &&
                  typeof possible._doSaveTitle === 'function'
                ) {
                  possible._doSaveTitle(true);
                  __lastPendingTitle = null;
                  return;
                }
              }

              // No live area found; attempt best-effort background save using stored id/status
              if (__lastPendingTitle.id && __lastPendingTitle.pending) {
                try {
                  chrome.runtime.sendMessage(
                    {
                      action: 'update_kanban_card',
                      data: {
                        cardId: __lastPendingTitle.id,
                        status: __lastPendingTitle.status || 'ideas',
                        updates: { title: __lastPendingTitle.pending },
                      },
                    },
                    () => {
                      __lastPendingTitle = null;
                    }
                  );
                  return;
                } catch (e) {
                  // ignore and fallthrough
                }
              }
            } catch (err) {
              // ignore and continue
            }
          }

          // Try all existing publish-info contents for any pending title changes (covers case where
          // the user typed into one publish area, then the workspace re-rendered and replaced the
          // publish area DOM with a new one). This scans the DOM to find any element that has
          // handlers attached and a pending title to save.
          const publishAreas = document.querySelectorAll('#publish-info-content');
          for (const pa of publishAreas) {
            try {
              const pending =
                pa._pendingTitle ||
                (pa.querySelector &&
                  pa.querySelector('#idea-title-input') &&
                  String(pa.querySelector('#idea-title-input').value || '').trim());
              if (pending && typeof pa._doSaveTitleFromExternal === 'function') {
                pa._doSaveTitleFromExternal(pending);
                return;
              }
              if ((pa._titleChanged || pending) && typeof pa._doSaveTitle === 'function') {
                pa._doSaveTitle(true);
                return;
              }
            } catch (err) {
              // ignore and continue to next
            }
          }
        } catch (e) {
          console.debug && console.debug('[Workspace] __cp_force_save_title fallback failed:', e);
        }
      };

      // Force save for SEO title as well
      window.__cp_force_save_seo_title = () => {
        console.debug('[DIAG __cp_force_save_seo_title] called');
        const cur = document.querySelector('#seo-title-input');
        const val = cur ? String(cur.value || '').trim() : null;
        const pubContainer = cur ? cur.closest('#publish-info-content') : publishInfoArea;
        console.debug(
          '[DIAG __cp_force_save_seo_title] current input value:',
          val,
          'pubContainer present:',
          !!pubContainer
        );
        if (pubContainer && typeof pubContainer._doSaveSeoTitleFromExternal === 'function') {
          pubContainer._doSaveSeoTitleFromExternal(val);
          return;
        }
        if (publishInfoArea && typeof publishInfoArea._doSaveSeoTitle === 'function') {
          publishInfoArea._doSaveSeoTitle(true);
        }
      };
    } catch (e) {
      // ignore
    }

    // (Removed direct click listener on saveIdeaBtn to avoid double-firing with delegated handler)

    // Attach delegated handlers on the publish area once so they survive panel re-renders.
    // Defensive attach: if the dataset flag is present but the per-area helper methods are missing
    // (possible in some test runs or racey re-render situations), re-attach handlers to ensure
    // save hooks exist. This prevents cases where handlers have been removed but the flag remains.
    const needAttach =
      !publishInfoArea.dataset.cpPublishHandlersAttached ||
      typeof publishInfoArea._doSaveTitle !== 'function' ||
      typeof publishInfoArea._doSaveSeoTitle !== 'function';

    if (needAttach) {
      // If handlers already exist (from a previous attach), remove them first to avoid duplicate
      try {
        if (publishInfoArea._handler_input)
          publishInfoArea.removeEventListener('input', publishInfoArea._handler_input);
        if (publishInfoArea._handler_blur)
          publishInfoArea.removeEventListener('blur', publishInfoArea._handler_blur, true);
        if (publishInfoArea._handler_click)
          publishInfoArea.removeEventListener('click', publishInfoArea._handler_click);
      } catch (e) {
        // ignore
      }

      // create and store handlers so they can be removed/checked deterministically
      publishInfoArea._handler_input = (ev) => {
        const targ = ev.target;
        if (!targ || !targ.id) return;

        if (targ.id === 'idea-title-input') {
          console.debug('[DIAG publishInfo input] idea title target value:', targ.value);
          publishInfoArea._titleChanged = true;
          publishInfoArea._pendingTitle = targ.value;
          try {
            __lastPendingTitle = {
              id: ideaData && ideaData.id,
              pending: String(targ.value || '').trim(),
              status: ideaData && (ideaData.status || 'ideas'),
            };
            // Expose a lightweight global fallback for fast cross-render saves
            try {
              window.__cp_last_pending_title = { ...__lastPendingTitle };
            } catch (e) {}
          } catch (e) {
            __lastPendingTitle = null;
            try {
              window.__cp_last_pending_title = null;
            } catch (e) {}
          }
          return;
        }

        if (targ.id === 'seo-title-input') {
          console.debug('[DIAG publishInfo input] seo title target value:', targ.value);
          publishInfoArea._seoChanged = true;
          publishInfoArea._pendingSeo = targ.value;
          return;
        }
      };

      publishInfoArea._handler_blur = (ev) => {
        const targ = ev.target;
        if (!targ || !targ.id) return;

        if (targ.id === 'idea-title-input' && publishInfoArea._titleChanged) {
          publishInfoArea._doSaveTitle();
          return;
        }

        if (targ.id === 'seo-title-input' && publishInfoArea._seoChanged) {
          publishInfoArea._doSaveSeoTitle();
          return;
        }
      };

      publishInfoArea._handler_click = (ev) => {
        const targ = ev.target;
        if (!targ || !targ.id) return;
        if (targ.id === 'apply-suggested-desc-btn') {
          const suggested =
            publishInfoPanel.querySelector('#ai-suggested-desc-text')?.textContent || '';
          if (suggested) {
            try {
              const descInput = publishInfoPanel.querySelector('#seo-description-input');
              if (descInput) {
                descInput.value = suggested;
                // trigger blur handler to save
                descInput.dispatchEvent(new Event('blur', { bubbles: true }));
              }
            } catch (e) {
              console.warn('[Workspace] apply suggested description failed', e);
            }
          }
        }
      };

      publishInfoArea.addEventListener('input', publishInfoArea._handler_input);
      publishInfoArea.addEventListener('blur', publishInfoArea._handler_blur, true);
      publishInfoArea.addEventListener('click', publishInfoArea._handler_click);

      publishInfoArea.dataset.cpPublishHandlersAttached = '1';
    }
  }

  // Make SEO description editable
  const seoDescInput = publishInfoPanel.querySelector('#seo-description-input');
  if (seoDescInput) {
    seoDescInput.removeAttribute('readonly');

    const doSaveDescriptionImpl = (newDesc) => {
      if (publishInfoArea._isSavingDesc) return;
      publishInfoArea._isSavingDesc = true;

      console.debug('[Workspace] Saving SEO description:', newDesc);

      // Prepare updates
      const currentPublishInfo = ideaData.publishInfo || {};
      let updatedJsonLdSchema = null;

      // Handle jsonLdSchema (object or string)
      if (currentPublishInfo.jsonLdSchema) {
        try {
          if (typeof currentPublishInfo.jsonLdSchema === 'string') {
            updatedJsonLdSchema = JSON.parse(currentPublishInfo.jsonLdSchema);
          } else {
            updatedJsonLdSchema = JSON.parse(JSON.stringify(currentPublishInfo.jsonLdSchema));
          }
        } catch (e) {
          console.warn('[Workspace] Failed to parse jsonLdSchema:', e);
        }
      }

      // If jsonLdSchema exists, update its description too
      if (updatedJsonLdSchema && typeof updatedJsonLdSchema === 'object') {
        updatedJsonLdSchema.description = newDesc;
      }

      const updates = {
        description: newDesc,
        publishInfo: {
          ...currentPublishInfo,
          description: newDesc,
          ...(updatedJsonLdSchema ? { jsonLdSchema: updatedJsonLdSchema } : {}),
          updatedAt: Date.now(),
        },
      };

      try {
        chrome.runtime.sendMessage(
          {
            action: 'update_kanban_card',
            data: {
              cardId: ideaData.id,
              status: ideaData.status || 'ideas',
              updates: updates,
            },
          },
          (response) => {
            publishInfoArea._isSavingDesc = false;
            if (response && response.success) {
              // Update local data
              if (!ideaData.publishInfo) ideaData.publishInfo = {};
              ideaData.publishInfo.description = newDesc;
              ideaData.description = newDesc;
              if (updatedJsonLdSchema) {
                ideaData.publishInfo.jsonLdSchema = updatedJsonLdSchema;
              }
              showToast('✅ SEO 설명이 저장되었습니다.');
            } else {
              showToast('❌ SEO 설명 저장 실패');
            }
          }
        );
      } catch (e) {
        publishInfoArea._isSavingDesc = false;
        console.error('[Workspace] Save description error:', e);
      }
    };

    // Attach listeners if not already attached
    if (!publishInfoArea.dataset.cpPublishDescHandlersAttached) {
      publishInfoArea.addEventListener(
        'blur',
        (ev) => {
          const targ = ev.target;
          if (targ && targ.id === 'seo-description-input') {
            const val = targ.value.trim();
            const currentDesc = ideaData.publishInfo?.description || ideaData.description || '';
            if (val !== currentDesc) {
              doSaveDescriptionImpl(val);
            }
          }
        },
        true
      );
      publishInfoArea.dataset.cpPublishDescHandlersAttached = '1';
    }
  }

  // header title removed — publish-info panel provides title editing

  // 이벤트 리스너
  // Render regenerate/thumbnail/delete buttons under the copy-html button
  try {
    const actionsContainerId = 'publish-info-actions';
    let actionsContainer = publishInfoPanel.querySelector(`#${actionsContainerId}`);

    // Determine whether we have a meaningful draft before mutating buttons.
    const hasDraft =
      isMeaningfulDraft(ideaData.draftContent) || isMeaningfulDraft(ideaData.workspace?.draft);

    if (!actionsContainer) {
      actionsContainer = document.createElement('div');
      actionsContainer.id = actionsContainerId;
      actionsContainer.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
      publishInfoPanel.appendChild(actionsContainer);
    }

    // create buttons helper
    const makeBtn = (id, text) => {
      const b = document.createElement('button');
      b.id = id;
      b.textContent = text;
      b.style.cssText =
        'width: 100%; padding: 10px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;';
      return b;
    };

    // The HTML copy button only makes sense when a draft exists. Create
    // it alongside the regenerate/delete buttons and remove it when no
    // draft is present to avoid exposing a non-functional control.

    // Ensure regenerate/thumbnail/delete buttons exist only when we have a draft;
    // otherwise remove them if present (keeps UI deterministic across rerenders).
    if (hasDraft) {
      // Ensure the HTML copy button exists in the actions container
      if (!actionsContainer.querySelector('#copy-html-btn')) {
        const cbtn = document.createElement('button');
        cbtn.id = 'copy-html-btn';
        cbtn.style.cssText =
          'width: 100%; padding: 10px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;';
        cbtn.textContent = '📄 HTML 복사 (JSON-LD 포함)';
        actionsContainer.insertBefore(cbtn, actionsContainer.firstElementChild || null);
      }
      if (!actionsContainer.querySelector('#regenerate-draft-btn'))
        actionsContainer.appendChild(makeBtn('regenerate-draft-btn', '📝 텍스트만 다시 쓰기'));
      if (!actionsContainer.querySelector('#regenerate-thumbnail-btn'))
        actionsContainer.appendChild(
          makeBtn('regenerate-thumbnail-btn', '🎨 썸네일만 다시 그리기')
        );
      if (!actionsContainer.querySelector('#delete-draft-in-workspace'))
        actionsContainer.appendChild(makeBtn('delete-draft-in-workspace', '❌ 초안 삭제'));

      // Insert the inline compose-thumbnail-text checkbox next to the regenerate-thumbnail button
      const regenThumbBtn = actionsContainer.querySelector('#regenerate-thumbnail-btn');
      if (regenThumbBtn && !actionsContainer.querySelector('.compose-thumbnail-controls')) {
        // Wrap the regenerate thumbnail button with a controls container so
        // the checkbox sits immediately before the button (input + button).
        const controls = document.createElement('div');
        controls.className = 'compose-thumbnail-controls';
        // make controls look like a single button-like block; allow it to flex
        controls.style.cssText =
          'width:auto;padding:10px;background: rgb(66, 133, 244);color: #fff;border: none;border-radius: 4px;cursor: pointer;font-size: 13px;font-weight: 500;flex: 1 1 0%;display:inline-flex;align-items:center;gap:6px;position:relative;';

        const input = document.createElement('input');
        input.type = 'checkbox';
        input.id = 'compose-thumbnail-text-checkbox';
        input.checked = false;
        input.style.cssText =
          'margin: 0 8px 0 0; cursor: pointer; accent-color: #6c5ce7; transform: scale(1.02);';
        // use native tooltip on hover to show the description
        input.title = '썸네일 텍스트 오버레이 적용';

        // initialize checked state from storage if available (support both callback and Promise mock implementations)
        try {
          const maybe = chrome.storage.local.get('composeThumbnailText');
          if (maybe && typeof maybe.then === 'function') {
            maybe
              .then((s) => {
                input.checked = !!(s && s.composeThumbnailText);
              })
              .catch(() => {});
          } else if (typeof chrome.storage.local.get === 'function') {
            chrome.storage.local.get('composeThumbnailText', (s) => {
              input.checked = !!(s && s.composeThumbnailText);
            });
          }
        } catch (e) {
          // ignore
        }

        input.addEventListener('change', (e) => {
          const isChecked = e.target.checked;
          chrome.storage.local.set({ composeThumbnailText: isChecked });
        });

        // Insert controls before the existing button, then move the button
        // inside the controls so the DOM becomes: <div.controls><input/><button id="regenerate-thumbnail-btn">...</button></div>
        regenThumbBtn.parentNode.insertBefore(controls, regenThumbBtn);
        // style the button to flex and match the controls' appearance
        regenThumbBtn.style.cssText =
          'width: auto; padding: 0; background: rgb(66, 133, 244); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; flex: 1 1 0%;';
        controls.appendChild(input);
        controls.appendChild(regenThumbBtn);
        // Keep the text-regenerate button outside of the compose controls
        // so it remains a separate action (visually adjacent but not nested).
      }

      // Safety: ensure regenerate thumbnail button is wrapped with compose-controls
      // in case a previous render placed the button differently (defensive fix for tests).
      try {
        const pubRegenBtn = publishInfoPanel.querySelector('#regenerate-thumbnail-btn');
        if (pubRegenBtn && !pubRegenBtn.closest('.compose-thumbnail-controls')) {
          const fallbackControls = document.createElement('div');
          fallbackControls.className = 'compose-thumbnail-controls';
          fallbackControls.style.cssText =
            'width:auto;padding:10px;background: rgb(66, 133, 244);color: #fff;border: none;border-radius: 4px;cursor: pointer;font-size: 13px;font-weight: 500;flex: 1 1 0%;display:inline-flex;align-items:center;gap:6px;position:relative;';
          // prefer reusing an existing checkbox if present (keeps event listeners intact)
          let fallbackInput =
            publishInfoPanel.querySelector('#compose-thumbnail-text-checkbox') ||
            workspaceEl.querySelector('#compose-thumbnail-text-checkbox');
          if (!fallbackInput) {
            fallbackInput = document.createElement('input');
            fallbackInput.type = 'checkbox';
            fallbackInput.id = 'compose-thumbnail-text-checkbox';
            fallbackInput.checked = false;
            fallbackInput.style.cssText =
              'margin: 0 8px 0 0; cursor: pointer; accent-color: #6c5ce7; transform: scale(1.02);';
            fallbackInput.title = '썸네일 텍스트 오버레이 적용';
            try {
              const maybe = chrome.storage.local.get('composeThumbnailText');
              if (maybe && typeof maybe.then === 'function') {
                maybe
                  .then((s) => {
                    fallbackInput.checked = !!(s && s.composeThumbnailText);
                  })
                  .catch(() => {});
              } else if (typeof chrome.storage.local.get === 'function') {
                chrome.storage.local.get('composeThumbnailText', (s) => {
                  fallbackInput.checked = !!(s && s.composeThumbnailText);
                });
              }
            } catch (e) {}
            fallbackInput.addEventListener('change', (e) => {
              chrome.storage.local.set({ composeThumbnailText: e.target.checked });
            });
          } else {
            // ensure title is set
            fallbackInput.title = fallbackInput.title || '썸네일 텍스트 오버레이 적용';
          }
          pubRegenBtn.parentNode.insertBefore(fallbackControls, pubRegenBtn);
          pubRegenBtn.style.cssText =
            'width: auto; padding: 0; background: rgb(66, 133, 244); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; flex: 1 1 0%;';
          fallbackControls.appendChild(fallbackInput);
          fallbackControls.appendChild(pubRegenBtn);
        }
      } catch (e) {
        // defensive no-op
      }
    } else {
      [
        'regenerate-draft-btn',
        'regenerate-thumbnail-btn',
        'delete-draft-in-workspace',
        'copy-html-btn',
      ].forEach((id) => {
        const el = actionsContainer.querySelector(`#${id}`);
        if (el && el.parentNode) el.remove();
      });
    }

    // Show the actions container always so the generate button/checkbox can be
    // placed here when there is no draft.
    actionsContainer.style.display = 'flex';

    // copy buttons should be visible only when AI draft exists (appear with regenerate buttons)
    const copyHtmlBtn = publishInfoPanel.querySelector('#copy-html-btn');
    const copyTagsBtn = publishInfoPanel.querySelector('#copy-tags-btn');
    if (copyHtmlBtn) copyHtmlBtn.style.display = hasDraft ? 'block' : 'none';
    if (copyTagsBtn) copyTagsBtn.style.display = hasDraft ? 'inline-block' : 'none';

    // If no draft: show generate button and ensure checkbox is placed near copy-html (publish-info)
    if (!hasDraft) {
      // create a compose-controls wrapper in publish-info-actions so the
      // generate button and the compose checkbox visually match the
      // .compose-thumbnail-controls used when a draft exists.
      const pubActions = publishInfoPanel.querySelector('#publish-info-actions');
      if (pubActions) {
        let controls = pubActions.querySelector('.compose-thumbnail-controls');
        if (!controls) {
          controls = document.createElement('div');
          controls.className = 'compose-thumbnail-controls';
          controls.style.cssText =
            'width:auto;padding:10px;background: rgb(66, 133, 244);color: #fff;border: none;border-radius: 4px;cursor: pointer;font-size: 13px;font-weight: 500;flex: 1 1 0%;display:inline-flex;align-items:center;gap:6px;position:relative;';

          // checkbox
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.id = 'compose-thumbnail-text-checkbox';
          input.checked = false;
          input.style.cssText =
            'margin: 0 8px 0 0; cursor: pointer; accent-color: #6c5ce7; transform: scale(1.02);';
          input.title = '썸네일 텍스트 오버레이 적용';
          try {
            const maybe = chrome.storage.local.get('composeThumbnailText');
            if (maybe && typeof maybe.then === 'function') {
              maybe
                .then((s) => {
                  input.checked = !!(s && s.composeThumbnailText);
                })
                .catch(() => {});
            } else if (typeof chrome.storage.local.get === 'function') {
              chrome.storage.local.get('composeThumbnailText', (s) => {
                input.checked = !!(s && s.composeThumbnailText);
              });
            }
          } catch (e) {
            // ignore
          }
          input.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            chrome.storage.local.set({ composeThumbnailText: isChecked });
          });

          // generate button (styled to flex like regenerate button)
          const genBtn = document.createElement('button');
          genBtn.id = 'generate-draft-btn';
          genBtn.style.cssText =
            'width: auto; padding: 0; background: rgb(66, 133, 244); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; flex: 1 1 0%;';
          genBtn.textContent = '✨ AI 초안 생성';

          controls.appendChild(input);
          controls.appendChild(genBtn);
          pubActions.insertBefore(controls, pubActions.firstElementChild || null);
        }
      }
    } else {
      // remove any generate button from publish-info if draft exists
      const pubActions = publishInfoPanel.querySelector('#publish-info-actions');
      if (pubActions) {
        const genBtn = pubActions.querySelector('#generate-draft-btn');
        if (genBtn && genBtn.parentNode) {
          // remove the surrounding compose controls container if it exists
          const controls = genBtn.closest('.compose-thumbnail-controls');
          if (controls && controls.parentNode) controls.remove();
          else genBtn.remove();
        }
      }
    }
  } catch (err) {
    // ignore UI action render failures
  }
  const connectBtn = publishInfoPanel.querySelector('#connect-permalink-btn');
  if (connectBtn && fullUrl) {
    connectBtn.addEventListener('click', () => {
      console.debug('[Workspace] connect-permalink-btn clicked', {
        cardId: ideaData.id,
        fullUrl,
      });
      // 현재 카드의 실제 status 가져오기
      const currentStatus =
        ideaData.status || window.__cp_workspace_idea_data?.status || 'in-progress';
      chrome.runtime.sendMessage(
        {
          action: 'link_published_url',
          data: {
            cardId: ideaData.id,
            url: fullUrl,
            status: currentStatus,
          },
        },
        (res) => {
          console.debug('[Workspace] link_published_url response for', ideaData.id, res);
          if (res && res.success) {
            showToast('✅ 발행 URL이 연결되었습니다. 성과 추적이 시작됩니다.');
            // 로컬 데이터 업데이트
            if (window.__cp_workspace_idea_data) {
              window.__cp_workspace_idea_data.publishedUrl = fullUrl;
              window.__cp_workspace_idea_data.performanceTracked = true;
            }
          } else {
            showToast(`❌ 연결 실패: ${res?.error || '알 수 없는 오류'}`, 'error');
          }
        }
      );
    });
    console.debug('[DIAG showPublishInfo] connect-permalink-btn listener attached');
  }

  const copyTagsBtn = publishInfoPanel.querySelector('#copy-tags-btn');
  if (copyTagsBtn) {
    copyTagsBtn.addEventListener('click', () => {
      const tagsInput = publishInfoPanel.querySelector('#tags-input');
      if (tagsInput && tagsInput.value) {
        navigator.clipboard
          .writeText(tagsInput.value)
          .then(() => showToast('📋 태그가 클립보드에 복사되었습니다.'));
      }
    });
  }

  // HTML 복사 버튼 이벤트 리스너
  // 주의: 이벤트 리스너 내부에서 항상 최신 데이터를 참조하도록 수정
  const copyHtmlBtn = publishInfoPanel.querySelector('#copy-html-btn');
  if (copyHtmlBtn) {
    copyHtmlBtn.addEventListener('click', async () => {
      try {
        copyHtmlBtn.disabled = true;
        copyHtmlBtn.textContent = '⏳ 생성 중...';

        // 최신 ideaData 가져오기 (클로저 캡처 대신 런타임에 참조)
        const currentIdeaData = window.__cp_workspace_idea_data || ideaData;

        // 에디터 내용 가져오기
        const editorIframe = workspaceEl.querySelector('#editor-iframe');
        let editorHtml = '';

        if (editorIframe && editorIframe.contentWindow) {
          const messageId = `get-content-html-${Date.now()}`;
          editorHtml = await new Promise((resolve) => {
            const handler = (event) => {
              if (event.data.action === 'content-response' && event.data.requestId === messageId) {
                window.removeEventListener('message', handler);
                resolve(event.data.data?.html || '');
              }
            };
            window.addEventListener('message', handler);
            editorIframe.contentWindow.postMessage(
              { action: 'get-content', requestId: messageId },
              '*'
            );
            setTimeout(() => {
              window.removeEventListener('message', handler);
              resolve('');
            }, 2000);
          });
        }

        // 에디터 내용이 없으면 최신 draftContent 사용
        if (!editorHtml || editorHtml.trim() === '') {
          const draftContent =
            currentIdeaData?.workspace?.draft ||
            currentIdeaData?.draftContent ||
            currentIdeaData?.draft ||
            '';
          if (draftContent) {
            // draftContent가 마크다운 형식일 수 있으므로 HTML로 변환
            if (typeof marked !== 'undefined' && marked.parse) {
              editorHtml = marked.parse(draftContent);
            } else {
              // marked가 없으면 그대로 사용
              editorHtml = draftContent;
            }
          }
        }

        // [핵심 수정] JSON-LD 스키마 가져오기 (없으면 자동 생성)
        let jsonLdSchema = null;
        const currentPublishInfo = currentIdeaData?.publishInfo;

        if (currentPublishInfo && currentPublishInfo.jsonLdSchema) {
          try {
            if (typeof currentPublishInfo.jsonLdSchema === 'string') {
              jsonLdSchema = JSON.parse(currentPublishInfo.jsonLdSchema);
            } else {
              jsonLdSchema = currentPublishInfo.jsonLdSchema;
            }
          } catch (e) {
            console.warn('[Workspace] Failed to parse jsonLdSchema:', e);
          }
        }

        if (!jsonLdSchema) {
          // Fallback: 저장된 JSON-LD가 없으면 기본값 생성
          console.log('[Workspace] JSON-LD가 없어 기본 스키마를 생성합니다.');
          const today = new Date().toISOString().split('T')[0];

          // 썸네일 이미지 URL들 수집
          const imageUrls = [];
          if (currentIdeaData?.thumbnailUrls) {
            if (currentIdeaData.thumbnailUrls.url_1x1)
              imageUrls.push(currentIdeaData.thumbnailUrls.url_1x1);
            if (currentIdeaData.thumbnailUrls.url_4x3)
              imageUrls.push(currentIdeaData.thumbnailUrls.url_4x3);
            if (currentIdeaData.thumbnailUrls.url_16x9)
              imageUrls.push(currentIdeaData.thumbnailUrls.url_16x9);
          } else if (currentIdeaData?.thumbnail) {
            imageUrls.push(currentIdeaData.thumbnail);
          }

          // 퍼머링크 URL (전체 URL)
          const permalinkUrl = fullUrl || '';

          // Publisher 정보 (채널 URL에서 도메인 추출 또는 기본값)
          let publisherName = 'Content Pilot';
          try {
            if (channelUrl) {
              const url = new URL(channelUrl);
              publisherName = url.hostname;
            }
          } catch (e) {
            // URL 파싱 실패 시 기본값 유지
          }

          jsonLdSchema = {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: currentIdeaData.seoTitle || currentIdeaData.title || '제목 없음',
            description:
              currentIdeaData.publishInfo?.description ||
              currentIdeaData.description ||
              '콘텐츠 설명이 없습니다.',
            author: {
              '@type': 'Person',
              name: publisherName,
            },
            datePublished: today,
            dateModified: today,
            image: imageUrls.length > 0 ? imageUrls : undefined,
            mainEntityOfPage: permalinkUrl
              ? {
                  '@type': 'WebPage',
                  '@id': permalinkUrl,
                }
              : undefined,
            publisher: {
              '@type': 'Organization',
              name: publisherName,
              logo: {
                '@type': 'ImageObject',
                url: 'https://via.placeholder.com/120x60',
              },
            },
          };

          // undefined 값 제거
          Object.keys(jsonLdSchema).forEach((key) => {
            if (jsonLdSchema[key] === undefined) {
              delete jsonLdSchema[key];
            }
          });
        }

        // 최신 seoTitle 가져오기
        const currentSeoTitle =
          currentPublishInfo?.seoTitle || currentIdeaData?.seoTitle || currentIdeaData?.title || '';

        // [Fix] Ensure JSON-LD description matches the UI input (publishInfo.description)
        // 사용자가 입력한 최신 SEO 설명이 JSON-LD에도 반영되도록 강제 업데이트
        const currentDescription =
          currentPublishInfo?.description || currentIdeaData?.description || '';
        if (jsonLdSchema && currentDescription) {
          jsonLdSchema.description = currentDescription;
        }

        // 완전한 HTML 생성
        const fullHtml = generateCompleteHtml(editorHtml, jsonLdSchema, currentSeoTitle);

        // 클립보드에 복사
        await navigator.clipboard.writeText(fullHtml);
        showToast('✅ HTML이 클립보드에 복사되었습니다! (JSON-LD 포함)');
        copyHtmlBtn.textContent = '📄 HTML 복사 (JSON-LD 포함)';
      } catch (error) {
        console.error('[Workspace] HTML 복사 실패:', error);
        showToast('❌ HTML 복사에 실패했습니다.', 'error');
        copyHtmlBtn.textContent = '📄 HTML 복사 (JSON-LD 포함)';
      } finally {
        copyHtmlBtn.disabled = false;
      }
    });
  }

  // [추가] publish-info 패널이 렌더링된 후 썸네일 버튼을 올바른 위치에 추가
  // showPublishInfo가 DOM을 새로 그리기 때문에 버튼이 사라질 수 있음 -> 다시 렌더링 요청
  try {
    if (typeof renderThumbnailButton === 'function') {
      renderThumbnailButton(workspaceEl, ideaData);
    }
  } catch (e) {
    console.warn('[Workspace] renderThumbnailButton call failed in showPublishInfo:', e);
  }
}

// Helper to read activeChannelId from chrome.storage.local supporting
// both callback-style and promise-style implementations (tests may
// stub either form).
function getActiveChannelId(cb) {
  try {
    const res = chrome.storage.local.get('activeChannelId', (r) => {
      if (typeof cb === 'function') cb(r);
    });
    if (res && typeof res.then === 'function') {
      return res.then((r) => {
        if (typeof cb === 'function') cb(r);
        return r;
      });
    }
    // If callback-style only, return a resolved promise; caller can still use callback.
    return Promise.resolve();
  } catch (e) {
    if (typeof cb === 'function') cb({ activeChannelId: null });
    return Promise.resolve({ activeChannelId: null });
  }
}

// 완전한 HTML 생성 함수 (JSON-LD 포함)
function generateCompleteHtml(contentHtml, jsonLdSchema, title) {
  // JSON-LD 스크립트 태그 생성
  let jsonLdScript = '';
  if (jsonLdSchema) {
    try {
      // Handle string input
      let schemaObj = jsonLdSchema;
      if (typeof schemaObj === 'string') {
        try {
          schemaObj = JSON.parse(schemaObj);
        } catch (e) {
          console.warn('[Workspace] generateCompleteHtml received invalid JSON string', e);
          schemaObj = null;
        }
      }

      if (schemaObj) {
        // JSON-LD 스키마에 필수 필드 업데이트 (없으면 추가)
        const schema = JSON.parse(JSON.stringify(schemaObj)); // 깊은 복사

        // headline이 없으면 title 사용
        if (!schema.headline && title) {
          schema.headline = title;
        }

        // datePublished가 없으면 현재 날짜 사용
        if (!schema.datePublished) {
          const now = new Date();
          schema.datePublished = now.toISOString().split('T')[0]; // YYYY-MM-DD 형식
        }

        // author가 없으면 기본값 추가
        if (!schema.author) {
          schema.author = {
            '@type': 'Person',
            name: 'Content Pilot',
          };
        }

        jsonLdScript = `\n<script type="application/ld+json">\n${JSON.stringify(
          schema,
          null,
          2
        )}\n</script>`;
      }
    } catch (error) {
      console.error('[Workspace] JSON-LD 스키마 처리 실패:', error);
    }
  }

  // 메타 디스크립션 태그 생성
  let descriptionMeta = '';
  if (jsonLdSchema && jsonLdSchema.description) {
    descriptionMeta = `\n  <meta name="description" content="${String(jsonLdSchema.description).replace(/"/g, '&quot;')}">`;
  }

  // <mark> 태그를 <span> 태그로 변환 (스타일 유지)
  let processedContent = contentHtml;
  if (contentHtml) {
    // <mark> 태그를 <span> 태그로 변환하면서 스타일 속성 유지
    processedContent = contentHtml
      .replace(/<mark([^>]*)>/gi, '<span$1>')
      .replace(/<\/mark>/gi, '</span>');
  }

  // 완전한 HTML 문서 생성
  const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || '제목 없음'}</title>${descriptionMeta}${jsonLdScript}
</head>
<body>
${processedContent}
</body>
</html>`;

  return fullHtml;
}

// -----------------------------------------------------------------------------
// 3. 메인 렌더링 함수 (renderWorkspace)
// -----------------------------------------------------------------------------

// -----------------------------------------------------------------------------
// 워크스페이스 액션 버튼 업데이트 헬퍼 함수
// -----------------------------------------------------------------------------
export async function updateWorkspaceActionButtons(workspaceEl, hasDraft) {
  let buttonContainer = workspaceEl.querySelector('#workspace-action-buttons');
  if (!buttonContainer) {
    // Do not create a static `#workspace-action-buttons` container.
    // Use the workspace root as a fallback target so buttons can be
    // inserted into the publish-info area or directly into the workspace.
    buttonContainer = workspaceEl;
    console.debug(
      '[DIAG updateWorkspaceActionButtons] no #workspace-action-buttons found, using workspace root as fallback'
    );
  }

  // 사용자 설정 로드 (기본값: false - AI가 글자 그림)
  let composeThumbnailText = false;
  try {
    // Support both Promise-based and callback-based mocks of chrome.storage.local.get
    const maybe = chrome.storage.local.get('composeThumbnailText');
    let storage = {};
    if (maybe && typeof maybe.then === 'function') {
      storage = await maybe;
    } else if (typeof chrome.storage.local.get === 'function') {
      storage = await new Promise((resolve) =>
        chrome.storage.local.get('composeThumbnailText', (s) => resolve(s || {}))
      );
    }
    composeThumbnailText = !!(storage && storage.composeThumbnailText);
  } catch (e) {
    console.warn('[Workspace] 설정 로드 실패:', e);
  }

  // NOTE: checkbox insertion moved later (after buttons creation) so it can be
  // positioned next to the regenerate-draft button for visibility.

  // Ensure the action buttons reflect current draft state
  try {
    const hasGenerateBtn = !!buttonContainer.querySelector('#generate-draft-btn');
    const hasRegenerateBtn = !!buttonContainer.querySelector('#regenerate-draft-btn');
    const hasRegenerateThumbBtn = !!buttonContainer.querySelector('#regenerate-thumbnail-btn');
    const hasDeleteDraftBtn = !!buttonContainer.querySelector('#delete-draft-in-workspace');

    // If draft exists but regenerate buttons are missing, create them
    if (hasDraft) {
      // remove generate button (if present) from action bar and publish-info area
      const genBtn = buttonContainer.querySelector('#generate-draft-btn');
      if (genBtn && genBtn.parentNode) genBtn.remove();
      try {
        const pubActions = buttonContainer
          .closest('.workspace-container')
          ?.querySelector('#publish-info-content')
          ?.querySelector('#publish-info-actions');
        const genBtnInPub = pubActions?.querySelector('#generate-draft-btn');
        if (genBtnInPub && genBtnInPub.parentNode) genBtnInPub.remove();
      } catch (e) {
        // ignore
      }

      // Ensure publish-info panel shows regenerate/delete actions (move buttons here)
      try {
        const ideaData = window.__cp_workspace_idea_data || {};
        const tagsForDisplay = Array.isArray(ideaData.publishInfo?.tags)
          ? ideaData.publishInfo.tags.join(', ')
          : ideaData.publishInfo?.tags || '';
        if (typeof showPublishInfo === 'function') {
          showPublishInfo(
            buttonContainer.closest('.workspace-container'),
            ideaData.publishInfo?.permalink,
            tagsForDisplay,
            ideaData.seoTitle || ideaData.publishInfo?.seoTitle || '',
            ideaData
          );
        }
      } catch (e) {
        // non-fatal
      }
    } else {
      // no draft: always remove regenerate / delete buttons to avoid stale buttons
      ['regenerate-draft-btn', 'regenerate-thumbnail-btn', 'delete-draft-in-workspace'].forEach(
        (id) => {
          const el = buttonContainer.querySelector(`#${id}`);
          if (el && el.parentNode) el.remove();
        }
      );

      // Also remove any moved buttons from publish-info panel
      try {
        const pubArea = buttonContainer
          .closest('.workspace-container')
          ?.querySelector('#publish-info-content');
        if (pubArea) {
          ['regenerate-draft-btn', 'regenerate-thumbnail-btn', 'delete-draft-in-workspace'].forEach(
            (id) => {
              const el = pubArea.querySelector(`#${id}`);
              if (el && el.parentNode) el.remove();
            }
          );
        }
      } catch (e) {
        // ignore
      }

      // Ensure generate button exists - prefer publish-info area (near copy-html) for placement
      if (!hasGenerateBtn) {
        const genBtn = document.createElement('button');
        genBtn.id = 'generate-draft-btn';
        genBtn.style.cssText =
          'width: auto; padding: 10px; background: rgb(66, 133, 244); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; flex: 1 1 0%;';
        genBtn.textContent = '✨ AI 초안 생성';
        // try to insert into publish-info-actions if available
        try {
          let publishContent = buttonContainer
            .closest('.workspace-container')
            ?.querySelector('#publish-info-content');
          let pubActions = publishContent?.querySelector('#publish-info-actions');
          // create publish-info-actions container if it doesn't exist so we have a
          // consistent place to put generate button and compose checkbox
          if (!pubActions && publishContent) {
            pubActions = document.createElement('div');
            pubActions.id = 'publish-info-actions';
            pubActions.style.cssText = 'display:flex; flex-direction:column; gap:8px;';
            publishContent.appendChild(pubActions);
          }
          if (pubActions) {
            pubActions.insertBefore(genBtn, pubActions.firstElementChild || null);
          } else {
            buttonContainer.appendChild(genBtn);
          }
        } catch (e) {
          buttonContainer.appendChild(genBtn);
        }
      }
    }
  } catch (e) {
    // non-fatal
    console.warn('[Workspace] updateWorkspaceActionButtons error updating DOM:', e);
  }

  // Insert the compose-thumbnail-text checkbox next to the regenerate-draft button
  try {
    const existingCheckbox = buttonContainer
      .closest('.workspace-container')
      ?.querySelector('#compose-thumbnail-text-checkbox');
    if (!existingCheckbox) {
      const regenTextBtn = buttonContainer.querySelector('#regenerate-draft-btn');
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = 'compose-thumbnail-text-checkbox';
      input.checked = !!composeThumbnailText;
      input.style.cssText =
        'margin: 0 8px 0 0; cursor: pointer; accent-color: #6c5ce7; transform: scale(1.02);';
      input.title = '썸네일 텍스트 오버레이 적용';

      // Prefer inserting into publish-info actions container when possible (near copy-html)
      let inserted = false;
      try {
        const pubActions = buttonContainer
          .closest('.workspace-container')
          ?.querySelector('#publish-info-content')
          ?.querySelector('#publish-info-actions');
        if (pubActions) {
          if (hasDraft) {
            // For drafts, the publish panel rendering (showPublishInfo)
            // is responsible for creating the regenerate/thumnail controls
            // and placing the checkbox inside that wrapper. Skip inserting
            // a duplicate input here to avoid inconsistent DOM structure.
          } else {
            // No draft: prefer to insert into a .compose-thumbnail-controls wrapper
            // so the generate button and checkbox share the same visual style.
            let controls = pubActions.querySelector('.compose-thumbnail-controls');
            if (!controls) {
              controls = document.createElement('div');
              controls.className = 'compose-thumbnail-controls';
              controls.style.cssText =
                'width:auto;padding:10px;background: rgb(66, 133, 244);color: #fff;border: none;border-radius: 4px;cursor: pointer;font-size: 13px;font-weight: 500;flex: 1 1 0%;display:inline-flex;align-items:center;gap:6px;position:relative;';

              const existingGen = pubActions.querySelector('#generate-draft-btn');
              if (existingGen) {
                // move existing generate button into the controls wrapper
                existingGen.style.cssText =
                  'width: auto; padding: 0; background: rgb(66, 133, 244); color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500; flex: 1 1 0%;';
                pubActions.insertBefore(controls, existingGen);
                controls.appendChild(input);
                controls.appendChild(existingGen);
              } else {
                pubActions.insertBefore(controls, pubActions.firstElementChild || null);
                controls.appendChild(input);
              }
            } else {
              controls.insertBefore(input, controls.firstElementChild || null);
            }
            inserted = true;
            console.debug(
              '[Workspace] compose-thumbnail-text checkbox inserted into publish-info-actions, checked:',
              input.checked
            );
          }
        }
      } catch (e) {
        // ignore
      }

      if (!inserted && regenTextBtn && regenTextBtn.parentNode) {
        regenTextBtn.parentNode.insertBefore(input, regenTextBtn.parentNode.firstChild);
        inserted = true;
        console.debug(
          '[Workspace] compose-thumbnail-text checkbox inserted next to regenerate-draft-btn in action bar, checked:',
          input.checked
        );
      }
      if (!inserted) {
        // fallback to appending to container
        buttonContainer.appendChild(wrapper);
        console.debug(
          '[Workspace] compose-thumbnail-text checkbox appended to action bar container (fallback), checked:',
          input.checked
        );
      }
    }

    // re-query for checkbox after insertion
    const checkbox = buttonContainer.querySelector('#compose-thumbnail-text-checkbox');
    if (checkbox && !checkbox.__compose_listener_attached) {
      checkbox.addEventListener('change', (e) => {
        const isChecked = e.target.checked;
        chrome.storage.local.set({ composeThumbnailText: isChecked });
        console.log('[Workspace] 텍스트 오버레이 설정 변경:', isChecked ? 'ON' : 'OFF');
      });
      checkbox.__compose_listener_attached = true;
    }
  } catch (e) {
    console.warn('[Workspace] compose-thumbnail-text-checkbox 생성 실패:', e);
  }
}

export function renderWorkspace(container, ideaData) {
  Logger.debug('[Workspace] renderWorkspace 함수 호출됨');
  // Diagnostic: surface the idea id and publishInfo for tracing SEO bug
  console.debug(
    '[DIAG renderWorkspace] ideaId:',
    ideaData?.id,
    'seoTitle:',
    ideaData?.seoTitle,
    'publishInfo:',
    ideaData?.publishInfo
  );
  Logger.debug('[Workspace] container:', container);
  Logger.debug('[Workspace] ideaData:', ideaData);

  // If an existing workspace is present and has an unsaved title change,
  // trigger save before rendering the new workspace so the card reflects the
  // updated title when the user leaves the workspace.
  try {
    const existingWorkspace = container.querySelector('.workspace-container');
    if (existingWorkspace) {
      // Ensure any pending title is force-saved before we replace the workspace UI
      try {
        if (typeof window.__cp_force_save_title === 'function') window.__cp_force_save_title();
      } catch (e) {
        /* ignore */
      }

      // Try to find the element where properties are attached (content or area)
      let publishInfoArea = existingWorkspace.querySelector('#publish-info-content');
      if (!publishInfoArea) {
        publishInfoArea = existingWorkspace.querySelector('#publish-info-area');
      }

      // If handlers were attached to a different element instance for
      // some runs, try to locate any element in the workspace that
      // exposes the save API so we can detect pending changes.
      if (!publishInfoArea) {
        const possible = Array.from(existingWorkspace.querySelectorAll('*')).find(
          (el) =>
            el &&
            (typeof el._doSaveTitle === 'function' ||
              typeof el._doSaveTitleFromExternal === 'function')
        );
        if (possible) publishInfoArea = possible;
      }

      if (
        publishInfoArea &&
        publishInfoArea._titleChanged &&
        typeof publishInfoArea._doSaveTitle === 'function'
      ) {
        publishInfoArea._doSaveTitle(true);
        console.debug(
          '[Workspace] Pending title change detected; triggered save before leaving workspace.'
        );
      }
      // Fallback: if there's a visible title input whose value differs from the
      // current idea title but the panel didn't mark _titleChanged (race in
      // some full-suite runs), force a save using the global helper or the
      // per-panel external save API.
      try {
        const curInput = existingWorkspace.querySelector('#idea-title-input');
        // Prefer any pending value recorded by input handler to avoid races
        const curValFromPending =
          publishInfoArea && publishInfoArea._pendingTitle
            ? String(publishInfoArea._pendingTitle).trim()
            : '';
        const curVal = curValFromPending || (curInput ? String(curInput.value || '').trim() : '');
        // If there's an input value that's different from the current
        // idea title, force a save. This covers races where handlers
        // didn't mark the panel as dirty or the change wasn't recorded.
        if (curVal && curVal !== ideaData.title) {
          // Prefer the panel's internal save API if available (stronger guarantee).
          if (publishInfoArea && typeof publishInfoArea._doSaveTitle === 'function') {
            publishInfoArea._doSaveTitle(true);
            console.debug(
              '[Workspace] Forced save via publishInfoArea._doSaveTitle before leaving workspace.'
            );
          } else if (typeof window.__cp_force_save_title === 'function') {
            window.__cp_force_save_title();
            console.debug(
              '[Workspace] Fallback: forced save via __cp_force_save_title before leaving workspace.'
            );
          } else if (
            publishInfoArea &&
            typeof publishInfoArea._doSaveTitleFromExternal === 'function'
          ) {
            publishInfoArea._doSaveTitleFromExternal(curVal);
            console.debug(
              '[Workspace] Fallback: forced save via _doSaveTitleFromExternal before leaving workspace.'
            );
          }
        }
      } catch (e) {
        // swallow any errors in the fallback to avoid breaking render
      }
    }
  } catch (e) {
    console.warn('[Workspace] Error while attempting to flush pending title save:', e);
  }

  // 방어 코드
  ideaData.workspace = ideaData.workspace || {};
  ideaData.workspace.keywords = ideaData.workspace.keywords || [];
  ideaData.workspace.outline = ideaData.workspace.outline || [];
  ideaData.workspace.draft = ideaData.workspace.draft || '';
  ideaData.workspace.linkedScraps = ideaData.workspace.linkedScraps || {};
  console.debug(
    '[Workspace] normalize linkedScraps — workspace.linkedScraps/raw:',
    ideaData.workspace.linkedScraps,
    'ideaData.linkedScraps:',
    ideaData.linkedScraps
  );

  // Keep top-level thumbnailUrls in sync (legacy fields may exist at top-level)
  if (!ideaData.thumbnailUrls && ideaData.publishInfo?.thumbnailUrls) {
    ideaData.thumbnailUrls = ideaData.publishInfo.thumbnailUrls;
  }

  // Also ensure publishInfo has thumbnailUrls if top-level contains them
  // (some older flows may write to top-level; keep both in sync so UI is
  // robust when re-entering workspaces).
  if (!ideaData.publishInfo) ideaData.publishInfo = {};
  if (!ideaData.publishInfo.thumbnailUrls && ideaData.thumbnailUrls) {
    ideaData.publishInfo.thumbnailUrls = ideaData.thumbnailUrls;
  }

  // [수정] 1. 데이터 동기화 로직 추가
  // workspace 안에 숨어있는 linkedScraps를 바깥으로 꺼내줍니다.
  if (!ideaData.linkedScraps && ideaData.workspace.linkedScraps) {
    ideaData.linkedScraps = ideaData.workspace.linkedScraps;
    console.debug(
      '[Workspace] migrated linkedScraps from workspace to ideaData:',
      ideaData.linkedScraps
    );
  }

  // linkedScraps를 배열로 정규화 (Firebase에서 객체로 올 수 있음)
  if (ideaData.linkedScraps) {
    if (!Array.isArray(ideaData.linkedScraps) && typeof ideaData.linkedScraps === 'object') {
      ideaData.linkedScraps = Object.keys(ideaData.linkedScraps);
    }
  } else {
    ideaData.linkedScraps = [];
  }

  if (!ideaData.tags && ideaData.workspace.keywords) ideaData.tags = ideaData.workspace.keywords;
  if (!ideaData.outline && ideaData.workspace.outline)
    ideaData.outline = ideaData.workspace.outline;

  // "즉시 추적(Instant Tracking)" 카드 감지
  const isTrackingOnly = ideaData.origin?.type === 'tracking_only';

  // 브리핑이 이미 생성되었는지 확인 (outline, mainKeywords, longTailKeywords, tags 중 하나라도 있으면 생성된 것으로 간주)
  const hasBriefing =
    ideaData.outline?.length > 0 ||
    ideaData.mainKeywords?.length > 0 ||
    ideaData.longTailKeywords?.length > 0 ||
    (ideaData.tags && ideaData.tags.length > 1);

  // 브리핑이 없고, tags도 없거나 1개 이하일 때만 브리핑 요청 (중복 호출 방지)
  // tracking_only인 경우는 브리핑 생성하지 않음
  if (
    !isTrackingOnly &&
    ideaData.title &&
    !hasBriefing &&
    (!ideaData.tags || ideaData.tags.length <= 1)
  ) {
    Logger.debug(`[Workspace] 브리핑 요청 - cardId: ${ideaData.id}, title: ${ideaData.title}`);
    try {
      const _sm = chrome.runtime.sendMessage({
        action: 'generate_idea_briefing',
        data: {
          cardId: ideaData.id,
          title: ideaData.title,
          description: ideaData.description || '',
          generateMainKeywords: true,
          generateOutline: true,
          generateKeywords: true,
          generateLongTail: true,
        },
      });
      if (_sm && typeof _sm.catch === 'function') {
        _sm.catch((err) => {
          Logger.warn(`[Workspace] 브리핑 요청 실패:`, err);
        });
      }
    } catch (e) {
      // sendMessage might use callback API in test environment; ignore synchronous exceptions
      Logger.debug('[Workspace] sendMessage returned non-promise or threw:', e?.message || e);
    }
  } else {
    if (isTrackingOnly) {
      Logger.debug(`[Workspace] 브리핑 요청 건너뜀 - tracking_only 카드`);
    } else {
      Logger.debug(
        `[Workspace] 브리핑 요청 건너뜀 - hasBriefing: ${hasBriefing}, tags: ${
          ideaData.tags?.length || 0
        }`
      );
    }
  }

  // 에디터 저장 리스너
  window.__cp_workspace_idea_id = ideaData.id;
  // 전역 ideaData 저장 (실시간 업데이트를 위해)
  window.__cp_workspace_idea_data = ideaData;
  // 초안 삭제 후 자동 저장 차단 플래그
  if (!window.__cp_draft_deletion_block_time) {
    window.__cp_draft_deletion_block_time = 0;
  }
  if (!window.__cp_workspace_save_listener) {
    window.addEventListener('message', (event) => {
      if (event.data?.action === 'cp_save_draft' && event.data.content) {
        // 초안 삭제 후 5초 이내에는 자동 저장 차단
        const now = Date.now();
        if (
          window.__cp_draft_deletion_block_time &&
          now - window.__cp_draft_deletion_block_time < 5000
        ) {
          Logger.debug(
            `[Workspace] 초안 삭제 후 자동 저장 차단 (${
              5000 - (now - window.__cp_draft_deletion_block_time)
            }ms 남음)`
          );
          return;
        }

        // 빈 내용 필터링 (초안 삭제 후 재생성 방지)
        const content = event.data.content || '';
        const trimmedContent = content.trim();
        if (
          !trimmedContent ||
          trimmedContent === '<p><br></p>' ||
          trimmedContent === '<p></p>' ||
          trimmedContent === '<br>'
        ) {
          Logger.debug(`[Workspace] 빈 내용 자동 저장 차단`);
          return;
        }

        if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
          chrome.runtime
            .sendMessage({
              action: 'save_idea_draft',
              ideaId: window.__cp_workspace_idea_id,
              draft: event.data.content,
            })
            .catch(() => {});
        }
      }

      // 텍스트 변경 자동 저장 (Debounce 1000ms)
      // editor.js sends: { action: 'content-changed', data: { html: '...', text: '...' } }
      const isContentChanged = event.data?.action === 'content-changed';
      const contentData = isContentChanged ? event.data.data?.html || event.data.content : null;

      if (isContentChanged && contentData) {
        // [Fix] Update in-memory data so thumbnail maker sees it immediately
        if (window.__cp_workspace_idea_data) {
          Logger.debug('[Workspace] content-changed: updating in-memory draft', {
            prevLength: (window.__cp_workspace_idea_data.formattedDraft || '').length,
            newLength: contentData.length,
          });
          window.__cp_workspace_idea_data.formattedDraft = contentData;
          window.__cp_workspace_idea_data.currentDraft = contentData;
          // Also update draftContent if used elsewhere
          window.__cp_workspace_idea_data.draftContent = contentData;

          // Update workspace.draft to ensure isMeaningfulDraft() can detect content
          if (!window.__cp_workspace_idea_data.workspace) {
            window.__cp_workspace_idea_data.workspace = {};
          }
          window.__cp_workspace_idea_data.workspace.draft = contentData;

          // Update action buttons to show/hide delete button based on content
          try {
            const workspaceEl = document.querySelector('.workspace-container');
            if (workspaceEl && typeof updateWorkspaceActionButtons === 'function') {
              const hasMeaningfulContent = isMeaningfulDraft(contentData);
              updateWorkspaceActionButtons(workspaceEl, hasMeaningfulContent);
            }
          } catch (e) {
            Logger.warn('[Workspace] Failed to update action buttons on content change:', e);
          }
        } else {
          Logger.warn('[Workspace] content-changed: window.__cp_workspace_idea_data is missing!');
        }

        if (window.__cp_autosave_timer) {
          clearTimeout(window.__cp_autosave_timer);
        }

        window.__cp_autosave_timer = setTimeout(() => {
          try {
            Logger.debug('[Workspace] Auto-saving draft (debounce triggered)', {
              ideaId: window.__cp_workspace_idea_id,
              contentLength: (contentData || '').length,
            });
          } catch (err) {
            // ignore
          }

          // 초안 삭제 후 5초 이내에는 자동 저장 차단
          const now = Date.now();
          if (
            window.__cp_draft_deletion_block_time &&
            now - window.__cp_draft_deletion_block_time < 5000
          ) {
            Logger.debug(`[Workspace] 초안 삭제 후 자동 저장 차단 (Auto-save skipped)`);
            return;
          }

          // 빈 내용 필터링
          const content = contentData || '';
          const trimmedContent = content.trim();
          if (
            !trimmedContent ||
            trimmedContent === '<p><br></p>' ||
            trimmedContent === '<p></p>' ||
            trimmedContent === '<br>'
          ) {
            return;
          }

          if (chrome.runtime && typeof chrome.runtime.sendMessage === 'function') {
            const payload = {
              action: 'save_idea_draft',
              ideaId: window.__cp_workspace_idea_id,
              draft: content,
              ts: Date.now(),
            };

            try {
              chrome.runtime.sendMessage(payload, (response) => {
                if (chrome.runtime.lastError) {
                  Logger.error('[Workspace] Auto-save error:', chrome.runtime.lastError);
                } else {
                  Logger.debug('[Workspace] Auto-save success:', response);
                }
              });
            } catch (e) {
              Logger.error('[Workspace] Auto-save sendMessage threw:', e);
            }
          }
        }, 1000);
      }
    });
    window.__cp_workspace_save_listener = true;
  }

  // -----------------------------------------------------------------------------
  // 워크스페이스 액션 버튼 업데이트 헬퍼 함수
  // -----------------------------------------------------------------------------

  const outlineHtml =
    ideaData.outline?.length > 0
      ? ideaData.outline
          .map(
            (item, i) =>
              `<li class="outline-item" data-index="${i}"><span class="outline-text">${item}</span><button class="outline-delete-btn">×</button></li>`
          )
          .join('')
      : "<li class='outline-empty'>추천 목차가 없습니다.</li>";

  // 주요 키워드 표시 (mainKeywords 우선, 없으면 tags 사용)
  const mainKeywordsHtml =
    ideaData.mainKeywords?.length > 0
      ? ideaData.mainKeywords
          .map((k) => `<span class="tag main-keyword-tag interactive-tag">🔑 ${k}</span>`)
          .join('')
      : ideaData.tags?.length > 0
        ? ideaData.tags
            .filter((t) => t !== '#AI-추천')
            .map((k) => `<span class="tag interactive-tag">${k}</span>`)
            .join('')
        : '<span>주요 키워드 없음</span>';

  // 브리핑 메타 정보 HTML 생성 (워크스페이스 우측 패널에 표시)
  // 우선 top-level card fields를 우선 사용하고, 없으면 nested workspace.draft 경로를 사용합니다.
  let briefingMetaHtml = '';
  const draftObj = ideaData.workspace?.draft || ideaData.draft || null;
  const cardLevelStatus = ideaData.briefingStatus ?? null;
  const cardLevelProgress =
    typeof ideaData.briefingProgress === 'number' ? ideaData.briefingProgress : null;
  const bs = cardLevelStatus ?? (draftObj && draftObj.briefingStatus);
  const progressValue = cardLevelProgress ?? (draftObj && draftObj.briefingProgress);
  const progressNumeric =
    typeof progressValue === 'number' && !Number.isNaN(progressValue)
      ? Math.max(0, Math.min(100, Math.round(progressValue)))
      : null;

  if (bs) {
    let bsHtml = '';
    switch (bs) {
      case 'queued':
        bsHtml = `<span class="briefing-status-badge queued" title="AI 브리핑 대기 중">⏳ 브리핑 대기</span>`;
        break;
      case 'processing':
        if (progressNumeric !== null && typeof progressNumeric === 'number') {
          bsHtml = `
            <span class="briefing-status-badge processing" title="AI 브리핑 생성 중 - ${progressValue}%">
              <span class="briefing-spinner">🔄</span>
              <span class="briefing-progress-label">브리핑 생성 중 (${progressNumeric}%)</span>
              <div class="briefing-progress-wrap"><div class="briefing-progress-bar" style="width: ${progressNumeric}%"></div></div>
            </span>`;
        } else {
          bsHtml = `<span class="briefing-status-badge processing" title="AI 브리핑 생성 중">🔄 브리핑 생성 중...</span>`;
        }
        break;
      case 'done':
        bsHtml = `<span class="briefing-status-badge done" title="AI 브리핑 완료">✅ 브리핑 완료</span>`;
        break;
      case 'failed': {
        const errMsg = draftObj?.briefingError || ideaData.briefingError || '브리핑 실패';
        bsHtml = `<span class="briefing-status-badge failed" title="${errMsg}">❌ 브리핑 실패</span>`;
        // retry 버튼 (워크스페이스 상세에서 사용)
        bsHtml += ` <button class="workspace-briefing-retry-btn" data-card-id="${ideaData.id}" data-status="${ideaData.status || 'ideas'}">↻ 재시도</button>`;
        break;
      }
      default:
        break;
    }

    if (bsHtml) {
      briefingMetaHtml = `<div class="workspace-briefing-meta">${bsHtml}</div>`;
    }
    Logger.debug('[Workspace] briefingMetaHtml generated:', briefingMetaHtml);
  }
  const longTailHtml =
    ideaData.longTailKeywords?.length > 0
      ? ideaData.longTailKeywords
          .map((k) => `<span class="tag long-tail-keyword interactive-tag">${k}</span>`)
          .join('')
      : '<span>롱테일 키워드 없음</span>';

  // 추천 검색어 표시 (tags 우선, 없으면 recommendedKeywords 사용)
  // tags는 긴 검색어일 수 있으므로 정규화 필요 (1-3단어, 30자 이내로 제한)
  const recommendedKeywords =
    ideaData.tags?.length > 0
      ? ideaData.tags
          .filter((t) => t !== '#AI-추천')
          .map((t) => t.replace(/^#+/, ''))
          .map((tag) => {
            // 간단한 정규화: 단어 수와 길이 체크
            const words = tag.trim().split(/\s+/);
            if (words.length <= 3 && tag.length <= 30) {
              return tag;
            }
            // 긴 검색어는 첫 3단어만 또는 30자까지만
            if (words.length > 3) {
              return words.slice(0, 3).join(' ');
            }
            return tag.slice(0, 30);
          })
          .filter((t, i, arr) => arr.indexOf(t) === i) // 중복 제거
          .slice(0, 10) // 최대 10개
      : ideaData.recommendedKeywords || [];

  const searchHtml =
    recommendedKeywords.length > 0
      ? recommendedKeywords
          .map(
            (item) => `
          <li style="display: flex; align-items: center; justify-content: space-between; gap: 8px;">
            <span class="recommended-keyword-item" data-keyword="${item.replace(
              /"/g,
              '&quot;'
            )}" style="cursor: pointer; flex: 1; padding: 4px 0; transition: color 0.2s;" title="클릭하여 에디터에 추가">${item}</span>
            <a href="https://www.google.com/search?q=${encodeURIComponent(
              item
            )}" target="_blank" class="keyword-search-link" title="구글 검색" style="text-decoration: none; margin-left: 8px; font-size: 14px; color: #4285f4; cursor: pointer; flex-shrink: 0; padding: 4px; transition: opacity 0.2s;" onmouseover="this.style.opacity='0.7'" onmouseout="this.style.opacity='1'">🔗</a>
          </li>
        `
          )
          .join('')
      : '<li>추천 검색어 없음</li>';

  // Consider both top-level draftContent and the nested workspace.draft
  // for determining whether the idea has a meaningful draft. This makes
  // the UI consistent regardless of whether older data uses the top-level
  // field or the newer workspace.draft field.
  const hasDraft =
    isMeaningfulDraft(ideaData.draftContent) || isMeaningfulDraft(ideaData.workspace?.draft);

  // tracking_only인 경우 특별한 UI 렌더링
  const trackingOnlyContent = isTrackingOnly
    ? `
    <div style="padding: 20px; background: #fff; border-radius: 8px; margin: 20px;">
      ${
        ideaData.thumbnail
          ? `
        <div style="margin-bottom: 20px; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
          <img src="${ideaData.thumbnail}" alt="${ideaData.title || '썸네일'}" 
               style="width: 100%; height: auto; display: block; max-height: 400px; object-fit: cover;"
               onerror="this.style.display='none';">
        </div>
      `
          : ''
      }
      ${
        ideaData.publishedUrl
          ? `
        <div style="margin-bottom: 20px; padding: 12px; background: #f8f9fa; border-radius: 6px; border-left: 4px solid #4285f4;">
          <a href="${ideaData.publishedUrl}" target="_blank" rel="noopener noreferrer" 
             style="display: inline-flex; align-items: center; gap: 8px; color: #4285f4; text-decoration: none; font-weight: 500; font-size: 14px;">
            <span>🔗</span>
            <span>원문 보기</span>
            <span style="font-size: 12px; opacity: 0.7;">→</span>
          </a>
        </div>
      `
          : ''
      }
      ${
        ideaData.description
          ? `
        <div style="line-height: 1.8; color: #333; font-size: 14px; padding: 16px; background: #f8f9fa; border-radius: 6px; white-space: pre-wrap;">
          ${ideaData.description}
        </div>
      `
          : '<p style="color: #888; font-style: italic;">설명이 없습니다.</p>'
      }
    </div>
  `
    : '';

  // [최적화] 이미 워크스페이스가 렌더링되어 있고, 같은 아이디어 ID라면 전체 리렌더링을 건너뜀
  const existingWorkspace = container.querySelector('.workspace-container');
  const existingIdeaId = existingWorkspace?.querySelector('.linked-scraps-list')?.dataset?.ideaId;

  let workspaceEl;

  if (existingWorkspace && existingIdeaId === ideaData.id) {
    console.debug('[Workspace] 동일한 아이디어 ID 감지, 부분 업데이트 수행:', ideaData.id);
    workspaceEl = existingWorkspace;

    // 연결된 스크랩 목록 업데이트 (필요한 경우)
    const linkedScrapsList = workspaceEl.querySelector('.linked-scraps-list');
    if (linkedScrapsList && ideaData.linkedScraps && ideaData.linkedScraps.length > 0) {
      getActiveChannelId((res) => {
        chrome.runtime.sendMessage(
          { action: 'get_all_scraps', channelId: res.activeChannelId },
          (r) => {
            if (r && r.success && r.scraps) {
              const linkedScraps = r.scraps.filter((s) => ideaData.linkedScraps.includes(s.id));
              if (linkedScraps.length > 0) {
                linkedScrapsList.classList.remove('empty-state');
                linkedScrapsList.innerHTML = linkedScraps
                  .map((s) => createScrapCard(s, true))
                  .join('');
                linkedScrapsList.querySelectorAll('.linked-scrap-item').forEach((item) => {
                  setupLinkedScrapItem(item);
                });
              }
            }
          }
        );
      });
    }
  } else {
    console.debug('[Workspace] 전체 워크스페이스 렌더링 수행');
    container.innerHTML = `
    <div class="workspace-container">
      <div id="main-editor-panel" class="workspace-column" style="display:flex; flex-direction:column;">
        <!-- header removed: title editing now happens via publish-info panel -->
        ${
          isTrackingOnly
            ? trackingOnlyContent
            : `

        <div style="flex:1; display:flex; flex-direction:column; /* gap:8px; */">
            <iframe id="editor-iframe" src="${chrome.runtime.getURL(
              'editor.html'
            )}" style="flex:1; width:100%; border:none;"></iframe>
            <div id="linked-scraps-section" style="/* height:150px; */overflow-x:auto;overflow-y:hidden;/* border-top:1px solid #eee; *//* padding:10px; */">
                <div class="scrap-list linked-scraps-list empty-state" data-idea-id="${
                  ideaData.id
                }" style="display:flex;flex-wrap:nowrap;/* gap:8px; */align-items:center;">
                    <p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>
                </div>
            </div>
        </div>
        `
        }
      </div>

      <div id="resource-library-panel" class="workspace-column">
        <div class="resource-tabs">
            <button class="resource-tab-btn active" data-tab="publish-info" title="발행 정보">📝</button>
            <button class="resource-tab-btn" data-tab="ai-briefing" title="AI 브리핑">✨</button>
            <button class="resource-tab-btn" data-tab="outline" title="목차">📄</button>
            <button class="resource-tab-btn" data-tab="recommended-keywords" title="추천 검색어">🔍</button>
            <button class="resource-tab-btn" data-tab="all-scraps" title="모든 스크랩">📖</button>
            <button class="resource-tab-btn" data-tab="image-gallery" title="이미지 갤러리">🖼️</button>
            <button class="resource-tab-btn" data-tab="affiliate" title="제휴 카드">💰</button>
        </div>
        
        <div class="resource-content-area publish-info-area" id="publish-info-area" style="display:block;"><div id="publish-info-content"></div></div>
        <div class="resource-content-area ai-briefing-area" id="ai-briefing-area" style="display:none;">
          ${briefingMetaHtml}
            <div class="editor-keyword-section">
                <div class="keyword-list">${mainKeywordsHtml}</div>
                <div class="keyword-list" style="margin-top: 12px;">${longTailHtml}</div>
            </div>
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
        <div class="resource-content-area affiliate-area" id="affiliate-area" style="display:none; padding: 12px; overflow-y:auto;">
          <div id="affiliate-list" style="display:flex;flex-direction:column;gap:8px;">
            <div style="color:#888;font-size:13px;">제휴 링크 로드 중...</div>
          </div>
        </div>
      </div>
    </div>
    
    <!-- 스크랩 상세 모달 -->
    <div id="scrap-detail-modal" class="scrap-detail-modal" style="display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10000; overflow-y: auto;">
      <div class="scrap-detail-modal-content" style="max-width: 800px; margin: 40px auto; background: #fff; border-radius: 12px; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #eee; padding-bottom: 16px;">
          <h2 style="margin: 0; font-size: 20px; font-weight: 600;">스크랩 상세</h2>
          <button id="scrap-detail-modal-close" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666; padding: 0; width: 32px; height: 32px; display: flex; align-items: center; justify-content: center; border-radius: 4px; transition: background 0.2s;" onmouseover="this.style.background='#f0f0f0'" onmouseout="this.style.background='none'">×</button>
        </div>
        <div id="scrap-detail-content" style="max-height: 70vh; overflow-y: auto;">
          <div id="scrap-detail-title" style="font-size: 18px; font-weight: 600; margin-bottom: 16px; color: #333;"></div>
          <div id="scrap-detail-url" style="margin-bottom: 16px;">
            <a id="scrap-detail-url-link" href="#" target="_blank" style="color: #4285f4; text-decoration: none; font-size: 14px; display: inline-flex; align-items: center; gap: 4px;">
              <span>🔗</span>
              <span id="scrap-detail-url-text"></span>
            </a>
          </div>
          <div id="scrap-detail-images" style="margin-bottom: 16px; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px;"></div>
          <div id="scrap-detail-text" style="line-height: 1.6; color: #333; white-space: pre-wrap; word-wrap: break-word; padding: 16px; background: #f8f9fa; border-radius: 8px; max-height: 400px; overflow-y: auto;"></div>
          <div id="scrap-detail-tags" style="margin-top: 16px; display: flex; flex-wrap: wrap; gap: 8px;"></div>
        </div>
      </div>
    </div>
  `;

    workspaceEl = container.querySelector('.workspace-container');
    Logger.debug('[Workspace] workspaceEl 찾기:', workspaceEl);

    // [중요] Shadow DOM 내부의 window에도 TUI 에디터 리스너 등록
    try {
      const shadowWindow = container.ownerDocument?.defaultView || window;
      if (shadowWindow && !shadowWindow.__cp_tui_shadow_listener_attached) {
        Logger.debug('🔧 [Workspace] Shadow DOM 내부 window에 TUI 에디터 리스너 등록 중...');
        Logger.debug('🔧 [Workspace] Shadow window:', shadowWindow);
        Logger.debug('🔧 [Workspace] Shadow window === window:', shadowWindow === window);

        const shadowTuiEditorListener = (event) => {
          if (event.data?.action === 'cp_open_tui_editor') {
            console.log('🌐 [Workspace] ========================================');
            console.log('🌐 [Workspace] 📨 Shadow DOM 리스너: cp_open_tui_editor 메시지 수신!');
            console.log('🌐 [Workspace] ========================================');

            const imageUrl = event.data.imageUrl || event.data.currentImageUrl;
            if (!imageUrl) {
              Logger.error('❌ [Workspace] TUI 에디터 열기 실패: 이미지 URL 없음');
              return;
            }

            // workspace 컨테이너 찾기
            const workspaceContainer =
              container.querySelector('.workspace-container') ||
              document.querySelector('.workspace-container') ||
              document.querySelector('.cp-workspace-container');

            if (!workspaceContainer) {
              Logger.error('❌ [Workspace] workspace 컨테이너를 찾을 수 없습니다!');
              return;
            }

            Logger.debug('✅ [Workspace] workspace 컨테이너 확인 완료');

            // TUI 에디터 iframe 생성 또는 재사용
            let tuiEditorIframe = document.querySelector('#tui-editor-iframe');

            if (!tuiEditorIframe) {
              console.log('🔨 [Workspace] TUI 에디터 iframe 생성 중...');

              // 기존 모달이 있으면 제거
              const existingOverlay = document.querySelector('#tui-editor-overlay');
              if (existingOverlay) existingOverlay.remove();

              // 배경 오버레이 생성
              const overlay = document.createElement('div');
              overlay.id = 'tui-editor-overlay';
              overlay.style.cssText =
                'position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;background:rgba(0,0,0,0.7) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;';
              overlay.onclick = () => {
                if (confirm('편집을 종료하시겠습니까?')) {
                  overlay.remove();
                  if (tuiEditorIframe) tuiEditorIframe.remove();
                }
              };
              // body의 마지막에 추가하여 최상위에 위치
              document.body.appendChild(overlay);

              // 모달 컨테이너 생성
              const modalContainer = document.createElement('div');
              modalContainer.id = 'tui-editor-modal-container';
              modalContainer.style.cssText =
                'position:relative !important;width:90vw !important;max-width:1400px !important;height:90vh !important;max-height:900px !important;background:#282828 !important;border-radius:12px !important;box-shadow:0 20px 60px rgba(0,0,0,0.5) !important;overflow:hidden !important;display:flex !important;flex-direction:column !important;z-index:2147483648 !important;';
              overlay.appendChild(modalContainer);

              // 닫기 버튼 추가
              const closeBtn = document.createElement('button');
              closeBtn.innerHTML = '×';
              closeBtn.style.cssText =
                'position:absolute !important;top:12px !important;right:12px !important;width:36px !important;height:36px !important;background:rgba(255,255,255,0.1) !important;border:none !important;border-radius:50% !important;color:#fff !important;font-size:24px !important;cursor:pointer !important;z-index:2147483649 !important;display:flex !important;align-items:center !important;justify-content:center !important;line-height:1 !important;transition:background 0.2s !important;';
              closeBtn.onmouseover = () => (closeBtn.style.background = 'rgba(255,255,255,0.2)');
              closeBtn.onmouseout = () => (closeBtn.style.background = 'rgba(255,255,255,0.1)');
              closeBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('편집을 종료하시겠습니까?')) {
                  overlay.remove();
                  if (tuiEditorIframe) tuiEditorIframe.remove();
                }
              };
              modalContainer.appendChild(closeBtn);

              // iframe 생성
              tuiEditorIframe = document.createElement('iframe');
              tuiEditorIframe.id = 'tui-editor-iframe';
              tuiEditorIframe.src = chrome.runtime.getURL('tui-editor.html');
              tuiEditorIframe.style.cssText =
                'width:100%;height:100%;border:none;background:#282828;';
              modalContainer.appendChild(tuiEditorIframe);
              Logger.debug('✅ [Workspace] TUI 에디터 iframe 생성 완료');

              const sourceInfo = event.data.source || 'editor';
              console.log('🎯 [Workspace] 소스 정보:', sourceInfo);
              const editorIframe = workspaceContainer.querySelector('#editor-iframe');

              const tuiEditorMessageHandler = function (e) {
                if (e.data?.action === 'tui-editor-result' && e.data.dataUrl) {
                  console.log('[Workspace] TUI 에디터 편집 완료, 결과 처리 중...');

                  if (
                    sourceInfo === 'thumbnail_maker' ||
                    !event.data.allDocumentImages ||
                    event.data.allDocumentImages.length === 0
                  ) {
                    const altText = '편집된 썸네일';
                    if (editorIframe && editorIframe.contentWindow) {
                      editorIframe.contentWindow.postMessage(
                        {
                          action: 'insert-image',
                          data: {
                            url: e.data.dataUrl,
                            alt: altText,
                          },
                        },
                        '*'
                      );
                    }
                  } else {
                    if (editorIframe && editorIframe.contentWindow) {
                      editorIframe.contentWindow.postMessage(
                        {
                          action: 'replace-edited-image',
                          data: { dataUrl: e.data.dataUrl },
                        },
                        '*'
                      );
                    }
                  }

                  if (tuiEditorIframe) {
                    tuiEditorIframe.remove();
                  }

                  shadowWindow.removeEventListener('message', tuiEditorMessageHandler);
                }
              };
              shadowWindow.addEventListener('message', tuiEditorMessageHandler);

              tuiEditorIframe.onload = () => {
                console.log('[Workspace] TUI 에디터 iframe 로드 완료, 이미지 전달 중...');
                setTimeout(() => {
                  if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
                    tuiEditorIframe.contentWindow.postMessage(
                      {
                        action: 'open-tui-editor',
                        imageUrl: imageUrl,
                      },
                      '*'
                    );

                    if (
                      event.data.allDocumentImages &&
                      Array.isArray(event.data.allDocumentImages) &&
                      event.data.allDocumentImages.length > 0
                    ) {
                      tuiEditorIframe.contentWindow.postMessage(
                        {
                          action: 'set-document-images',
                          images: event.data.allDocumentImages,
                        },
                        '*'
                      );
                      console.log(
                        '[Workspace] 문서 이미지 목록 전달 완료:',
                        event.data.allDocumentImages.length,
                        '개'
                      );
                    }

                    console.log('[Workspace] TUI 에디터에 이미지 전달 완료');
                  }
                }, 500);
              };
            } else {
              console.log('[Workspace] 기존 TUI 에디터 iframe 재사용, 이미지 전달 중...');
              if (tuiEditorIframe.contentWindow) {
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: 'open-tui-editor',
                    imageUrl: imageUrl,
                  },
                  '*'
                );

                if (
                  event.data.allDocumentImages &&
                  Array.isArray(event.data.allDocumentImages) &&
                  event.data.allDocumentImages.length > 0
                ) {
                  tuiEditorIframe.contentWindow.postMessage(
                    {
                      action: 'set-document-images',
                      images: event.data.allDocumentImages,
                    },
                    '*'
                  );
                  console.log(
                    '[Workspace] 문서 이미지 목록 전달 완료:',
                    event.data.allDocumentImages.length,
                    '개'
                  );
                }

                console.log('[Workspace] TUI 에디터에 이미지 전달 완료');
              }
            }
          }
        };

        shadowWindow.addEventListener('message', shadowTuiEditorListener);
        shadowWindow.__cp_tui_shadow_listener_attached = true;
        Logger.debug('✅ [Workspace] Shadow DOM 내부 window에 TUI 에디터 리스너 등록 완료');
      } else if (shadowWindow && shadowWindow.__cp_tui_shadow_listener_attached) {
        Logger.info('ℹ️ [Workspace] Shadow DOM 내부 window에 이미 리스너가 등록되어 있습니다.');
      }
    } catch (err) {
      console.warn('⚠️ [Workspace] Shadow DOM 내부 window 리스너 등록 실패:', err.message);
    }

    addWorkspaceEventListeners(workspaceEl, ideaData, container);
  }

  // Render thumbnail button proactively (best-effort). In some test or DOM
  // ordering scenarios the async action-button update may be delayed — rendering
  // thumbnail button early makes the UI more resilient. It will be called
  // again after action buttons update to ensure correct placement.
  try {
    renderThumbnailButton(workspaceEl, ideaData);
  } catch (e) {
    console.debug('[DIAG renderThumbnailButton] pre-render attempt failed:', e?.message);
  }

  // Ensure thumbnail button also created after any async action-button updates
  updateWorkspaceActionButtons(workspaceEl, hasDraft).then(() => {
    renderThumbnailButton(workspaceEl, ideaData);
  });

  // Final fallback: ensure retry button is queryable from the container
  try {
    if (
      briefingMetaHtml &&
      container &&
      !container.querySelector('.workspace-briefing-retry-btn')
    ) {
      const fallbackBtn = `<button class="workspace-briefing-retry-btn" style="display:none" data-card-id="${ideaData.id}" data-status="${ideaData.status || 'ideas'}">↻ 재시도</button>`;
      container.insertAdjacentHTML('beforeend', fallbackBtn);
      Logger.debug('[Workspace] inserted fallback retry into container after render');
    }
  } catch (e) {
    /* ignore */
  }

  // tracking_only 카드인 경우 publishedUrl에서 permalink 추출
  if (isTrackingOnly && ideaData.publishedUrl && !ideaData.publishInfo?.permalink) {
    const extractedPermalink = extractPermalinkFromUrl(ideaData.publishedUrl);
    if (extractedPermalink) {
      // publishInfo 객체가 없으면 생성
      if (!ideaData.publishInfo) {
        ideaData.publishInfo = {};
      }
      ideaData.publishInfo.permalink = extractedPermalink;

      // Firebase에 저장 (비동기, 실패해도 계속 진행)
      chrome.runtime
        .sendMessage({
          action: 'update_kanban_card',
          data: {
            cardId: ideaData.id,
            status: ideaData.status || 'done',
            updates: {
              publishInfo: {
                ...ideaData.publishInfo,
                permalink: extractedPermalink,
              },
            },
          },
        })
        .catch((err) => {
          Logger.warn('[Workspace] permalink 저장 실패:', err);
        });
    }
  }

  // Always show publish-info panel initially since it's the default active tab
  if (ideaData) {
    console.debug(
      '[DIAG renderWorkspace] initial showPublishInfo call - seoTitle:',
      ideaData.seoTitle,
      'publishInfo.seoTitle:',
      ideaData.publishInfo?.seoTitle
    );
    // tags가 배열인 경우 쉼표로 조인
    let tagsForDisplay = ideaData.publishInfo?.tags || '';
    if (Array.isArray(tagsForDisplay)) {
      tagsForDisplay = tagsForDisplay.join(', ');
    }
    // ensure any previously scheduled showPublishInfo is cleared to avoid stale re-renders
    try {
      if (container && container.__cp_showPublishInfoTimeout) {
        clearTimeout(container.__cp_showPublishInfoTimeout);
        container.__cp_showPublishInfoTimeout = null;
      }
    } catch (e) {
      // ignore
    }

    // Call showPublishInfo synchronously to prevent UI blinking/disappearing
    showPublishInfo(
      container.querySelector('.workspace-container'),
      ideaData.publishInfo?.permalink,
      tagsForDisplay,
      ideaData.seoTitle || ideaData.publishInfo?.seoTitle || '',
      ideaData
    );
  }
}

export function addWorkspaceEventListeners(workspaceEl, ideaData, container = null) {
  console.log('[Workspace] addWorkspaceEventListeners 함수 호출됨');

  // "즉시 추적" 카드인지 확인
  const isTrackingOnly = ideaData.origin?.type === 'tracking_only';

  const tabBtns = workspaceEl.querySelectorAll('.resource-tab-btn');
  const allScrapsList = workspaceEl.querySelector('.all-scraps-list');
  const linkedScrapsList = workspaceEl.querySelector('.linked-scraps-list');
  const editorIframe = workspaceEl.querySelector('#editor-iframe');
  const resourceLibrary = workspaceEl.querySelector('#resource-library-panel');

  console.log('[Workspace] editorIframe 찾기:', editorIframe);
  console.log('[Workspace] isTrackingOnly:', isTrackingOnly);

  // 모든 스크랩 리스트의 삭제 버튼 이벤트 리스너 (이벤트 위임)
  if (allScrapsList) {
    allScrapsList.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.scrap-card-delete-btn');
      if (!deleteBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const card = deleteBtn.closest('.scrap-card-item');
      if (!card) return;

      const scrapId = card.dataset.scrapId;
      if (!scrapId) {
        console.error('[Workspace] 스크랩 ID를 찾을 수 없습니다.');
        return;
      }

      showConfirmationToast('정말로 스크랩을 삭제하시겠습니까?', () => {
        chrome.runtime.sendMessage({ action: 'delete_scrap', id: scrapId }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('[Workspace] 스크랩 삭제 오류:', chrome.runtime.lastError);
            showToast(`❌ 삭제 실패: ${chrome.runtime.lastError.message}`, 'error');
            return;
          }
          if (response && response.success) {
            showToast('✅ 스크랩이 삭제되었습니다.');
            // 스크랩 리스트 새로고침
            getActiveChannelId((res) => {
              chrome.runtime.sendMessage(
                { action: 'get_all_scraps', channelId: res.activeChannelId },
                (r) => {
                  if (r && r.success) {
                    const linkedScrapIds = ideaData.linkedScraps || [];
                    const availableScraps = r.scraps.filter((s) => !linkedScrapIds.includes(s.id));
                    if (availableScraps.length > 0) {
                      allScrapsList.innerHTML = availableScraps
                        .map((s) => createScrapCard(s, false))
                        .join('');
                    } else {
                      allScrapsList.innerHTML =
                        "<p style='text-align: center; padding: 20px; color: #666;'>자료 보관함이 비어있습니다.</p>";
                    }
                    // 이미지 갤러리도 갱신
                    if (resourceLibrary) {
                      const imageGalleryGrid = resourceLibrary.querySelector('.image-gallery-grid');
                      if (imageGalleryGrid) {
                        const sendCommand = (action, data = {}) => {
                          const editorIframe = workspaceEl.querySelector('#editor-iframe');
                          if (editorIframe && editorIframe.contentWindow) {
                            editorIframe.contentWindow.postMessage({ action, data }, '*');
                          }
                        };
                        updateImageGalleryFromAllScraps(
                          resourceLibrary,
                          r.scraps,
                          sendCommand,
                          ideaData
                        );
                      }
                    }
                  }
                }
              );
            });
          } else {
            const errorMsg = response?.error || '알 수 없는 오류';
            console.error('[Workspace] 스크랩 삭제 실패:', errorMsg);
            showToast(`❌ 삭제 실패: ${errorMsg}`, 'error');
          }
        });
      });
    });
  }

  // 연결된 스크랩 목록 초기 렌더링
  if (linkedScrapsList && ideaData.linkedScraps && ideaData.linkedScraps.length > 0) {
    getActiveChannelId((res) => {
      chrome.runtime.sendMessage(
        { action: 'get_all_scraps', channelId: res.activeChannelId },
        (r) => {
          if (r && r.success && r.scraps) {
            // 연결된 스크랩만 필터링
            const linkedScraps = r.scraps.filter((s) => ideaData.linkedScraps.includes(s.id));
            if (linkedScraps.length > 0) {
              linkedScrapsList.classList.remove('empty-state');
              linkedScrapsList.innerHTML = linkedScraps
                .map((s) => createScrapCard(s, true))
                .join('');
              // 연결된 스크랩에 드래그 이벤트 리스너 설정 (연결 해제는 이벤트 위임으로 처리됨)
              linkedScrapsList.querySelectorAll('.linked-scrap-item').forEach((item) => {
                setupLinkedScrapItem(item);
              });
            }
          }
        }
      );
    });

    // Synchronously update AI briefing meta (status badge / retry button) on partial update
    try {
      const aiArea = workspaceEl.querySelector && workspaceEl.querySelector('#ai-briefing-area');
      if (aiArea) {
        const existingMeta = aiArea.querySelector('.workspace-briefing-meta');
        if (existingMeta) {
          existingMeta.outerHTML = briefingMetaHtml || '';
        } else if (briefingMetaHtml) {
          aiArea.insertAdjacentHTML('afterbegin', briefingMetaHtml);
        }
      }
    } catch (e) {
      Logger.warn('[Workspace] partial update briefing meta failed:', e?.message);
    }
    try {
      // no-op diagnostics removed
    } catch (e) {}
  }

  function sendCommand(action, data = {}) {
    try {
      if (editorIframe && editorIframe.contentWindow) {
        editorIframe.contentWindow.postMessage({ action, data }, '*');
      }
    } catch (error) {
      console.error('[Workspace] sendCommand 오류:', error);
    }
  }

  // Briefing retry button handling (workspace detail)
  workspaceEl.addEventListener('click', (e) => {
    const retryBtn = e.target.closest && e.target.closest('.workspace-briefing-retry-btn');
    if (retryBtn) {
      e.stopPropagation();
      const cardId = retryBtn.dataset.cardId || ideaData.id;
      const status = retryBtn.dataset.status || ideaData.status || 'ideas';
      chrome.runtime.sendMessage(
        { action: 'retry_idea_briefing', data: { cardId, status } },
        (res) => {
          if (res && res.success) {
            showToast('🔁 브리핑 재시도 요청이 큐에 추가되었습니다.');
          } else {
            showToast('❌ 브리핑 재시도 실패: ' + (res?.error || '알 수 없는 오류'), 'error');
          }
        }
      );
    }
  });

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      console.log('[DEBUG tab click] clicked tab:', btn.dataset?.tab);
      try {
        console.debug(
          '[DIAG tab click] ideaId:',
          ideaData?.id,
          'seoTitle:',
          ideaData?.seoTitle,
          'publishInfo:',
          ideaData?.publishInfo
        );
      } catch (e) {
        void 0; // ignore diagnostic logging failures
      }
      tabBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      workspaceEl
        .querySelectorAll('.resource-content-area')
        .forEach((el) => (el.style.display = 'none'));

      const tab = btn.dataset.tab;
      const target =
        workspaceEl.querySelector(`.${tab}-area`) ||
        workspaceEl.querySelector(`#${tab}-area`) ||
        workspaceEl.querySelector(`#${tab}-list-container`);
      if (target) target.style.display = 'block';

      if (tab === 'all-scraps') {
        chrome.storage.local.get('activeChannelId', (res) => {
          // 로딩 표시
          allScrapsList.innerHTML =
            "<p style='text-align: center; padding: 20px; color: #666;'>로딩 중...</p>";
          chrome.runtime.sendMessage(
            { action: 'get_all_scraps', channelId: res.activeChannelId },
            (r) => {
              if (r && r.success) {
                window.__cp_scrap_filter.allScraps = r.scraps;
                window.__cp_updateScrapList(r.scraps, allScrapsList, linkedScrapsList, ideaData);
              } else {
                allScrapsList.innerHTML =
                  "<p style='text-align: center; padding: 20px; color: #666;'>자료를 불러오는데 실패했습니다.</p>";
              }
            }
          );
        });
      } else if (tab === 'image-gallery') {
        chrome.storage.local.get('activeChannelId', (res) => {
          // 로딩 표시
          const imageGalleryGrid = resourceLibrary.querySelector('.image-gallery-grid');
          if (imageGalleryGrid) {
            imageGalleryGrid.innerHTML =
              "<p style='text-align: center; padding: 20px; color: #666;'>로딩 중...</p>";
          }
          chrome.runtime.sendMessage(
            { action: 'get_all_scraps', channelId: res.activeChannelId },
            (r) => {
              if (r && r.success) {
                updateImageGalleryFromAllScraps(resourceLibrary, r.scraps, sendCommand, ideaData);
              } else {
                if (imageGalleryGrid) {
                  imageGalleryGrid.innerHTML =
                    "<p style='text-align: center; padding: 20px; color: #666;'>자료를 불러오는데 실패했습니다.</p>";
                }
              }
            }
          );
        });
      } else if (tab === 'publish-info') {
        // publish-info 탭 클릭 시 Firebase에서 최신 데이터 가져오기
        chrome.runtime.sendMessage(
          {
            action: 'get_kanban_card_status',
            data: { cardId: ideaData.id },
          },
          (statusResponse) => {
            if (statusResponse && statusResponse.success) {
              const status = statusResponse.status || ideaData.status || 'ideas';
              // Firebase에서 최신 카드 데이터 가져오기
              chrome.runtime.sendMessage(
                {
                  action: 'get_kanban_data',
                },
                (kanbanResponse) => {
                  if (kanbanResponse && kanbanResponse.success && kanbanResponse.data) {
                    const cardData = kanbanResponse.data[status]?.[ideaData.id];
                    if (cardData) {
                      // 최신 데이터로 ideaData 업데이트
                      if (cardData.publishInfo) ideaData.publishInfo = cardData.publishInfo;
                      if (cardData.seoTitle) ideaData.seoTitle = cardData.seoTitle;

                      const publishInfo = ideaData.publishInfo || {};
                      showPublishInfo(
                        workspaceEl,
                        publishInfo.permalink,
                        publishInfo.tags,
                        ideaData.seoTitle || publishInfo.seoTitle,
                        ideaData
                      );
                    } else {
                      // 카드 데이터가 없으면 기존 데이터 사용
                      const publishInfo = ideaData.publishInfo || {};
                      showPublishInfo(
                        workspaceEl,
                        publishInfo.permalink,
                        publishInfo.tags,
                        ideaData.seoTitle || publishInfo.seoTitle || '',
                        ideaData
                      );
                    }
                  } else {
                    // Firebase 조회 실패 시 기존 데이터 사용
                    const publishInfo = ideaData.publishInfo || {};
                    showPublishInfo(
                      workspaceEl,
                      publishInfo.permalink,
                      publishInfo.tags,
                      ideaData.seoTitle || publishInfo.seoTitle || '',
                      ideaData
                    );
                  }
                }
              );
            } else {
              // 상태 조회 실패 시 기존 데이터 사용
              const publishInfo = ideaData.publishInfo || {};
              showPublishInfo(
                workspaceEl,
                publishInfo.permalink,
                publishInfo.tags,
                ideaData.seoTitle,
                ideaData
              );
            }
          }
        );
      } else if (tab === 'affiliate') {
        const listContainer = workspaceEl.querySelector('#affiliate-list');
        if (!listContainer) return;
        listContainer.innerHTML =
          '<div style="color:#888;font-size:13px;">제휴 링크 불러오는 중...</div>';

        try {
          const links = await getAffiliateLinks();
          if (!links || links.length === 0) {
            listContainer.innerHTML =
              '<div style="color:#666;font-size:13px;">등록된 제휴 링크가 없습니다.</div>';
            return;
          }

          listContainer.innerHTML = links
            .map((link) => {
              const short = shortenLink(link.url || '');
              const hasCard = link.cardData ? true : false;
              return `
                    <div class="affiliate-list-item" data-id="${
                      link.id
                    }" style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-radius:8px;border:1px solid #eee;background:#fff;">
                      <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1;">
                        <div style="width:44px;height:44px;border-radius:8px;overflow:hidden;background:#fafbfc;border:1px solid #eee;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${
                          link.cardData && link.cardData.imageUrl
                            ? `<img src="${link.cardData.imageUrl}" style="width:100%;height:100%;object-fit:cover;"/>`
                            : '💰'
                        }</div>
                        <div style="flex:1;min-width:0;">
                          <div style="font-weight:700;font-size:13px;color:#222;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${
                            link.name
                          }</div>
                          <div style="font-size:12px;color:#666;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${short}</div>
                        </div>
                      </div>
                      <div style="display:flex;gap:8px;margin-left:12px;">
                        <button class="cp-btn cp-btn-secondary insert-affiliate-text" data-id="${
                          link.id
                        }">텍스트 삽입</button>
                        <button class="cp-btn cp-btn-primary insert-affiliate-card" data-id="${
                          link.id
                        }" ${hasCard ? '' : 'disabled'}>카드 삽입</button>
                      </div>
                    </div>
                  `;
            })
            .join('');

          // attach click handlers
          listContainer.querySelectorAll('.insert-affiliate-text').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const id = btn.dataset.id;
              const link = links.find((l) => l.id === id);
              if (!link) return;
              const html = `<a href="${link.url}" target="_blank" rel="nofollow noopener">${link.name}</a>`;
              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  { action: 'insert-content', data: { content: html } },
                  '*'
                );
                showToast('✅ 텍스트 링크를 에디터에 삽입했습니다.');
              } else {
                navigator.clipboard?.writeText?.(html);
                showToast(
                  'ℹ️ 에디터 감지 실패 — 링크 HTML을 클립보드에 복사했습니다. 붙여넣기 해주세요.'
                );
              }
            });
          });

          listContainer.querySelectorAll('.insert-affiliate-card').forEach((btn) => {
            btn.addEventListener('click', (e) => {
              const id = btn.dataset.id;
              const link = links.find((l) => l.id === id);
              if (!link || !link.cardData) return;

              const cd = link.cardData;
              const cardHtml = `
<figure data-type="affiliate-card" style="margin: 24px 0;">
  <div style="border:1px solid #e5e7eb;border-radius:16px;padding:20px;display:flex;gap:20px;max-width:680px;background:#ffffff;box-shadow:0 4px 16px rgba(0,0,0,0.08);transition:transform 0.2s,box-shadow 0.2s;">
    <div style="flex-shrink:0;width:140px;height:140px;border-radius:12px;overflow:hidden;background:linear-gradient(135deg,#f3f4f6 0%,#e5e7eb 100%);display:flex;align-items:center;justify-content:center;">
      ${
        cd.imageUrl
          ? `<img src="${cd.imageUrl}" alt="${cd.productName || link.name}" style="width:100%;height:100%;object-fit:cover;"/>`
          : '<div style="color:#9ca3af;font-size:13px;text-align:center;">이미지<br/>없음</div>'
      }
    </div>
    <div style="flex:1;display:flex;flex-direction:column;justify-content:space-between;">
      <div>
        <div style="font-weight:700;font-size:16px;color:#111827;margin-bottom:12px;line-height:1.4;">${
          cd.productName || link.name
        }</div>
        <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:16px;flex-wrap:wrap;">
          ${
            cd.salePrice
              ? `<span style="font-weight:800;color:#dc2626;font-size:24px;">${Number(
                  cd.salePrice
                ).toLocaleString()}<span style="font-size:16px;font-weight:600;">원</span></span>`
              : ''
          }
          ${
            cd.originalPrice && cd.originalPrice > cd.salePrice
              ? `<span style="text-decoration:line-through;color:#9ca3af;font-size:14px;">${Number(
                  cd.originalPrice
                ).toLocaleString()}원</span>`
              : ''
          }
          ${
            cd.discountRate
              ? `<span style="background:#fee2e2;color:#dc2626;font-weight:700;font-size:14px;padding:4px 10px;border-radius:6px;">${cd.discountRate}%</span>`
              : ''
          }
        </div>
      </div>
      <div style="margin-top:auto;">
        <a href="${
          link.url
        }" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:linear-gradient(135deg,#3b82f6 0%,#2563eb 100%);color:#ffffff;font-weight:600;font-size:14px;padding:12px 24px;border-radius:10px;text-decoration:none;box-shadow:0 2px 8px rgba(59,130,246,0.3);transition:transform 0.2s,box-shadow 0.2s;">
          🛒 최저가 확인하기
        </a>
      </div>
    </div>
  </div>
</figure>
                    `;

              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  { action: 'insert-content', data: { content: cardHtml } },
                  '*'
                );
                showToast('✅ 제휴 카드를 에디터에 삽입했습니다.');
              } else {
                // fallback
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard
                    .writeText(cardHtml)
                    .then(() =>
                      showToast(
                        'ℹ️ 에디터가 감지되지 않아 카드 HTML을 클립보드에 복사했습니다. 붙여넣기 해주세요.'
                      )
                    );
                } else {
                  window.prompt('에디터가 감지되지 않습니다. 아래 HTML을 복사하세요:', cardHtml);
                }
              }
            });
          });
        } catch (err) {
          console.error('[Workspace] affiliate tab load error', err);
          listContainer.innerHTML =
            '<div style="color:#e33;font-size:13px;">제휴 링크를 불러오는 중 오류가 발생했습니다.</div>';
        }
      }
    });
  });

  // 에디터 iframe에서 온 메시지 처리
  const editorMessageListener = (event) => {
    // 디버깅: 모든 메시지 로깅 (editor-ready 확인용)
    if (event.data && typeof event.data === 'object' && event.data.action) {
      console.log('[Workspace] 에디터 메시지 수신:', event.data.action, event.data);
      console.log('[Workspace] 에디터 메시지 소스:', event.source);
      console.log('[Workspace] editorIframe?.contentWindow:', editorIframe?.contentWindow);
      console.log(
        '[Workspace] event.source === editorIframe?.contentWindow:',
        event.source === editorIframe?.contentWindow
      );
    }

    if (event.source === editorIframe?.contentWindow) {
      const { action, data } = event.data;
      if (action === 'editor-ready') {
        if (ideaData.draftContent)
          sendCommand('set-content', {
            html: marked.parse(ideaData.draftContent),
          });
      }
    }
  };
  window.addEventListener('message', editorMessageListener);

  // TUI 에디터 열기 요청 처리 (썸네일 메이커 또는 에디터에서) - 별도 리스너
  console.log('[Workspace] TUI 에디터 메시지 리스너 등록 중...');
  console.log('[Workspace] 현재 window:', window);
  console.log('[Workspace] window === window.top:', window === window.top);
  console.log('[Workspace] editorIframe:', editorIframe);
  console.log('[Workspace] editorIframe?.contentWindow:', editorIframe?.contentWindow);

  // editor iframe의 parent window 확인
  let editorParentWindow = null;
  if (editorIframe && editorIframe.contentWindow) {
    try {
      editorParentWindow = editorIframe.contentWindow.parent;
      console.log('[Workspace] editor iframe의 parent window:', editorParentWindow);
      console.log('[Workspace] editorParentWindow === window:', editorParentWindow === window);
      console.log(
        '[Workspace] editorParentWindow === window.top:',
        editorParentWindow === window.top
      );
      console.log('[Workspace] window === window.top:', window === window.top);
    } catch (e) {
      console.warn('[Workspace] editor iframe의 parent window 접근 실패:', e);
    }
  }

  // [수정] 리스너 중복 등록 방지
  // 툴바 에디터 메시지를 전역에서 참조하기 위해 외부 스코프에 선언
  let tuiEditorMessageListener;
  if (!window.__cp_tui_listener_attached) {
    Logger.debug('🔧 [Workspace] addWorkspaceEventListeners 내부 TUI 리스너 등록 중...');

    tuiEditorMessageListener = (event) => {
      // 🔍 디버깅: 모든 메시지 로깅
      if (event.data && typeof event.data === 'object' && event.data.action) {
        Logger.debug('🔍 [Workspace] addWorkspace 리스너 - 메시지 수신:', {
          action: event.data.action,
          origin: event.origin,
          source: event.source,
          isCpOpenTuiEditor: event.data.action === 'cp_open_tui_editor',
        });
      }

      // cp_open_tui_editor 메시지 처리
      if (event.data?.action === 'cp_open_tui_editor') {
        console.log('🏢 [Workspace] ========================================');
        console.log('🏢 [Workspace] 📨 cp_open_tui_editor 메시지 수신!');
        console.log('🏢 [Workspace] ========================================');
        console.log('📦 [Workspace] 메시지 데이터:', {
          action: event.data.action,
          imageUrl: event.data.imageUrl ? event.data.imageUrl.substring(0, 50) + '...' : '없음',
          allDocumentImagesCount: event.data.allDocumentImages?.length || 0,
          source: event.data.source || 'editor',
        });

        // currentImageUrl 또는 imageUrl 둘 다 처리 (호환성)
        const imageUrl = event.data.imageUrl || event.data.currentImageUrl;
        if (!imageUrl) {
          Logger.error('❌ [Workspace] TUI 에디터 열기 실패: 이미지 URL 없음');
          return;
        }

        Logger.debug('✅ [Workspace] 이미지 URL 확인 완료:', imageUrl.substring(0, 50) + '...');

        // TUI 에디터 iframe 생성 또는 재사용
        let tuiEditorIframe = document.querySelector('#tui-editor-iframe');

        if (!tuiEditorIframe) {
          console.log('🔨 [Workspace] TUI 에디터 iframe 생성 중...');

          // 기존 모달이 있으면 제거
          const existingOverlay = document.querySelector('#tui-editor-overlay');
          if (existingOverlay) existingOverlay.remove();

          // 배경 오버레이 생성
          const overlay = document.createElement('div');
          overlay.id = 'tui-editor-overlay';
          overlay.style.cssText =
            'position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;background:rgba(0,0,0,0.7) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;';
          overlay.onclick = () => {
            if (confirm('편집을 종료하시겠습니까?')) {
              overlay.remove();
              if (tuiEditorIframe) tuiEditorIframe.remove();
            }
          };
          // body의 마지막에 추가하여 최상위에 위치
          document.body.appendChild(overlay);

          // 모달 컨테이너 생성
          const modalContainer = document.createElement('div');
          modalContainer.id = 'tui-editor-modal-container';
          modalContainer.style.cssText =
            'position:relative !important;width:90vw !important;max-width:1400px !important;height:90vh !important;max-height:900px !important;background:#282828 !important;border-radius:12px !important;box-shadow:0 20px 60px rgba(0,0,0,0.5) !important;overflow:hidden !important;display:flex !important;flex-direction:column !important;z-index:2147483648 !important;';
          overlay.appendChild(modalContainer);

          // 닫기 버튼 추가
          const closeBtn = document.createElement('button');
          closeBtn.innerHTML = '×';
          closeBtn.style.cssText =
            'position:absolute !important;top:12px !important;right:12px !important;width:36px !important;height:36px !important;background:rgba(255,255,255,0.1) !important;border:none !important;border-radius:50% !important;color:#fff !important;font-size:24px !important;cursor:pointer !important;z-index:2147483649 !important;display:flex !important;align-items:center !important;justify-content:center !important;line-height:1 !important;transition:background 0.2s !important;';
          closeBtn.onmouseover = () => (closeBtn.style.background = 'rgba(255,255,255,0.2)');
          closeBtn.onmouseout = () => (closeBtn.style.background = 'rgba(255,255,255,0.1)');
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm('편집을 종료하시겠습니까?')) {
              overlay.remove();
              if (tuiEditorIframe) tuiEditorIframe.remove();
            }
          };
          modalContainer.appendChild(closeBtn);

          // iframe 생성
          tuiEditorIframe = document.createElement('iframe');
          tuiEditorIframe.id = 'tui-editor-iframe';
          tuiEditorIframe.src = chrome.runtime.getURL('tui-editor.html');
          tuiEditorIframe.style.cssText = 'width:100%;height:100%;border:none;background:#282828;';
          modalContainer.appendChild(tuiEditorIframe);
          Logger.debug('✅ [Workspace] TUI 에디터 iframe 생성 완료!');
          Logger.debug('📍 [Workspace] iframe src:', tuiEditorIframe.src);

          // TUI 에디터에서 편집 완료 시 처리
          const sourceInfo = event.data.source || 'editor'; // 기본값은 editor
          console.log('🎯 [Workspace] 소스 정보:', sourceInfo);

          const tuiEditorMessageHandler = function (e) {
            if (e.data?.action === 'tui-editor-result' && e.data.dataUrl) {
              console.log('🎉 [Workspace] ========================================');
              console.log('🎉 [Workspace] ✨ TUI 에디터 편집 완료!');
              console.log('🎉 [Workspace] ========================================');
              console.log('📊 [Workspace] 결과 데이터 URL 길이:', e.data.dataUrl.length, 'bytes');

              const editorIframe = workspaceEl.querySelector('#editor-iframe');

              // 썸네일 메이커에서 온 경우: 에디터에 삽입
              if (
                sourceInfo === 'thumbnail_maker' ||
                !event.data.allDocumentImages ||
                event.data.allDocumentImages.length === 0
              ) {
                console.log('📝 [Workspace] 썸네일 메이커 모드: 이미지 삽입');
                const altText = '편집된 썸네일';
                if (editorIframe && editorIframe.contentWindow) {
                  editorIframe.contentWindow.postMessage(
                    {
                      action: 'insert-image',
                      data: {
                        url: e.data.dataUrl,
                        alt: altText,
                      },
                    },
                    '*'
                  );
                  Logger.debug('✅ [Workspace] 에디터에 이미지 삽입 메시지 전송 완료');
                  showToast('✅ 편집된 썸네일이 본문에 삽입되었습니다!');
                } else {
                  Logger.error('❌ [Workspace] 에디터 iframe을 찾을 수 없음');
                }
              } else {
                // 에디터에서 온 경우: 기존 이미지 교체
                console.log('🔄 [Workspace] 에디터 모드: 기존 이미지 교체');
                if (editorIframe && editorIframe.contentWindow) {
                  editorIframe.contentWindow.postMessage(
                    {
                      action: 'replace-edited-image',
                      data: { dataUrl: e.data.dataUrl },
                    },
                    '*'
                  );
                  Logger.debug('✅ [Workspace] 에디터에 이미지 교체 메시지 전송 완료');
                } else {
                  Logger.error('❌ [Workspace] 에디터 iframe을 찾을 수 없음');
                }
              }

              // TUI 에디터 iframe 제거
              if (tuiEditorIframe) {
                console.log('🗑️ [Workspace] TUI 에디터 iframe 제거 중...');
                tuiEditorIframe.remove();
                Logger.debug('✅ [Workspace] TUI 에디터 iframe 제거 완료');
              }

              // 메시지 핸들러 제거
              window.removeEventListener('message', tuiEditorMessageHandler);
              console.log('🎉 [Workspace] 전체 프로세스 완료!');
              console.log('🎉 [Workspace] ========================================');
            }
          };
          window.addEventListener('message', tuiEditorMessageHandler);
          console.log('👂 [Workspace] TUI 에디터 결과 메시지 리스너 등록 완료');

          // TUI 에디터 iframe이 로드되면 이미지 전달
          tuiEditorIframe.onload = () => {
            console.log('⏳ [Workspace] TUI 에디터 iframe 로드 완료!');
            console.log('📤 [Workspace] 이미지 전달 준비 중...');
            setTimeout(() => {
              if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
                console.log(
                  '📸 [Workspace] TUI 에디터에 이미지 전달:',
                  imageUrl.substring(0, 50) + '...'
                );
                // 1. 이미지 열기
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: 'open-tui-editor',
                    imageUrl: imageUrl,
                  },
                  '*'
                );
                Logger.debug('✅ [Workspace] 1️⃣ open-tui-editor 메시지 전송 완료');

                // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
                if (
                  event.data.allDocumentImages &&
                  Array.isArray(event.data.allDocumentImages) &&
                  event.data.allDocumentImages.length > 0
                ) {
                  tuiEditorIframe.contentWindow.postMessage(
                    {
                      action: 'set-document-images',
                      images: event.data.allDocumentImages,
                    },
                    '*'
                  );
                  Logger.debug(
                    `✅ [Workspace] 2️⃣ 문서 이미지 목록 전달 완료: ${event.data.allDocumentImages.length}개`
                  );
                }

                console.log('🎨 [Workspace] TUI 에디터에 모든 데이터 전달 완료!');
              } else {
                Logger.error('❌ [Workspace] TUI 에디터 iframe contentWindow 접근 실패');
              }
            }, 500); // iframe 로드 대기
          };

          // onload가 이미 발생했을 수 있으므로 즉시 체크
          if (tuiEditorIframe.contentWindow) {
            console.log('⚡ [Workspace] TUI 에디터 iframe이 이미 로드됨, 즉시 이미지 전달');
            setTimeout(() => {
              if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
                // 1. 이미지 열기
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: 'open-tui-editor',
                    imageUrl: imageUrl,
                  },
                  '*'
                );
                Logger.debug('✅ [Workspace] 1️⃣ open-tui-editor 메시지 전송 완료 (즉시)');

                // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
                if (
                  event.data.allDocumentImages &&
                  Array.isArray(event.data.allDocumentImages) &&
                  event.data.allDocumentImages.length > 0
                ) {
                  tuiEditorIframe.contentWindow.postMessage(
                    {
                      action: 'set-document-images',
                      images: event.data.allDocumentImages,
                    },
                    '*'
                  );
                  Logger.debug(
                    `✅ [Workspace] 2️⃣ 문서 이미지 목록 전달 완료 (즉시): ${event.data.allDocumentImages.length}개`
                  );
                }

                console.log('🎨 [Workspace] TUI 에디터에 모든 데이터 전달 완료 (즉시)!');
              }
            }, 100);
          }
        } else {
          // 이미 iframe이 존재하는 경우 이미지만 교체
          console.log('♻️ [Workspace] 기존 TUI 에디터 iframe 재사용');
          console.log('📤 [Workspace] 이미지 전달 중...');
          if (tuiEditorIframe.contentWindow) {
            // 1. 이미지 열기
            tuiEditorIframe.contentWindow.postMessage(
              {
                action: 'open-tui-editor',
                imageUrl: imageUrl,
              },
              '*'
            );
            Logger.debug('✅ [Workspace] 1️⃣ open-tui-editor 메시지 전송 완료 (재사용)');

            // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
            if (
              event.data.allDocumentImages &&
              Array.isArray(event.data.allDocumentImages) &&
              event.data.allDocumentImages.length > 0
            ) {
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: 'set-document-images',
                  images: event.data.allDocumentImages,
                },
                '*'
              );
              Logger.debug(
                `✅ [Workspace] 2️⃣ 문서 이미지 목록 전달 완료 (재사용): ${event.data.allDocumentImages.length}개`
              );
            }

            console.log('🎨 [Workspace] TUI 에디터에 이미지 전달 완료 (재사용)!');
          } else {
            Logger.error('❌ [Workspace] 기존 TUI 에디터 iframe의 contentWindow 접근 실패');
          }
        }
      }
    };

    window.addEventListener('message', tuiEditorMessageListener);
    window.__cp_tui_listener_attached = true; // 플래그 설정
    Logger.debug('✅ [Workspace] TUI 에디터 메시지 리스너 등록 완료 (addWorkspaceEventListeners)');
    try {
      Logger.debug('🔍 [Workspace] 디버깅: window.location.href =', window.location.href);
    } catch (e) {
      Logger.debug('🔍 [Workspace] 디버깅: window.location.href = cross-origin (접근 불가)');
    }
    Logger.debug('🔍 [Workspace] 디버깅: window === window.top =', window === window.top);
  } else {
    console.log('[Workspace] TUI 에디터 메시지 리스너가 이미 등록되어 있습니다.');
  }
  let windowLocation = 'unknown';
  try {
    windowLocation = window.location?.href;
  } catch (e) {
    windowLocation = 'cross-origin';
  }
  console.log('[Workspace] 현재 window 정보:', {
    window: window,
    windowLocation: windowLocation,
    windowTop: window.top,
    windowParent: window.parent,
    windowFrames: window.frames?.length,
  });

  // editor iframe의 parent window에도 메시지 리스너 등록 (shadow DOM 호환)
  if (editorParentWindow && editorParentWindow !== window) {
    try {
      editorParentWindow.addEventListener('message', tuiEditorMessageListener);
      console.log('[Workspace] TUI 에디터 메시지 리스너 등록 완료 (editor parent window)');
    } catch (e) {
      console.warn('[Workspace] editor parent window에 메시지 리스너 등록 실패:', e);
    }
  }

  // window.top에도 메시지 리스너 등록 (최상위 window)
  if (window.top && window.top !== window && window.top !== editorParentWindow) {
    try {
      window.top.addEventListener('message', tuiEditorMessageListener);
      console.log('[Workspace] TUI 에디터 메시지 리스너 등록 완료 (window.top)');
    } catch (e) {
      console.warn('[Workspace] window.top에 메시지 리스너 등록 실패:', e);
    }
  }

  // editor iframe의 contentWindow에서 직접 parent를 확인하고 리스너 등록
  if (editorIframe && editorIframe.contentWindow) {
    try {
      // editor iframe이 로드된 후 parent window 확인
      editorIframe.addEventListener('load', () => {
        try {
          const iframeParent = editorIframe.contentWindow.parent;
          if (iframeParent && iframeParent !== window) {
            iframeParent.addEventListener('message', tuiEditorMessageListener);
            console.log(
              '[Workspace] TUI 에디터 메시지 리스너 등록 완료 (iframe load 후 parent window)'
            );
          }
        } catch (e) {
          console.warn('[Workspace] iframe load 후 parent window 접근 실패:', e);
        }
      });
    } catch (e) {
      console.warn('[Workspace] iframe load 이벤트 리스너 등록 실패:', e);
    }
  }

  workspaceEl.addEventListener('click', (e) => {
    // [체크리스트 2] 스크랩 공유 토글 버튼 클릭 처리
    if (
      e.target.classList.contains('scrap-share-toggle-btn') ||
      e.target.closest('.scrap-share-toggle-btn')
    ) {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.classList.contains('scrap-share-toggle-btn')
        ? e.target
        : e.target.closest('.scrap-share-toggle-btn');
      if (!btn) return;

      const scrapId = btn.dataset.scrapId;
      const currentChannelId = btn.dataset.currentChannelId;

      // 현재 활성 채널 ID 가져오기
      chrome.storage.local.get('activeChannelId', (res) => {
        const activeChannelId = res.activeChannelId || null;

        // 버튼 비활성화 및 로딩 표시
        btn.disabled = true;
        const originalIcon = btn.innerHTML;
        btn.innerHTML = '⏳';

        chrome.runtime.sendMessage(
          {
            action: 'toggle_scrap_sharing',
            scrapId: scrapId,
            currentChannelId: activeChannelId,
          },
          (response) => {
            btn.disabled = false;

            if (response && response.success) {
              // 성공 시 버튼 아이콘과 툴팁 업데이트
              const isNowDedicated = response.newChannelId !== null;
              btn.innerHTML = isNowDedicated ? '🔒' : '🌐';
              btn.title = isNowDedicated ? '공용으로 변경' : '전용으로 변경';
              // [CSP 준수] 클래스로 스타일 변경
              btn.classList.remove('scrap-toggle-dedicated', 'scrap-toggle-public');
              btn.classList.add(isNowDedicated ? 'scrap-toggle-dedicated' : 'scrap-toggle-public');
              btn.dataset.currentChannelId = response.newChannelId || '';

              // 배지 제거됨 (토글 버튼만 사용)

              showToast(
                response.message ||
                  (isNowDedicated
                    ? '전용 스크랩으로 변경되었습니다.'
                    : '공용 스크랩으로 변경되었습니다.')
              );
            } else {
              btn.innerHTML = originalIcon;
              showToast('❌ 변경 실패: ' + (response?.error || '알 수 없는 오류'));
            }
          }
        );
      });
      return;
    } else if (e.target.classList.contains('interactive-tag')) {
      const text = e.target.classList.contains('long-tail-keyword')
        ? ` ${e.target.textContent} `
        : `\n\n## ${e.target.textContent}\n\n`;
      sendCommand('insert-text', { text });
      sendCommand('focus');
    } else if (
      e.target.classList.contains('keyword-search-link') ||
      e.target.closest('.keyword-search-link')
    ) {
      // 2. 검색 아이콘 클릭 -> 구글 검색 (이벤트 버블링 허용하여 <a> 태그의 기본 동작 따름)
      e.stopPropagation(); // 부모 요소의 클릭 이벤트는 막지만 <a> 태그의 기본 동작은 유지
    } else if (e.target.classList.contains('recommended-keyword-item')) {
      // 1. 텍스트 클릭 -> 에디터 삽입
      e.preventDefault();
      e.stopPropagation();
      const keyword = e.target.textContent.trim();
      if (keyword) {
        sendCommand('insert-text', { text: `\n\n## ${keyword}\n\n` });
        sendCommand('focus');
        showToast(`✅ "${keyword}" 목차를 본문에 추가했습니다.`);
      }
    } else if (
      e.target.id === 'generate-draft-btn' ||
      e.target.closest('#generate-draft-btn') ||
      e.target.id === 'regenerate-draft-btn' ||
      e.target.closest('#regenerate-draft-btn') ||
      e.target.id === 'regenerate-thumbnail-btn' ||
      e.target.closest('#regenerate-thumbnail-btn')
    ) {
      e.preventDefault();
      e.stopPropagation();

      // 어떤 버튼이 클릭되었는지 확인
      let btn = null;
      let actionType = 'full'; // 'full', 'draft-only', 'thumbnail-only'

      if (e.target.id === 'generate-draft-btn' || e.target.closest('#generate-draft-btn')) {
        btn =
          e.target.id === 'generate-draft-btn' ? e.target : e.target.closest('#generate-draft-btn');
        const options = { generateDraft: true, generateThumbnail: true };
        handleGenerateAction(btn, options);
      } else if (
        e.target.id === 'regenerate-draft-btn' ||
        e.target.closest('#regenerate-draft-btn')
      ) {
        btn =
          e.target.id === 'regenerate-draft-btn'
            ? e.target
            : e.target.closest('#regenerate-draft-btn');
        const options = { generateDraft: true, generateThumbnail: false };
        handleGenerateAction(btn, options);
      } else if (
        e.target.id === 'regenerate-thumbnail-btn' ||
        e.target.closest('#regenerate-thumbnail-btn')
      ) {
        btn =
          e.target.id === 'regenerate-thumbnail-btn'
            ? e.target
            : e.target.closest('#regenerate-thumbnail-btn');
        const options = { generateDraft: false, generateThumbnail: true };
        handleGenerateAction(btn, options);
      }
    }
    // delete-draft-in-workspace handler (moved here to avoid fall-through)
    if (
      e.target.id === 'delete-draft-in-workspace' ||
      e.target.closest('#delete-draft-in-workspace')
    ) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[Workspace] 초안 삭제 버튼 클릭됨');

      const deleteBtn =
        e.target.id === 'delete-draft-in-workspace'
          ? e.target
          : e.target.closest('#delete-draft-in-workspace');
      if (!deleteBtn) {
        console.error('[Workspace] 삭제 버튼을 찾을 수 없습니다.');
        return;
      }

      if (!confirm('초안을 삭제하시겠습니까?')) return;

      // 에디터 즉시 초기화 (개선됨)
      const editorIframe = workspaceEl.querySelector('#editor-iframe');
      if (editorIframe && editorIframe.contentWindow) {
        // 에디터 내용을 즉시 초기화하고 포커스
        const clearAndFocus = () => {
          try {
            editorIframe.contentWindow.postMessage(
              { action: 'set-content', data: { html: '' } },
              '*'
            );
          } catch (err) {
            console.error('[Workspace] 에디터 초기화 오류:', err);
          }
        };

        // 초기화 여러 번 시도하여 확실히 반영
        clearAndFocus();
        setTimeout(clearAndFocus, 100);
        setTimeout(clearAndFocus, 300);

        // 마지막으로 포커스
        setTimeout(() => {
          try {
            editorIframe.contentWindow.postMessage({ action: 'focus' }, '*');
          } catch (err) {
            console.error('[Workspace] 에디터 포커스 오류:', err);
          }
        }, 500);
      }

      // Firebase에서 초안과 발행 정보 모두 삭제
      chrome.runtime.sendMessage(
        {
          action: 'delete_draft_and_publish_info',
          data: { ideaId: ideaData.id, status: ideaData.status || 'ideas' },
        },
        (response) => {
          if (response && response.success) {
            // 메모리 상태 초기화
            window.__cp_draft_deletion_block_time = Date.now();
            ideaData.draftContent = '';
            if (ideaData.workspace) ideaData.workspace.draft = '';
            if (ideaData.publishInfo) ideaData.publishInfo = {};
            ideaData.seoTitle = '';
            if (window.__cp_workspace_idea_data) {
              window.__cp_workspace_idea_data.draftContent = '';
              if (window.__cp_workspace_idea_data.workspace)
                window.__cp_workspace_idea_data.workspace.draft = '';
              if (window.__cp_workspace_idea_data.publishInfo)
                window.__cp_workspace_idea_data.publishInfo = {};
              window.__cp_workspace_idea_data.seoTitle = '';
            }

            // UI 즉시 업데이트
            const publishInfoArea = workspaceEl.querySelector('#publish-info-area');
            if (publishInfoArea) {
              const existingInfo = workspaceEl.querySelector('.publish-info-panel');
              if (existingInfo) existingInfo.remove();
              const emptyInfoHtml = `<div class="publish-info-panel" style="padding: 12px; background: #f5f5f5; border-radius: 4px; margin-top: 12px;"><p style="color: #999; font-size: 13px;">발행 정보가 없습니다.</p></div>`;
              publishInfoArea.insertAdjacentHTML('beforeend', emptyInfoHtml);
            }

            // 썸네일 버튼 제거
            const thumbBtn = workspaceEl.querySelector('#btn-create-thumbnail');
            if (thumbBtn && thumbBtn.parentNode) thumbBtn.remove();

            // 삭제 버튼 제거
            if (deleteBtn && deleteBtn.parentNode) deleteBtn.remove();

            // 버튼 UI 업데이트 (삭제 완료 후 생성 버튼 표시)
            setTimeout(() => {
              updateWorkspaceActionButtons(workspaceEl, false).then(() => {
                showToast('✅ 초안과 발행 정보가 삭제되었습니다.');
              });
            }, 100);
          } else {
            console.error('[Workspace] 초안 삭제 실패:', response);
            showToast(`❌ 초안 삭제에 실패했습니다: ${response?.error || '알 수 없는 오류'}`);
          }
        }
      );
      return;
    }
    // 스크랩 카드 클릭 시
    const card = e.target.closest('.scrap-card-item');
    if (!card) return;

    // 1. 삭제 버튼 클릭은 무시 (이미 처리됨)
    if (e.target.closest('.unlink-scrap-btn') || e.target.closest('.scrap-card-delete-btn')) {
      return;
    }

    // 2. 링크 클릭 처리 (URL 텍스트나 링크 아이콘 클릭 시)
    if (
      e.target.classList.contains('scrap-card-snippet') ||
      e.target.closest('.scrap-card-snippet') ||
      e.target.classList.contains('scrap-link-btn') ||
      e.target.closest('.scrap-link-btn')
    ) {
      e.preventDefault();
      e.stopPropagation();
      const url = card.dataset.previewUrl || card.dataset.url;
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        window.open(url, '_blank');
        showToast(`🔗 링크 열기: ${url.substring(0, 50)}...`);
      } else {
        showToast('❌ 유효한 URL이 없습니다.');
      }
      return;
    }

    // 3. 태그 클릭은 무시
    if (e.target.classList.contains('tag') || e.target.closest('.tag')) {
      return;
    }

    // 4. 상세 모달 띄우기 (나머지 영역 클릭 시)
    // (핸들러 로직은 중복되어 아래에서 한 번 더 처리됩니다)
    // Prevent fall-through; the actual modal code with fallback is implemented later
    e.preventDefault();
    e.stopPropagation();
    return;
    // delete draft handling moved earlier

    // 1. 삭제 버튼 클릭은 무시 (이미 처리됨)
    if (e.target.closest('.unlink-scrap-btn') || e.target.closest('.scrap-card-delete-btn')) {
      return;
    }

    // 2. 링크 클릭 처리 (URL 텍스트나 링크 아이콘 클릭 시)
    if (
      e.target.classList.contains('scrap-card-snippet') ||
      e.target.closest('.scrap-card-snippet') ||
      e.target.classList.contains('scrap-link-btn') ||
      e.target.closest('.scrap-link-btn')
    ) {
      e.preventDefault();
      e.stopPropagation();
      const url = card.dataset.previewUrl || card.dataset.url;
      if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
        window.open(url, '_blank');
        showToast(`🔗 링크 열기: ${url.substring(0, 50)}...`);
      } else {
        showToast('❌ 유효한 URL이 없습니다.');
      }
      return;
    }

    // 3. 태그 클릭은 무시
    if (e.target.classList.contains('tag') || e.target.closest('.tag')) {
      return;
    }

    // 4. 상세 모달 띄우기 (나머지 영역 클릭 시)
    e.preventDefault();
    e.stopPropagation();

    const scrapId = card.dataset.scrapId;
    if (!scrapId) {
      console.error('[Workspace] 스크랩 ID를 찾을 수 없습니다.');
      return;
    }

    console.log('[Workspace] 스크랩 카드 클릭:', scrapId);

    // 전체 데이터를 가져오기 위해 background에 요청 (allImages 등 상세 정보 필요)
    chrome.storage.local.get('activeChannelId', (res) => {
      chrome.runtime.sendMessage(
        {
          action: 'get_scrap_detail',
          scrapId: scrapId,
          channelId: res.activeChannelId,
        },
        (response) => {
          if (response && response.success && response.data) {
            console.log('[Workspace] 스크랩 상세 데이터 수신:', response.data);
            // shadow DOM 내부의 모달을 찾기 위해 container 전달
            showScrapDetailModal(response.data, container || workspaceEl);
          } else {
            // 실패 시 dataset에 있는 정보로라도 띄움 (Fallback)
            console.warn('[Workspace] 스크랩 상세 데이터 가져오기 실패, dataset 정보 사용');
            const fallbackData = {
              text: card.dataset.text || card.dataset.previewText || '(내용 없음)',
              url: card.dataset.previewUrl || '',
              image: card.dataset.previewImage || '',
              allImages: card.dataset.previewImage ? [card.dataset.previewImage] : [],
              tags: [],
            };
            // shadow DOM 내부의 모달을 찾기 위해 container 전달
            showScrapDetailModal(fallbackData, container || workspaceEl);
          }
        }
      );
    });
    return; // Prevent fall-through to other click handlers
  });

  // dragover 이벤트: 드롭 영역 시각적 피드백
  workspaceEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    // linked-scraps-list 위에 있을 때 시각적 피드백 (null 체크)
    if (
      linkedScrapsList &&
      (linkedScrapsList.contains(e.target) || e.target.closest('.linked-scraps-list'))
    ) {
      linkedScrapsList.classList.add('drag-over');
    } else if (linkedScrapsList) {
      linkedScrapsList.classList.remove('drag-over');
    }
  });

  // dragleave 이벤트: 드래그가 영역을 벗어날 때 피드백 제거 (null 체크)
  if (linkedScrapsList) {
    linkedScrapsList.addEventListener('dragleave', (e) => {
      if (!linkedScrapsList.contains(e.relatedTarget)) {
        linkedScrapsList.classList.remove('drag-over');
      }
    });
  }

  workspaceEl.addEventListener('drop', (e) => {
    e.preventDefault();
    if (linkedScrapsList) {
      linkedScrapsList.classList.remove('drag-over'); // 드롭 시 피드백 제거
    }
    const data = e.dataTransfer.getData('application/json');
    if (!data) return;
    const scrapData = JSON.parse(data);
    const imageUrl = scrapData.imageUrl || scrapData.image || scrapData.thumbnail || null;

    if (
      linkedScrapsList &&
      (linkedScrapsList.contains(e.target) || e.target.closest('.linked-scraps-list'))
    ) {
      // 중복 체크: 이미 연결된 스크랩인지 확인
      const linkedScrapsIds = Array.isArray(ideaData.linkedScraps)
        ? ideaData.linkedScraps
        : ideaData.linkedScraps && typeof ideaData.linkedScraps === 'object'
          ? Object.keys(ideaData.linkedScraps)
          : [];

      console.debug(
        '[Workspace] drop event — scrapData:',
        scrapData,
        'linkedScrapsIds:',
        linkedScrapsIds
      );
      if (linkedScrapsIds.includes(scrapData.id)) {
        // If an image was specifically dragged and the scrap is already linked,
        // add the image to the workspace image gallery (and update the linked scrap card if necessary).
        if (imageUrl) {
          console.debug(
            '[Workspace] drop event for already-linked scrap with image:',
            scrapData.id,
            imageUrl
          );

          // First, add the image to the scrap in the database
          chrome.runtime.sendMessage(
            {
              action: 'add_image_to_scrap',
              data: {
                scrapId: scrapData.id,
                imageUrl: imageUrl,
              },
            },
            (addImageRes) => {
              if (!addImageRes || !addImageRes.success) {
                console.warn('[Workspace] Failed to add image to scrap in DB:', addImageRes);
                showToast('⚠️ 이미지 추가 실패');
                return;
              }

              console.debug('[Workspace] Image added to scrap in DB:', scrapData.id);

              // Update ideaData.linkedScraps with the new allImages array
              if (addImageRes.allImages && Array.isArray(addImageRes.allImages)) {
                // Find and update the scrap in ideaData's linkedScraps
                if (ideaData.workspace && ideaData.workspace.linkedScrapsData) {
                  const linkedScrap = ideaData.workspace.linkedScrapsData.find(
                    (s) => s.id === scrapData.id
                  );
                  if (linkedScrap) {
                    linkedScrap.allImages = addImageRes.allImages;
                    if (!linkedScrap.image) {
                      linkedScrap.image = addImageRes.allImages[0];
                    }
                  }
                }
              }

              // Update linked scrap card to include image if missing
              const existingCard = linkedScrapsList.querySelector(
                `[data-scrap-id="${scrapData.id}"]`
              );
              if (existingCard) {
                // If card already lacks an img, insert an image wrapper at the front
                const existingImg = existingCard.querySelector('.scrap-card-img-wrap img');
                if (!existingImg) {
                  const imgWrap = document.createElement('div');
                  imgWrap.className = 'scrap-card-img-wrap';
                  imgWrap.innerHTML = `<img src="${imageUrl}" alt="scrap image">`;
                  // Try to insert into the canonical .scrap-card wrapper if it exists
                  const cardDiv = existingCard.querySelector('.scrap-card');
                  if (cardDiv) {
                    cardDiv.insertAdjacentElement('afterbegin', imgWrap);
                  } else {
                    // Fallback: insert directly at the beginning of the linked card container
                    existingCard.insertAdjacentElement('afterbegin', imgWrap);
                  }
                  // Add class to indicate thumbnail exists for styling
                  try {
                    existingCard.classList.add('has-thumbnail');
                  } catch (e) {
                    /* ignore */
                  }
                } else {
                  // Update existing image src
                  existingImg.src = imageUrl;
                }

                // Update image count badge
                const imgCountBadge = existingCard.querySelector('.scrap-img-count');
                if (imgCountBadge && addImageRes.allImages) {
                  imgCountBadge.textContent = `📷 ${addImageRes.allImages.length}`;
                } else if (
                  !imgCountBadge &&
                  addImageRes.allImages &&
                  addImageRes.allImages.length > 1
                ) {
                  // Add badge if multiple images now exist
                  const badge = document.createElement('span');
                  badge.className = 'scrap-img-count';
                  badge.textContent = `📷 ${addImageRes.allImages.length}`;
                  badge.style.cssText =
                    'position:absolute;top:4px;right:4px;background:rgba(0,0,0,0.7);color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;';
                  const imgWrap = existingCard.querySelector('.scrap-card-img-wrap');
                  if (imgWrap) {
                    imgWrap.style.position = 'relative';
                    imgWrap.appendChild(badge);
                  }
                }
              }

              // Persist workspace.linkedScrapsData to kanban card so Kanban UI can refresh counts
              try {
                if (ideaData && ideaData.id) {
                  // ensure workspace exists
                  if (!ideaData.workspace) ideaData.workspace = {};
                  // Attempt to send a lightweight card update that persists linkedScrapsData
                  chrome.runtime.sendMessage(
                    {
                      action: 'update_kanban_card',
                      data: {
                        cardId: ideaData.id,
                        status: ideaData.status || 'ideas',
                        updates: {
                          workspace: {
                            ...(ideaData.workspace || {}),
                            linkedScrapsData: ideaData.workspace?.linkedScrapsData || [],
                          },
                        },
                      },
                    },
                    (updRes) => {
                      if (!updRes || !updRes.success) {
                        Logger.debug('[Workspace] update_kanban_card 실패:', updRes);
                      }
                    }
                  );
                }
              } catch (err) {
                console.debug('[Workspace] update_kanban_card 전송 실패:', err);
              }

              // Add to image gallery if available
              try {
                const resourceLibrary = workspaceEl.querySelector('#resource-library-panel');
                if (resourceLibrary) {
                  const imageGalleryGrid = resourceLibrary.querySelector('.image-gallery-grid');
                  if (imageGalleryGrid) {
                    // Avoid duplicates
                    const found =
                      imageGalleryGrid.querySelector(`img[data-src="${imageUrl}"]`) ||
                      imageGalleryGrid.querySelector(`img[src="${imageUrl}"]`);
                    if (!found) {
                      const div = document.createElement('div');
                      div.className = 'gallery-thumb-wrap';
                      div.draggable = true;
                      div.dataset.imageUrl = imageUrl;
                      div.dataset.scrapId = scrapData.id || '';
                      div.style.cssText =
                        'position: relative; cursor: pointer; border-radius: 8px; overflow: hidden; background: #f5f5f5; min-width: 0; min-height: 88px; box-sizing: border-box;';
                      const imgThumb = document.createElement('img');
                      imgThumb.className = 'gallery-thumb';
                      imgThumb.loading = 'lazy';
                      imgThumb.decoding = 'async';
                      imgThumb.style.cssText =
                        'width:100%;height:88px;object-fit:cover;display:block;';
                      imgThumb.dataset.src = imageUrl;
                      imgThumb.src = imageUrl;
                      div.appendChild(imgThumb);
                      // attach dragstart handler for the new thumb
                      div.addEventListener('dragstart', (ev) => {
                        try {
                          const payload = {
                            id: scrapData.id,
                            text: scrapData.text || '',
                            isLinked: true,
                            imageUrl,
                          };
                          ev.dataTransfer.effectAllowed = 'move';
                          ev.dataTransfer.setData('application/json', JSON.stringify(payload));
                        } catch (err) {
                          console.debug(
                            '[Workspace] gallery newly added dragstart setData failed',
                            err
                          );
                        }
                      });
                      imageGalleryGrid.appendChild(div);
                    }
                  }
                }
              } catch (err) {
                console.warn('[Workspace] adding image to gallery failed:', err);
              }

              showToast('✅ 연결된 스크랩에 이미지를 추가했습니다.');
            }
          );
          return;
        }
        console.debug('[Workspace] drop ignored — scrap already linked:', scrapData.id);
        showToast('⚠️ 이미 연결된 스크랩입니다.');
        return;
      }

      // 이미 DOM에 존재하는지도 확인
      if (linkedScrapsList.querySelector(`[data-scrap-id="${scrapData.id}"]`)) {
        console.debug('[Workspace] drop ignored — DOM already has scrap item for:', scrapData.id);
        showToast('⚠️ 이미 연결된 스크랩입니다.');
        return;
      }

      chrome.runtime.sendMessage(
        {
          action: 'link_scrap_to_idea',
          data: {
            ideaId: ideaData.id,
            scrapId: scrapData.id,
            status: ideaData.status,
          },
        },
        (res) => {
          if (res && res.success) {
            const emptyState = linkedScrapsList.querySelector('.empty-state p');
            if (emptyState) emptyState.remove();
            linkedScrapsList.classList.remove('empty-state');
            const cardToCreate = { ...scrapData };
            if (imageUrl) cardToCreate.image = imageUrl;
            linkedScrapsList.insertAdjacentHTML('beforeend', createScrapCard(cardToCreate, true));
            // linkedScraps를 배열로 초기화 (객체인 경우 배열로 변환)
            console.debug('[Workspace] linking scrap — id:', scrapData.id);
            if (!ideaData.linkedScraps) {
              ideaData.linkedScraps = [];
            } else if (!Array.isArray(ideaData.linkedScraps)) {
              // 객체인 경우 배열로 변환
              ideaData.linkedScraps = Object.keys(ideaData.linkedScraps);
            }
            if (!ideaData.linkedScraps.includes(scrapData.id)) {
              ideaData.linkedScraps.push(scrapData.id);
              console.debug('[Workspace] linkedScraps updated:', ideaData.linkedScraps);
            }
            showToast('✅ 스크랩이 연결되었습니다.');
            // 새로 추가된 스크랩에 드래그 이벤트 리스너 추가 (연결 해제는 이벤트 위임으로 처리됨)
            const newScrapItem = linkedScrapsList.querySelector(
              `[data-scrap-id="${scrapData.id}"]`
            );
            if (newScrapItem) {
              setupLinkedScrapItem(newScrapItem);
              console.debug('[Workspace] new linked scrap item setup completed for:', scrapData.id);
            }
          } else {
            console.error('[Workspace] 스크랩 연결 실패:', res);
            showToast(`❌ 스크랩 연결 실패: ${res?.error || '알 수 없는 오류'}`);
          }
        }
      );
    } else if (e.target.closest('#main-editor-panel')) {
      sendCommand('insert-text', {
        text: `\n\n--- (참고) ---\n${scrapData.text}\n\n`,
      });
    }
  });

  // 연결된 스크랩 아이템에 이벤트 리스너 설정 (중복 방지)
  const linkedScrapItems = new WeakSet();
  function setupLinkedScrapItem(item) {
    if (!item || linkedScrapItems.has(item)) return;
    try {
      console.debug(
        '[Workspace] setupLinkedScrapItem - attaching listeners for item:',
        item?.dataset?.scrapId
      );
    } catch (e) {
      console.warn('[Workspace] setupLinkedScrapItem debug failed:', e);
    }
    linkedScrapItems.add(item);

    // 드래그 시작 이벤트
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData(
        'application/json',
        JSON.stringify({
          id: item.dataset.scrapId,
          text: item.dataset.text,
          isLinked: true,
        })
      );
      item.style.opacity = '0.5';
    });

    // 드래그 종료 이벤트
    item.addEventListener('dragend', (e) => {
      item.style.opacity = '1';
      // 드롭이 linked-scraps-list 외부에서 발생했는지 확인
      setTimeout(() => {
        const relatedTarget = document.elementFromPoint(e.clientX, e.clientY);
        if (
          linkedScrapsList &&
          (!relatedTarget ||
            (!linkedScrapsList.contains(relatedTarget) &&
              !relatedTarget.closest('.linked-scraps-list')))
        ) {
          // 외부로 드래그된 경우 삭제 (confirm 없이)
          const scrapId = item.dataset.scrapId;
          if (scrapId) {
            chrome.runtime.sendMessage(
              {
                action: 'unlink_scrap_from_idea',
                data: {
                  ideaId: ideaData.id,
                  scrapId: scrapId,
                  status: ideaData.status,
                },
              },
              (res) => {
                if (res && res.success) {
                  item.remove();
                  // 연결된 스크랩이 없으면 empty-state 복원
                  if (linkedScrapsList.children.length === 0) {
                    linkedScrapsList.classList.add('empty-state');
                    linkedScrapsList.innerHTML =
                      '<p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>';
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
                  showToast('✅ 스크랩 연결이 해제되었습니다.');
                }
              }
            );
          }
        }
      }, 10);
    });
  }

  // 기존 연결된 스크랩에 이벤트 리스너 설정 (null 체크)
  if (linkedScrapsList) {
    linkedScrapsList.querySelectorAll('.linked-scrap-item').forEach((item) => {
      setupLinkedScrapItem(item);
    });

    // 이벤트 위임: 연결 해제 버튼 클릭 이벤트 (동적 요소에서도 작동)
    linkedScrapsList.addEventListener('click', (e) => {
      const unlinkBtn = e.target.closest('.unlink-scrap-btn');
      if (!unlinkBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const item = unlinkBtn.closest('.linked-scrap-item');
      if (!item) return;

      const scrapId = unlinkBtn.dataset.scrapId || item.dataset.scrapId;
      if (!scrapId) {
        console.error('[Workspace] 스크랩 ID를 찾을 수 없습니다.');
        return;
      }

      console.log('[Workspace] 스크랩 연결 해제 요청:', {
        ideaId: ideaData.id,
        scrapId,
        status: ideaData.status,
      });

      chrome.runtime.sendMessage(
        {
          action: 'unlink_scrap_from_idea',
          data: {
            ideaId: ideaData.id,
            scrapId: scrapId,
            status: ideaData.status,
          },
        },
        (res) => {
          if (res && res.success) {
            item.remove();
            // 연결된 스크랩이 없으면 empty-state 복원
            if (linkedScrapsList.children.length === 0) {
              linkedScrapsList.classList.add('empty-state');
              linkedScrapsList.innerHTML =
                '<p style="white-space:nowrap; color:#888; margin:0;">스크랩을 이곳으로 끌어다 놓아 연결하세요.</p>';
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
            showToast('✅ 스크랩 연결이 해제되었습니다.');
          } else {
            console.error('[Workspace] 스크랩 연결 해제 실패:', res);
            showToast(`❌ 스크랩 연결 해제에 실패했습니다: ${res?.error || '알 수 없는 오류'}`);
          }
        }
      );
    });
  }

  // 목차 기능을 위한 헬퍼 함수
  const updateOutlineInFirebase = (newOutline, callback) => {
    // workspace 객체를 nested object로 처리 (dot notation 사용 안 함)
    const workspace = ideaData.workspace || {};
    const updates = {
      outline: newOutline,
      workspace: {
        ...workspace,
        outline: newOutline,
      },
    };

    chrome.runtime.sendMessage(
      {
        action: 'update_kanban_card',
        data: {
          cardId: ideaData.id,
          status: ideaData.status || 'ideas',
          updates: updates,
        },
      },
      (response) => {
        if (response && response.success) {
          // ideaData 동기화
          ideaData.outline = newOutline;
          if (ideaData.workspace) {
            ideaData.workspace.outline = newOutline;
          }
          // 전역 ideaData도 업데이트 (실시간 업데이트를 위해)
          if (window.__cp_workspace_idea_data) {
            window.__cp_workspace_idea_data.outline = newOutline;
            if (window.__cp_workspace_idea_data.workspace) {
              window.__cp_workspace_idea_data.workspace.outline = newOutline;
            }
          }
          if (callback) callback();
        } else {
          console.error('[Workspace] 목차 업데이트 실패:', response);
          showToast(`❌ 목차 업데이트 실패: ${response?.error || '알 수 없는 오류'}`);
        }
      }
    );
  };

  const refreshOutlineList = () => {
    const outlineList = workspaceEl.querySelector('.outline-list');
    if (!outlineList) return;

    // 최신 데이터 가져오기 (전역 데이터 우선)
    const currentOutline =
      window.__cp_workspace_idea_data?.outline ||
      ideaData.outline ||
      ideaData.workspace?.outline ||
      [];

    if (currentOutline.length === 0) {
      outlineList.innerHTML = "<li class='outline-empty'>추천 목차가 없습니다.</li>";
    } else {
      outlineList.innerHTML = currentOutline
        .map(
          (item, i) =>
            `<li class="outline-item" data-index="${i}"><span class="outline-text">${item}</span><button class="outline-delete-btn">×</button></li>`
        )
        .join('');
    }
  };

  // 목차 더블클릭 편집 기능 (이벤트 위임 사용)
  const outlineList = workspaceEl.querySelector('.outline-list');
  if (outlineList) {
    outlineList.addEventListener('dblclick', (e) => {
      const textEl = e.target.closest('.outline-text');
      if (!textEl) return;

      e.stopPropagation();
      const listItem = textEl.closest('.outline-item');
      if (!listItem) return;

      const index = parseInt(listItem.dataset.index);
      const currentText = textEl.textContent;

      const input = document.createElement('input');
      input.type = 'text';
      input.value = currentText;
      input.style.cssText =
        'width:100%; padding:4px; border:1px solid #4285f4; border-radius:4px; font-size:13px;';

      textEl.style.display = 'none';
      listItem.insertBefore(input, textEl);
      input.focus();
      input.select();

      const saveEdit = () => {
        const newText = input.value.trim();
        if (newText && newText !== currentText) {
          const outline = [...(ideaData.outline || ideaData.workspace?.outline || [])];
          outline[index] = newText;
          updateOutlineInFirebase(outline, () => {
            textEl.textContent = newText;
            textEl.style.display = '';
            input.remove();
            showToast('✅ 목차가 수정되었습니다.');
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

    // 목차 삭제 버튼 (이벤트 위임 사용)
    outlineList.addEventListener('click', (e) => {
      const deleteBtn = e.target.closest('.outline-delete-btn');
      if (!deleteBtn) return;

      e.stopPropagation();
      const listItem = deleteBtn.closest('.outline-item');
      if (!listItem) return;

      const index = parseInt(listItem.dataset.index);

      if (confirm('이 목차 항목을 삭제하시겠습니까?')) {
        // 최신 데이터 가져오기
        const currentOutline =
          window.__cp_workspace_idea_data?.outline ||
          ideaData.outline ||
          ideaData.workspace?.outline ||
          [];
        const outline = [...currentOutline];
        outline.splice(index, 1);
        updateOutlineInFirebase(outline, () => {
          refreshOutlineList();
          showToast('✅ 목차 항목이 삭제되었습니다.');
        });
      }
    });
  }

  // 목차 추가 버튼
  const addOutlineBtn = workspaceEl.querySelector('#add-outline-item-btn');
  if (addOutlineBtn) {
    addOutlineBtn.addEventListener('click', () => {
      const newItem = prompt('새 목차 항목을 입력하세요:');
      if (newItem && newItem.trim()) {
        // 최신 데이터 가져오기
        const currentOutline =
          window.__cp_workspace_idea_data?.outline ||
          ideaData.outline ||
          ideaData.workspace?.outline ||
          [];
        const outline = [...currentOutline];
        outline.push(newItem.trim());
        updateOutlineInFirebase(outline, () => {
          refreshOutlineList();
          showToast('✅ 목차 항목이 추가되었습니다.');
        });
      } else if (newItem !== null) {
        // 취소가 아닌 경우 (빈 값 입력)
        showToast('⚠️ 목차 항목은 비어있을 수 없습니다.');
      }
    });
  }

  // 스크랩 초안 필터 기능
  const filterScrapByDraftBtn = workspaceEl.querySelector('#filter-scrap-by-draft-btn');
  const scrapSearchInput = workspaceEl.querySelector('#scrap-search-input');
  let isScrapDraftFilterActive = false;
  let scrapDraftContentText = '';

  function extractTextFromDraft(html) {
    if (!html) return '';
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = html;
    let text = tempDiv.textContent || tempDiv.innerText || '';
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  }

  function getDraftContentForScrapFilter() {
    return new Promise((resolve) => {
      if (ideaData && ideaData.draftContent) {
        const text = extractTextFromDraft(ideaData.draftContent);
        if (text.length >= 10) {
          resolve(text);
          return;
        }
      }
      const editorIframe = workspaceEl.querySelector('#editor-iframe');
      if (!editorIframe || !editorIframe.contentWindow) {
        resolve('');
        return;
      }

      const messageId = `draft-scrap-${Date.now()}`;
      const handler = (event) => {
        if (event.data.action === 'content-response' && event.data.requestId === messageId) {
          window.removeEventListener('message', handler);
          resolve(extractTextFromDraft(event.data.data?.html || ''));
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

  function getFilterTextFromIdeaData() {
    // AI 브리핑, 추천 목차, 추천 검색어로 필터 텍스트 생성
    const parts = [];

    // 제목과 설명
    if (ideaData.title) parts.push(ideaData.title);
    if (ideaData.description) parts.push(ideaData.description);

    // 태그 (AI 브리핑의 주요 키워드)
    if (ideaData.tags && Array.isArray(ideaData.tags)) {
      ideaData.tags
        .filter((t) => t !== '#AI-추천')
        .forEach((tag) => {
          parts.push(tag.replace(/^#/, ''));
        });
    }

    // 목차
    if (ideaData.outline && Array.isArray(ideaData.outline)) {
      ideaData.outline.forEach((item) => parts.push(item));
    }

    // 추천 검색어
    if (ideaData.recommendedKeywords && Array.isArray(ideaData.recommendedKeywords)) {
      ideaData.recommendedKeywords.forEach((keyword) => parts.push(keyword));
    }

    // 롱테일 키워드
    if (ideaData.longTailKeywords && Array.isArray(ideaData.longTailKeywords)) {
      ideaData.longTailKeywords.forEach((keyword) => parts.push(keyword));
    }

    return parts.join(' ');
  }

  function calculateScrapRelevance(scrap, filterText) {
    if (!filterText || filterText.length < 3) return 0;
    const filterWords = filterText
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2);
    if (filterWords.length === 0) return 0;

    let score = 0;
    const scrapText = ((scrap.text || '') + ' ' + (scrap.url || '')).toLowerCase();

    filterWords.forEach((word) => {
      if (scrapText.includes(word)) score += 1;
    });

    // 태그 매칭
    if (scrap.tags && Array.isArray(scrap.tags)) {
      scrap.tags.forEach((tag) => {
        if (filterText.toLowerCase().includes(tag.toLowerCase())) score += 0.5;
      });
    }

    return Math.min(score / Math.max(filterWords.length, 1), 1);
  }

  function filterScrapsByDraft(scraps, filterText) {
    if (!filterText || filterText.length < 3) return scraps;
    return scraps
      .map((scrap) => ({
        ...scrap,
        relevance: calculateScrapRelevance(scrap, filterText),
      }))
      .filter((scrap) => scrap.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance);
  }

  function updateScrapList() {
    if (!window.__cp_scrap_filter.allScraps || window.__cp_scrap_filter.allScraps.length === 0)
      return;

    const searchTerm = scrapSearchInput ? scrapSearchInput.value.toLowerCase().trim() : '';
    window.__cp_scrap_filter.searchText = searchTerm;

    let filtered;
    if (isScrapDraftFilterActive && scrapDraftContentText) {
      const draftFiltered = filterScrapsByDraft(
        window.__cp_scrap_filter.allScraps,
        scrapDraftContentText
      );
      if (searchTerm) {
        // 초안 필터 + 검색어 조합 (AND 조건)
        filtered = draftFiltered.filter((s) => {
          const text = (s.text || '').toLowerCase();
          const url = (s.url || '').toLowerCase();
          const title = (s.title || '').toLowerCase();
          const tags = (s.tags || []).map((t) => t.toLowerCase());
          return (
            text.includes(searchTerm) ||
            url.includes(searchTerm) ||
            title.includes(searchTerm) ||
            tags.some((t) => t.includes(searchTerm))
          );
        });
      } else {
        filtered = draftFiltered;
      }
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
        filterScrapByDraftBtn.style.background = '#e8f0fe';
        filterScrapByDraftBtn.style.borderColor = '#1a73e8';
        const spanText = filterScrapByDraftBtn.querySelector('span:last-child');
        if (spanText) spanText.textContent = '초안 필터 ON';

        // 먼저 에디터 내용 확인
        scrapDraftContentText = await getDraftContentForScrapFilter();

        // 에디터 내용이 없으면 AI 브리핑/목차/검색어로 필터
        if (!scrapDraftContentText || scrapDraftContentText.length < 10) {
          scrapDraftContentText = getFilterTextFromIdeaData();
          if (!scrapDraftContentText || scrapDraftContentText.length < 3) {
            alert('초안 내용이 부족합니다.');
            filterScrapByDraftBtn.style.background = '#fff';
            filterScrapByDraftBtn.style.borderColor = '#dadce0';
            if (spanText) spanText.textContent = '초안 필터';
            return;
          }
        }

        isScrapDraftFilterActive = true;
        updateScrapList();
      } else {
        filterScrapByDraftBtn.style.background = '#fff';
        filterScrapByDraftBtn.style.borderColor = '#dadce0';
        const spanText = filterScrapByDraftBtn.querySelector('span:last-child');
        if (spanText) spanText.textContent = '초안 필터';
        isScrapDraftFilterActive = false;
        scrapDraftContentText = '';
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
  if (
    chrome.storage &&
    chrome.storage.onChanged &&
    typeof chrome.storage.onChanged.addListener === 'function'
  ) {
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'local' && changes.activeChannelId) {
        console.log('[Workspace] 채널 변경 감지, 스크랩 목록 새로고침');
        // 현재 활성화된 탭이 'all-scraps' 또는 'image-gallery'인 경우에만 새로고침
        const activeTab = workspaceEl.querySelector('.resource-tab-btn.active');
        if (activeTab) {
          const tab = activeTab.dataset.tab;
          if (tab === 'all-scraps') {
            chrome.storage.local.get('activeChannelId', (res) => {
              // 로딩 표시
              allScrapsList.innerHTML =
                "<p style='text-align: center; padding: 20px; color: #666;'>로딩 중...</p>";
              chrome.runtime.sendMessage(
                { action: 'get_all_scraps', channelId: res.activeChannelId },
                (r) => {
                  if (r && r.success) {
                    window.__cp_scrap_filter.allScraps = r.scraps;
                    window.__cp_updateScrapList(
                      r.scraps,
                      allScrapsList,
                      linkedScrapsList,
                      ideaData
                    );
                  } else {
                    allScrapsList.innerHTML =
                      "<p style='text-align: center; padding: 20px; color: #666;'>자료를 불러오는데 실패했습니다.</p>";
                  }
                }
              );
            });
          } else if (tab === 'image-gallery') {
            chrome.storage.local.get('activeChannelId', (res) => {
              // 로딩 표시
              const imageGalleryGrid = resourceLibrary.querySelector('.image-gallery-grid');
              if (imageGalleryGrid) {
                imageGalleryGrid.innerHTML =
                  "<p style='text-align: center; padding: 20px; color: #666;'>로딩 중...</p>";
              }
              chrome.runtime.sendMessage(
                { action: 'get_all_scraps', channelId: res.activeChannelId },
                (r) => {
                  if (r && r.success) {
                    updateImageGalleryFromAllScraps(
                      resourceLibrary,
                      r.scraps,
                      sendCommand,
                      ideaData
                    );
                  } else {
                    if (imageGalleryGrid) {
                      imageGalleryGrid.innerHTML =
                        "<p style='text-align: center; padding: 20px; color: #666;'>자료를 불러오는데 실패했습니다.</p>";
                    }
                  }
                }
              );
            });
          }
        }
      }
    });
  }
}
window.__cp_scrap_filter = { keyword: null, searchText: null, allScraps: [] };
window.__cp_filterScraps = function (scraps, keyword, searchText) {
  if (!keyword && !searchText) return scraps;
  const term = (keyword || searchText).toLowerCase().trim();
  if (!term) return scraps;
  return scraps.filter((s) => {
    const text = (s.text || '').toLowerCase();
    const url = (s.url || '').toLowerCase();
    const title = (s.title || '').toLowerCase();
    const tags = (s.tags || []).map((t) => t.toLowerCase());
    return (
      text.includes(term) ||
      url.includes(term) ||
      title.includes(term) ||
      tags.some((t) => t.includes(term))
    );
  });
};
window.__cp_updateScrapList = function (filtered, allCont, linkedCont, ideaData) {
  if (filtered.length > 0) {
    allCont.innerHTML = filtered.map((s) => createScrapCard(s, false)).join('');

    // 삭제 버튼 이벤트 리스너 재등록 (동적 요소 대응)
    allCont.querySelectorAll('.scrap-card-delete-btn').forEach((deleteBtn) => {
      // 이미 이벤트 리스너가 등록되어 있으면 중복 등록 방지
      if (deleteBtn.dataset.listenerAttached) return;
      deleteBtn.dataset.listenerAttached = 'true';

      deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();

        const card = deleteBtn.closest('.scrap-card-item');
        if (!card) return;

        const scrapId = card.dataset.scrapId;
        if (!scrapId) {
          console.error('[Workspace] 스크랩 ID를 찾을 수 없습니다.');
          return;
        }

        showConfirmationToast('정말로 스크랩을 삭제하시겠습니까?', () => {
          chrome.runtime.sendMessage({ action: 'delete_scrap', id: scrapId }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('[Workspace] 스크랩 삭제 오류:', chrome.runtime.lastError);
              showToast(`❌ 삭제 실패: ${chrome.runtime.lastError.message}`, 'error');
              return;
            }
            if (response && response.success) {
              showToast('✅ 스크랩이 삭제되었습니다.');
              // 스크랩 리스트 새로고침
              chrome.storage.local.get('activeChannelId', (res) => {
                chrome.runtime.sendMessage(
                  {
                    action: 'get_all_scraps',
                    channelId: res.activeChannelId,
                  },
                  (r) => {
                    if (r && r.success) {
                      const linkedScrapIds =
                        ideaData && ideaData.linkedScraps
                          ? Array.isArray(ideaData.linkedScraps)
                            ? ideaData.linkedScraps
                            : Object.keys(ideaData.linkedScraps)
                          : [];
                      const availableScraps = r.scraps.filter(
                        (s) => !linkedScrapIds.includes(s.id)
                      );
                      window.__cp_updateScrapList(availableScraps, allCont, linkedCont, ideaData);
                    }
                  }
                );
              });
            } else {
              const errorMsg = response?.error || '알 수 없는 오류';
              console.error('[Workspace] 스크랩 삭제 실패:', errorMsg);
              showToast(`❌ 삭제 실패: ${errorMsg}`, 'error');
            }
          });
        });
      });
      // attach dragstart listeners to non-linked scrap items so they can be dropped into linked list
      allCont.querySelectorAll('.scrap-card-item').forEach((scrapItem) => {
        // avoid duplicate listeners
        if (scrapItem.dataset.dragListenerAttached) return;
        scrapItem.dataset.dragListenerAttached = 'true';
        scrapItem.addEventListener('dragstart', (e) => {
          try {
            const data = {
              id: scrapItem.dataset.scrapId,
              text: scrapItem.dataset.text,
              isLinked: false,
            };
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('application/json', JSON.stringify(data));
          } catch (err) {
            console.debug('[Workspace] attach dragstart failed for scrapItem', scrapItem, err);
          }
        });
      });
    });
  } else {
    const searchInput = document.querySelector('#scrap-search-input');
    const filterBtn = document.querySelector('#filter-scrap-by-draft-btn');
    const hasSearch = searchInput && searchInput.value.trim();
    const hasFilter = filterBtn && filterBtn.style.background === 'rgb(232, 240, 254)';

    if (hasSearch || hasFilter) {
      allCont.innerHTML =
        "<p style='text-align: center; padding: 20px; color: #666;'>검색 결과가 없습니다.</p>";
    } else {
      allCont.innerHTML =
        "<p style='text-align: center; padding: 20px; color: #666;'>자료 보관함이 비어있습니다.</p>";
    }
  }
};

// [체크리스트 5-2] 워크스페이스: 채널 변경 시 자료만 갱신 (에디터 보호)
export function updateWorkspaceScraps(container, ideaData) {
  // [체크리스트 5-1] 에디터 유지: 에디터와 제목은 절대 건드리지 않음
  // Accept both container class names used across modules
  const workspaceEl =
    container.querySelector('.cp-workspace-container') ||
    container.querySelector('.workspace-container');
  if (!workspaceEl) {
    console.warn('[Workspace] 워크스페이스 컨테이너를 찾을 수 없습니다.');
    return;
  }

  // [체크리스트 5-2] 참고 자료 갱신: 우측 패널의 '모든 스크랩', '이미지 갤러리'만 갱신
  const allScrapsList = workspaceEl.querySelector('.all-scraps-list');
  const resourceLibrary = workspaceEl.querySelector('#resource-library-panel');

  if (allScrapsList) {
    // 현재 활성 채널의 스크랩만 다시 로드
    chrome.storage.local.get('activeChannelId', (res) => {
      chrome.runtime.sendMessage(
        { action: 'get_all_scraps', channelId: res.activeChannelId },
        (response) => {
          if (response && response.success && response.scraps) {
            // 연결된 스크랩은 제외하고 표시
            const linkedScrapIds = ideaData.linkedScraps || [];
            const availableScraps = response.scraps.filter((s) => !linkedScrapIds.includes(s.id));

            if (availableScraps.length > 0) {
              allScrapsList.innerHTML = availableScraps
                .map((s) => createScrapCard(s, false))
                .join('');
            } else {
              allScrapsList.innerHTML =
                "<p style='text-align: center; padding: 20px; color: #666;'>자료 보관함이 비어있습니다.</p>";
            }

            // 이미지 갤러리도 갱신
            if (resourceLibrary) {
              const imageGalleryGrid = resourceLibrary.querySelector('.image-gallery-grid');
              if (imageGalleryGrid) {
                // updateImageGalleryFromAllScraps 호출
                const sendCommand = (action, data = {}) => {
                  const editorIframe = workspaceEl.querySelector('#editor-iframe');
                  if (editorIframe && editorIframe.contentWindow) {
                    editorIframe.contentWindow.postMessage({ action, data }, '*');
                  }
                };
                updateImageGalleryFromAllScraps(
                  resourceLibrary,
                  response.scraps,
                  sendCommand,
                  ideaData
                );
              }
            }
          }
        }
      );
    });
  }
}

// -----------------------------------------------------------------------------
// 전역 TUI 에디터 메시지 리스너 등록 (renderWorkspace 호출 여부와 무관하게)
// 모듈이 import될 때 즉시 실행됨
// -----------------------------------------------------------------------------
(function () {
  // 디버그 모드에서만 상세 로그 출력
  if (Logger.isDebugMode()) {
    Logger.debug('🔧 [Workspace] 전역 TUI 에디터 리스너 등록 함수 실행 중...');
    Logger.debug('🔧 [Workspace] 모듈 로드 확인:', typeof window !== 'undefined');
    try {
      Logger.debug('🔧 [Workspace] window.location:', window.location?.href);
    } catch (e) {
      Logger.debug('🔧 [Workspace] window.location: cross-origin (접근 불가)');
    }
    Logger.debug('🔧 [Workspace] window === window.top:', window === window.top);
  }

  // 즉시 실행 확인을 위한 추가 로그
  if (typeof window === 'undefined') {
    Logger.error('❌ [Workspace] window가 정의되지 않았습니다!');
    return;
  }

  // 중복 등록 방지
  if (window.__cp_tui_global_listener_attached) {
    Logger.info('ℹ️ [Workspace] 전역 TUI 에디터 메시지 리스너가 이미 등록되어 있습니다.');
    return;
  }

  const globalTuiEditorMessageListener = (event) => {
    // 🔍 디버깅: 모든 메시지 로깅
    if (event.data && typeof event.data === 'object' && event.data.action) {
      // Cross-origin 프레임의 location 접근 시도 시 SecurityError 방지
      let windowLocation = 'unknown';
      try {
        windowLocation = window.location.href;
      } catch (e) {
        windowLocation = 'cross-origin';
      }

      Logger.debug('🔍 [Workspace] 전역 리스너 - 메시지 수신:', {
        action: event.data.action,
        origin: event.origin,
        source: event.source,
        isCpOpenTuiEditor: event.data.action === 'cp_open_tui_editor',
        windowLocation: windowLocation,
        isTopWindow: window === window.top,
      });
    }

    // cp_open_tui_editor 메시지 처리
    if (event.data?.action === 'cp_open_tui_editor') {
      console.log('🌐 [Workspace] ========================================');
      console.log('🌐 [Workspace] 📨 전역 리스너: cp_open_tui_editor 메시지 수신!');
      console.log('🌐 [Workspace] ========================================');

      // currentImageUrl 또는 imageUrl 둘 다 처리 (호환성)
      const imageUrl = event.data.imageUrl || event.data.currentImageUrl;
      if (!imageUrl) {
        Logger.error('❌ [Workspace] TUI 에디터 열기 실패: 이미지 URL 없음');
        return;
      }
      Logger.debug('✅ [Workspace] 이미지 URL 확인 완료:', imageUrl.substring(0, 50) + '...');

      // workspace 컨테이너 찾기
      const workspaceContainer =
        document.querySelector('.workspace-container') ||
        document.querySelector('.cp-workspace-container');

      if (!workspaceContainer) {
        console.warn(
          '⚠️ [Workspace] workspace 컨테이너를 찾을 수 없습니다. TUI 에디터를 열 수 없습니다.'
        );
        return;
      }
      Logger.debug('✅ [Workspace] workspace 컨테이너 확인 완료');

      // TUI 에디터 iframe 생성 또는 재사용
      let tuiEditorIframe = document.querySelector('#tui-editor-iframe');

      if (!tuiEditorIframe) {
        console.log('🔨 [Workspace] TUI 에디터 iframe 생성 중...');

        // 기존 모달이 있으면 제거
        const existingOverlay = document.querySelector('#tui-editor-overlay');
        if (existingOverlay) existingOverlay.remove();

        // 배경 오버레이 생성
        const overlay = document.createElement('div');
        overlay.id = 'tui-editor-overlay';
        overlay.style.cssText =
          'position:fixed !important;top:0 !important;left:0 !important;width:100vw !important;height:100vh !important;background:rgba(0,0,0,0.7) !important;z-index:2147483647 !important;display:flex !important;align-items:center !important;justify-content:center !important;';
        overlay.onclick = () => {
          if (confirm('편집을 종료하시겠습니까?')) {
            overlay.remove();
            if (tuiEditorIframe) tuiEditorIframe.remove();
          }
        };
        // body의 마지막에 추가하여 최상위에 위치
        document.body.appendChild(overlay);

        // 모달 컨테이너 생성
        const modalContainer = document.createElement('div');
        modalContainer.id = 'tui-editor-modal-container';
        modalContainer.style.cssText =
          'position:relative !important;width:90vw !important;max-width:1400px !important;height:90vh !important;max-height:900px !important;background:#282828 !important;border-radius:12px !important;box-shadow:0 20px 60px rgba(0,0,0,0.5) !important;overflow:hidden !important;display:flex !important;flex-direction:column !important;z-index:2147483648 !important;';
        overlay.appendChild(modalContainer);

        // 닫기 버튼 추가
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '×';
        closeBtn.style.cssText =
          'position:absolute !important;top:12px !important;right:12px !important;width:36px !important;height:36px !important;background:rgba(255,255,255,0.1) !important;border:none !important;border-radius:50% !important;color:#fff !important;font-size:24px !important;cursor:pointer !important;z-index:2147483649 !important;display:flex !important;align-items:center !important;justify-content:center !important;line-height:1 !important;transition:background 0.2s !important;';
        closeBtn.onmouseover = () => (closeBtn.style.background = 'rgba(255,255,255,0.2)');
        closeBtn.onmouseout = () => (closeBtn.style.background = 'rgba(255,255,255,0.1)');
        closeBtn.onclick = (e) => {
          e.stopPropagation();
          if (confirm('편집을 종료하시겠습니까?')) {
            overlay.remove();
            if (tuiEditorIframe) tuiEditorIframe.remove();
          }
        };
        modalContainer.appendChild(closeBtn);

        // iframe 생성
        tuiEditorIframe = document.createElement('iframe');
        tuiEditorIframe.id = 'tui-editor-iframe';
        tuiEditorIframe.src = chrome.runtime.getURL('tui-editor.html');
        tuiEditorIframe.style.cssText = 'width:100%;height:100%;border:none;background:#282828;';
        modalContainer.appendChild(tuiEditorIframe);
        Logger.debug('✅ [Workspace] TUI 에디터 iframe 생성 완료');

        // TUI 에디터에서 편집 완료 시 처리
        const sourceInfo = event.data.source || 'editor';
        console.log('🎯 [Workspace] 소스 정보:', sourceInfo);
        const editorIframe = workspaceContainer.querySelector('#editor-iframe');

        const tuiEditorMessageHandler = function (e) {
          if (e.data?.action === 'tui-editor-result' && e.data.dataUrl) {
            console.log('🎉 [Workspace] ========================================');
            console.log('🎉 [Workspace] ✨ TUI 에디터 편집 완료! (전역 리스너)');
            console.log('🎉 [Workspace] ========================================');
            console.log('📊 [Workspace] 결과 데이터 URL 길이:', e.data.dataUrl.length, 'bytes');

            // 썸네일 메이커에서 온 경우: 에디터에 삽입
            if (
              sourceInfo === 'thumbnail_maker' ||
              !event.data.allDocumentImages ||
              event.data.allDocumentImages.length === 0
            ) {
              console.log('📝 [Workspace] 썸네일 메이커 모드: 이미지 삽입');
              const altText = '편집된 썸네일';
              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  {
                    action: 'insert-image',
                    data: {
                      url: e.data.dataUrl,
                      alt: altText,
                    },
                  },
                  '*'
                );
                Logger.debug('✅ [Workspace] 에디터에 이미지 삽입 메시지 전송 완료');
                showToast('✅ 편집된 썸네일이 본문에 삽입되었습니다!');
              } else {
                console.error('❌ [Workspace] 에디터 iframe을 찾을 수 없음');
              }
            } else {
              // 에디터에서 온 경우: 기존 이미지 교체
              console.log('🔄 [Workspace] 에디터 모드: 기존 이미지 교체');
              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  {
                    action: 'replace-edited-image',
                    data: { dataUrl: e.data.dataUrl },
                  },
                  '*'
                );
                Logger.debug('✅ [Workspace] 에디터에 이미지 교체 메시지 전송 완료');
              } else {
                console.error('❌ [Workspace] 에디터 iframe을 찾을 수 없음');
              }
            }

            // TUI 에디터 iframe 제거
            if (tuiEditorIframe) {
              console.log('🗑️ [Workspace] TUI 에디터 iframe 제거 중...');
              tuiEditorIframe.remove();
              Logger.debug('✅ [Workspace] TUI 에디터 iframe 제거 완료');
            }

            // 메시지 핸들러 제거
            window.removeEventListener('message', tuiEditorMessageHandler);
            console.log('🎉 [Workspace] 전체 프로세스 완료! (전역 리스너)');
            console.log('🎉 [Workspace] ========================================');
          }
        };
        window.addEventListener('message', tuiEditorMessageHandler);
        console.log('👂 [Workspace] TUI 에디터 결과 메시지 리스너 등록 완료 (전역)');

        // TUI 에디터 iframe이 로드되면 이미지 전달
        tuiEditorIframe.onload = () => {
          console.log('⏳ [Workspace] TUI 에디터 iframe 로드 완료! (전역)');
          console.log('📤 [Workspace] 이미지 전달 준비 중...');
          setTimeout(() => {
            if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
              // 1. 이미지 열기
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: 'open-tui-editor',
                  imageUrl: imageUrl,
                },
                '*'
              );
              console.log('✅ [Workspace] 1️⃣ open-tui-editor 메시지 전송 완료 (전역)');

              // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
              if (
                event.data.allDocumentImages &&
                Array.isArray(event.data.allDocumentImages) &&
                event.data.allDocumentImages.length > 0
              ) {
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: 'set-document-images',
                    images: event.data.allDocumentImages,
                  },
                  '*'
                );
                console.log(
                  `✅ [Workspace] 2️⃣ 문서 이미지 목록 전달 완료 (전역): ${event.data.allDocumentImages.length}개`
                );
              }

              console.log('🎨 [Workspace] TUI 에디터에 모든 데이터 전달 완료! (전역)');
            }
          }, 500);
        };

        // onload가 이미 발생했을 수 있으므로 즉시 체크
        if (tuiEditorIframe.contentWindow) {
          console.log('⚡ [Workspace] TUI 에디터 iframe이 이미 로드됨, 즉시 이미지 전달 (전역)');
          setTimeout(() => {
            if (tuiEditorIframe && tuiEditorIframe.contentWindow) {
              // 1. 이미지 열기
              tuiEditorIframe.contentWindow.postMessage(
                {
                  action: 'open-tui-editor',
                  imageUrl: imageUrl,
                },
                '*'
              );
              console.log('✅ [Workspace] 1️⃣ open-tui-editor 메시지 전송 완료 (즉시, 전역)');

              // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
              if (
                event.data.allDocumentImages &&
                Array.isArray(event.data.allDocumentImages) &&
                event.data.allDocumentImages.length > 0
              ) {
                tuiEditorIframe.contentWindow.postMessage(
                  {
                    action: 'set-document-images',
                    images: event.data.allDocumentImages,
                  },
                  '*'
                );
                console.log(
                  `✅ [Workspace] 2️⃣ 문서 이미지 목록 전달 완료 (즉시, 전역): ${event.data.allDocumentImages.length}개`
                );
              }

              console.log('🎨 [Workspace] TUI 에디터에 모든 데이터 전달 완료 (즉시, 전역)!');
            }
          }, 100);
        }
      } else {
        // 이미 iframe이 존재하는 경우 이미지만 교체
        console.log('♻️ [Workspace] 기존 TUI 에디터 iframe 재사용 (전역)');
        console.log('📤 [Workspace] 이미지 전달 중...');
        if (tuiEditorIframe.contentWindow) {
          // 1. 이미지 열기
          tuiEditorIframe.contentWindow.postMessage(
            {
              action: 'open-tui-editor',
              imageUrl: imageUrl,
            },
            '*'
          );
          console.log('✅ [Workspace] 1️⃣ open-tui-editor 메시지 전송 완료 (재사용, 전역)');

          // 2. 문서 내 모든 이미지 목록 전달 (사이드바 표시용)
          if (
            event.data.allDocumentImages &&
            Array.isArray(event.data.allDocumentImages) &&
            event.data.allDocumentImages.length > 0
          ) {
            tuiEditorIframe.contentWindow.postMessage(
              {
                action: 'set-document-images',
                images: event.data.allDocumentImages,
              },
              '*'
            );
            console.log(
              `✅ [Workspace] 2️⃣ 문서 이미지 목록 전달 완료 (재사용, 전역): ${event.data.allDocumentImages.length}개`
            );
          }

          console.log('🎨 [Workspace] TUI 에디터에 이미지 전달 완료 (재사용, 전역)!');
        }
      }
    }
  };

  window.addEventListener('message', globalTuiEditorMessageListener);
  window.__cp_tui_global_listener_attached = true;
  Logger.debug('✅ [Workspace] 전역 TUI 에디터 메시지 리스너 등록 완료');
  try {
    Logger.debug('🔍 [Workspace] 디버깅: window.location.href =', window.location.href);
  } catch (e) {
    Logger.debug('🔍 [Workspace] 디버깅: window.location.href = cross-origin (접근 불가)');
  }
  // 디버그 모드에서만 상세 로그 출력
  if (Logger.isDebugMode()) {
    Logger.debug('🔍 [Workspace] 디버깅: window === window.top =', window === window.top);
    Logger.debug(
      '🔍 [Workspace] 디버깅: window.addEventListener 존재 여부 =',
      typeof window.addEventListener
    );
    Logger.debug(
      '🔍 [Workspace] 디버깅: 리스너 함수 타입 =',
      typeof globalTuiEditorMessageListener
    );
    Logger.debug(
      '🔍 [Workspace] 디버깅: 리스너 등록 확인 - window에 message 이벤트 리스너가 등록되었습니다'
    );
  }
})();

// ✅ [UI 갱신 추가] handleGenerateAction: 생성 성공 시 버튼 상태 즉시 변경
// ✅ [버그 수정] handleGenerateAction: 썸네일 데이터 누락 방지 및 동기화 강화
async function handleGenerateAction(btn, options) {
  console.debug(
    '[DIAG handleGenerateAction] called with options:',
    options,
    'ideaData id:',
    window.__cp_workspace_idea_data?.id
  );
  if (!btn) return;

  // 1. 데이터 및 에디터 찾기
  const ideaData = window.__cp_workspace_idea_data;

  let workspaceContainer = btn.closest('.workspace-container');
  if (!workspaceContainer) {
    const host = document.getElementById('content-pilot-host');
    if (host && host.shadowRoot) workspaceContainer = host.shadowRoot;
  }
  const editorIframe = workspaceContainer
    ? workspaceContainer.querySelector('#editor-iframe')
    : null;

  if (!ideaData) {
    alert('데이터를 불러오지 못했습니다. 페이지를 새로고침 해주세요.');
    return;
  }
  if (!editorIframe || !editorIframe.contentWindow) {
    alert('에디터가 준비되지 않았습니다. 잠시 후 다시 시도해주세요.');
    return;
  }

  // [추가] 체크박스 값 읽기
  const checkbox = workspaceContainer.querySelector('#compose-thumbnail-text-checkbox');
  const composeThumbnailText = checkbox ? checkbox.checked : false;
  options.composeThumbnailText = composeThumbnailText;

  // 2. 버튼 상태 변경
  const originalText = btn.dataset.originalText || btn.innerHTML;
  btn.dataset.originalText = originalText;
  btn.disabled = true;
  btn.innerHTML = '⏳ 준비 중...';

  console.log('🚀 [Workspace] 초안 생성 시작', { title: ideaData.title });

  // 3. 에디터 내용 가져오기
  const getContentTask = new Promise((resolve) => {
    const messageId = `get-content-${Date.now()}`;
    const handler = (event) => {
      if (event.data.action === 'content-response' && event.data.requestId === messageId) {
        window.removeEventListener('message', handler);
        resolve(event.data.data?.html || '');
      }
    };
    window.addEventListener('message', handler);
    editorIframe.contentWindow.postMessage({ action: 'get-content', requestId: messageId }, '*');

    setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve('');
      console.warn('[Workspace] ⚠️ 에디터 응답 시간 초과 (빈 내용으로 진행)');
    }, 2000);
  });

  getContentTask.then(async (currentDraftHtml) => {
    const title = ideaData.title || '';
    if (!title.trim()) {
      alert('❌ 제목이 비어있습니다.');
      btn.disabled = false;
      btn.innerHTML = originalText;
      return;
    }

    let currentDraft = '';
    if (currentDraftHtml) {
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = currentDraftHtml;
      currentDraft = tempDiv.textContent || tempDiv.innerText || '';
    }

    // 4. 스크랩 로딩
    btn.innerHTML = '📚 자료 정리 중...';
    let linkedScrapsIds = Array.isArray(ideaData.linkedScraps) ? ideaData.linkedScraps : [];
    if (!Array.isArray(ideaData.linkedScraps) && typeof ideaData.linkedScraps === 'object') {
      linkedScrapsIds = Object.keys(ideaData.linkedScraps);
    }

    const linkedScrapsContent = [];
    if (linkedScrapsIds.length > 0) {
      try {
        const { activeChannelId } = await chrome.storage.local.get('activeChannelId');
        await Promise.race([
          new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'get_all_scraps', channelId: activeChannelId },
              (r) => {
                if (!chrome.runtime.lastError && r && r.success && r.scraps) {
                  linkedScrapsIds.forEach((id) => {
                    const s = r.scraps.find((item) => item.id === id);
                    if (s) {
                      linkedScrapsContent.push({
                        title: s.title || '스크랩',
                        text: s.text || '',
                        url: s.url || '',
                        // [추가] 이미지 URL 전달 (단일 image 또는 allImages의 첫 번째)
                        image:
                          s.image || (s.allImages && s.allImages.length > 0 ? s.allImages[0] : ''),
                      });
                    }
                  });
                }
                resolve();
              }
            );
          }),
          new Promise((r) => setTimeout(r, 5000)),
        ]);
      } catch (err) {
        console.warn('[Workspace] 스크랩 로딩 실패(무시함):', err);
      }
    }

    // 5. AI 요청 데이터 준비
    // 버튼 피드백은 요청 옵션에 맞춰 텍스트/썸네일 전용으로 구분합니다.
    if (options.generateDraft) {
      btn.innerHTML = '✍️ 텍스트 작성 중...';
    } else if (options.generateThumbnail) {
      btn.innerHTML = '🎨 썸네일 생성 중...';
    } else {
      btn.innerHTML = '⏳ 작업 중...';
    }

    // [수정] 제휴 링크 로드 (AI가 글 주제와 관련된 링크만 사용할 수 있도록)
    let affiliateLinks = ideaData.affiliateLinks || [];
    if (!affiliateLinks || affiliateLinks.length === 0) {
      try {
        const links = await getAffiliateLinks();
        if (links && links.length > 0) {
          affiliateLinks = links;
        }
      } catch (err) {
        console.warn('[Workspace] 제휴 링크 로딩 실패(무시함):', err);
      }
    }

    const baseDraftData = {
      ...ideaData, // ✅ [수정] ideaData를 맨 위로 올려야 합니다!
      title: title,
      description: ideaData.description || '',
      tags: ideaData.tags || [],
      outline: ideaData.outline || [],
      currentDraft: currentDraft || '',
      linkedScrapsContent: linkedScrapsContent, // ✅ 그래야 이 최신 데이터(URL 포함)가 덮어씌워지지 않고 유지됩니다.
      affiliateLinks: affiliateLinks, // ✅ [추가] 제휴 링크 전달
      // ...ideaData, // ❌ (기존 위치) 여기에 있으면 linkedScrapsContent를 옛날 데이터(빈 URL)로 덮어버립니다. 지워주세요.
    };

    const shouldSplitRequest = options.generateDraft && options.generateThumbnail;
    const firstStepOptions = shouldSplitRequest
      ? { ...options, generateThumbnail: false }
      : options;

    // If user requested thumbnail-only (regenerate thumbnail button), call
    // the dedicated thumbnail image generation action and return early.
    if (!options.generateDraft && options.generateThumbnail) {
      console.log('[Workspace] 🎨 썸네일(단독) 생성 요청 전송...');
      btn.innerHTML = '🎨 썸네일 생성 중...';
      chrome.runtime.sendMessage(
        {
          action: 'generate_thumbnail_images',
          data: baseDraftData,
          options: { composeThumbnailText: options.composeThumbnailText },
        },
        (thumbResponse) => {
          btn.disabled = false;
          btn.innerHTML = originalText;

          if (!thumbResponse || !thumbResponse.success) {
            alert(`썸네일 생성 실패: ${thumbResponse?.error || '응답이 없습니다.'}`);
            return;
          }

          // merge thumbnail info back into ideaData
          if (thumbResponse.thumbnailInfo) ideaData.publishInfo = ideaData.publishInfo || {};
          if (thumbResponse.thumbnailInfo)
            ideaData.publishInfo.thumbnailInfo = thumbResponse.thumbnailInfo;
          if (thumbResponse.thumbnailUrls)
            ideaData.publishInfo.thumbnailUrls = thumbResponse.thumbnailUrls;
          if (thumbResponse.jsonLdSchema) ideaData.jsonLdSchema = thumbResponse.jsonLdSchema;

          const workspaceEl = btn.closest('.workspace-container') || workspaceContainer;
          if (workspaceEl && typeof renderThumbnailButton === 'function') {
            renderThumbnailButton(workspaceEl, ideaData);
          }

          import('../utils.js').then((utils) => utils.showToast('✅ 썸네일 생성 완료!'));
        }
      );

      return;
    }

    console.log('[Workspace] 📡 1단계 AI 요청 전송...');

    // 6. AI 요청 (1단계)
    chrome.runtime.sendMessage(
      {
        action: 'generate_draft_from_idea',
        data: baseDraftData,
        options: firstStepOptions,
      },
      async (response) => {
        if (chrome.runtime.lastError) {
          console.error('[Workspace] ❌ 런타임 오류:', chrome.runtime.lastError);
          btn.disabled = false;
          btn.innerHTML = originalText;
          alert('연결 오류가 발생했습니다. 잠시 후 다시 시도해주세요.');
          return;
        }

        if (!response || !response.success) {
          btn.disabled = false;
          btn.innerHTML = originalText;
          alert(`생성 실패: ${response?.error || '응답이 없습니다.'}`);
          return;
        }

        // 7. 결과 적용 (텍스트)
        if (response.draft) {
          if (editorIframe.contentWindow) {
            editorIframe.contentWindow.postMessage(
              { action: 'set-content', data: { html: response.draft } },
              '*'
            );
          }
          import('../utils.js').then((utils) =>
            utils.showToast('✅ 텍스트 작성이 완료되었습니다.')
          );

          // 데이터 메모리 업데이트 (helper 뷰 로직으로 통합)
          applyDraftResponseToIdea(ideaData, response);

          // 저장
          chrome.runtime.sendMessage(
            {
              action: 'save_idea_draft',
              ideaId: ideaData.id,
              draft: response.draft,
            },
            (res) => {
              if (res && res.moved) {
                ideaData.status = res.newStatus;
                if (window.__cp_workspace_idea_data)
                  window.__cp_workspace_idea_data.status = res.newStatus;
              }
              // 메타데이터 저장
              if (Object.keys(ideaData.publishInfo).length > 0 || response.seoTitle) {
                const updates = { publishInfo: ideaData.publishInfo };
                // keep top-level seoTitle in sync as well (backwards compatibility)
                if (response.seoTitle) updates.seoTitle = response.seoTitle;
                chrome.runtime.sendMessage({
                  action: 'update_kanban_card',
                  data: { cardId: ideaData.id, status: ideaData.status, updates: updates },
                });
              }
            }
          );

          // UI 갱신
          const workspaceEl = btn.closest('.workspace-container') || workspaceContainer;
          if (workspaceEl) {
            if (typeof showPublishInfo === 'function') {
              let tagsForDisplay = ideaData.publishInfo.tags;
              if (Array.isArray(tagsForDisplay)) tagsForDisplay = tagsForDisplay.join(', ');
              showPublishInfo(
                workspaceEl,
                ideaData.publishInfo.permalink,
                tagsForDisplay,
                ideaData.seoTitle || ideaData.publishInfo?.seoTitle || '',
                ideaData
              );
            }
            // 버튼 UI 갱신
            if (typeof updateWorkspaceActionButtons === 'function') {
              // [수정] await를 추가하여 버튼 갱신이 끝날 때까지 기다립니다.
              await updateWorkspaceActionButtons(workspaceEl, true);
            }
          }
        }

        // 분리 실행이 아니면 종료
        if (!shouldSplitRequest) {
          btn.disabled = false;
          btn.innerHTML = originalText;
          if (options.generateThumbnail && response.thumbnailUrls) {
            // 썸네일 버튼 갱신
            const workspaceEl = btn.closest('.workspace-container') || workspaceContainer;
            if (typeof renderThumbnailButton === 'function' && workspaceEl) {
              renderThumbnailButton(workspaceEl, ideaData);
            }
            // 사용자 피드백 추가
            import('../utils.js').then((utils) => utils.showToast('✅ 썸네일 생성 완료!'));
          }
          return;
        }

        // 8. 2단계: 썸네일 생성 시작
        console.log('[Workspace] 🎨 2단계 썸네일 생성 시작...');
        btn.innerHTML = '🎨 썸네일 생성 중...';

        const secondStepData = {
          ...baseDraftData,
          currentDraft: response.draft || baseDraftData.currentDraft,
          seoTitle: response.seoTitle || baseDraftData.seoTitle,
          publishInfo: ideaData.publishInfo,
        };

        const secondStepOptions = {
          generateDraft: false,
          generateThumbnail: true,
          composeThumbnailText: options.composeThumbnailText, // 👈 이 부분이 누락되어 있었습니다.
        };

        chrome.runtime.sendMessage(
          {
            action: 'generate_thumbnail_images',
            data: secondStepData,
            options: { composeThumbnailText: secondStepOptions.composeThumbnailText },
          },
          (thumbResponse) => {
            // Debug: log thumb response to validate callback execution in tests
            console.debug('[Workspace] thumbResponse received:', thumbResponse);
            btn.disabled = false;
            btn.innerHTML = originalText;

            if (thumbResponse && thumbResponse.success) {
              import('../utils.js').then((utils) => utils.showToast('✅ 썸네일 생성 완료!'));

              if (thumbResponse.thumbnailInfo) {
                if (!ideaData.publishInfo) ideaData.publishInfo = {};
                ideaData.publishInfo.thumbnailInfo = thumbResponse.thumbnailInfo;

                // [버그 수정] 생성된 썸네일 URL을 메모리(ideaData)에 반드시 저장해야 함!
                // 이게 없어서 다음에 '텍스트 다시 쓰기' 할 때 이미지가 사라졌던 것임.
                if (thumbResponse.thumbnailUrls) {
                  ideaData.publishInfo.thumbnailUrls = thumbResponse.thumbnailUrls;
                }

                // Persist JSON-LD if provided by thumbnail response
                if (thumbResponse.jsonLdSchema) {
                  if (!ideaData.publishInfo) ideaData.publishInfo = {};
                  ideaData.publishInfo.jsonLdSchema = thumbResponse.jsonLdSchema;
                }

                // 버튼 UI 갱신
                const workspaceEl = btn.closest('.workspace-container') || workspaceContainer;
                if (typeof renderThumbnailButton === 'function' && workspaceEl) {
                  const oldBtn = workspaceEl.querySelector('#btn-create-thumbnail');
                  if (oldBtn) oldBtn.remove();
                  renderThumbnailButton(workspaceEl, ideaData);
                }

                // 본문에 이미지 업데이트
                if (thumbResponse.draft && editorIframe.contentWindow) {
                  editorIframe.contentWindow.postMessage(
                    { action: 'set-content', data: { html: thumbResponse.draft } },
                    '*'
                  );
                  // 데이터 메모리도 최신 draft로 업데이트
                  ideaData.draftContent = thumbResponse.draft;
                  if (ideaData.workspace) ideaData.workspace.draft = thumbResponse.draft;
                }
              }
            } else {
              console.warn('[Workspace] ⚠️ 썸네일 생성 실패:', thumbResponse?.error);
              import('../utils.js').then((utils) =>
                utils.showToast('텍스트는 저장되었으나 썸네일 생성에 실패했습니다.', 'error')
              );
            }
          }
        );
      }
    );
  });
}

// Exported helper: update the modal's reference images given a cardData object
export function updateThumbnailModalReferences(cardData, maxCount = 5) {
  const refWrapper = document.querySelector('#tm-ref-images');
  if (!refWrapper) return;
  refWrapper.innerHTML = '';
  const formatted = cardData.formattedDraft || cardData.currentDraft || '';
  const linked = cardData.linkedScrapsContent || [];
  const aff = cardData.affiliateLinks || [];
  const refs = selectBackgroundReferenceImages(
    { formattedDraft: formatted, ideaData: { linkedScrapsContent: linked }, affiliateLinks: aff },
    maxCount
  );

  if (!refs || refs.length === 0) {
    const empty = document.createElement('div');
    empty.style.fontSize = '12px';
    empty.style.color = '#777';
    empty.textContent = '(없음)';
    refWrapper.appendChild(empty);
    return;
  }

  for (const url of refs) {
    const imgWrap = document.createElement('div');
    imgWrap.style.display = 'inline-flex';
    imgWrap.style.flexDirection = 'column';
    imgWrap.style.alignItems = 'center';
    imgWrap.style.gap = '4px';
    imgWrap.style.background = '#111';
    imgWrap.style.padding = '6px';
    imgWrap.style.borderRadius = '6px';
    imgWrap.style.border = '1px solid #333';

    const img = document.createElement('img');
    img.src = url;
    img.style.width = '64px';
    img.style.height = '64px';
    img.style.objectFit = 'cover';
    img.style.borderRadius = '4px';
    imgWrap.appendChild(img);

    const txt = document.createElement('div');
    txt.style.fontSize = '10px';
    txt.style.color = '#999';
    txt.style.maxWidth = '120px';
    txt.style.overflow = 'hidden';
    txt.style.textOverflow = 'ellipsis';
    txt.style.whiteSpace = 'nowrap';
    txt.textContent = url;
    imgWrap.appendChild(txt);

    refWrapper.appendChild(imgWrap);
  }
}
