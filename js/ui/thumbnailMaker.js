// js/ui/thumbnailMaker.js
import { renderTemplateFromData, createSmartTemplate } from './thumbnailGenerator.js';
import { showToast, Logger, debounce, sendRuntimeMessageWithTimeout } from '../utils.js';
// Select background references helper from aiService
import { selectBackgroundReferenceImages } from '../services/aiService.js';

/**
 * 썸네일 제작 모달을 엽니다.
 * @param {Object} draftData - 초안 생성 시 확보된 데이터 (thumbnailInfo 포함)
 * @param {Function} onInsert - '본문에 삽입' 클릭 시 실행할 콜백 (dataUrl, altText 전달)
 * @param {Function} onSave - 상태 변경 시 자동 저장 콜백 (thumbnailInfo 전달)
 * @param {Function} onEditTui - '정밀 편집' 클릭 시 실행할 콜백 (dataUrl 전달)
 * @param {Object} initialOptions - 초기 옵션 (showText 등)
 * @param {Element} container - 모달을 추가할 부모 컨테이너 (기본값: document.body)
 */
export function openThumbnailMaker(
  draftData,
  onInsert,
  onSave,
  onEditTui,
  initialOptions = {},
  container = document.body
) {
  // 0. [버그 수정] 기존 모달이 있다면 제거 (container 내부 검색)
  // container가 ShadowRoot일 수 있으므로 querySelector 사용
  const existingModal = container.querySelector
    ? container.querySelector('#cp-thumbnail-modal')
    : document.getElementById('cp-thumbnail-modal');
  if (existingModal) {
    existingModal.remove();
  }

  // 1. 기존 데이터에서 썸네일 정보 추출 (배열 지원)
  let thumbInfo = null;
  let thumbnailCandidates = []; // 3가지 컨셉 후보 저장
  let selectedConceptIndex = 0; // 현재 선택된 컨셉 인덱스

  // helper: create three meta-based prompt candidates (reusable by UI button)
  const createMetaBasedCandidates = (baseSourceRawParam) => {
    const stripHtml = (s) => (String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
    const baseSourceRaw =
      baseSourceRawParam ||
      draftData.metaDescription ||
      draftData.description ||
      stripHtml(draftData.formattedDraft || '') ||
      draftData.seoTitle ||
      '제목을 입력하세요';
    const baseSource = baseSourceRaw.length > 200 ? baseSourceRaw.substring(0, 200).trim() + '...' : baseSourceRaw;

    return [
      {
        type: 'curiosity',
        thumbnailPromptEn: `High-quality, dramatic thumbnail inspired by: "${baseSource}", create a visually intriguing image with mysterious atmosphere, bold composition, and dramatic lighting — keep the image text-free and leave room for overlay`,
        thumbnailPromptKo: `다음 메타 요약을 바탕으로 한 호기심 유발형 썸네일: "${baseSource}" — 드라마틱한 조명과 강렬한 구성, 텍스트는 이미지에 포함하지 말고 오버레이 공간을 남겨주세요.`,
        thumbnailText: '',
        fontFamily: "'Pretendard', sans-serif",
        textColor: 'auto',
        ratio: '16:9',
        bgImage: null,
        overlayOpacity: 0.0,
      },
      {
        type: 'informative',
        thumbnailPromptEn: `Clean, professional thumbnail based on: "${baseSource}", minimal composition optimized for legibility, bright lighting, icons or numbers for emphasis, no embedded title text in the image`,
        thumbnailPromptKo: `다음 메타 요약을 바탕으로 한 정보형 썸네일: "${baseSource}" — 가독성 좋은 미니멀 구성, 밝은 조명, 강조용 아이콘/숫자 사용. 이미지 내 텍스트는 제외해주세요.`,
        thumbnailText: '완벽 정리',
        fontFamily: "'Pretendard', sans-serif",
        textColor: 'auto',
        ratio: '16:9',
        bgImage: null,
        overlayOpacity: 0.0,
      },
      {
        type: 'emotional',
        thumbnailPromptEn: `Warm, emotive thumbnail using: "${baseSource}", soft tones, human element or relatable scene, cozy lighting and colors that evoke empathy, leave clear space for overlay text`,
        thumbnailPromptKo: `다음 메타 요약을 바탕으로 한 감성형 썸네일: "${baseSource}" — 부드러운 톤과 인간적 요소, 따뜻한 조명으로 공감을 유도하고 오버레이 텍스트 공간을 확보하세요.`,
        thumbnailText: '당신을 위한',
        fontFamily: "'Pretendard', sans-serif",
        textColor: 'auto',
        ratio: '16:9',
        bgImage: null,
        overlayOpacity: 0.0,
      },
    ];
  }; 

  // thumbnailInfo가 배열인 경우
  if (Array.isArray(draftData.thumbnailInfo)) {
    thumbnailCandidates = draftData.thumbnailInfo;
    // 저장된 선택 인덱스가 있으면 사용, 없으면 첫 번째 요소 사용
    const savedIndex = draftData.selectedThumbnailIndex || 0;
    selectedConceptIndex =
      savedIndex >= 0 && savedIndex < thumbnailCandidates.length ? savedIndex : 0;
    thumbInfo = thumbnailCandidates[selectedConceptIndex] || thumbnailCandidates[0] || null;
    Logger.debug('[ThumbnailMaker] 썸네일 배열에서 선택된 컨셉 사용:', {
      index: selectedConceptIndex,
      type: thumbInfo?.type,
      total: thumbnailCandidates.length,
    });
  } else if (draftData.thumbnailInfo) {
    // 단일 객체인 경우 (구버전 호환)
    thumbInfo = draftData.thumbnailInfo;
    thumbnailCandidates = [draftData.thumbnailInfo];
  }

  // 썸네일 정보가 없으면 기본값 (3가지 대비되는 컨셉 생성 — 메타디스크립션 우선 사용)
  if (!thumbInfo || thumbnailCandidates.length === 0) {
    thumbnailCandidates = createMetaBasedCandidates();
    selectedConceptIndex = 0;
    thumbInfo = thumbnailCandidates[0];
    Logger.debug('[ThumbnailMaker] 메타 기반 기본 컨셉 3개 생성:', thumbnailCandidates.length, { baseSource: (draftData.metaDescription || draftData.description || (draftData.formattedDraft||'').replace(/<[^>]+>/g, '').trim() || draftData.seoTitle || '제목을 입력하세요') });
  }

  // 초기화 데이터 로깅 시 Base64 숨기기
  const logThumbInfo = { ...thumbInfo };
  if (logThumbInfo.bgImage && logThumbInfo.bgImage.startsWith('data:image')) {
    logThumbInfo.bgImage = `[Base64 Image: ${logThumbInfo.bgImage.length} chars]`;
  } else if (logThumbInfo.bgImage && logThumbInfo.bgImage.length > 80) {
    logThumbInfo.bgImage = logThumbInfo.bgImage.substring(0, 80) + '...';
  }
  console.log('%c[AI 썸네일 메이커 디버깅][Init]', 'color:#9E9E9E', logThumbInfo);

  // [수정 1] initialOptions에서 initialShowText 추출 (변수 선언 누락 수정)
  const initialShowText = initialOptions.showText !== undefined ? initialOptions.showText : true;

  // [수정 2] modal 변수 선언 및 엘리먼트 생성 (누락된 코드 추가)
  const modal = document.createElement('div');
  modal.id = 'cp-thumbnail-modal';

  // [핵심 수정] Z-Index를 브라우저 최대 허용값(2147483647)으로 수정
  // 기존 2147483648은 무효화되어 패널 뒤로 숨겨짐
  modal.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:640px;min-width:320px;background:#1e1e1e;color:#fff;z-index:2147483647;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.5);border-radius:16px;font-family:'Pretendard', sans-serif;border:1px solid #333;max-height:90vh;overflow-y:auto;box-sizing:border-box;";

  // Safety cleanup: remove any leftover main title UI elements or labels inserted by older builds or test helpers
  // This ensures the modal never shows the deprecated main title input or its toggle in runtime.
  const cleanupPotentialTitleUi = (rootEl) => {
    try {
      const leftoverTitle = rootEl.querySelector('#tm-title');
      if (leftoverTitle) leftoverTitle.remove();
      const leftoverShowText = rootEl.querySelector('#tm-show-text');
      if (leftoverShowText) leftoverShowText.remove();
      // Remove labels that explicitly mention 메인 타이틀 or 텍스트 표시
      Array.from(rootEl.querySelectorAll('label')).forEach((lbl) => {
        if (/메인\s*타이틀|텍스트\s*표시/.test((lbl.textContent || '').trim())) {
          lbl.remove();
        }
      });
    } catch (e) {
      // ignore cleanup errors
      console.warn('[ThumbnailMaker] cleanupPotentialTitleUi failed:', e && e.message);
    }
  };

  // 프롬프트 텍스트 이스케이프 처리
  const escapedPromptEn = (thumbInfo.thumbnailPromptEn || '')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const escapedPromptKo = (thumbInfo.thumbnailPromptKo || '자동 설정됨')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
  const escapedThumbText = (thumbInfo.thumbnailText || '')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  // 컨셉 선택 UI 생성 (3가지 컨셉이 있을 때만 표시)
  const conceptSelectorHtml =
    thumbnailCandidates.length > 1
      ? `
    <div style="margin-bottom:16px;padding:12px;background:#2d2d2d;border-radius:8px;border:1px solid #444;">
      <label style="display:block;font-size:12px;color:#aaa;margin-bottom:8px;font-weight:600;">🎨 썸네일 컨셉 선택 (A/B 테스팅)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${thumbnailCandidates
          .map((candidate, idx) => {
            const typeLabels = {
              curiosity: '🔥 호기심 자극형',
              informative: '📊 정보 요약형',
              emotional: '💝 감성/공감형',
            };
            const isSelected = idx === selectedConceptIndex;
            const label = typeLabels[candidate.type] || `컨셉 ${idx + 1}`;
            return `
            <button class="tm-concept-btn" data-index="${idx}" style="
              flex:1;min-width:120px;padding:10px 12px;
              background:${isSelected ? 'linear-gradient(135deg, #6c5ce7, #a29bfe)' : '#1e1e1e'};
              color:${isSelected ? '#fff' : '#ccc'};
              border:1px solid ${isSelected ? '#6c5ce7' : '#444'};
              border-radius:6px;
              cursor:pointer;
              font-size:12px;
              font-weight:${isSelected ? '600' : '400'};
              transition:all 0.2s;
              text-align:center;
            ">
              ${label}${isSelected ? ' ✓' : ''}
            </button>
          `;
          })
          .join('')}
      </div>
      <div style="margin-top:8px;padding:8px;background:#1e1e1e;border-radius:4px;font-size:11px;color:#888;line-height:1.5;">
        <strong style="color:#aaa;">선택된 컨셉:</strong> ${thumbInfo.thumbnailText || '없음'}<br>
        <span style="font-size:10px;opacity:0.8;">각 컨셉을 클릭하여 프롬프트와 문구를 변경할 수 있습니다.</span>
      </div>
    </div>
  `
      : '';

  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-shrink:0;">
      <h3 style="margin:0;font-size:18px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span>✨ AI 썸네일 메이커</span>
        <span style="font-size:11px;background:#6c5ce7;padding:2px 6px;border-radius:4px;">Beta</span>
      </h3>
      <button id="tm-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:24px;line-height:1;flex-shrink:0;padding:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">&times;</button>
    </div>

    <div style="display:grid;grid-template-columns: minmax(0, 2fr) minmax(0, 1fr); gap:20px; margin-bottom:20px;flex-shrink:0;align-items:start;">
      <div style="display:flex;flex-direction:column;gap:12px;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:nowrap;">
          <label style="font-size:11px;color:#888;white-space:nowrap;flex-shrink:0;">비율</label>
          <select id="tm-ratio" style="flex:1;min-width:0;padding:8px 6px;background:#2d2d2d;color:#fff;border:1px solid #444;border-radius:6px;font-size:12px;box-sizing:border-box;line-height:1.4;height:auto;">
            <option value="16:9" ${thumbInfo.ratio === '16:9' ? 'selected' : ''}>🖥️ 유튜브 (16:9)</option>
            <option value="1:1" ${thumbInfo.ratio === '1:1' ? 'selected' : ''}>🟦 인스타 (1:1)</option>
            <option value="9:16" ${thumbInfo.ratio === '9:16' ? 'selected' : ''}>📱 쇼츠/릴스 (9:16)</option>
            <option value="4:3" ${thumbInfo.ratio === '4:3' ? 'selected' : ''}>📄 블로그 (4:3)</option>
          </select>
          <!-- Move Generate button next to ratio select for easier access -->
          <button id="tm-gen-bg" style="margin-left:8px;padding:8px 10px;background:linear-gradient(135deg, #6c5ce7, #a29bfe);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;box-shadow:0 2px 6px rgba(108,92,231,0.18);white-space:nowrap;">🎨 배경 생성</button>
          <button id="tm-insert" style="margin-left:8px;padding:8px 10px;background:#0984e3;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;box-shadow:0 2px 6px rgba(9,132,227,0.18);white-space:nowrap;">본문에 삽입</button>
          <button id="tm-my-images" style="margin-left:8px;padding:8px 10px;border:1px solid #555;background:transparent;color:#ccc;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;white-space:nowrap;">🖼️ 내가 만든 이미지</button>
        </div>
        

        

        


        <div style="display:flex;gap:10px;flex-shrink:0;flex-wrap:wrap;">


        </div>
      </div>
    </div>
    
    <!-- Reference images UI (Moved) -->
    <div id="tm-ref-images-wrapper" style="margin-bottom:10px;display:block;">
      <label style="display:block;font-size:11px;color:#aaa;margin-bottom:6px;">참고 이미지</label>
      <div id="tm-ref-images" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
        <div style="font-size:12px;color:#777;">(없음)</div>
      </div>
      <div style="font-size:11px;color:#888;margin-top:6px;">AI는 위의 참고 이미지를 배경 생성 시 참고합니다.</div>
    </div>

    <div id="tm-canvas-wrapper" style="background:#000;padding:20px;border-radius:12px;border:2px dashed #333;display:flex;align-items:center;justify-content:center;position:relative;transition:0.2s;min-height:200px;max-height:50vh;margin-bottom:20px;flex-shrink:0;box-shadow:inset 0 0 20px rgba(0,0,0,0.5);">
      <div id="tm-loading" style="position:absolute;display:none;flex-direction:column;align-items:center;gap:12px;z-index:10;">
        <div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.1);border-top-color:#fff;border-radius:50%;animation:tm-spin 1s linear infinite;"></div>
        <span style="color:#fff;font-size:14px;font-weight:500;">AI가 배경을 그리고 있습니다...</span>
      </div>
      



      
      <canvas id="tm-preview" width="1280" height="720" style="max-width:100%;max-height:calc(50vh - 40px);width:auto;height:auto;object-fit:contain;box-shadow:0 10px 30px rgba(0,0,0,0.5);"></canvas>
    </div>

    ${conceptSelectorHtml}
    
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex-shrink:0;">
      <div style="flex:1;min-width:200px;background:#2d2d2d;padding:10px 12px;border-radius:8px;display:flex;flex-direction:column;justify-content:center;">
        <span style="font-size:10px;color:#888;margin-bottom:4px;">적용된 프롬프트 (자동)</span>
        <div id="tm-prompt-display" style="font-size:12px;color:#ccc;word-wrap:break-word;word-break:break-word;line-height:1.4;" title="${escapedPromptEn}">
          <div style="margin-bottom:4px;">${escapedPromptKo}</div>
          <div style="font-size:10px;color:#888;opacity:0.8;word-break:break-word;">${escapedPromptEn}</div>
        </div>
      </div>
      
      <div style="display:flex;gap:8px;flex-shrink:0;align-items:center;">
        <button id="tm-undo" title="실행 취소 (Ctrl+Z)" style="padding:8px 12px;border:1px solid #555;background:transparent;color:#ccc;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap;transition:all 0.2s;" disabled>
          ↶ 실행 취소
        </button>
        <button id="tm-redo" title="다시 실행 (Ctrl+Y)" style="padding:8px 12px;border:1px solid #555;background:transparent;color:#ccc;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:4px;white-space:nowrap;transition:all 0.2s;" disabled>
          ↷ 다시 실행
        </button>
        <button id="tm-gen-from-meta" title="메타로 프롬프트 재생성" style="padding:8px 12px;border:1px solid #555;background:transparent;color:#ccc;border-radius:6px;cursor:pointer;font-size:12px;display:flex;align-items:center;gap:6px;white-space:nowrap;">
          🔁 메타로 프롬프트 생성
        </button>
        <button id="tm-edit-tui" style="padding:10px 16px;border:1px solid #555;background:transparent;color:#ccc;border-radius:8px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px;white-space:nowrap;">
          🛠️ 정밀 편집
        </button>

      </div>
    </div>
    <style>
      @keyframes tm-spin { to { transform: rotate(360deg); } }
      #cp-thumbnail-modal::-webkit-scrollbar { width: 8px; }
      #cp-thumbnail-modal::-webkit-scrollbar-track { background: #2d2d2d; border-radius: 4px; }
      #cp-thumbnail-modal::-webkit-scrollbar-thumb { background: #555; border-radius: 4px; }
      #cp-thumbnail-modal::-webkit-scrollbar-thumb:hover { background: #666; }
    </style>
  `;
  // [수정] 전달받은 container(Shadow DOM)에 추가
  container.appendChild(modal);

  // Run cleanup in case older builds or test helpers injected deprecated title UI
  cleanupPotentialTitleUi(modal);

  // [DEBUG] concept selector 존재 여부 확인 및 폴백
  try {
    const promptDisplayEl = modal.querySelector('#tm-prompt-display');
    console.log('[ThumbnailMaker] Concept UI check:', {
      thumbnailCandidatesLength: thumbnailCandidates.length,
      hasConceptButtons: modal.querySelectorAll('.tm-concept-btn')?.length || 0,
      conceptHtmlSample: conceptSelectorHtml ? conceptSelectorHtml.slice(0, 120) : null,
    });

    // 만약 컨셉 버튼이 DOM에 없는데 후보가 여러 개라면 폴백으로 삽입
    if (
      thumbnailCandidates.length > 1 &&
      (!modal.querySelectorAll('.tm-concept-btn') ||
        modal.querySelectorAll('.tm-concept-btn').length === 0)
    ) {
      console.warn('[ThumbnailMaker] 컨셉 선택 UI가 누락되어 폴백으로 삽입합니다.');
      if (promptDisplayEl) {
        promptDisplayEl.insertAdjacentHTML('beforebegin', conceptSelectorHtml || '');
      } else {
        // promptDisplay가 없으면 canvas-wrapper 뒤에 삽입
        const canvasWrapper = modal.querySelector('#tm-canvas-wrapper');
        canvasWrapper.insertAdjacentHTML('afterend', conceptSelectorHtml || '');
      }
    }
  } catch (e) {
    console.warn('[ThumbnailMaker] Concept UI check failed:', e && e.message);
  }

  // 3. 캔버스 및 상태 초기화
  const canvas = modal.querySelector('#tm-preview');
  const ctx = canvas.getContext('2d');
  // [신규] 저장된 배경 이미지가 있으면 불러오기
  let currentBgImage = thumbInfo.bgImage || null;

  // [신규] 제외된 참조 이미지 목록
  const excludedRefImages = new Set();
  let currentRefImages = [];

  // [신규] compute and render reference images for background generation
  const renderReferenceImages = () => {
    const wrapper = modal.querySelector('#tm-ref-images');
    if (!wrapper) return [];
    wrapper.innerHTML = '';
    const formattedDraft = draftData.formattedDraft || draftData.currentDraft || '';
    const idea = draftData || {};
    const affiliateLinks = draftData.affiliateLinks || [];

    console.log('%c[AI 썸네일 메이커 디버깅][참조 렌더]', 'color:#9E9E9E', {
      draftLength: formattedDraft.length,
      ideaKeys: Object.keys(idea),
      affiliateLinksCount: affiliateLinks.length,
    });

    let refs = selectBackgroundReferenceImages(
      { formattedDraft, ideaData: idea, affiliateLinks },
      5
    );

    // 제외된 이미지 필터링
    refs = refs.filter((url) => !excludedRefImages.has(url));
    currentRefImages = refs; // 현재 참조 이미지 목록 업데이트

    console.log('%c[AI 썸네일 메이커 디버깅][참조 선택 결과]', 'color:#9E9E9E', refs);

    if (!refs || refs.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '12px';
      empty.style.color = '#777';
      empty.textContent = '(없음)';
      wrapper.appendChild(empty);
      return refs;
    }

    for (const url of refs) {
      const imgWrap = document.createElement('div');
      imgWrap.style.display = 'inline-flex';
      imgWrap.style.alignItems = 'center';
      imgWrap.style.gap = '6px';
      imgWrap.style.position = 'relative'; // 삭제 버튼 위치 잡기 위해
      imgWrap.style.marginRight = '8px'; // 버튼 공간 확보

      const img = document.createElement('img');
      img.src = url;
      img.alt = '참고 이미지';
      img.style.width = '64px';
      img.style.height = '36px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '6px';
      img.style.border = '1px solid #444';
      imgWrap.appendChild(img);

      // 삭제 버튼 (X)
      const removeBtn = document.createElement('button');
      removeBtn.innerHTML = '×';
      removeBtn.style.position = 'absolute';
      removeBtn.style.top = '-6px';
      removeBtn.style.right = 'calc(100% - 70px)'; // 이미지 오른쪽 상단에 위치
      removeBtn.style.width = '16px';
      removeBtn.style.height = '16px';
      removeBtn.style.background = '#ff4444';
      removeBtn.style.color = 'white';
      removeBtn.style.border = 'none';
      removeBtn.style.borderRadius = '50%';
      removeBtn.style.fontSize = '12px';
      removeBtn.style.lineHeight = '1';
      removeBtn.style.cursor = 'pointer';
      removeBtn.style.display = 'flex';
      removeBtn.style.alignItems = 'center';
      removeBtn.style.justifyContent = 'center';
      removeBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      removeBtn.style.zIndex = '10';
      removeBtn.title = '참고 이미지에서 제외';

      removeBtn.onclick = (e) => {
        e.stopPropagation(); // 부모 클릭 방지
        excludedRefImages.add(url);
        renderReferenceImages(); // 재렌더링
      };
      imgWrap.appendChild(removeBtn);

      // small url tooltip (removed as per request)
      /*
      const txt = document.createElement('div');
      txt.style.fontSize = '10px';
      txt.style.color = '#999';
      txt.style.maxWidth = '120px';
      txt.style.overflow = 'hidden';
      txt.style.textOverflow = 'ellipsis';
      txt.style.whiteSpace = 'nowrap';
      txt.textContent = url;
      imgWrap.appendChild(txt);
      */

      wrapper.appendChild(imgWrap);
    }
    return refs;
  };

  // render initial references
  renderReferenceImages();

  // [신규] 저장된 비율에 맞게 캔버스 크기 조정
  const savedRatio = thumbInfo.ratio || '16:9';
  const [w, h] = savedRatio.split(':').map(Number);
  if (w === 16 && h === 9) {
    canvas.width = 1280;
    canvas.height = 720;
  } else if (w === 1 && h === 1) {
    canvas.width = 1080;
    canvas.height = 1080;
  } else if (w === 9 && h === 16) {
    canvas.width = 720;
    canvas.height = 1280;
  } else if (w === 4 && h === 3) {
    canvas.width = 1024;
    canvas.height = 768;
  }

  // [실행 취소/다시 실행] 상태 히스토리 관리
  const history = {
    states: [],
    currentIndex: -1,
    maxHistory: 20, // 최대 20개 상태 저장
  };

  // [신규] 자동 저장 함수 (디바운스 적용)
  let saveTimeout;
  const triggerAutoSave = () => {
    if (!onSave) return; // onSave 콜백이 없으면 저장하지 않음

    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(async () => {
      let bgImageToSave = currentBgImage;

      // Base64 데이터인 경우 Firebase Storage에 업로드 시도
      if (bgImageToSave && bgImageToSave.startsWith('data:image')) {
        try {
          const timestamp = Date.now();
          const filename = `thumbnail-bg-${timestamp}.png`;

          const response = await sendRuntimeMessageWithTimeout({
            action: 'upload_thumbnail_to_storage',
            data: {
              dataUrl: bgImageToSave,
              filename: filename,
            },
          });

          if (response && response.success && response.url) {
            bgImageToSave = response.url;
            currentBgImage = response.url; // 현재 이미지도 업데이트
            console.log('[ThumbnailMaker] ✅ 자동 저장: 배경 이미지 Firebase Storage 업로드 완료');
          } else {
            console.warn(
              '[ThumbnailMaker] ⚠️ 자동 저장: Firebase Storage 업로드 실패, Base64 유지'
            );
          }
        } catch (error) {
          console.error('[ThumbnailMaker] 자동 저장: 배경 이미지 업로드 오류:', error);
        }
      }

      const currentInfo = {
        thumbnailPromptEn: thumbInfo.thumbnailPromptEn, // 프롬프트는 유지
        thumbnailPromptKo: thumbInfo.thumbnailPromptKo,
        // 스타일 정보 저장
        templateType: modal.querySelector('#tm-template-type')?.value || 'default',

        ratio: modal.querySelector('#tm-ratio')?.value || '16:9',
        // 배경 이미지 저장 (Firebase Storage URL 또는 Base64 fallback)
        bgImage: bgImageToSave,
        // [신규] 선택된 컨셉 인덱스 저장 (영구 저장)
        selectedThumbnailIndex: selectedConceptIndex,

      };

      // 로깅 시 Base64 숨기기
      const logInfo = { ...currentInfo };
      if (logInfo.bgImage && logInfo.bgImage.startsWith('data:image')) {
        logInfo.bgImage = `[Base64 Image: ${logInfo.bgImage.length} chars]`;
      } else if (logInfo.bgImage && logInfo.bgImage.length > 80) {
        logInfo.bgImage = logInfo.bgImage.substring(0, 80) + '...';
      }

      onSave(currentInfo);
      console.log('[ThumbnailMaker] 자동 저장 완료:', logInfo);
    }, 500); // 0.5초 뒤 저장
  };

  // 상태 저장 함수 (Undo/Redo용)
  const saveState = () => {
    // 복원 중이면 상태 저장하지 않음
    if (isRestoring) return;

    const state = {
      templateType: modal.querySelector('#tm-template-type')?.value || 'default',
      ratio: modal.querySelector('#tm-ratio')?.value || '16:9',
      bgImage: currentBgImage,

      timestamp: Date.now(),
    };

    // 현재 인덱스 이후의 상태 제거 (새로운 변경이 있으면 redo 불가)
    history.states = history.states.slice(0, history.currentIndex + 1);

    // 새 상태 추가
    history.states.push(state);
    history.currentIndex = history.states.length - 1;

    // 최대 개수 초과 시 오래된 상태 제거
    if (history.states.length > history.maxHistory) {
      history.states.shift();
      history.currentIndex--;
    }

    // Undo/Redo 버튼 상태 업데이트
    updateUndoRedoButtons();

    // 자동 저장도 트리거
    triggerAutoSave();
  };

  // 상태 복원 함수 (상태 저장 없이 복원만 수행)
  let isRestoring = false; // 복원 중 플래그
  const restoreState = (state) => {
    isRestoring = true; // 복원 중임을 표시

    // Note: slider event listeners are attached in the primary init block below.
    // Here we avoid adding duplicate listeners to prevent races; restoreState will
    // only set UI values (handled in the "Restore overlay opacity if present" block).
    // No action needed here.

    // Restore persisted ratio and background image
    modal.querySelector('#tm-ratio').value = state.ratio;



    currentBgImage = state.bgImage;

    // 비율 변경 시 캔버스 크기 조정
    const [w, h] = state.ratio.split(':').map(Number);
    if (w === 16 && h === 9) {
      canvas.width = 1280;
      canvas.height = 720;
    } else if (w === 1 && h === 1) {
      canvas.width = 1080;
      canvas.height = 1080;
    } else if (w === 9 && h === 16) {
      canvas.width = 720;
      canvas.height = 1280;
    } else if (w === 4 && h === 3) {
      canvas.width = 1024;
      canvas.height = 768;
    }

    updatePreview();
    updateUndoRedoButtons();

    isRestoring = false; // 복원 완료
  };

  // Undo/Redo 버튼 상태 업데이트
  const updateUndoRedoButtons = () => {
    const undoBtn = modal.querySelector('#tm-undo');
    const redoBtn = modal.querySelector('#tm-redo');
    if (undoBtn) {
      undoBtn.disabled = history.currentIndex <= 0;
      undoBtn.style.opacity = history.currentIndex <= 0 ? '0.5' : '1';
    }
    if (redoBtn) {
      redoBtn.disabled = history.currentIndex >= history.states.length - 1;
      redoBtn.style.opacity = history.currentIndex >= history.states.length - 1 ? '0.5' : '1';
    }
  };

  // 렌더링 함수 (thumbnailGenerator 엔진 활용)
  const updatePreview = async () => {
    const startTime = performance.now();

    // Template selection removed — always use default template
    const templateType = 'default';

    // 고정 폰트와 자동 색상 보정을 사용합니다 (사용자 선택 비활성화)
    const fontFamily = "'Pretendard', sans-serif";
    const textColorMode = 'auto';

    // [Offscreen 가속] 배경 이미지가 있으면 offscreen에서 리사이징
    let processedBgImage = currentBgImage;

    if (currentBgImage && currentBgImage.startsWith('data:image')) {
      try {
        // DataURL 유효성 검사
        if (currentBgImage.length < 100) {
          console.warn('[ThumbnailMaker] DataURL이 너무 짧습니다. 원본 사용.');
        } else {
          // Offscreen에서 이미지 리사이징 (캔버스 크기에 맞춤)
          const response = await sendRuntimeMessageWithTimeout({
            action: 'resize_image_in_offscreen',
            data: {
              imageDataUrl: currentBgImage,
              maxWidth: canvas.width,
              maxHeight: canvas.height,
              quality: 0.95,
            },
          });

          if (response && response.success && response.dataUrl) {
            processedBgImage = response.dataUrl;
            const elapsed = Math.round(performance.now() - startTime);
            console.log(`⚡ [ThumbnailMaker] 배경 이미지 리사이징 완료 (${elapsed}ms)`);
          } else {
            console.warn('[ThumbnailMaker] Offscreen 리사이징 실패, 원본 사용:', response?.error);
          }
        }
      } catch (error) {
        console.warn('[ThumbnailMaker] Offscreen 리사이징 실패, 원본 사용:', error.message);
        // 실패 시 원본 사용
      }
    }

    // 배경 설정
    const background = processedBgImage
      ? { type: 'image', value: processedBgImage }
      : { type: 'gradient', value: 'linear-gradient(135deg, #1e272e 0%, #485460 100%)' };

    // [Smart Templates] 템플릿 타입에 따라 스마트 템플릿 생성 또는 기본 템플릿 사용
    let templateData;

    if (templateType !== 'default') {
      // 스마트 템플릿 사용 (비교형, 질문형, 리스트형)
      templateData = createSmartTemplate(templateType, '', '', background, { fontFamily });
    } else {
      // 기본 템플릿 (서브타이틀 제거된 버전)
      // 항상 자동 색상 보정을 사용하여 가독성 최적화
      let textFill = '#ffffff';
      let autoAdjust = true;

      templateData = {
        name: 'Custom Thumbnail',
        background: background,
        layers: [],
      };
    }



    // thumbnailGenerator.js의 렌더러 호출
    await renderTemplateFromData(ctx, templateData);
  };

  // [비율별 텍스트 크기 계산 함수]
  const calculateFontRatio = (canvasWidth, canvasHeight, hasSubtitle) => {
    const aspectRatio = canvasWidth / canvasHeight;

    // 비율에 따라 기본 fontRatio 조정
    let baseRatio;
    if (aspectRatio > 1.5) {
      // 가로가 긴 경우 (16:9, 4:3 등)
      baseRatio = 0.12;
    } else if (aspectRatio < 0.7) {
      // 세로가 긴 경우 (9:16 등)
      baseRatio = 0.1;
    } else {
      // 정사각형 (1:1)
      baseRatio = 0.11;
    }

    // 서브타이틀이 있으면 메인 타이틀을 약간 작게
    if (hasSubtitle) {
      baseRatio *= 0.9;
    }

    return baseRatio;
  };

  // 4. 이벤트 리스너 연결

  // [신규] 탭 전환 UI 로직
  const toggleTabs = (mode) => {
    const aiPanel = modal.querySelector('#tm-bg-ai-panel');
    const uploadPanel = modal.querySelector('#tm-bg-upload-panel');
    const aiTab = modal.querySelector('#tm-bg-mode-ai');
    const uploadTab = modal.querySelector('#tm-bg-mode-upload');

    if (mode === 'ai') {
      aiPanel.style.display = 'block';
      uploadPanel.style.display = 'none';
      aiTab.style.background = '#444';
      aiTab.style.color = '#fff';
      aiTab.style.border = 'none';
      uploadTab.style.background = 'transparent';
      uploadTab.style.color = '#888';
      uploadTab.style.border = '1px solid #444';
    } else {
      aiPanel.style.display = 'none';
      uploadPanel.style.display = 'block';
      uploadTab.style.background = '#444';
      uploadTab.style.color = '#fff';
      uploadTab.style.border = 'none';
      aiTab.style.background = 'transparent';
      aiTab.style.color = '#888';
      aiTab.style.border = '1px solid #444';
    }
  };

  const bgModeAi = modal.querySelector('#tm-bg-mode-ai');
  if (bgModeAi) bgModeAi.onclick = () => toggleTabs('ai');

  const bgModeUpload = modal.querySelector('#tm-bg-mode-upload');
  if (bgModeUpload) bgModeUpload.onclick = () => toggleTabs('upload');

  // [신규] 컨셉 선택 버튼 이벤트 리스너
  if (thumbnailCandidates.length > 1) {
    const conceptButtons = modal.querySelectorAll('.tm-concept-btn');
    conceptButtons.forEach((btn, idx) => {
      btn.addEventListener('click', () => {
        // 선택된 컨셉으로 전환
        selectedConceptIndex = idx;
        const selectedConcept = thumbnailCandidates[idx];

        // UI 업데이트: 버튼 스타일
        conceptButtons.forEach((b, i) => {
          const isSelected = i === idx;
          b.style.background = isSelected ? 'linear-gradient(135deg, #6c5ce7, #a29bfe)' : '#1e1e1e';
          b.style.color = isSelected ? '#fff' : '#ccc';
          b.style.border = `1px solid ${isSelected ? '#6c5ce7' : '#444'}`;
          b.style.fontWeight = isSelected ? '600' : '400';
          // 체크마크 업데이트
          const label = b.textContent.replace(/\s✓$/, '');
          b.textContent = label + (isSelected ? ' ✓' : '');
        });

        // 입력 필드 업데이트


        // 프롬프트 정보 업데이트 (ID로 정확히 찾기)
        const promptDisplay = modal.querySelector('#tm-prompt-display');
        if (promptDisplay) {
          const newPromptKo = selectedConcept.thumbnailPromptKo || '자동 설정됨';
          const newPromptEn = selectedConcept.thumbnailPromptEn || '';
          // 한글과 영문 프롬프트 모두 표시
          promptDisplay.innerHTML = `
            <div style="margin-bottom:4px;">${newPromptKo}</div>
            <div style="font-size:10px;color:#888;opacity:0.8;word-break:break-word;">${newPromptEn}</div>
          `;
          promptDisplay.title = newPromptEn; // 전체 영문 프롬프트를 툴팁으로도 제공
          Logger.debug('[ThumbnailMaker] 프롬프트 업데이트:', {
            ko: newPromptKo.substring(0, 50) + '...',
            en: newPromptEn.substring(0, 50) + '...',
          });
        } else {
          Logger.warn('[ThumbnailMaker] 프롬프트 표시 영역을 찾을 수 없습니다.');
        }

        // thumbInfo 업데이트 (현재 선택된 컨셉으로, 기존 스타일 정보는 유지)
        const oldStyle = {
          fontFamily: thumbInfo.fontFamily,
          textColor: thumbInfo.textColor,
          ratio: thumbInfo.ratio,
          bgImage: thumbInfo.bgImage,
          templateType: thumbInfo.templateType,
        };
        thumbInfo = { ...selectedConcept, ...oldStyle };

        Logger.debug('[ThumbnailMaker] 컨셉 변경:', {
          index: idx,
          type: selectedConcept.type,
          text: selectedConcept.thumbnailText,
        });

        // 프리뷰 업데이트 (updatePreview 함수가 정의된 후 호출)
        // updatePreview는 나중에 정의되므로, 약간의 지연 후 호출
        setTimeout(() => {
          if (typeof updatePreview === 'function') {
            updatePreview();
          }
        }, 100);

        // 자동 저장 트리거 (선택된 컨셉 인덱스도 함께 저장)
        triggerAutoSave();
      });
    });

    Logger.debug('[ThumbnailMaker] 컨셉 선택 버튼 이벤트 리스너 연결 완료:', {
      buttonCount: conceptButtons.length,
      candidates: thumbnailCandidates.length,
    });
  }

  // [신규] '메타로 프롬프트 생성' 버튼 처리
  const genFromMetaBtn = modal.querySelector('#tm-gen-from-meta');
  if (genFromMetaBtn)
    genFromMetaBtn.onclick = () => {
      // regenerate candidates from current draft meta/description
      thumbnailCandidates = createMetaBasedCandidates();
      selectedConceptIndex = 0;
      thumbInfo = thumbnailCandidates[0];

      // remove existing concept selector block if present
      const existingBtn = modal.querySelector('.tm-concept-btn');
      if (existingBtn) {
        const outer = existingBtn.parentElement && existingBtn.parentElement.parentElement;
        if (outer) outer.remove();
      }

      // build new concept selector HTML and insert
      const typeLabels = { curiosity: '🔥 호기심 자극형', informative: '📊 정보 요약형', emotional: '💝 감성/공감형' };
      const newHtml =
        thumbnailCandidates.length > 1
          ? `
      <div style="margin-bottom:16px;padding:12px;background:#2d2d2d;border-radius:8px;border:1px solid #444;">
        <label style="display:block;font-size:12px;color:#aaa;margin-bottom:8px;font-weight:600;">🎨 썸네일 컨셉 선택 (A/B 테스팅)</label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;">
          ${thumbnailCandidates
            .map((candidate, idx) => {
              const isSelected = idx === selectedConceptIndex;
              const label = typeLabels[candidate.type] || `컨셉 ${idx + 1}`;
              return `
            <button class="tm-concept-btn" data-index="${idx}" style="
              flex:1;min-width:120px;padding:10px 12px;
              background:${isSelected ? 'linear-gradient(135deg, #6c5ce7, #a29bfe)' : '#1e1e1e'};
              color:${isSelected ? '#fff' : '#ccc'};
              border:1px solid ${isSelected ? '#6c5ce7' : '#444'};
              border-radius:6px;
              cursor:pointer;
              font-size:12px;
              font-weight:${isSelected ? '600' : '400'};
              transition:all 0.2s;
              text-align:center;
            ">
              ${label}${isSelected ? ' ✓' : ''}
            </button>
          `;
            })
            .join('')}
        </div>
        <div style="margin-top:8px;padding:8px;background:#1e1e1e;border-radius:4px;font-size:11px;color:#888;line-height:1.5;">
          <strong style="color:#aaa;">선택된 컨셉:</strong> ${thumbInfo.thumbnailText || '없음'}<br>
          <span style="font-size:10px;opacity:0.8;">각 컨셉을 클릭하여 프롬프트와 문구를 변경할 수 있습니다.</span>
        </div>
      </div>
    `
          : '';

      const promptDisplayEl = modal.querySelector('#tm-prompt-display');
      if (promptDisplayEl) {
        promptDisplayEl.insertAdjacentHTML('beforebegin', newHtml);
      } else {
        const canvasWrapper = modal.querySelector('#tm-canvas-wrapper');
        canvasWrapper.insertAdjacentHTML('afterend', newHtml);
      }

      // attach listeners to new buttons (same as initial setup)
      const conceptButtons = modal.querySelectorAll('.tm-concept-btn');
      conceptButtons.forEach((btn, idx) => {
        btn.addEventListener('click', () => {
          selectedConceptIndex = idx;
          const selectedConcept = thumbnailCandidates[idx];

          conceptButtons.forEach((b, i) => {
            const isSelected = i === idx;
            b.style.background = isSelected ? 'linear-gradient(135deg, #6c5ce7, #a29bfe)' : '#1e1e1e';
            b.style.color = isSelected ? '#fff' : '#ccc';
            b.style.border = `1px solid ${isSelected ? '#6c5ce7' : '#444'}`;
            b.style.fontWeight = isSelected ? '600' : '400';
            const label = b.textContent.replace(/\s✓$/, '');
            b.textContent = label + (isSelected ? ' ✓' : '');
          });



          const promptDisplay = modal.querySelector('#tm-prompt-display');
          if (promptDisplay) {
            const newPromptKo = selectedConcept.thumbnailPromptKo || '자동 설정됨';
            const newPromptEn = selectedConcept.thumbnailPromptEn || '';
            promptDisplay.innerHTML = `\n            <div style="margin-bottom:4px;">${newPromptKo}</div>\n            <div style="font-size:10px;color:#888;opacity:0.8;word-break:break-word;">${newPromptEn}</div>\n          `;
            promptDisplay.title = newPromptEn;
          }

          const oldStyle = {
            ratio: thumbInfo.ratio,
            bgImage: thumbInfo.bgImage,
            templateType: thumbInfo.templateType,
          };
          thumbInfo = { ...selectedConcept, ...oldStyle };

          setTimeout(() => {
            if (typeof updatePreview === 'function') {
              updatePreview();
            }
          }, 100);

          triggerAutoSave();
        });
      });

      // update prompt display to new first candidate
      const promptDisplay = modal.querySelector('#tm-prompt-display');
      if (promptDisplay) {
        const newPromptKo = thumbInfo.thumbnailPromptKo || '자동 설정됨';
        const newPromptEn = thumbInfo.thumbnailPromptEn || '';
        promptDisplay.innerHTML = `\n            <div style="margin-bottom:4px;">${newPromptKo}</div>\n            <div style="font-size:10px;color:#888;opacity:0.8;word-break:break-word;">${newPromptEn}</div>\n          `;
        promptDisplay.title = newPromptEn;
      }

      setTimeout(() => {
        if (typeof updatePreview === 'function') updatePreview();
      }, 100);

      triggerAutoSave();
    };

  // File upload UI and handlers removed: uploading background images via file input is deprecated.
  // Previously, upload button and file input change handlers uploaded images to Firebase Storage and applied them as background.


  // [핵심] 배경 생성 버튼 클릭 (스타일 반영)
  const genBgBtn = modal.querySelector('#tm-gen-bg');
  if (genBgBtn)
    genBgBtn.onclick = async () => {
      const btn = modal.querySelector('#tm-gen-bg');
      const loading = modal.querySelector('#tm-loading');
      if (!btn || !loading) return;

      // UI 로딩 상태 전환
      btn.disabled = true;
      btn.style.opacity = '0.7';
      btn.textContent = '⏳ 생성 중...';
      loading.style.display = 'flex';

      // 캔버스 살짝 어둡게 처리
      ctx.fillStyle = 'rgba(0,0,0,0.7)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      try {
        // Background style selection removed — use a fixed, text-friendly prompt suffix
        const promptSuffix = 'text-friendly background, minimal distractions';

        // 메인 타이틀 제거: 프롬프트에 타이틀 텍스트는 포함하지 않습니다.
        const textPrompt = '';


        // 기본 프롬프트 + 스타일 프롬프트 (explicitly remove high-quality text rendering to avoid textual overlays)
        const enhancedPrompt = `${thumbInfo.thumbnailPromptEn}${textPrompt}, ${promptSuffix}, 16:9 aspect ratio`;

        // background.js에 이미지 생성 요청 (참조 이미지도 함께 전달)
        // Decode HTML entities and ensure URLs are clean before sending to background
        const refImagesToSend = (
          currentRefImages && Array.isArray(currentRefImages) ? currentRefImages : []
        ).map((u) => {
          try {
            // Replace common HTML-escaped entities and trim
            // [FIX] Do NOT decodeURIComponent the entire URL as it breaks query parameters (e.g. %26 -> &)
            let s = String(u).replace(/&amp;/g, '&').trim();
            return s;
          } catch (e) {
            return u;
          }
        });
        // Debug: show decoded refs
        console.log(
          '%c[AI 썸네일 메이커 디버깅][UI-Request - decoded refs]',
          'color:#9E9E9E',
          refImagesToSend
        );

        // [DEBUG HOOK] For testing: accept test URL from multiple places (localStorage, DOM attribute, window variables)
        try {
          let testUrl = '';

          // 0. Check localStorage (Persists across refreshes - Best for repetitive testing)
          if (!testUrl) {
            try {
              testUrl = localStorage.getItem('FORCE_TEST_REF_URL') || '';
            } catch (e) {}
          }

          // 1. Check DOM attribute (works across isolated worlds - best for one-off DevTools injection)
          if (!testUrl && document && document.body) {
            testUrl = document.body.getAttribute('data-force-test-ref-url') || '';
          }

          // 2. Check window variables (only works if set in content script context)
          if (!testUrl) {
            try {
              testUrl =
                (window && (window.__FORCE_TEST_REF_URL__ || window.FORCE_TEST_REF_URL)) || '';
            } catch (e) {
              testUrl = '';
            }
          }

          // check parent/top frames if same-origin
          if (!testUrl) {
            try {
              if (window.parent && window.parent !== window)
                testUrl =
                  window.parent.localStorage.getItem('FORCE_TEST_REF_URL') ||
                  window.parent.__FORCE_TEST_REF_URL__ ||
                  window.parent.FORCE_TEST_REF_URL ||
                  '';
            } catch (e) {}
          }
          if (!testUrl) {
            try {
              if (window.top && window.top !== window)
                testUrl =
                  window.top.localStorage.getItem('FORCE_TEST_REF_URL') ||
                  window.top.__FORCE_TEST_REF_URL__ ||
                  window.top.FORCE_TEST_REF_URL ||
                  '';
            } catch (e) {}
          }

          testUrl = String(testUrl || '').trim();

          if (testUrl) {
            if (!refImagesToSend.includes(testUrl)) {
              refImagesToSend.push(testUrl);
              // indicate source when possible
              let source = 'unknown';
              if (localStorage.getItem('FORCE_TEST_REF_URL')) source = 'localStorage';
              else if (document.body.getAttribute('data-force-test-ref-url'))
                source = 'DOM-attribute';
              else if (window.__FORCE_TEST_REF_URL__) source = 'window-var';

              console.log(
                '%c[AI 썸네일 메이커 디버깅][UI-Request - injected test ref]',
                'color:#FF9800',
                testUrl,
                'source:',
                source
              );
            } else {
              console.log(
                '%c[AI 썸네일 메이커 디버깅][UI-Request - test ref already present]',
                'color:#FF9800',
                testUrl
              );
            }
          }
        } catch (e) {
          /* ignore */
        }

        // [DEBUG] AI 이미지 생성 요청 전송 전 데이터 확인
        console.log('%c[AI 썸네일 메이커 디버깅][UI-Request]', 'color:#9E9E9E', {
          prompt: enhancedPrompt,
          references: refImagesToSend,
          refCount: refImagesToSend.length,
        });

        // Try with extended timeout (60s) and perform a single automatic retry on timeout
        let response = await sendRuntimeMessageWithTimeout(
          {
            action: 'ai_generate_images',
            data: {
              prompt: enhancedPrompt,
              count: 1,
              aspect: '16:9',
              references: refImagesToSend,
            },
          },
          60000
        );

        if (response && response.error === 'timeout') {
          // Inform user and retry once
          showToast('이미지 생성이 지연되어 재시도합니다...');
          response = await sendRuntimeMessageWithTimeout(
            {
              action: 'ai_generate_images',
              data: {
                prompt: enhancedPrompt,
                count: 1,
                aspect: '16:9',
                references: refImagesToSend,
              },
            },
            60000
          );
        }

        // 응답 진단 정보가 있으면 UI에 표시
        try {
          if (response && response.diagnostics) {
            console.log(
              '%c[AI 썸네일 메이커 디버깅][ai_generate_images response diagnostics]',
              'color:#9E9E9E',
              response.diagnostics
            );

            // diagnostics element 생성/갱신
            let diagEl = modal.querySelector('#tm-diagnostics');
            if (!diagEl) {
              diagEl = document.createElement('div');
              diagEl.id = 'tm-diagnostics';
              diagEl.style.fontSize = '12px';
              diagEl.style.color = '#bbb';
              diagEl.style.marginTop = '8px';
              diagEl.style.background = 'rgba(158,158,158,0.06)';
              diagEl.style.padding = '8px';
              diagEl.style.borderRadius = '6px';
              diagEl.style.border = '1px solid rgba(158,158,158,0.08)';
              const refWrapper = modal.querySelector('#tm-ref-images-wrapper');
              if (refWrapper) refWrapper.insertAdjacentElement('afterend', diagEl);
            }

            const converted = response.diagnostics.converted || 0;
            const inputCount =
              response.diagnostics.inputCount || (refImagesToSend ? refImagesToSend.length : 0);
            const failed = response.diagnostics.failed || [];

            // show counts and, when failures exist, list the failed URLs (up to 5)
            diagEl.innerHTML = `참조 이미지 변환: ${converted}/${inputCount} (실패: ${failed.length || 0})`;

            if (Array.isArray(failed) && failed.length > 0) {
              const list = document.createElement('ul');
              list.style.margin = '6px 0 0 12px';
              list.style.padding = '0';
              list.style.fontSize = '12px';
              list.style.color = '#f66';
              failed.slice(0, 5).forEach((f) => {
                const li = document.createElement('li');
                li.style.listStyle = 'disc';
                li.textContent = (f.url ? f.url : String(f)) + (f.error ? ` (${f.error})` : '');
                list.appendChild(li);
              });
              diagEl.appendChild(list);
            }

            // 툴팁에 샘플 미리보기 추가
            const sample = response.diagnostics.convertedSample || [];
            // remove existing preview if any
            const existingPreview = diagEl.querySelector('.tm-diagnostics-preview');
            if (existingPreview) existingPreview.remove();

            if (sample.length > 0) {
              diagEl.title = sample
                .map((s, i) => `${i + 1}. ${s.url} (${s.mimeType}, ${s.dataKb}KB)`)
                .join('\n');

              // If server provided a full data URL for preview, render it
              const first = sample[0];
              if (first && first.dataFullUrl) {
                const previewWrap = document.createElement('div');
                previewWrap.className = 'tm-diagnostics-preview';
                previewWrap.style.marginTop = '8px';
                previewWrap.style.display = 'flex';
                previewWrap.style.alignItems = 'center';
                previewWrap.style.gap = '8px';

                const img = document.createElement('img');
                img.src = first.dataFullUrl;
                img.alt = 'Converted reference preview';
                img.style.maxWidth = '160px';
                img.style.maxHeight = '90px';
                img.style.objectFit = 'cover';
                img.style.borderRadius = '6px';
                img.style.border = '1px solid rgba(255,255,255,0.06)';
                previewWrap.appendChild(img);

                const actions = document.createElement('div');
                actions.style.display = 'flex';
                actions.style.flexDirection = 'column';
                actions.style.gap = '6px';

                const dl = document.createElement('a');
                dl.href = first.dataFullUrl;
                dl.download = 'ref-preview.png';
                dl.textContent = 'Download preview';
                dl.style.fontSize = '12px';
                dl.style.color = '#9E9E9E';
                dl.style.textDecoration = 'underline';
                actions.appendChild(dl);

                const openBtn = document.createElement('button');
                openBtn.textContent = 'Open in new tab';
                openBtn.style.fontSize = '12px';
                openBtn.style.cursor = 'pointer';
                openBtn.onclick = () => window.open(first.dataFullUrl);
                actions.appendChild(openBtn);

                previewWrap.appendChild(actions);
                diagEl.appendChild(previewWrap);
              }
            }

            // 간단 토스트로도 알림
            showToast(
              `참조 변환: ${converted}/${inputCount} (실패: ${Array.isArray(failed) ? failed.length : 0})`
            );
          }
        } catch (e) {
          console.warn('[ThumbnailMaker] diagnostics display failed:', e);
        }

        if (
          response &&
          response.success &&
          Array.isArray(response.images) &&
          response.images.length > 0
        ) {
          // AI 생성 이미지는 이미 Firebase Storage URL로 반환됨
          currentBgImage = response.images[0];
          console.log(
            '[ThumbnailMaker] ✅ AI 생성 배경 이미지:',
            currentBgImage.substring(0, 80) + '...'
          );
          await updatePreview(); // 다시 렌더링
          saveState(); // 배경 생성 후 상태 저장
        } else {
          if (response && response.diagnostics) {
            // diagnostics already displayed above; just restore preview
            await updatePreview();
          } else {
            try {
              alert('이미지 생성에 실패했습니다: ' + (response?.error || '알 수 없는 오류'));
            } catch (e) {
              // ignore alert errors in non-browser or test environments
              Logger.warn(
                '[ThumbnailMaker] alert failed or not available:',
                e && e.message ? e.message : e
              );
            }
            await updatePreview(); // 실패 시 원복
          }
        }
      } catch (e) {
        console.error('배경 생성 오류:', e);
        alert('오류가 발생했습니다.');
        await updatePreview();
      } finally {
        // UI 복원
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.textContent = '🎨 배경 생성';
        loading.style.display = 'none';
      }
    };

  // [신규] Undo/Redo 이벤트 리스너
  const undoBtn = modal.querySelector('#tm-undo');
  if (undoBtn)
    undoBtn.addEventListener('click', () => {
      if (history.currentIndex > 0) {
        history.currentIndex--;
        restoreState(history.states[history.currentIndex]);
      }
    });

  const redoBtn = modal.querySelector('#tm-redo');
  if (redoBtn)
    redoBtn.addEventListener('click', () => {
      if (history.currentIndex < history.states.length - 1) {
        history.currentIndex++;
        restoreState(history.states[history.currentIndex]);
      }
    });

  // [신규] 키보드 단축키 (Ctrl+Z, Ctrl+Y)
  modal.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        const undoBtn = modal.querySelector('#tm-undo');
        if (undoBtn) undoBtn.click();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        const redoBtn = modal.querySelector('#tm-redo');
        if (redoBtn) redoBtn.click();
      }
    }
  });

  // [신규] 텍스트 표시 토글 이벤트


  // 텍스트 실시간 반영 (입력할 때마다 렌더링) - 상태 저장 포함






  // [신규] 타이포그래피 컨트롤 이벤트 리스너 - 상태 저장 포함


  // [신규] 비율 변경 이벤트 - 상태 저장 포함
  const ratioSelect = modal.querySelector('#tm-ratio');
  if (ratioSelect)
    ratioSelect.addEventListener('change', (e) => {
      const [w, h] = e.target.value.split(':').map(Number);
      // 기준 높이 720px에 맞춰 너비 계산 (또는 고정 해상도 사용)
      if (w === 16 && h === 9) {
        canvas.width = 1280;
        canvas.height = 720;
      } else if (w === 1 && h === 1) {
        canvas.width = 1080;
        canvas.height = 1080;
      } else if (w === 9 && h === 16) {
        canvas.width = 720;
        canvas.height = 1280;
      } else if (w === 4 && h === 3) {
        canvas.width = 1024;
        canvas.height = 768;
      }

      updatePreview(); // 크기 변경 후 다시 그리기
      saveState();
    });

  // Drag & drop upload handlers removed — image uploads via drag/drop are disabled to simplify the UI and avoid background uploads.
  const wrapper = modal.querySelector('#tm-canvas-wrapper');

  // 본문 삽입 버튼
  const insertBtn = modal.querySelector('#tm-insert');
  if (insertBtn)
    insertBtn.onclick = async () => {
      const btn = modal.querySelector('#tm-insert');
      if (!btn) return;
      const originalText = btn.textContent;

      // 로딩 상태
      btn.disabled = true;
      btn.textContent = '⏳ 업로드 중...';

      try {
        // [Offscreen 가속] 최종 이미지 생성도 offscreen에서 처리 (선택적)
        // 현재는 메인 스레드에서 처리하되, 향후 offscreen으로 이관 가능
        const startTime = performance.now();
        const dataUrl = canvas.toDataURL('image/png');
        const elapsed = Math.round(performance.now() - startTime);
        console.log(`⚡ [ThumbnailMaker] 최종 이미지 생성 완료 (${elapsed}ms)`);

        // [SEO 핵심] 대표 텍스트로 thumbInfo.thumbnailText 또는 기본값 사용
        const altText = thumbInfo.thumbnailText || '썸네일 이미지';

        // 1. 제목 가져오기 (파일명 생성용) - thumbInfo.thumbnailText 또는 기본값 사용
        const rawTitle = thumbInfo.thumbnailText || 'thumbnail';

        // 2. [SEO] 안전한 파일명으로 변환 (한글/영어/숫자 외 제거, 공백 -> 하이픈)
        // 예: "집 전체를 손끝으로!" -> "집-전체를-손끝으로-170..."
        const safeTitle = rawTitle
          .trim()
          .replace(/[^a-zA-Z0-9가-힣\s-]/g, '') // 특수문자 제거
          .replace(/\s+/g, '-'); // 공백을 하이픈으로

        const seoFilename = `${safeTitle}-${Date.now()}.png`; // 중복 방지를 위해 시간 추가

        // 3. Firebase Storage에 업로드 (수정된 파일명 사용)
        const response = await sendRuntimeMessageWithTimeout({
          action: 'upload_thumbnail_to_storage',
          data: {
            dataUrl: dataUrl,
            filename: seoFilename, // [변경] 의미 있는 파일명 전달
          },
        });

        if (response && response.success && response.url) {
          // [수정] url과 함께 altText 전달
          if (onInsert) onInsert(response.url, altText);
          modal.remove();
        } else {
          // [수정] Base64 Fallback 시에도 altText 전달
          console.warn('[ThumbnailMaker] Firebase Storage 업로드 실패, Base64로 fallback');
          if (onInsert) onInsert(dataUrl, altText);
          modal.remove();
        }
      } catch (e) {
        console.error('[ThumbnailMaker] 업로드 오류:', e);
        // [수정] 에러 발생 시에도 altText 전달
        const dataUrl = canvas.toDataURL('image/png');
        const altText = thumbInfo.thumbnailText || '썸네일 이미지';
        if (onInsert) onInsert(dataUrl, altText);
        modal.remove();
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    };

  // 정밀 편집 (TUI) 버튼 - 실제 기능 구현
  const editTuiBtn = modal.querySelector('#tm-edit-tui');
  if (editTuiBtn)
    editTuiBtn.onclick = () => {
      try {
        const dataUrl = canvas.toDataURL('image/png');
        console.log('[ThumbnailMaker] 정밀 편집 버튼 클릭, 이미지 데이터 준비');

        // [수정] 에디터 iframe을 거치지 않고, 바로 메인 윈도우(Parent)로 메시지 전송
        // 이렇게 하면 에디터 로딩 여부와 상관없이 항상 TUI 에디터를 열 수 있습니다.
        window.postMessage(
          {
            action: 'cp_open_tui_editor',
            currentImageUrl: dataUrl, // 호환성을 위해 유지
            imageUrl: dataUrl, // tui-editor.js가 찾는 필드명
            source: 'thumbnail_maker',
            // TUI 에디터 사이드바에 표시할 단일 이미지 목록 구성
            allDocumentImages: [{ url: dataUrl, range: null }],
          },
          '*'
        );

        // 썸네일 모달 닫기
        modal.remove();
        console.log('[ThumbnailMaker] TUI 에디터 요청 전송 및 모달 닫기 완료');
      } catch (error) {
        console.error('[ThumbnailMaker] 정밀 편집 오류:', error);
        alert('❌ 정밀 편집 중 오류가 발생했습니다: ' + (error.message || '알 수 없는 오류'));
      }
    };

  // 내가 만든 이미지 보기 버튼
  const myImagesBtn = modal.querySelector('#tm-my-images');
  if (myImagesBtn)
    myImagesBtn.onclick = async () => {
      const originalText = myImagesBtn.textContent;
      myImagesBtn.disabled = true;
      myImagesBtn.textContent = '⏳ 불러오는 중...';
      try {
        chrome.runtime.sendMessage({ action: 'get_uploaded_images_log' }, (res) => {
          myImagesBtn.disabled = false;
          myImagesBtn.textContent = originalText;
          if (!res || !res.success || !Array.isArray(res.images) || res.images.length === 0) {
            showToast('저장된 이미지가 없습니다.', 'warning');
            return;
          }

          // 모달 생성
          const gm = document.createElement('div');
          gm.id = 'tm-my-images-modal';
          gm.style.cssText =
            'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:2147483648;padding:20px;';
          gm.innerHTML = `
            <div style="max-width:900px;width:100%;max-height:90vh;background:#fff;border-radius:12px;padding:16px;overflow:auto;box-sizing:border-box;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">
                <h4 style="margin:0;font-size:16px;color:#222;">🖼️ 내가 만든 이미지</h4>
                <button id="tm-my-images-close" style="border:none;background:none;font-size:20px;cursor:pointer;">&times;</button>
              </div>
              <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:12px;">${res.images
                .map(
                  (it) => `
                  <div class="tm-my-img-item" data-id="${it.id}" data-url="${it.downloadURL}" data-path="${(it.originData && it.originData.storagePath) || it.storagePath || ''}" data-published="${it.published === true || (it.originData && it.originData.published === true) || (it.publishInfo && it.publishInfo.publishedUrl) ? 'true' : 'false'}" style="position:relative;cursor:pointer;border:1px solid #eee;border-radius:8px;overflow:hidden;aspect-ratio:16/9;background:#f5f5f5;display:flex;align-items:center;justify-content:center;">
                    ${it.published === true || (it.originData && it.originData.published === true) || (it.publishInfo && it.publishInfo.publishedUrl) ? `<div class="tm-published-badge" title="발행됨" style="position:absolute;top:8px;right:8px;padding:4px 8px;border-radius:12px;background:#28a745;color:#fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.2);">발행</div>` : ''}
                    <input type="checkbox" class="tm-my-img-checkbox" data-id="${it.id}" data-path="${(it.originData && it.originData.storagePath) || it.storagePath || ''}" data-published="${it.published === true || (it.originData && it.originData.published === true) || (it.publishInfo && it.publishInfo.publishedUrl) ? 'true' : 'false'}" ${it.published === true || (it.originData && it.originData.published === true) || (it.publishInfo && it.publishInfo.publishedUrl) ? 'disabled title="발행된 이미지는 선택 및 삭제할 수 없습니다."' : ''} style="position:absolute; top:8px; left:8px; z-index:20; width:18px; height:18px; background:rgba(255,255,255,0.9);">
                    <button class="tm-my-img-delete-btn" data-id="${it.id}" data-path="${(it.originData && it.originData.storagePath) || it.storagePath || ''}" data-published="${it.published === true || (it.originData && it.originData.published === true) || (it.publishInfo && it.publishInfo.publishedUrl) ? 'true' : 'false'}" ${it.published === true || (it.originData && it.originData.published === true) || (it.publishInfo && it.publishInfo.publishedUrl) ? 'disabled title="발행된 이미지는 삭제할 수 없습니다." style="position:absolute; top:8px; right:8px; z-index:20; width:26px; height:26px; border-radius:50%; border:none; background:rgba(255,255,255,0.95); color:#aaa; display:flex; align-items:center; justify-content:center; font-weight:bold; cursor:not-allowed;"' : 'title="삭제" style="position:absolute; top:8px; right:8px; z-index:20; width:26px; height:26px; border-radius:50%; border:none; background:rgba(255,255,255,0.95); color:#ea4335; display:flex; align-items:center; justify-content:center; font-weight:bold; cursor:pointer;"'}>×</button>
                    <img src="${it.downloadURL}" style="width:100%;height:100%;object-fit:cover;display:block;">
                  </div>
                `
                )
                .join('')}
              </div>
              <div style="margin-top:12px; display:flex; justify-content:flex-end; gap:8px;">
                <button id="tm-my-images-delete" disabled style="padding:8px 12px; border-radius:6px; border:1px solid #ea4335; background:#fff; color:#ea4335; cursor:pointer; font-weight:600;">🗑️ 선택 삭제</button>
              </div>
            </div>
          `;

          // 닫기 핸들러
          gm.querySelector('#tm-my-images-close').onclick = () => gm.remove();

          // 이미지 클릭 핸들러 (위임) 및 체크박스 토글 처리
          const deleteBtn = gm.querySelector('#tm-my-images-delete');
          gm.addEventListener('click', (e) => {
            // 체크박스를 직접 클릭한 경우: 선택 토글
            if (
              e.target &&
              e.target.classList &&
              e.target.classList.contains('tm-my-img-checkbox')
            ) {
              const selected = Array.from(gm.querySelectorAll('.tm-my-img-checkbox')).filter(
                (cb) => cb.checked
              );
              if (deleteBtn) deleteBtn.disabled = selected.length === 0;
              e.stopPropagation();
              return;
            }

            // 개별 삭제 버튼 클릭 (위임) 처리
            if (
              e.target &&
              e.target.classList &&
              e.target.classList.contains('tm-my-img-delete-btn')
            ) {
              e.stopPropagation();
              const id = e.target.dataset.id;
              const path = e.target.dataset.path;
              if (!id) return;
              if (!confirm('이 이미지를 삭제하시겠습니까? (복구 불가)')) return;

              const el = gm.querySelector(`.tm-my-img-item[data-id="${id}"]`);
              if (el && el.dataset && el.dataset.published === 'true') {
                if (el) el.style.opacity = '1';
                showToast('발행된 이미지는 삭제할 수 없습니다.', 'warning');
                return;
              }

              if (el) el.style.opacity = '0.5';

              chrome.runtime.sendMessage(
                { action: 'delete_storage_image', data: { id, storagePath: path } },
                (res) => {
                  if (res && res.success) {
                    if (el) el.remove();
                    showToast('✅ 이미지가 삭제되었습니다.');
                  } else {
                    if (el) el.style.opacity = '1';
                    showToast('삭제 실패: ' + (res?.error || '알 수 없는 오류'), 'error');
                  }
                }
              );

              return;
            }

            const item = e.target && e.target.closest ? e.target.closest('.tm-my-img-item') : null;
            if (!item) return;
            const url = item.dataset.url;
            if (!url) return;
            currentBgImage = url; // 배경으로 설정
            updatePreview();
            saveState();
            showToast('✅ 선택한 이미지가 배경으로 적용되었습니다.');
            gm.remove();
          });

          // 삭제 버튼 핸들러
          if (deleteBtn) {
            deleteBtn.onclick = () => {
              const selected = Array.from(gm.querySelectorAll('.tm-my-img-checkbox'))
                .filter((cb) => cb.checked)
                .map((cb) => ({ id: cb.dataset.id, storagePath: cb.dataset.path }));
              if (selected.length === 0) return;
              if (!confirm(`선택한 ${selected.length}개의 이미지를 삭제하시겠습니까? (복구 불가)`))
                return;

              // 낙관적 UI 업데이트
              selected.forEach((s) => {
                const el = gm.querySelector(`.tm-my-img-item[data-id="${s.id}"]`);
                if (el) el.style.opacity = '0.5';
              });

              chrome.runtime.sendMessage(
                { action: 'delete_storage_images', data: { items: selected } },
                (res) => {
                  if (res && res.success) {
                    selected.forEach((s) => {
                      const el = gm.querySelector(`.tm-my-img-item[data-id="${s.id}"]`);
                      if (el) el.remove();
                    });
                    showToast(`✅ ${selected.length}개의 이미지가 삭제되었습니다.`);
                    if (deleteBtn) deleteBtn.disabled = true;
                  } else {
                    // rollback visual
                    selected.forEach((s) => {
                      const el = gm.querySelector(`.tm-my-img-item[data-id="${s.id}"]`);
                      if (el) el.style.opacity = '1';
                    });
                    showToast('삭제 실패: ' + (res?.error || '알 수 없는 오류'), 'error');
                  }
                }
              );
            };
          }

          // append to container (shadow-aware)
          const appendTarget = container && container.appendChild ? container : document.body;
          appendTarget.appendChild(gm);
        });
      } catch (err) {
        console.error('[ThumbnailMaker] get_uploaded_images_log 오류:', err);
        myImagesBtn.disabled = false;
        myImagesBtn.textContent = originalText;
        showToast('저장된 이미지 조회 중 오류가 발생했습니다.', 'error');
      }
    };

  // 닫기 버튼
  const closeBtn = modal.querySelector('#tm-close');
  if (closeBtn) closeBtn.onclick = () => modal.remove();



  // 초기 1회 렌더링 (기본 배경 + 텍스트)
  updatePreview();

  // 초기 상태 저장
  saveState();
}

// Global listener: handle background notifications for delete results and ACKs
if (
  typeof chrome !== 'undefined' &&
  chrome.runtime &&
  chrome.runtime.onMessage &&
  typeof document !== 'undefined'
) {
  chrome.runtime.onMessage.addListener((msg) => {
    try {
      if (!msg || !msg.action) return;
      if (msg.action === 'delete_storage_image_ack') {
        const el = document.querySelector(`.tm-my-img-item[data-id="${msg.id}"]`);
        if (el) el.style.opacity = '0.5';
      }
      if (msg.action === 'delete_storage_image_result') {
        const { id, success, error } = msg;
        const el = document.querySelector(`.tm-my-img-item[data-id="${id}"]`);
        if (el) el.remove();
        if (success) showToast('✅ 이미지가 삭제되었습니다.');
        else showToast('삭제 실패: ' + (error || '알 수 없는 오류'), 'error');
      }
    } catch (e) {
      // ignore
    }
  });
}
