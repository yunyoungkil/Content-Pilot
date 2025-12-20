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

  // 썸네일 정보가 없으면 기본값 (3가지 컨셉 강제 생성)
  if (!thumbInfo || thumbnailCandidates.length === 0) {
    const baseTitle = draftData.seoTitle || '제목을 입력하세요';
    thumbnailCandidates = [
      {
        type: 'curiosity',
        thumbnailPromptEn: `High-quality, dramatic thumbnail for "${baseTitle}", mysterious atmosphere, vibrant colors, dramatic lighting, eye-catching composition, 16:9 aspect ratio`,
        thumbnailPromptKo: `"${baseTitle}"에 대한 호기심 자극형 썸네일, 드라마틱한 조명, 강렬한 색상, 시선을 끄는 구성, 16:9 비율`,
        thumbnailText: '',
        fontFamily: "'Pretendard', sans-serif",
        textColor: 'auto',
        ratio: '16:9',
        subtitle: '',
        bgImage: null,
      },
      {
        type: 'informative',
        // Avoid explicit 'text overlay' instruction in the AI prompt; request a clean layout suitable for overlay but no text
        thumbnailPromptEn: `Clean, professional thumbnail for "${baseTitle}", clean layout suitable for text overlay (DO NOT include any text in the image), bright lighting, organized layout, numbers or checkmarks, modern design, 16:9 aspect ratio`,
        thumbnailPromptKo: `"${baseTitle}"에 대한 정보 요약형 썸네일, 깔끔한 레이아웃, 밝은 조명, 숫자나 체크마크 포함, 전문적인 디자인, 16:9 비율`,
        thumbnailText: '완벽 정리',
        fontFamily: "'Pretendard', sans-serif",
        textColor: 'auto',
        ratio: '16:9',
        subtitle: '',
        bgImage: null,
      },
      {
        type: 'emotional',
        thumbnailPromptEn: `Warm, cozy thumbnail for "${baseTitle}", soft lighting, human element, welcoming atmosphere, friendly colors, comfortable feeling, 16:9 aspect ratio`,
        thumbnailPromptKo: `"${baseTitle}"에 대한 감성/공감형 썸네일, 따뜻한 조명, 인간적 요소, 환영하는 분위기, 친근한 색상, 편안한 느낌, 16:9 비율`,
        thumbnailText: '당신을 위한',
        fontFamily: "'Pretendard', sans-serif",
        textColor: 'auto',
        ratio: '16:9',
        subtitle: '',
        bgImage: null,
      },
    ];
    selectedConceptIndex = 0;
    thumbInfo = thumbnailCandidates[0];
    Logger.debug('[ThumbnailMaker] 기본 컨셉 3개 생성:', thumbnailCandidates.length);
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
        </div>
        
        <div style="flex-shrink:0;">
          <label style="display:block;font-size:12px;color:#aaa;margin-bottom:4px;">템플릿 스타일</label>
          <select id="tm-template-type" style="width:100%;padding:10px 8px;background:#2d2d2d;color:#fff;border:1px solid #444;border-radius:6px;font-size:12px;box-sizing:border-box;line-height:1.4;height:auto;">
            <option value="default" ${thumbInfo.templateType === 'default' || !thumbInfo.templateType ? 'selected' : ''}>📝 기본 (중앙 정렬)</option>
            <option value="comparison" ${thumbInfo.templateType === 'comparison' ? 'selected' : ''}>⚖️ 비교형 (VS, Before/After)</option>
            <option value="question" ${thumbInfo.templateType === 'question' ? 'selected' : ''}>❓ 질문형 (물음표 강조)</option>
            <option value="list" ${thumbInfo.templateType === 'list' ? 'selected' : ''}>📋 리스트형 (번호/체크리스트)</option>
          </select>
        </div>
        
        <div style="flex-shrink:0;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;">
            <label style="font-size:12px;color:#aaa;">메인 타이틀</label>
            <div style="display:flex;align-items:center;gap:6px;">
              <input type="checkbox" id="tm-show-text" ${initialShowText ? 'checked' : ''} style="cursor:pointer;accent-color:#6c5ce7;">
              <label for="tm-show-text" style="font-size:11px;color:#ccc;cursor:pointer;">텍스트 표시</label>
            </div>
          </div>
          <input id="tm-title" type="text" value="${escapedThumbText}" placeholder="비교형: 'A VS B', 질문형: '어떻게 할까?', 리스트형: '1. 항목1, 2. 항목2'" style="width:100%;padding:10px;background:#2d2d2d;border:1px solid #444;color:#fff;border-radius:8px;box-sizing:border-box;font-size:14px;">
        </div>
        
        <div style="flex-shrink:0;">
          <label style="display:block;font-size:12px;color:#aaa;margin-bottom:4px;">서브 타이틀 (선택)</label>
          <input id="tm-subtitle" type="text" value="${(thumbInfo.subtitle || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;')}" placeholder="부제목을 입력하세요" style="width:100%;padding:10px;background:#2d2d2d;border:1px solid #444;color:#fff;border-radius:8px;box-sizing:border-box;font-size:14px;">
        </div>

        <div style="display:flex;gap:10px;flex-shrink:0;flex-wrap:wrap;">
          <div style="flex:1;min-width:150px;">
            <label style="display:block;font-size:11px;color:#888;margin-bottom:4px;">글꼴 (Font)</label>
            <select id="tm-font-family" style="width:100%;padding:10px 8px;background:#2d2d2d;color:#fff;border:1px solid #444;border-radius:6px;font-size:12px;box-sizing:border-box;line-height:1.4;height:auto;">
              <option value="'Pretendard', sans-serif" ${thumbInfo.fontFamily === "'Pretendard', sans-serif" || !thumbInfo.fontFamily ? 'selected' : ''}>깔끔한 고딕 (기본)</option>
              <option value="'Noto Serif KR', serif" ${thumbInfo.fontFamily === "'Noto Serif KR', serif" ? 'selected' : ''}>진지한 명조</option>
              <option value="'Black Han Sans', sans-serif" ${thumbInfo.fontFamily === "'Black Han Sans', sans-serif" ? 'selected' : ''}>강력한 제목용</option>
              <option value="'Nanum Pen Script', cursive" ${thumbInfo.fontFamily === "'Nanum Pen Script', cursive" ? 'selected' : ''}>친근한 손글씨</option>
            </select>
          </div>
          <div style="flex:1;min-width:150px;">
            <label style="display:block;font-size:11px;color:#888;margin-bottom:4px;">글자 색상</label>
            <select id="tm-text-color" style="width:100%;padding:10px 8px;background:#2d2d2d;color:#fff;border:1px solid #444;border-radius:6px;font-size:12px;box-sizing:border-box;line-height:1.4;height:auto;">
              <option value="auto" ${thumbInfo.textColor === 'auto' || !thumbInfo.textColor ? 'selected' : ''}>✨ 자동 (가독성)</option>
              <option value="#FFFFFF" ${thumbInfo.textColor === '#FFFFFF' ? 'selected' : ''}>⚪ 흰색</option>
              <option value="#000000" ${thumbInfo.textColor === '#000000' ? 'selected' : ''}>⚫ 검은색</option>
              <option value="#FFD700" ${thumbInfo.textColor === '#FFD700' ? 'selected' : ''}>🟡 노란색 (강조)</option>
              <option value="#FF4444" ${thumbInfo.textColor === '#FF4444' ? 'selected' : ''}>🔴 빨간색 (경고)</option>
            </select>
          </div>
        </div>
      </div>
      <div style="min-width:0;background:#2d2d2d;padding:12px;border-radius:8px;display:flex;flex-direction:column;gap:10px;height:fit-content;position:sticky;top:0;">
        <label style="font-size:12px;color:#aaa;white-space:nowrap;">배경 스타일</label>
        
        <div style="display:flex;gap:4px;background:#1e1e1e;padding:2px;border-radius:6px;">
          <button id="tm-bg-mode-ai" class="tm-bg-tab active" style="flex:1;padding:6px;font-size:11px;cursor:pointer;background:#444;color:white;border:none;border-radius:4px;transition:0.2s;">🤖 AI 생성</button>
          <button id="tm-bg-mode-upload" class="tm-bg-tab" style="flex:1;padding:6px;font-size:11px;cursor:pointer;background:transparent;color:#888;border:none;border-radius:4px;transition:0.2s;">📂 업로드</button>
        </div>

        <div id="tm-bg-ai-panel">
          <select id="tm-bg-style" style="width:100%;padding:10px 8px;background:#1e1e1e;color:#fff;border:1px solid #444;border-radius:6px;font-size:12px;margin-bottom:8px;box-sizing:border-box;line-height:1.4;height:auto;">
            <option value="abstract">✨ 추상적/모던</option>
            <option value="gradient">🌈 그라디언트/질감</option>
            <option value="office">🏢 오피스/데스크</option>
            <option value="nature">🌿 자연/풍경</option>
            <option value="dark">🌑 다크 모드</option>
          </select>
          <button id="tm-gen-bg" style="width:100%;padding:10px;background:linear-gradient(135deg, #6c5ce7, #a29bfe);color:white;border:none;border-radius:6px;cursor:pointer;font-weight:bold;font-size:12px;box-shadow:0 2px 6px rgba(108, 92, 231, 0.3);transition:all 0.2s;">
            🎨 배경 생성
          </button>

          <!-- Reference images UI -->
          <!-- Moved to before canvas wrapper -->
        </div>

        <div id="tm-bg-upload-panel" style="display:none;text-align:center;">
          <input type="file" id="tm-file-input" accept="image/*" style="display:none;">
          <button id="tm-upload-btn" style="width:100%;padding:20px 10px;background:#1e1e1e;color:#888;border:1px dashed #666;border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s;">
            클릭하여 이미지 업로드<br><span style="font-size:10px;opacity:0.7">(JPG, PNG)</span>
          </button>
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
      
      <div id="tm-drag-overlay" style="position:absolute;inset:0;background:rgba(108, 92, 231, 0.2);display:none;align-items:center;justify-content:center;pointer-events:none;z-index:5;border-radius:12px;">
        <span style="color:#fff;font-weight:bold;font-size:16px;text-shadow:0 2px 4px rgba(0,0,0,0.5);">📂 이미지를 놓아서 배경 변경</span>
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
        <button id="tm-edit-tui" style="padding:10px 16px;border:1px solid #555;background:transparent;color:#ccc;border-radius:8px;cursor:pointer;font-size:13px;display:flex;align-items:center;gap:6px;white-space:nowrap;">
          🛠️ 정밀 편집
        </button>
        <button id="tm-insert" style="padding:10px 20px;background:#0984e3;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:bold;font-size:14px;box-shadow:0 4px 12px rgba(9, 132, 227, 0.3);white-space:nowrap;">
          본문에 삽입
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

  // [DEBUG] concept selector 존재 여부 확인 및 폴백
  try {
    const promptDisplayEl = modal.querySelector('#tm-prompt-display');
    console.log('[ThumbnailMaker] Concept UI check:', {
      thumbnailCandidatesLength: thumbnailCandidates.length,
      hasConceptButtons: modal.querySelectorAll('.tm-concept-btn')?.length || 0,
      conceptHtmlSample: conceptSelectorHtml ? conceptSelectorHtml.slice(0, 120) : null,
    });

    // 만약 컨셉 버튼이 DOM에 없는데 후보가 여러 개라면 폴백으로 삽입
    if (thumbnailCandidates.length > 1 && (!modal.querySelectorAll('.tm-concept-btn') || modal.querySelectorAll('.tm-concept-btn').length === 0)) {
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
  const renderReferenceImages = async () => {
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

    // 1) references from content
    let refs = selectBackgroundReferenceImages({ formattedDraft, ideaData: idea, affiliateLinks }, 5) || [];
    refs = refs.filter((url) => !excludedRefImages.has(url));

    // 2) fetch uploaded images and include only AI thumbnails (thumbnails/ or thumbnail-bg-)
    let aiItems = [];
    try {
      const resp = await sendRuntimeMessageWithTimeout({ action: 'get_uploaded_images_log' }, 5000);
      const uploaded = (resp && Array.isArray(resp.images)) ? resp.images : [];
      aiItems = uploaded
        .filter((i) => i && i.path && (i.path.includes('thumbnails/') || i.path.includes('thumbnail-bg-')))
        .map((i) => ({ url: i.downloadURL || i.thumbnail || i.url, id: i.id, storagePath: i.storagePath || i.path, timestamp: i.timestamp }));
      // remove excluded ones
      aiItems = aiItems.filter((a) => !excludedRefImages.has(a.url));
    } catch (e) {
      console.warn('[ThumbnailMaker] get_uploaded_images_log failed:', e && e.error ? e.error : e);
      aiItems = [];
    }

    // merge AI items first then refs (preserve order, dedupe)
    const merged = [];
    const seen = new Set();

    for (const a of aiItems) {
      if (a && a.url && !seen.has(a.url)) {
        merged.push({ url: a.url, isAi: true, id: a.id, storagePath: a.storagePath });
        seen.add(a.url);
      }
    }
    for (const url of refs) {
      if (url && !seen.has(url)) {
        merged.push({ url, isAi: false });
        seen.add(url);
      }
    }

    currentRefImages = merged.map((m) => m.url);

    if (!merged || merged.length === 0) {
      const empty = document.createElement('div');
      empty.style.fontSize = '12px';
      empty.style.color = '#777';
      empty.textContent = '(없음)';
      wrapper.appendChild(empty);
      return merged;
    }

    for (const item of merged) {
      const url = item.url;
      const imgWrap = document.createElement('div');
      imgWrap.style.display = 'inline-flex';
      imgWrap.style.alignItems = 'center';
      imgWrap.style.gap = '6px';
      imgWrap.style.position = 'relative'; // deletion button position
      imgWrap.style.marginRight = '8px'; // spacing

      const img = document.createElement('img');
      img.src = url;
      img.alt = item.isAi ? 'AI 업로드 이미지' : '참고 이미지';
      img.style.width = '64px';
      img.style.height = '36px';
      img.style.objectFit = 'cover';
      img.style.borderRadius = '6px';
      img.style.border = '1px solid #444';
      imgWrap.appendChild(img);

      // AI badge
      if (item.isAi) {
        const badge = document.createElement('span');
        badge.textContent = 'AI';
        badge.style.position = 'absolute';
        badge.style.left = '6px';
        badge.style.bottom = '4px';
        badge.style.padding = '2px 4px';
        badge.style.fontSize = '10px';
        badge.style.background = 'rgba(108,92,231,0.9)';
        badge.style.color = '#fff';
        badge.style.borderRadius = '4px';
        badge.style.zIndex = '9';
        imgWrap.appendChild(badge);
      }

      // Exclude button (existing behavior)
      const excludeBtn = document.createElement('button');
      excludeBtn.innerHTML = '×';
      excludeBtn.style.position = 'absolute';
      excludeBtn.style.top = '-6px';
      excludeBtn.style.right = 'calc(100% - 70px)';
      excludeBtn.style.width = '16px';
      excludeBtn.style.height = '16px';
      excludeBtn.style.background = '#ff4444';
      excludeBtn.style.color = 'white';
      excludeBtn.style.border = 'none';
      excludeBtn.style.borderRadius = '50%';
      excludeBtn.style.fontSize = '12px';
      excludeBtn.style.lineHeight = '1';
      excludeBtn.style.cursor = 'pointer';
      excludeBtn.style.display = 'flex';
      excludeBtn.style.alignItems = 'center';
      excludeBtn.style.justifyContent = 'center';
      excludeBtn.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
      excludeBtn.style.zIndex = '10';
      excludeBtn.title = '참고 이미지에서 제외';
      excludeBtn.onclick = (e) => {
        e.stopPropagation();
        excludedRefImages.add(url);
        renderReferenceImages();
      };
      imgWrap.appendChild(excludeBtn);

      // If storage-backed AI image, add permanent delete button
      if (item.isAi && item.id) {
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑';
        delBtn.title = '영구 삭제';
        delBtn.style.position = 'absolute';
        delBtn.style.top = '-6px';
        delBtn.style.right = '4px';
        delBtn.style.width = '20px';
        delBtn.style.height = '20px';
        delBtn.style.background = '#111';
        delBtn.style.color = '#fff';
        delBtn.style.border = 'none';
        delBtn.style.borderRadius = '50%';
        delBtn.style.fontSize = '12px';
        delBtn.style.cursor = 'pointer';
        delBtn.style.zIndex = '11';

        delBtn.onclick = async (e) => {
          e.stopPropagation();
          try {
            // confirm with user
            let ok = true;
            try {
              ok = confirm('이 이미지를 스토리지에서 영구 삭제하시겠습니까? (취소하면 보존됩니다)');
            } catch (e) {
              ok = true;
            }
            if (!ok) return;

            const resp = await sendRuntimeMessageWithTimeout({ action: 'delete_storage_image', data: { id: item.id, storagePath: item.storagePath } }, 10000);
            if (resp && resp.success) {
              showToast('이미지가 삭제되었습니다.');
              // ensure excluded set also cleans it
              excludedRefImages.add(url);
              await renderReferenceImages();
            } else {
              showToast('이미지 삭제에 실패했습니다: ' + (resp && resp.error ? resp.error : 'unknown'));
            }
          } catch (err) {
            console.error('[ThumbnailMaker] delete error:', err);
            showToast('이미지 삭제 중 오류가 발생했습니다.');
          }
        };

        imgWrap.appendChild(delBtn);
      }

      wrapper.appendChild(imgWrap);
    }
    return merged;
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
        thumbnailText: modal.querySelector('#tm-title')?.value || '',
        subtitle: modal.querySelector('#tm-subtitle')?.value || '',
        thumbnailPromptEn: thumbInfo.thumbnailPromptEn, // 프롬프트는 유지
        thumbnailPromptKo: thumbInfo.thumbnailPromptKo,
        // 스타일 정보 저장
        templateType: modal.querySelector('#tm-template-type')?.value || 'default',
        fontFamily: modal.querySelector('#tm-font-family')?.value || "'Pretendard', sans-serif",
        textColor: modal.querySelector('#tm-text-color')?.value || 'auto',
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
      title: modal.querySelector('#tm-title').value,
      subtitle: modal.querySelector('#tm-subtitle')?.value || '',
      fontFamily: modal.querySelector('#tm-font-family')?.value || "'Pretendard', sans-serif",
      textColor: modal.querySelector('#tm-text-color')?.value || 'auto',
      ratio: modal.querySelector('#tm-ratio')?.value || '16:9',
      bgImage: currentBgImage,
      // [추가] 텍스트 표시 여부 상태 저장
      showText: modal.querySelector('#tm-show-text')?.checked ?? true,
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

    if (modal.querySelector('#tm-template-type')) {
      modal.querySelector('#tm-template-type').value = state.templateType || 'default';
    }
    modal.querySelector('#tm-title').value = state.title;
    if (modal.querySelector('#tm-subtitle')) {
      modal.querySelector('#tm-subtitle').value = state.subtitle || '';
    }
    modal.querySelector('#tm-font-family').value = state.fontFamily;
    modal.querySelector('#tm-text-color').value = state.textColor;
    modal.querySelector('#tm-ratio').value = state.ratio;

    // [추가] 텍스트 표시 체크박스 상태 복원
    const showTextCheckbox = modal.querySelector('#tm-show-text');
    if (showTextCheckbox) {
      // 저장된 상태가 있으면 그것을 따르고, 없으면(구버전 데이터) true
      const shouldShow = state.showText !== undefined ? state.showText : true;
      showTextCheckbox.checked = shouldShow;

      // 입력창 활성화/비활성화 UI 동기화
      const titleInput = modal.querySelector('#tm-title');
      const subtitleInput = modal.querySelector('#tm-subtitle');
      if (titleInput) {
        titleInput.disabled = !shouldShow;
        titleInput.style.opacity = shouldShow ? '1' : '0.5';
      }
      if (subtitleInput) {
        subtitleInput.disabled = !shouldShow;
        subtitleInput.style.opacity = shouldShow ? '1' : '0.5';
      }
    }

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

    const title = modal.querySelector('#tm-title').value;
    const subtitle = modal.querySelector('#tm-subtitle')?.value || '';
    const templateType = modal.querySelector('#tm-template-type')?.value || 'default';

    // [신규] UI에서 값 가져오기
    const fontFamily = modal.querySelector('#tm-font-family')?.value || "'Pretendard', sans-serif";
    const textColorMode = modal.querySelector('#tm-text-color')?.value || 'auto';

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
      templateData = createSmartTemplate(templateType, title, subtitle, background, { fontFamily });
    } else {
      // 기본 템플릿 (기존 로직)
      // 텍스트 색상 결정 (Auto가 아니면 지정색 사용)
      let textFill = '#ffffff'; // 기본값
      let autoAdjust = true; // 자동 보정 여부

      if (textColorMode !== 'auto') {
        textFill = textColorMode;
        autoAdjust = false; // 강제 지정 시 자동 보정 끄기
      }

      templateData = {
        name: 'Custom Thumbnail',
        background: background,
        layers: [
          // 배경 이미지가 있을 때는 텍스트 가독성을 위해 어두운 오버레이 추가 (자동 모드일 때만)
          ...(currentBgImage && autoAdjust
            ? [
                {
                  type: 'shape',
                  shape: 'rect',
                  x: 0.5,
                  y: 0.5,
                  widthRatio: 1,
                  heightRatio: 1,
                  styles: { fill: 'rgba(0,0,0,0.4)' },
                },
              ]
            : []),

          // 메인 타이틀 (서브타이틀 있으면 위로 이동)
          {
            type: 'text',
            text: title,
            x: 0.5,
            y: subtitle ? 0.45 : 0.5,
            autoColorAdjust: autoAdjust,
            styles: {
              fill: textFill,
              fontFamily: fontFamily,
              fontRatio: calculateFontRatio(canvas.width, canvas.height, subtitle ? true : false),
              fontWeight: 'bold',
              align: 'center',
              baseline: 'middle',
              shadow: { color: 'rgba(0,0,0,0.8)', blur: 40, offsetX: 0, offsetY: 10 },
            },
          },

          // 서브 타이틀 (조건부 렌더링)
          ...(subtitle
            ? [
                {
                  type: 'text',
                  text: subtitle,
                  x: 0.5,
                  y: 0.65,
                  autoColorAdjust: autoAdjust,
                  styles: {
                    fill: textFill,
                    fontFamily: fontFamily,
                    fontRatio: calculateFontRatio(canvas.width, canvas.height, true) * 0.5,
                    fontWeight: 'normal',
                    align: 'center',
                    baseline: 'middle',
                    shadow: { color: 'rgba(0,0,0,0.8)', blur: 20, offsetX: 0, offsetY: 5 },
                  },
                },
              ]
            : []),
        ],
      };
    }

    // [핵심 수정] 텍스트 표시가 꺼져있으면 텍스트 레이어 제거 (좀비 모달 방지)
    const showTextCheckbox = modal.querySelector('#tm-show-text');
    // 체크박스가 있으면 그 값을 쓰고, 없으면 초기값 사용
    const showText = showTextCheckbox ? showTextCheckbox.checked : initialShowText;

    if (!showText && templateData.layers) {
      // type이 'text'인 모든 레이어를 필터링하여 제거
      templateData.layers = templateData.layers.filter((layer) => layer.type !== 'text');
      console.log('[ThumbnailMaker] 텍스트 오버레이가 비활성화되어 텍스트 레이어를 제거했습니다.');
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
        const titleInput = modal.querySelector('#tm-title');
        if (titleInput && selectedConcept.thumbnailText) {
          titleInput.value = selectedConcept.thumbnailText;
        }

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
          subtitle: thumbInfo.subtitle,
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

  // [신규] 파일 업로드 처리
  const uploadBtn = modal.querySelector('#tm-upload-btn');
  if (uploadBtn)
    uploadBtn.onclick = () => {
      const fileInput = modal.querySelector('#tm-file-input');
      if (fileInput) fileInput.click();
    };

  const fileInput = modal.querySelector('#tm-file-input');
  if (fileInput)
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const base64Data = event.target.result; // Base64 데이터

        // Firebase Storage에 업로드 시도
        try {
          const timestamp = Date.now();
          const filename = `thumbnail-bg-${timestamp}.png`;

          const response = await sendRuntimeMessageWithTimeout({
            action: 'upload_thumbnail_to_storage',
            data: {
              dataUrl: base64Data,
              filename: filename,
            },
          });

          if (response && response.success && response.url) {
            // Firebase Storage URL 사용
            currentBgImage = response.url;
            console.log(
              '[ThumbnailMaker] ✅ 배경 이미지 Firebase Storage 업로드 완료:',
              response.url
            );
          } else {
            // 업로드 실패 시 Base64 fallback
            currentBgImage = base64Data;
            console.warn('[ThumbnailMaker] ⚠️ Firebase Storage 업로드 실패, Base64 사용');
          }
        } catch (error) {
          // 오류 발생 시 Base64 fallback
          console.error('[ThumbnailMaker] 배경 이미지 업로드 오류:', error);
          currentBgImage = base64Data;
        }

        await updatePreview(); // 캔버스 다시 그리기
        saveState(); // 업로드 후 상태 저장 (내부에서 triggerAutoSave 호출)
        showToast('✅ 배경 이미지가 업로드되었습니다!');
      };
      reader.onerror = () => {
        showToast('❌ 이미지 로드에 실패했습니다.');
      };
      reader.readAsDataURL(file);
    });

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
        // 스타일에 따른 프롬프트 튜닝
        const style = modal.querySelector('#tm-bg-style').value;
        let promptSuffix = '';

        if (style === 'abstract') {
          promptSuffix =
            'abstract geometric shapes, modern, minimalistic, dark theme background, text-friendly';
        } else if (style === 'gradient') {
          promptSuffix =
            'smooth gradient texture, grain noise, high quality wallpaper, 4k, professional';
        } else if (style === 'office') {
          promptSuffix =
            'blurred modern office background, bokeh, professional workspace, soft lighting';
        } else if (style === 'nature') {
          promptSuffix =
            'scenic nature background, soft lighting, cinematic, text-friendly overlay';
        } else if (style === 'dark') {
          promptSuffix = 'dark mode background, minimalistic, modern, high contrast, text-friendly';
        }

        // 메인 타이틀 가져오기
        const titleInput = modal.querySelector('#tm-title');
        const mainTitle = titleInput ? titleInput.value.trim() : thumbInfo.thumbnailText || '';

        // Gemini API 문서 참고: 고화질 텍스트 렌더링을 위해 텍스트를 명시적으로 포함
        // https://ai.google.dev/gemini-api/docs/image-generation?hl=ko
        // 프롬프트에 메인 타이틀 텍스트를 포함하여 이미지에 텍스트가 렌더링되도록 함
        let textPrompt = '';
        if (mainTitle) {
          // We will not include the text in the generated image. Instead, request visual metaphors or icons
          // that represent the title. UI overlays will render the actual text separately.
          textPrompt = `, visually representing the idea of "${mainTitle}" with icons/illustrations, DO NOT render the title as text in the image`;
        }

        // 기본 프롬프트 + 스타일 프롬프트 (explicitly remove high-quality text rendering to avoid textual overlays)
        const enhancedPrompt = `${thumbInfo.thumbnailPromptEn}${textPrompt}, ${promptSuffix}, 16:9 aspect ratio`;

        // background.js에 이미지 생성 요청 (참조 이미지도 함께 전달)
        // Decode HTML entities and ensure URLs are clean before sending to background
        const refImagesToSend = (currentRefImages && Array.isArray(currentRefImages) ? currentRefImages : []).map((u) => {
          try {
            // Replace common HTML-escaped entities and trim
            // [FIX] Do NOT decodeURIComponent the entire URL as it breaks query parameters (e.g. %26 -> &)
            let s = String(u).replace(/&amp;/g, '&').trim();
            return s;
          } catch (e) { return u; }
        });
        // Debug: show decoded refs
        console.log('%c[AI 썸네일 메이커 디버깅][UI-Request - decoded refs]', 'color:#9E9E9E', refImagesToSend);

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
              testUrl = (window && (window.__FORCE_TEST_REF_URL__ || window.FORCE_TEST_REF_URL)) || '';
            } catch (e) {
              testUrl = '';
            }
          }

          // check parent/top frames if same-origin
          if (!testUrl) {
            try {
              if (window.parent && window.parent !== window) testUrl = window.parent.localStorage.getItem('FORCE_TEST_REF_URL') || window.parent.__FORCE_TEST_REF_URL__ || window.parent.FORCE_TEST_REF_URL || '';
            } catch (e) {}
          }
          if (!testUrl) {
            try {
              if (window.top && window.top !== window) testUrl = window.top.localStorage.getItem('FORCE_TEST_REF_URL') || window.top.__FORCE_TEST_REF_URL__ || window.top.FORCE_TEST_REF_URL || '';
            } catch (e) {}
          }

          testUrl = String(testUrl || '').trim();

          if (testUrl) {
            if (!refImagesToSend.includes(testUrl)) {
              refImagesToSend.push(testUrl);
              // indicate source when possible
              let source = 'unknown';
              if (localStorage.getItem('FORCE_TEST_REF_URL')) source = 'localStorage';
              else if (document.body.getAttribute('data-force-test-ref-url')) source = 'DOM-attribute';
              else if (window.__FORCE_TEST_REF_URL__) source = 'window-var';
              
              console.log('%c[AI 썸네일 메이커 디버깅][UI-Request - injected test ref]', 'color:#FF9800', testUrl, 'source:', source);
            } else {
              console.log('%c[AI 썸네일 메이커 디버깅][UI-Request - test ref already present]', 'color:#FF9800', testUrl);
            }
          }
        } catch (e) { /* ignore */ }
        
            // [DEBUG] AI 이미지 생성 요청 전송 전 데이터 확인
        console.log('%c[AI 썸네일 메이커 디버깅][UI-Request]', 'color:#9E9E9E', {
          prompt: enhancedPrompt,
          references: refImagesToSend,
          refCount: refImagesToSend.length
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
            console.log('%c[AI 썸네일 메이커 디버깅][ai_generate_images response diagnostics]', 'color:#9E9E9E', response.diagnostics);

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
            const inputCount = response.diagnostics.inputCount || (refImagesToSend ? refImagesToSend.length : 0);
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
            showToast(`참조 변환: ${converted}/${inputCount} (실패: ${Array.isArray(failed) ? failed.length : 0})`);
          }
        } catch (e) {
          console.warn('[ThumbnailMaker] diagnostics display failed:', e);
        }

        if (response && response.success && Array.isArray(response.images) && response.images.length > 0) {
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
              Logger.warn('[ThumbnailMaker] alert failed or not available:', e && e.message ? e.message : e);
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
  const showTextCheckbox = modal.querySelector('#tm-show-text');
  if (showTextCheckbox) {
    showTextCheckbox.addEventListener('change', () => {
      const titleInput = modal.querySelector('#tm-title');
      const subtitleInput = modal.querySelector('#tm-subtitle');

      // 체크 해제 시 입력창 비활성화 (시각적 피드백)
      const isChecked = showTextCheckbox.checked;
      if (titleInput) {
        titleInput.disabled = !isChecked;
        titleInput.style.opacity = isChecked ? '1' : '0.5';
      }
      if (subtitleInput) {
        subtitleInput.disabled = !isChecked;
        subtitleInput.style.opacity = isChecked ? '1' : '0.5';
      }

      updatePreview();
      saveState();
    });
  }

  // 텍스트 실시간 반영 (입력할 때마다 렌더링) - 상태 저장 포함
  modal.querySelector('#tm-template-type')?.addEventListener('change', () => {
    updatePreview();
    saveState();
  });

  const titleInput = modal.querySelector('#tm-title');
  if (titleInput)
    titleInput.addEventListener(
      'input',
      debounce(() => {
        updatePreview();
        saveState(); // Undo/Redo용 상태 저장 (내부에서 triggerAutoSave 호출)
      }, 300)
    );

  const subtitleInput = modal.querySelector('#tm-subtitle');
  if (subtitleInput)
    subtitleInput.addEventListener(
      'input',
      debounce(() => {
        updatePreview();
        saveState();
      }, 300)
    );

  // [신규] 타이포그래피 컨트롤 이벤트 리스너 - 상태 저장 포함
  const fontFamilySelect = modal.querySelector('#tm-font-family');
  if (fontFamilySelect)
    fontFamilySelect.addEventListener('change', () => {
      updatePreview();
      saveState();
    });

  const textColorInput = modal.querySelector('#tm-text-color');
  if (textColorInput)
    textColorInput.addEventListener('change', () => {
      updatePreview();
      saveState();
    });

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

  // [신규] 드래그 앤 드롭 이벤트
  const wrapper = modal.querySelector('#tm-canvas-wrapper');
  const overlay = modal.querySelector('#tm-drag-overlay');

  if (!wrapper || !overlay) {
    console.warn('[ThumbnailMaker] 드래그 앤 드롭 요소를 찾을 수 없습니다.');
  } else {
    wrapper.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.style.borderColor = '#6c5ce7'; // 보라색 강조
      overlay.style.display = 'flex';
    });

    wrapper.addEventListener('dragleave', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.style.borderColor = '#333';
      overlay.style.display = 'none';
    });

    wrapper.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      wrapper.style.borderColor = '#333';
      overlay.style.display = 'none';

      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        const reader = new FileReader();
        reader.onload = (event) => {
          currentBgImage = event.target.result;
          updatePreview(); // 이미지 교체 후 렌더링
          saveState(); // 드래그 앤 드롭 후 상태 저장
          showToast('✅ 배경 이미지가 업로드되었습니다!');
        };
        reader.onerror = () => {
          showToast('❌ 이미지 로드에 실패했습니다.');
        };
        reader.readAsDataURL(file);
      } else {
        showToast('❌ 이미지 파일만 드롭할 수 있습니다.');
      }
    });
  }

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

        // [SEO 핵심] 현재 입력된 제목을 Alt 텍스트로 사용
        const altText =
          modal.querySelector('#tm-title').value || thumbInfo.thumbnailText || '썸네일 이미지';

        // 1. 제목 가져오기
        const rawTitle =
          modal.querySelector('#tm-title').value || thumbInfo.thumbnailText || 'thumbnail';

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
        const altText =
          modal.querySelector('#tm-title').value || thumbInfo.thumbnailText || '썸네일 이미지';
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

  // 닫기 버튼
  const closeBtn = modal.querySelector('#tm-close');
  if (closeBtn) closeBtn.onclick = () => modal.remove();

  // 초기 1회 렌더링 (기본 배경 + 텍스트)
  updatePreview();

  // 초기 상태 저장
  saveState();
}
