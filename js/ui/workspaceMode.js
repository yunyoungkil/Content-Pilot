import { shortenLink, showToast, showConfirmationToast, Logger } from '../utils.js';
import { getAffiliateLinks } from '../services/affiliateService.js';
import { marked } from 'marked';
import { openThumbnailMaker } from './thumbnailMaker.js';

// -----------------------------------------------------------------------------
// 1. 이미지 갤러리 관련 함수들
// -----------------------------------------------------------------------------

// Previously defined _updateImageGallery helper removed — functionality consolidated into updateImageGalleryFromAllScraps

// renderImageGallery helper removed — no longer used by codepaths after refactor

function updateImageGalleryFromAllScraps(resourceLibrary, allScraps, sendCommand, ideaData = null) {
  const imageGalleryArea = resourceLibrary.querySelector('.image-gallery-area');
  if (!imageGalleryArea) return;

  if (!imageGalleryArea.querySelector('.image-gallery-header')) {
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

  const imageGalleryGrid = imageGalleryArea.querySelector('.image-gallery-grid');
  const searchInput = imageGalleryArea.querySelector('#image-search-input');
  const filterByDraftBtn = imageGalleryArea.querySelector('#filter-by-draft-btn');
  const imageCount = imageGalleryArea.querySelector('#image-count');
  const previewModal = imageGalleryArea.querySelector('#image-preview-modal');
  const previewImage = imageGalleryArea.querySelector('#preview-image');
  const imageMetadata = imageGalleryArea.querySelector('#image-metadata');
  const closePreview = imageGalleryArea.querySelector('#close-preview');

  let isDraftFilterActive = false;
  // Temporary image data collection removed; using local variables to avoid leaking module-level state.
  let draftContentText = '';

  imageGalleryGrid.innerHTML =
    "<p style='text-align:center;color:#888;padding:20px;'>이미지를 불러오는 중...</p>";

  const imageDataMap = new Map();

  const isValidImageUrl = (url) => {
    if (!url || typeof url !== 'string') return false;
    const trimmed = url.trim();
    if (trimmed.length === 0) return false;
    const invalidPatterns = [
      /sync\.smartadserver\.com/i,
      /getuid/i,
      /usersync/i,
      /pixel/i,
      /tracking/i,
      /analytics/i,
      /beacon/i,
      /\.js(\?|$)/i,
      /\.css(\?|$)/i,
      /\.html(\?|$)/i,
    ];
    if (invalidPatterns.some((pattern) => pattern.test(trimmed))) return false;
    return (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/')
    );
  };

  const normalizeImageUrl = (url, baseUrl) => {
    if (!url || typeof url !== 'string') return null;
    const trimmed = url.trim();
    if (trimmed.length === 0) return null;
    if (
      trimmed.startsWith('http://') ||
      trimmed.startsWith('https://') ||
      trimmed.startsWith('data:image/')
    ) {
      return trimmed;
    }
    if (trimmed.startsWith('//')) {
      return 'https:' + trimmed;
    }
    if (trimmed.startsWith('/') && baseUrl) {
      try {
        return new URL(trimmed, new URL(baseUrl).origin).href;
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

  allScraps.forEach((scrap) => {
    const baseUrl = scrap.url || window.location.href;
    const processUrl = (url) => {
      const normalized = normalizeImageUrl(url, baseUrl);
      if (normalized && isValidImageUrl(normalized) && !imageDataMap.has(normalized)) {
        imageDataMap.set(normalized, {
          url: normalized,
          source: '스크랩',
          title: scrap.text?.substring(0, 50) || scrap.url || '스크랩 이미지',
          url_source: scrap.url || '',
          timestamp: scrap.timestamp || Date.now(),
          scrapId: scrap.id,
        });
      }
    };
    if (scrap.image) processUrl(scrap.image);
    if (Array.isArray(scrap.allImages)) scrap.allImages.forEach(processUrl);
    if (Array.isArray(scrap.images)) scrap.images.forEach(processUrl);
  });

  chrome.runtime.sendMessage({ action: 'get_canvas_images' }, (canvasResponse) => {
    if (canvasResponse && canvasResponse.success && Array.isArray(canvasResponse.images)) {
      canvasResponse.images.forEach((imageUrl) => {
        const normalized = normalizeImageUrl(imageUrl, window.location.href);
        if (normalized && isValidImageUrl(normalized) && !imageDataMap.has(normalized)) {
          imageDataMap.set(normalized, {
            url: normalized,
            source: '캔버스',
            title: '편집된 이미지',
            url_source: '',
            timestamp: Date.now(),
          });
        }
      });
    }

    const allImages = Array.from(imageDataMap.values());
    // _allImageData assignment removed; allImages is used locally below.

    function extractTextFromDraft(html) {
      if (!html) return '';
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = html;
      let text = tempDiv.textContent || tempDiv.innerText || '';
      text = text.replace(/\s+/g, ' ').trim();
      return text;
    }

    function calculateRelevance(imageData, draftText) {
      if (!draftText || draftText.length < 10) return 0;
      const draftWords = draftText
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 2);
      if (draftWords.length === 0) return 0;

      let score = 0;
      const searchText = (
        (imageData.title || '') +
        ' ' +
        (imageData.url_source || '') +
        ' ' +
        (imageData.url || '')
      ).toLowerCase();

      draftWords.forEach((word) => {
        if (searchText.includes(word)) score += 1;
      });

      try {
        if (imageData.url) {
          const urlDomain = new URL(imageData.url).hostname;
          if (urlDomain && draftText.toLowerCase().includes(urlDomain.split('.')[0])) score += 0.5;
        }
      } catch (e) {
        Logger.warn('[Workspace] image url parsing/analysis error', e);
      }

      return Math.min(score / Math.max(draftWords.length, 1), 1);
    }

    function filterImagesByDraft(images, draftText) {
      if (!draftText || draftText.length < 10) return images;
      return images
        .map((img) => ({
          ...img,
          relevance: calculateRelevance(img, draftText),
        }))
        .filter((img) => img.relevance > 0)
        .sort((a, b) => b.relevance - a.relevance);
    }

    function renderImages(images) {
      if (images.length === 0) {
        const hasSearch = searchInput && searchInput.value.trim();
        const hasFilter = isDraftFilterActive;
        let message = '이미지가 없습니다.';
        if (hasSearch || hasFilter) {
          message = '검색 결과가 없습니다.';
        } else if (!allImages || allImages.length === 0) {
          message = '자료 보관함이 비어있습니다.';
        }
        imageGalleryGrid.innerHTML = `<p style='text-align:center;color:#888;padding:20px;'>${message}</p>`;
        imageCount.textContent = '0개';
        return;
      }

      imageCount.textContent = `${images.length}개`;
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
        .map((imgData) => {
          const escapedUrl = escapeHtml(imgData.url);
          const escapedTitle = escapeHtml(imgData.title || '이미지');
          return `
          <div class="gallery-thumb-wrap" draggable="true" data-image-url="${escapedUrl}" 
            data-title="${escapedTitle}" data-source="${
              imgData.source
            }" data-url-source="${escapeHtml(imgData.url_source || '')}"
            data-timestamp="${imgData.timestamp}" data-scrap-id="${imgData.scrapId || ''}"
            style="position: relative; cursor: pointer;">
            <img src="${escapedUrl}" class="gallery-thumb" style="width:100%;height:88px;object-fit:cover;border-radius:8px;cursor:move;" alt="${escapedTitle}" loading="lazy" onerror="this.style.display='none';">
            ${
              imgData.source === '스크랩' && imgData.scrapId
                ? `
              <button class="gallery-image-delete-btn" data-scrap-id="${imgData.scrapId}" data-image-url="${escapedUrl}"
                style="position: absolute; top: 4px; right: 4px; background: rgba(234,67,53,0.9); color: #fff; border: none; width: 24px; height: 24px; opacity: 0; transition: opacity 0.2s;" title="삭제">×</button>
            `
                : ''
            }
            <div class="gallery-thumb-overlay" style="position: absolute; inset: 0; background: rgba(0,0,0,0); pointer-events: none; display: flex; align-items: center; justify-content: center;">
              <span class="gallery-preview-icon" style="opacity: 0; color: #fff; font-size: 24px; pointer-events: auto; cursor: pointer;">🔍</span>
            </div>
          </div>`;
        })
        .join('');

      imageGalleryGrid.querySelectorAll('.gallery-thumb-wrap').forEach((wrap) => {
        wrap.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/plain', wrap.dataset.imageUrl);
          e.dataTransfer.effectAllowed = 'copy';
        });

        const deleteBtn = wrap.querySelector('.gallery-image-delete-btn');
        if (deleteBtn) {
          wrap.addEventListener('mouseenter', () => (deleteBtn.style.opacity = '1'));
          wrap.addEventListener('mouseleave', () => (deleteBtn.style.opacity = '0'));
          deleteBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('이미지를 삭제하시겠습니까?')) {
              chrome.runtime.sendMessage(
                {
                  action: 'remove_scrap_image',
                  data: {
                    scrapId: deleteBtn.dataset.scrapId,
                    imageUrl: deleteBtn.dataset.imageUrl,
                  },
                },
                (res) => {
                  if (res && res.success) {
                    chrome.storage.local.get('activeChannelId', (res) => {
                      chrome.runtime.sendMessage(
                        {
                          action: 'get_all_scraps',
                          channelId: res.activeChannelId,
                        },
                        (r) => {
                          if (r && r.success)
                            updateImageGalleryFromAllScraps(
                              resourceLibrary,
                              r.scraps,
                              sendCommand,
                              ideaData
                            );
                        }
                      );
                    });
                  }
                }
              );
            }
          });
        }

        const img = wrap.querySelector('.gallery-thumb');
        const icon = wrap.querySelector('.gallery-preview-icon');
        const overlay = wrap.querySelector('.gallery-thumb-overlay');

        if (overlay) {
          wrap.addEventListener('mouseenter', () => {
            overlay.style.background = 'rgba(0,0,0,0.5)';
            if (icon) icon.style.opacity = '1';
          });
          wrap.addEventListener('mouseleave', () => {
            overlay.style.background = 'rgba(0,0,0,0)';
            if (icon) icon.style.opacity = '0';
          });
        }

        const insertImage = (e) => {
          e.preventDefault();
          e.stopPropagation();
          sendCommand('insert-image', { url: wrap.dataset.imageUrl });
          sendCommand('focus');
        };

        if (img) img.addEventListener('click', insertImage);
        if (icon) {
          icon.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            showImagePreview({
              url: wrap.dataset.imageUrl,
              title: wrap.dataset.title,
              source: wrap.dataset.source,
              url_source: wrap.dataset.urlSource,
              timestamp: wrap.dataset.timestamp,
            });
          });
        }
      });
    }

    function showImagePreview(imgData) {
      previewImage.src = imgData.url;
      const date = imgData.timestamp ? new Date(parseInt(imgData.timestamp)) : new Date();
      imageMetadata.innerHTML = `<div>${
        imgData.title
      }</div><div style="font-size:11px;opacity:0.8;">${
        imgData.source
      } | ${date.toLocaleDateString()}</div>`;
      previewModal.style.display = 'flex';
    }

    closePreview.addEventListener('click', () => (previewModal.style.display = 'none'));
    previewModal.addEventListener('click', (e) => {
      if (e.target === previewModal) previewModal.style.display = 'none';
    });

    function getDraftContent() {
      return new Promise((resolve) => {
        if (ideaData && ideaData.draftContent) {
          const text = extractTextFromDraft(ideaData.draftContent);
          if (text.length >= 10) {
            resolve(text);
            return;
          }
        }
        const editorIframe = document.querySelector('#quill-editor-iframe');
        if (!editorIframe || !editorIframe.contentWindow) {
          resolve('');
          return;
        }

        const messageId = `draft-${Date.now()}`;
        const handler = (event) => {
          if (event.data.action === 'content-response' && event.data.requestId === messageId) {
            window.removeEventListener('message', handler);
            resolve(extractTextFromDraft(event.data.data?.html || ''));
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

    async function toggleDraftFilter() {
      if (!isDraftFilterActive) {
        filterByDraftBtn.style.background = '#e8f0fe';
        filterByDraftBtn.style.borderColor = '#1a73e8';
        const spanText = filterByDraftBtn.querySelector('span:last-child');
        if (spanText) spanText.textContent = '초안 필터 ON';
        draftContentText = await getDraftContent();
        if (!draftContentText || draftContentText.length < 10) {
          alert('초안 내용이 부족합니다.');
          filterByDraftBtn.style.background = '#fff';
          filterByDraftBtn.style.borderColor = '#dadce0';
          if (spanText) spanText.textContent = '초안 필터';
          return;
        }
        isDraftFilterActive = true;
        renderImages(filterImagesByDraft(allImages, draftContentText));
      } else {
        filterByDraftBtn.style.background = '#fff';
        filterByDraftBtn.style.borderColor = '#dadce0';
        const spanText = filterByDraftBtn.querySelector('span:last-child');
        if (spanText) spanText.textContent = '초안 필터';
        isDraftFilterActive = false;
        renderImages(allImages);
      }
    }

    if (filterByDraftBtn) filterByDraftBtn.addEventListener('click', toggleDraftFilter);

    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase().trim();
      let targetImages = isDraftFilterActive
        ? filterImagesByDraft(allImages, draftContentText)
        : allImages;
      if (term) {
        // 검색어가 있으면 필터링 (초안 필터 결과 내에서 검색)
        targetImages = targetImages.filter((img) => {
          const title = (img.title || '').toLowerCase();
          const source = (img.source || '').toLowerCase();
          const url = (img.url || '').toLowerCase();
          return title.includes(term) || source.includes(term) || url.includes(term);
        });
      }
      renderImages(targetImages);
    });

    renderImages(allImages);
  });
}

// -----------------------------------------------------------------------------
// 2. 헬퍼 함수들 (반드시 최상위 레벨에 있어야 함)
// -----------------------------------------------------------------------------

/**
 * 썸네일 만들기 버튼을 렌더링하는 헬퍼 함수
 * 초안이 있거나 썸네일 정보가 저장되어 있으면 버튼을 표시
 */
function renderThumbnailButton(workspaceEl, ideaData) {
  const buttonContainer = workspaceEl.querySelector('#workspace-title-header')?.nextElementSibling;
  // 이미 버튼이 있으면 중단
  if (!buttonContainer || buttonContainer.querySelector('#btn-create-thumbnail')) return;

  // 초안 데이터가 없으면 버튼 생성 안 함 (초안이 있어야 썸네일 추천 정보가 있음)
  // 단, publishInfo에 썸네일 정보가 저장되어 있다면 표시 가능
  const hasDraft = !!ideaData.draftContent || !!ideaData.workspace?.draft;
  const hasThumbInfo = !!ideaData.publishInfo?.thumbnailInfo;

  if (!hasDraft && !hasThumbInfo) return;

  const thumbBtn = document.createElement('button');
  thumbBtn.id = 'btn-create-thumbnail';
  thumbBtn.style.cssText =
    'padding:8px 16px;background:linear-gradient(135deg, #6c5ce7, #a29bfe);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:600;font-size:13px;box-shadow:0 2px 8px rgba(108, 92, 231, 0.3);transition:all 0.2s; margin-left: 8px;';
  thumbBtn.textContent = '🎨 썸네일 만들기';

  // '초안 삭제' 버튼이 있다면 그 앞에, 없으면 컨테이너 끝에 추가
  const deleteBtn = buttonContainer.querySelector('#delete-draft-in-workspace');
  if (deleteBtn) {
    buttonContainer.insertBefore(thumbBtn, deleteBtn);
  } else {
    buttonContainer.appendChild(thumbBtn);
  }

  // 이벤트 연결
  thumbBtn.onclick = () => {
    // 즉시 모달 열기 (기존 데이터로)
    const draftData = {
      seoTitle: ideaData.seoTitle || ideaData.title,
      thumbnailInfo: ideaData.publishInfo?.thumbnailInfo || null,
      // [신규] 저장된 컨셉 선택 인덱스 포함 (publishInfo에서 직접 가져오기)
      selectedThumbnailIndex:
        ideaData.publishInfo?.selectedThumbnailIndex ??
        (Array.isArray(ideaData.publishInfo?.thumbnailInfo) ? 0 : undefined),
    };

    // 공통 콜백 함수들
    const onInsert = (dataUrl, altText) => {
      const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
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
      } else {
        Logger.error('[ThumbnailMaker] 에디터 iframe을 찾을 수 없습니다.');
        showToast('❌ 에디터를 찾을 수 없습니다.');
      }
    };

    const onSave = (newThumbnailInfo) => {
      // 메모리 업데이트
      if (!ideaData.publishInfo) ideaData.publishInfo = {};

      // thumbnailInfo가 배열인 경우 처리
      if (Array.isArray(ideaData.publishInfo.thumbnailInfo)) {
        // 배열 전체를 유지하면서 선택된 컨셉만 업데이트
        const selectedIndex = newThumbnailInfo.selectedThumbnailIndex ?? 0;
        if (selectedIndex >= 0 && selectedIndex < ideaData.publishInfo.thumbnailInfo.length) {
          // 선택된 컨셉의 정보만 업데이트 (selectedThumbnailIndex 제외)
          const infoToUpdate = Object.assign({}, newThumbnailInfo);
          delete infoToUpdate.selectedThumbnailIndex;
          ideaData.publishInfo.thumbnailInfo[selectedIndex] = {
            ...ideaData.publishInfo.thumbnailInfo[selectedIndex],
            ...infoToUpdate,
          };
        }
        // selectedThumbnailIndex는 publishInfo에 별도로 저장
        ideaData.publishInfo.selectedThumbnailIndex = selectedIndex;
      } else {
        // 단일 객체인 경우 (구버전 호환)
        ideaData.publishInfo.thumbnailInfo = newThumbnailInfo;
        if (newThumbnailInfo.selectedThumbnailIndex !== undefined) {
          ideaData.publishInfo.selectedThumbnailIndex = newThumbnailInfo.selectedThumbnailIndex;
        }
      }

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
            Logger.biz('[Thumbnail] 작업 상태 자동 저장됨:', newThumbnailInfo);
          } else {
            Logger.error('[Thumbnail] 저장 실패:', response?.error);
          }
        }
      );
    };

    // 모달 즉시 열기
    Logger.info('[ThumbnailButton] 썸네일 모달 열기 (기존 데이터 사용)');
    openThumbnailMaker(draftData, onInsert, onSave, null);

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

                  // 모달이 열려있고 업데이트 가능하면 업데이트 (선택적)
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
  const cleanedTitle = textContent.replace(/\s+/g, ' ').trim();
  const displayTitle = cleanedTitle.substring(0, 10);

  if (isLinked) {
    return `<div class="scrap-card-item linked-scrap-item" data-scrap-id="${
      scrap.id
    }" data-text="${textContent.replace(
      /"/g,
      '&quot;'
    )}" draggable="true" style="margin:0; flex-shrink:0; position:relative;">
        <div class="linked-scrap-tag">
          <span class="tag-text">${displayTitle}...</span>
          <button class="unlink-scrap-btn" data-scrap-id="${scrap.id}" title="연결 해제">×</button>
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

function showScrapDetailModal(scrapData, container = null) {
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

  // 제목
  const title = scrapData.text ? scrapData.text.substring(0, 100).replace(/\n/g, ' ') : '제목 없음';
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
          <img src="${img.replace(
            /"/g,
            '&quot;'
          )}" alt="스크랩 이미지" style="width: 100%; height: 100%; object-fit: cover;" loading="lazy">
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
          document.body.appendChild(fullModal);
          fullModal.addEventListener('click', () => {
            if (document.body.contains(fullModal)) {
              document.body.removeChild(fullModal);
            }
          });
        });
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
  // 기존 패널 제거
  const existingInfo = workspaceEl.querySelector('.publish-info-panel');
  if (existingInfo) existingInfo.remove();

  // 파라미터 정규화 (null, undefined 처리)
  permalink = permalink || '';
  tags = tags || '';
  seoTitle = seoTitle || '';

  // Firebase 업데이트 (값이 있을 때만)
  // 모든 값이 빈 문자열이면 Firebase 업데이트를 건너뛰어야 함 (초안 삭제 후 재생성 방지)
  // 하지만 permalink나 tags가 이미 있더라도 업데이트할 수 있도록 수정
  if (ideaData && ideaData.id) {
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
    if (tags !== undefined && tags.trim() !== '') {
      publishInfoUpdates.tags = tags;
      hasNonEmptyValue = true;
    } else if (tags !== undefined && tags.trim() === '' && ideaData.publishInfo?.tags) {
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

  // 채널 정보 가져오기
  chrome.runtime.sendMessage({ action: 'get_my_channels' }, (channelsResponse) => {
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
        ${
          seoTitle
            ? `<div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">SEO 최적화 제목</label>
          <input type="text" id="seo-title-input" value="${seoTitle}" readonly style="width: 100%; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
        </div>`
            : ''
        }
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">퍼머링크</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="permalink-input" value="${
              permalink || ''
            }" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
            ${
              fullUrl
                ? `<button id="connect-permalink-btn" style="padding: 6px 12px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">🔗 연결</button>`
                : ''
            }
          </div>
          ${
            fullUrl
              ? `<div style="font-size: 11px; color: #666; margin-top: 4px;">전체 URL: <span style="color: #1a73e8;">${fullUrl}</span></div>`
              : ''
          }
        </div>
        <div>
          <label style="display: block; font-size: 12px; color: #666; margin-bottom: 4px;">태그</label>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="text" id="tags-input" value="${
              tags || ''
            }" readonly style="flex: 1; padding: 6px; border: 1px solid #ddd; border-radius: 4px; font-size: 13px; background: #fff;">
            <button id="copy-tags-btn" style="padding: 6px 12px; background: #fff; border: 1px solid #dadce0; border-radius: 4px; cursor: pointer; font-size: 12px;">📋 복사</button>
          </div>
        </div>
        <div>
          <button id="copy-html-btn" style="width: 100%; padding: 10px; background: #4285f4; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 13px; font-weight: 500;">📄 HTML 복사 (JSON-LD 포함)</button>
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
    }

    const copyTagsBtn = publishInfoPanel.querySelector('#copy-tags-btn');
    if (copyTagsBtn) {
      copyTagsBtn.addEventListener('click', () => {
        const tagsInput = publishInfoPanel.querySelector('#tags-input');
        if (tagsInput && tagsInput.value) {
          navigator.clipboard.writeText(tagsInput.value).then(() => alert('📋 태그 복사 완료'));
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
          const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
          let editorHtml = '';

          if (editorIframe && editorIframe.contentWindow) {
            const messageId = `get-content-html-${Date.now()}`;
            editorHtml = await new Promise((resolve) => {
              const handler = (event) => {
                if (
                  event.data.action === 'content-response' &&
                  event.data.requestId === messageId
                ) {
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

          // JSON-LD 스키마 가져오기 (최신 데이터 참조)
          let jsonLdSchema = null;
          const currentPublishInfo = currentIdeaData?.publishInfo;
          if (currentPublishInfo && currentPublishInfo.jsonLdSchema) {
            jsonLdSchema = currentPublishInfo.jsonLdSchema;
          }

          // 최신 seoTitle 가져오기
          const currentSeoTitle =
            currentPublishInfo?.seoTitle ||
            currentIdeaData?.seoTitle ||
            currentIdeaData?.title ||
            '';

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
  });
}

// 완전한 HTML 생성 함수 (JSON-LD 포함)
function generateCompleteHtml(contentHtml, jsonLdSchema, title) {
  // JSON-LD 스크립트 태그 생성
  let jsonLdScript = '';
  if (jsonLdSchema) {
    try {
      // JSON-LD 스키마에 필수 필드 업데이트 (없으면 추가)
      const schema = JSON.parse(JSON.stringify(jsonLdSchema)); // 깊은 복사

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
    } catch (error) {
      console.error('[Workspace] JSON-LD 스키마 처리 실패:', error);
    }
  }

  // 완전한 HTML 문서 생성
  const fullHtml = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || '제목 없음'}</title>${jsonLdScript}
</head>
<body>
${contentHtml}
</body>
</html>`;

  return fullHtml;
}

// -----------------------------------------------------------------------------
// 3. 메인 렌더링 함수 (renderWorkspace)
// -----------------------------------------------------------------------------

export function renderWorkspace(container, ideaData) {
  Logger.debug('[Workspace] renderWorkspace 함수 호출됨');
  Logger.debug('[Workspace] container:', container);
  Logger.debug('[Workspace] ideaData:', ideaData);

  // 방어 코드
  ideaData.workspace = ideaData.workspace || {};
  ideaData.workspace.keywords = ideaData.workspace.keywords || [];
  ideaData.workspace.outline = ideaData.workspace.outline || [];
  ideaData.workspace.draft = ideaData.workspace.draft || '';
  ideaData.workspace.linkedScraps = ideaData.workspace.linkedScraps || {};

  // [수정] 1. 데이터 동기화 로직 추가
  // workspace 안에 숨어있는 linkedScraps를 바깥으로 꺼내줍니다.
  if (!ideaData.linkedScraps && ideaData.workspace.linkedScraps) {
    ideaData.linkedScraps = ideaData.workspace.linkedScraps;
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
    chrome.runtime
      .sendMessage({
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
      })
      .catch((err) => {
        Logger.warn(`[Workspace] 브리핑 요청 실패:`, err);
      });
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

        chrome.runtime.sendMessage({
          action: 'save_idea_draft',
          ideaId: window.__cp_workspace_idea_id,
          draft: event.data.content,
        });
      }
    });
    window.__cp_workspace_save_listener = true;
  }

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

  const longTailHtml =
    ideaData.longTailKeywords?.length > 0
      ? ideaData.longTailKeywords
          .map((k) => `<span class="tag long-tail-keyword interactive-tag">${k}</span>`)
          .join('')
      : '<span>롱테일 키워드 없음</span>';

  // 추천 검색어 표시 (tags 우선, 없으면 recommendedKeywords 사용)
  const recommendedKeywords =
    ideaData.tags?.length > 0
      ? ideaData.tags.filter((t) => t !== '#AI-추천').map((t) => t.replace(/^#+/, ''))
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

  const hasDraft = !!ideaData.draftContent;

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

  container.innerHTML = `
    <div class="workspace-container">
      <div id="main-editor-panel" class="workspace-column" style="display:flex; flex-direction:column;">
        <div id="workspace-title-header" style="padding:12px; border-bottom:1px solid #eee; background:#f8f9fa;">
            <input type="text" id="workspace-title-input" value="${
              ideaData.title || '제목 없음'
            }" style="width:100%; font-size:16px; border:none; background:transparent; font-weight:bold;">
            <button id="save-title-btn" style="display:none;">저장</button>
        </div>
        ${
          isTrackingOnly
            ? trackingOnlyContent
            : `
        <div style="padding:10px; border-bottom:1px solid #eee; display:flex; justify-content:space-between;">
            <button id="generate-draft-btn">📄 AI로 초안 생성하기</button>
            ${
              hasDraft
                ? `<button id="delete-draft-in-workspace" class="draft-delete-btn">❌ 초안 삭제</button>`
                : ''
            }
        </div>
        <div style="flex:1; display:flex; flex-direction:column; gap:8px;">
            <iframe id="quill-editor-iframe" src="${chrome.runtime.getURL(
              'editor.html'
            )}" style="flex:1; width:100%; border:none;"></iframe>
            <div id="linked-scraps-section" style="height:150px; overflow-x:auto; overflow-y:hidden; border-top:1px solid #eee; padding:10px;">
                <div class="scrap-list linked-scraps-list empty-state" data-idea-id="${
                  ideaData.id
                }" style="display:flex; flex-wrap:nowrap; gap:8px; align-items:center;">
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

  const workspaceEl = container.querySelector('.workspace-container');
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
            const editorIframe = workspaceContainer.querySelector('#quill-editor-iframe');

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

  // [추가] 초기 로드 시 조건이 맞으면 썸네일 버튼 표시
  renderThumbnailButton(workspaceEl, ideaData);

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

  if (ideaData && (ideaData.publishInfo || ideaData.seoTitle)) {
    // tags가 배열인 경우 쉼표로 조인
    let tagsForDisplay = ideaData.publishInfo?.tags || '';
    if (Array.isArray(tagsForDisplay)) {
      tagsForDisplay = tagsForDisplay.join(', ');
    }
    setTimeout(
      () =>
        showPublishInfo(
          container.querySelector('.workspace-container'),
          ideaData.publishInfo?.permalink,
          tagsForDisplay,
          ideaData.seoTitle,
          ideaData
        ),
      200
    );
  }
}

function addWorkspaceEventListeners(workspaceEl, ideaData, container = null) {
  console.log('[Workspace] addWorkspaceEventListeners 함수 호출됨');

  // "즉시 추적" 카드인지 확인
  const isTrackingOnly = ideaData.origin?.type === 'tracking_only';

  const tabBtns = workspaceEl.querySelectorAll('.resource-tab-btn');
  const allScrapsList = workspaceEl.querySelector('.all-scraps-list');
  const linkedScrapsList = workspaceEl.querySelector('.linked-scraps-list');
  const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
  const resourceLibrary = workspaceEl.querySelector('#resource-library-panel');

  console.log('[Workspace] editorIframe 찾기:', editorIframe);
  console.log('[Workspace] isTrackingOnly:', isTrackingOnly);

  // 연결된 스크랩 목록 초기 렌더링
  if (linkedScrapsList && ideaData.linkedScraps && ideaData.linkedScraps.length > 0) {
    chrome.storage.local.get('activeChannelId', (res) => {
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

  tabBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
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
                        ideaData.seoTitle,
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
                      ideaData.seoTitle,
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
            btn.addEventListener('click', (_e) => {
              const id = btn.dataset.id;
              const link = links.find((l) => l.id === id);
              if (!link) return;
              const html = `<a href="${link.url}" target="_blank" rel="nofollow noopener">${link.name}</a>`;
              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  { action: 'insert-html', data: { html } },
                  '*'
                );
                showToast('✅ 텍스트 링크를 에디터에 삽입했습니다.');
              } else {
                navigator.clipboard?.writeText?.(html);
                showToast(
                  'ℹ️ 에디터 감지 실패 — 카드 HTML을 클립보드에 복사했습니다. 붙여넣기 해주세요.'
                );
              }
            });
          });

          listContainer.querySelectorAll('.insert-affiliate-card').forEach((btn) => {
            btn.addEventListener('click', (_e) => {
              const id = btn.dataset.id;
              const link = links.find((l) => l.id === id);
              if (!link || !link.cardData) return;

              const cd = link.cardData;
              const payload = `
                      <div style="border:1px solid #eee;border-radius:12px;padding:16px;display:flex;gap:16px;max-width:640px;background:#fff;box-shadow:0 6px 20px rgba(0,0,0,0.06);">
                        <div style="width:128px;height:128px;border-radius:8px;overflow:hidden;background:#fafbfc;border:1px solid #eee;display:flex;align-items:center;justify-content:center;">
                        ${
                          cd.imageUrl
                            ? `<img src="${cd.imageUrl}" style="width:100%;height:100%;object-fit:cover;"/>`
                            : '<div style="color:#999;">이미지 없음</div>'
                        }
                        </div>
                        <div style="flex:1;">
                        <div style="font-weight:800;font-size:15px;color:#222;margin-bottom:8px;">${
                          cd.productName || link.name
                        }</div>
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                          <div style="font-weight:900;color:#ae0000;font-size:18px;">${
                            cd.salePrice ? Number(cd.salePrice).toLocaleString() + '원' : ''
                          }</div>
                          ${
                            cd.originalPrice && cd.originalPrice > cd.salePrice
                              ? `<div style="text-decoration:line-through;color:#999;">${Number(
                                  cd.originalPrice
                                ).toLocaleString()}원</div>`
                              : ''
                          }
                          ${
                            cd.discountRate
                              ? `<div style="color:#ae0000;font-weight:700;">${cd.discountRate}%</div>`
                              : ''
                          }
                        </div>
                        ${
                          cd.badges && cd.badges.length
                            ? `<div style="font-size:12px;color:#666;">${cd.badges.join(
                                ', '
                              )}</div>`
                            : ''
                        }
                        <div style="margin-top:12px;"><a href="${
                          link.url
                        }" target="_blank" style="background:#007aff;color:#fff;padding:8px 12px;border-radius:8px;text-decoration:none;">최저가 보러가기</a></div>
                        </div>
                      </div>
                    `;

              if (editorIframe && editorIframe.contentWindow) {
                editorIframe.contentWindow.postMessage(
                  { action: 'insert-html', data: { html: payload } },
                  '*'
                );
                showToast('✅ 카드 HTML을 에디터에 삽입 요청했습니다.');
              } else {
                // fallback
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard
                    .writeText(payload)
                    .then(() =>
                      showToast(
                        'ℹ️ 에디터가 감지되지 않아 카드 HTML을 클립보드에 복사했습니다. 붙여넣기 해주세요.'
                      )
                    );
                } else {
                  window.prompt('에디터가 감지되지 않습니다. 아래 HTML을 복사하세요:', payload);
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

  // 제목 저장 기능
  const titleInput = workspaceEl.querySelector('#workspace-title-input');
  const saveTitleBtn = workspaceEl.querySelector('#save-title-btn');
  if (titleInput && saveTitleBtn) {
    let titleChanged = false;

    titleInput.addEventListener('input', () => {
      titleChanged = true;
      saveTitleBtn.style.display = 'inline-block';
    });

    titleInput.addEventListener('blur', () => {
      if (titleChanged) {
        const newTitle = titleInput.value.trim();
        if (newTitle && newTitle !== ideaData.title) {
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
              if (response && response.success) {
                ideaData.title = newTitle;
                saveTitleBtn.style.display = 'none';
                titleChanged = false;
                showToast('✅ 제목이 저장되었습니다.');
              } else {
                console.error('[Workspace] 제목 저장 실패:', response);
                showToast('❌ 제목 저장에 실패했습니다.');
              }
            }
          );
        } else {
          saveTitleBtn.style.display = 'none';
          titleChanged = false;
        }
      }
    });

    saveTitleBtn.addEventListener('click', () => {
      const newTitle = titleInput.value.trim();
      if (newTitle && newTitle !== ideaData.title) {
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
            if (response && response.success) {
              ideaData.title = newTitle;
              saveTitleBtn.style.display = 'none';
              titleChanged = false;
              showToast('✅ 제목이 저장되었습니다.');
            } else {
              console.error('[Workspace] 제목 저장 실패:', response);
              showToast('❌ 제목 저장에 실패했습니다.');
            }
          }
        );
      } else {
        saveTitleBtn.style.display = 'none';
        titleChanged = false;
      }
    });
  }

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
      const { action } = event.data;
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

              const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');

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
    } else if (e.target.id === 'generate-draft-btn' || e.target.closest('#generate-draft-btn')) {
      e.preventDefault();
      e.stopPropagation();
      const btn =
        e.target.id === 'generate-draft-btn' ? e.target : e.target.closest('#generate-draft-btn');
      if (!btn) return;

      // 버튼 비활성화 및 로딩 표시
      btn.disabled = true;
      const originalText = btn.textContent;
      btn.textContent = '⏳ 초안 생성 중...';

      // 현재 에디터 내용 가져오기
      const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
      if (!editorIframe || !editorIframe.contentWindow) {
        alert('에디터가 준비되지 않았습니다.');
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      // 에디터에서 현재 내용 가져오기
      const messageId = `get-content-${Date.now()}`;
      const getContentPromise = new Promise((resolve) => {
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

      getContentPromise.then(async (currentDraftHtml) => {
        // [체크리스트 1-1] 필수 데이터 유효성 검사
        const title = ideaData.title || '';
        const outline = ideaData.outline || ideaData.workspace?.outline || [];

        if (!title || title.trim() === '') {
          alert('❌ 제목이 비어있습니다. 제목을 입력해주세요.');
          btn.disabled = false;
          btn.textContent = originalText;
          return;
        }

        if (!outline || outline.length === 0) {
          const proceed = confirm(
            '⚠️ 목차가 없습니다. 목차 없이 초안을 생성하면 글 구조가 엉성할 수 있습니다.\n\n그래도 계속하시겠습니까?'
          );
          if (!proceed) {
            btn.disabled = false;
            btn.textContent = originalText;
            return;
          }
        }

        // HTML을 텍스트로 변환 (HTML 태그 제거)
        let currentDraft = '';
        if (currentDraftHtml) {
          const tempDiv = document.createElement('div');
          tempDiv.innerHTML = currentDraftHtml;
          currentDraft = tempDiv.textContent || tempDiv.innerText || '';
        }

        // [체크리스트 1-2] 연결된 스크랩 데이터 가져오기 및 텍스트 truncation
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

        // 스크랩 텍스트 최대 길이 제한 (토큰 절약)
        const MAX_SCRAP_TEXT_LENGTH = 2000; // 각 스크랩당 최대 2000자

        if (linkedScrapsIds.length > 0) {
          // 모든 스크랩 가져오기
          const { activeChannelId } = await chrome.storage.local.get('activeChannelId');
          await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              { action: 'get_all_scraps', channelId: activeChannelId },
              (response) => {
                if (response && response.success && response.scraps) {
                  // 연결된 스크랩만 필터링
                  linkedScrapsIds.forEach((scrapId) => {
                    const scrap = response.scraps.find((s) => s.id === scrapId);
                    if (scrap) {
                      let scrapText = scrap.text || scrap.cleanText || '';
                      // 텍스트가 너무 길면 truncation (토큰 절약)
                      if (scrapText.length > MAX_SCRAP_TEXT_LENGTH) {
                        scrapText =
                          scrapText.substring(0, MAX_SCRAP_TEXT_LENGTH) +
                          '... [내용이 길어 일부만 포함됨]';
                      }
                      linkedScrapsContent.push({
                        title: scrap.title || scrap.text?.substring(0, 50) || '스크랩',
                        url: scrap.url || '',
                        text: scrapText,
                      });
                    }
                  });
                }
                resolve();
              }
            );
          });
        }

        // 아이디어 데이터 준비
        const draftData = {
          title: title,
          description: ideaData.description || '',
          tags: ideaData.tags || ideaData.workspace?.keywords || [],
          outline: outline,
          longTailKeywords: ideaData.longTailKeywords || [],
          recommendedSearches: ideaData.recommendedKeywords || [],
          currentDraft: currentDraft || '',
          linkedScrapsContent: linkedScrapsContent,
        };

        // [체크리스트 4-3] 타임아웃 처리 (썸네일 생성 포함하여 120초로 증가)
        const TIMEOUT_MS = 120000; // 120초 (2분) - 썸네일 생성 포함
        let timeoutId = setTimeout(() => {
          if (btn.disabled) {
            btn.disabled = false;
            btn.textContent = originalText;
            alert(
              '⏱️ 초안 생성이 2분을 초과했습니다. 네트워크 상태를 확인하거나 다시 시도해주세요.'
            );
            console.error('[Workspace] AI 초안 생성 타임아웃 (120초 초과)');
          }
        }, TIMEOUT_MS);

        // AI 초안 생성 요청
        chrome.runtime.sendMessage(
          {
            action: 'generate_draft_from_idea',
            data: draftData,
          },
          (response) => {
            clearTimeout(timeoutId); // 타임아웃 취소
            btn.disabled = false;
            btn.textContent = originalText;

            // [체크리스트 4-2] 응답 오류 처리 강화
            if (!response) {
              alert('❌ 초안 생성에 실패했습니다. 응답을 받지 못했습니다.');
              console.error('[Workspace] AI 초안 생성: 응답 없음');
              return;
            }

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
              sendCommand('set-content', { html: htmlContent });
              sendCommand('focus');

              // 초안 저장
              chrome.runtime.sendMessage({
                action: 'save_idea_draft',
                ideaId: ideaData.id,
                draft: response.draft,
              });

              // 발행 정보 업데이트 (permalink, tags, seoTitle, thumbnailInfo, jsonLdSchema)
              if (
                response.permalink ||
                response.tags ||
                response.seoTitle ||
                response.thumbnailInfo ||
                response.jsonLdSchema
              ) {
                const updates = {};
                const publishInfoUpdates = {};

                if (response.permalink) publishInfoUpdates.permalink = response.permalink;
                if (response.tags) publishInfoUpdates.tags = response.tags;
                if (response.seoTitle) updates.seoTitle = response.seoTitle;
                if (response.seoTitle) publishInfoUpdates.seoTitle = response.seoTitle;
                if (response.thumbnailInfo)
                  publishInfoUpdates.thumbnailInfo = response.thumbnailInfo;
                if (response.jsonLdSchema) publishInfoUpdates.jsonLdSchema = response.jsonLdSchema;

                if (Object.keys(publishInfoUpdates).length > 0) {
                  updates.publishInfo = publishInfoUpdates;
                }

                // Firebase에 업데이트 전송
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
                    (updateResponse) => {
                      if (updateResponse && !updateResponse.success) {
                        console.error('[Workspace] 발행 정보 Firebase 저장 실패:', updateResponse);
                      }
                    }
                  );
                }

                // ideaData 먼저 업데이트
                if (!ideaData.publishInfo) ideaData.publishInfo = {};
                if (response.permalink) ideaData.publishInfo.permalink = response.permalink;
                if (response.tags) ideaData.publishInfo.tags = response.tags;
                if (response.thumbnailInfo)
                  ideaData.publishInfo.thumbnailInfo = response.thumbnailInfo;
                if (response.seoTitle) ideaData.seoTitle = response.seoTitle;
                if (response.jsonLdSchema)
                  ideaData.publishInfo.jsonLdSchema = response.jsonLdSchema;

                // 발행 정보 UI 업데이트 (Firebase 업데이트와 독립적으로)
                setTimeout(() => {
                  const publishInfo = {
                    permalink: response.permalink || ideaData.publishInfo?.permalink || '',
                    tags: response.tags || ideaData.publishInfo?.tags || '',
                    thumbnailInfo: response.thumbnailInfo || ideaData.publishInfo?.thumbnailInfo,
                  };
                  // tags가 문자열이 아닌 배열인 경우 쉼표로 조인
                  let tagsForDisplay = publishInfo.tags;
                  if (Array.isArray(tagsForDisplay)) {
                    tagsForDisplay = tagsForDisplay.join(', ');
                  }
                  showPublishInfo(
                    workspaceEl,
                    publishInfo.permalink,
                    tagsForDisplay || '',
                    response.seoTitle || ideaData.seoTitle || '',
                    ideaData
                  );
                }, 200);
              }

              // 초안 삭제 버튼 동적 추가
              const buttonContainer =
                workspaceEl.querySelector('#workspace-title-header').nextElementSibling;
              if (buttonContainer && !buttonContainer.querySelector('#delete-draft-in-workspace')) {
                const deleteBtn = document.createElement('button');
                deleteBtn.id = 'delete-draft-in-workspace';
                deleteBtn.className = 'draft-delete-btn';
                deleteBtn.textContent = '❌ 초안 삭제';
                buttonContainer.appendChild(deleteBtn);
              }

              // [수정] 중복 코드를 제거하고 헬퍼 함수 호출
              renderThumbnailButton(workspaceEl, ideaData);

              showToast('✅ AI 초안이 생성되었습니다!');
            } else {
              const errorMsg = response?.error || '초안 생성에 실패했습니다.';
              alert(`❌ ${errorMsg}`);
              console.error('[Workspace] AI 초안 생성 실패:', response);
            }
          }
        );
      });
    } else if (
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

      if (confirm('초안을 삭제하시겠습니까?')) {
        console.log('[Workspace] 초안 삭제 확인됨, 에디터 초기화 시작');

        // 에디터 즉시 초기화
        const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
        if (!editorIframe) {
          console.error('[Workspace] 에디터 iframe을 찾을 수 없습니다.');
        } else if (!editorIframe.contentWindow) {
          console.error('[Workspace] 에디터 iframe의 contentWindow에 접근할 수 없습니다.');
        } else {
          // 에디터에 직접 메시지 전송 (여러 번 시도하여 확실하게)
          let attemptCount = 0;
          const clearEditor = () => {
            attemptCount++;
            try {
              console.log(`[Workspace] 에디터 초기화 시도 ${attemptCount}회`);
              editorIframe.contentWindow.postMessage(
                {
                  action: 'set-content',
                  data: { html: '' },
                },
                '*'
              );
            } catch (err) {
              console.error('[Workspace] 에디터 초기화 오류:', err);
            }
          };

          clearEditor();
          // 에디터가 준비될 때까지 재시도
          setTimeout(clearEditor, 50);
          setTimeout(clearEditor, 150);
          setTimeout(clearEditor, 300);
          setTimeout(clearEditor, 500);

          // 포커스도 전송
          setTimeout(() => {
            try {
              editorIframe.contentWindow.postMessage(
                {
                  action: 'focus',
                },
                '*'
              );
            } catch (err) {
              console.error('[Workspace] 에디터 포커스 오류:', err);
            }
          }, 600);
        }

        // Firebase에서 초안과 발행 정보 모두 삭제
        console.log('[Workspace] Firebase 삭제 요청 전송:', {
          ideaId: ideaData.id,
          status: ideaData.status || 'ideas',
        });
        chrome.runtime.sendMessage(
          {
            action: 'delete_draft_and_publish_info',
            data: {
              ideaId: ideaData.id,
              status: ideaData.status || 'ideas',
            },
          },
          (response) => {
            console.log('[Workspace] Firebase 삭제 응답:', response);
            if (response && response.success) {
              // 초안 삭제 후 자동 저장 차단 플래그 설정 (5초간)
              window.__cp_draft_deletion_block_time = Date.now();
              Logger.debug(`[Workspace] 초안 삭제 후 자동 저장 차단 시작 (5초)`);

              // ideaData에서도 제거 (모든 관련 필드)
              ideaData.draftContent = '';
              if (ideaData.workspace) {
                ideaData.workspace.draft = '';
              }
              if (ideaData.publishInfo) {
                ideaData.publishInfo = {};
              }
              ideaData.seoTitle = '';

              // 전역 ideaData도 동기화
              if (window.__cp_workspace_idea_data) {
                window.__cp_workspace_idea_data.draftContent = '';
                if (window.__cp_workspace_idea_data.workspace) {
                  window.__cp_workspace_idea_data.workspace.draft = '';
                }
                if (window.__cp_workspace_idea_data.publishInfo) {
                  window.__cp_workspace_idea_data.publishInfo = {};
                }
                window.__cp_workspace_idea_data.seoTitle = '';
              }

              // 발행 정보 UI 즉시 업데이트 (Firebase 업데이트 없이 UI만 갱신)
              const publishInfoArea = workspaceEl.querySelector('#publish-info-area');
              if (publishInfoArea) {
                // showPublishInfo를 호출하면 빈 값으로도 publishInfo가 재생성될 수 있으므로
                // UI만 직접 업데이트 (Firebase 업데이트는 하지 않음)
                const existingInfo = workspaceEl.querySelector('.publish-info-panel');
                if (existingInfo) {
                  existingInfo.remove();
                }
                // 빈 발행 정보 패널 표시 (Firebase 업데이트 없이)
                const emptyInfoHtml = `
                                <div class="publish-info-panel" style="padding: 12px; background: #f5f5f5; border-radius: 4px; margin-top: 12px;">
                                    <p style="color: #999; font-size: 13px;">발행 정보가 없습니다.</p>
                                </div>
                            `;
                publishInfoArea.insertAdjacentHTML('beforeend', emptyInfoHtml);
              }

              // 썸네일 버튼도 제거 (초안이 없으면 썸네일 정보도 없어야 함)
              const thumbBtn = workspaceEl.querySelector('#btn-create-thumbnail');
              if (thumbBtn && thumbBtn.parentNode) {
                thumbBtn.remove();
                console.log('[Workspace] 썸네일 버튼이 UI에서 제거되었습니다.');
              }

              // 초안 삭제 버튼 제거
              if (deleteBtn && deleteBtn.parentNode) {
                deleteBtn.remove();
                console.log('[Workspace] 초안 삭제 버튼이 UI에서 제거되었습니다.');
              }

              // 에디터가 정말 비워졌는지 최종 확인
              setTimeout(() => {
                if (editorIframe && editorIframe.contentWindow) {
                  try {
                    editorIframe.contentWindow.postMessage(
                      {
                        action: 'get-content',
                        data: { requestId: 'verify-clear' },
                      },
                      '*'
                    );

                    // 응답 확인을 위한 리스너
                    const verifyListener = (event) => {
                      if (
                        event.data &&
                        event.data.action === 'content-response' &&
                        event.data.requestId === 'verify-clear'
                      ) {
                        const content = event.data.data?.html || '';
                        if (
                          content &&
                          content.trim() !== '' &&
                          content !== '<p><br></p>' &&
                          content !== '<p></p>'
                        ) {
                          console.warn(
                            '[Workspace] 에디터가 완전히 비워지지 않았습니다. 재시도합니다.'
                          );
                          editorIframe.contentWindow.postMessage(
                            {
                              action: 'set-content',
                              data: { html: '' },
                            },
                            '*'
                          );
                        } else {
                          console.log('[Workspace] 에디터 초기화 확인 완료');
                        }
                        window.removeEventListener('message', verifyListener);
                      }
                    };
                    window.addEventListener('message', verifyListener);
                    setTimeout(() => window.removeEventListener('message', verifyListener), 2000);
                  } catch (err) {
                    console.error('[Workspace] 에디터 검증 오류:', err);
                  }
                }
              }, 1000);

              showToast('✅ 초안과 발행 정보가 삭제되었습니다.');
            } else {
              console.error('[Workspace] 초안 삭제 실패:', response);
              showToast(`❌ 초안 삭제에 실패했습니다: ${response?.error || '알 수 없는 오류'}`);
            }
          }
        );
      }
    } else if (e.target.closest('.scrap-card-item')) {
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
    }
  });

  if (allScrapsList) {
    allScrapsList.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.scrap-card-item');
      if (card)
        e.dataTransfer.setData(
          'application/json',
          JSON.stringify({ id: card.dataset.scrapId, text: card.dataset.text })
        );
    });

    // 모든 스크랩 리스트의 삭제 버튼 이벤트 리스너 (이벤트 위임)
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
            chrome.storage.local.get('activeChannelId', (res) => {
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
                          const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
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

      if (linkedScrapsIds.includes(scrapData.id)) {
        showToast('⚠️ 이미 연결된 스크랩입니다.');
        return;
      }

      // 이미 DOM에 존재하는지도 확인
      if (linkedScrapsList.querySelector(`[data-scrap-id="${scrapData.id}"]`)) {
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
            linkedScrapsList.insertAdjacentHTML('beforeend', createScrapCard(scrapData, true));
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
            showToast('✅ 스크랩이 연결되었습니다.');
            // 새로 추가된 스크랩에 드래그 이벤트 리스너 추가 (연결 해제는 이벤트 위임으로 처리됨)
            const newScrapItem = linkedScrapsList.querySelector(
              `[data-scrap-id="${scrapData.id}"]`
            );
            if (newScrapItem) {
              setupLinkedScrapItem(newScrapItem);
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
      const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
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
        }
      }
    }
  });
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
  const workspaceEl = container.querySelector('.cp-workspace-container');
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
                  const editorIframe = workspaceEl.querySelector('#quill-editor-iframe');
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
        const editorIframe = workspaceContainer.querySelector('#quill-editor-iframe');

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
