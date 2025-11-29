// js/ui/thumbnailMaker.js
import { renderTemplateFromData, createSmartTemplate } from './thumbnailGenerator.js';
import { showToast, Logger } from '../utils.js';

/**
 * 썸네일 제작 모달을 엽니다.
 * @param {Object} draftData - 초안 생성 시 확보된 데이터 (thumbnailInfo 포함)
 * @param {Function} onInsert - '본문에 삽입' 클릭 시 실행할 콜백 (dataUrl, altText 전달)
 * @param {Function} onSave - 상태 변경 시 자동 저장 콜백 (thumbnailInfo 전달)
 * @param {Function} onEditTui - '정밀 편집' 클릭 시 실행할 콜백 (dataUrl 전달)
 */
export function openThumbnailMaker(draftData, onInsert, onSave, onEditTui) {
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
        thumbnailPromptEn: `High-quality, dramatic thumbnail for "${baseTitle}", mysterious atmosphere, question mark, vibrant colors, dramatic lighting, eye-catching composition, 16:9 aspect ratio`,
        thumbnailPromptKo: `"${baseTitle}"에 대한 호기심 자극형 썸네일, 드라마틱한 조명, 강렬한 색상, 시선을 끄는 구성, 16:9 비율`,
        thumbnailText: '이거 실화냐?',
        fontFamily: "'Pretendard', sans-serif",
        textColor: 'auto',
        ratio: '16:9',
        subtitle: '',
        bgImage: null,
      },
      {
        type: 'informative',
        thumbnailPromptEn: `Clean, professional thumbnail for "${baseTitle}", text overlay style, bright lighting, organized layout, numbers or checkmarks, modern design, 16:9 aspect ratio`,
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
  console.log('[ThumbnailMaker] 초기화 데이터:', logThumbInfo);

  // 2. 모달 컨테이너 생성 (어두운 테마 적용)
  const modal = document.createElement('div');
  modal.id = 'cp-thumbnail-modal';
  modal.style.cssText =
    "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:640px;min-width:320px;background:#1e1e1e;color:#fff;z-index:2147483648;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.5);border-radius:16px;font-family:'Pretendard', sans-serif;border:1px solid #333;max-height:90vh;overflow-y:auto;box-sizing:border-box;";

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
          <label style="display:block;font-size:12px;color:#aaa;margin-bottom:4px;">메인 타이틀</label>
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
        </div>

        <div id="tm-bg-upload-panel" style="display:none;text-align:center;">
          <input type="file" id="tm-file-input" accept="image/*" style="display:none;">
          <button id="tm-upload-btn" style="width:100%;padding:20px 10px;background:#1e1e1e;color:#888;border:1px dashed #666;border-radius:6px;cursor:pointer;font-size:12px;transition:all 0.2s;">
            클릭하여 이미지 업로드<br><span style="font-size:10px;opacity:0.7">(JPG, PNG)</span>
          </button>
        </div>
      </div>
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
  document.body.appendChild(modal);

  // 3. 캔버스 및 상태 초기화
  const canvas = modal.querySelector('#tm-preview');
  const ctx = canvas.getContext('2d');
  // [신규] 저장된 배경 이미지가 있으면 불러오기
  let currentBgImage = thumbInfo.bgImage || null;

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

          const response = await chrome.runtime.sendMessage({
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
        thumbnailText: document.getElementById('tm-title').value,
        subtitle: document.getElementById('tm-subtitle')?.value || '',
        thumbnailPromptEn: thumbInfo.thumbnailPromptEn, // 프롬프트는 유지
        thumbnailPromptKo: thumbInfo.thumbnailPromptKo,
        // 스타일 정보 저장
        templateType: document.getElementById('tm-template-type')?.value || 'default',
        fontFamily: document.getElementById('tm-font-family')?.value || "'Pretendard', sans-serif",
        textColor: document.getElementById('tm-text-color')?.value || 'auto',
        ratio: document.getElementById('tm-ratio')?.value || '16:9',
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
      templateType: document.getElementById('tm-template-type')?.value || 'default',
      title: document.getElementById('tm-title').value,
      subtitle: document.getElementById('tm-subtitle')?.value || '',
      fontFamily: document.getElementById('tm-font-family')?.value || "'Pretendard', sans-serif",
      textColor: document.getElementById('tm-text-color')?.value || 'auto',
      ratio: document.getElementById('tm-ratio')?.value || '16:9',
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

    if (document.getElementById('tm-template-type')) {
      document.getElementById('tm-template-type').value = state.templateType || 'default';
    }
    document.getElementById('tm-title').value = state.title;
    if (document.getElementById('tm-subtitle')) {
      document.getElementById('tm-subtitle').value = state.subtitle || '';
    }
    document.getElementById('tm-font-family').value = state.fontFamily;
    document.getElementById('tm-text-color').value = state.textColor;
    document.getElementById('tm-ratio').value = state.ratio;
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
    const undoBtn = document.getElementById('tm-undo');
    const redoBtn = document.getElementById('tm-redo');
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

    const title = document.getElementById('tm-title').value;
    const subtitle = document.getElementById('tm-subtitle')?.value || '';
    const templateType = document.getElementById('tm-template-type')?.value || 'default';

    // [신규] UI에서 값 가져오기
    const fontFamily =
      document.getElementById('tm-font-family')?.value || "'Pretendard', sans-serif";
    const textColorMode = document.getElementById('tm-text-color')?.value || 'auto';

    // [Offscreen 가속] 배경 이미지가 있으면 offscreen에서 리사이징
    let processedBgImage = currentBgImage;
    if (currentBgImage && currentBgImage.startsWith('data:image')) {
      try {
        // DataURL 유효성 검사
        if (currentBgImage.length < 100) {
          console.warn('[ThumbnailMaker] DataURL이 너무 짧습니다. 원본 사용.');
        } else {
          // Offscreen에서 이미지 리사이징 (캔버스 크기에 맞춤)
          const response = await chrome.runtime.sendMessage({
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
    const aiPanel = document.getElementById('tm-bg-ai-panel');
    const uploadPanel = document.getElementById('tm-bg-upload-panel');
    const aiTab = document.getElementById('tm-bg-mode-ai');
    const uploadTab = document.getElementById('tm-bg-mode-upload');

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

  const bgModeAi = document.getElementById('tm-bg-mode-ai');
  if (bgModeAi) bgModeAi.onclick = () => toggleTabs('ai');

  const bgModeUpload = document.getElementById('tm-bg-mode-upload');
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
  const uploadBtn = document.getElementById('tm-upload-btn');
  if (uploadBtn)
    uploadBtn.onclick = () => {
      const fileInput = document.getElementById('tm-file-input');
      if (fileInput) fileInput.click();
    };

  const fileInput = document.getElementById('tm-file-input');
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

          const response = await chrome.runtime.sendMessage({
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
  const genBgBtn = document.getElementById('tm-gen-bg');
  if (genBgBtn)
    genBgBtn.onclick = async () => {
      const btn = document.getElementById('tm-gen-bg');
      const loading = document.getElementById('tm-loading');
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
        const style = document.getElementById('tm-bg-style').value;
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
        const titleInput = document.getElementById('tm-title');
        const mainTitle = titleInput ? titleInput.value.trim() : thumbInfo.thumbnailText || '';

        // Gemini API 문서 참고: 고화질 텍스트 렌더링을 위해 텍스트를 명시적으로 포함
        // https://ai.google.dev/gemini-api/docs/image-generation?hl=ko
        // 프롬프트에 메인 타이틀 텍스트를 포함하여 이미지에 텍스트가 렌더링되도록 함
        let textPrompt = '';
        if (mainTitle) {
          textPrompt = `, with text "${mainTitle}" rendered in high-quality, readable font, properly positioned`;
        }

        // 기본 프롬프트 + 스타일 프롬프트 + 텍스트 렌더링 지시 결합
        const enhancedPrompt = `${thumbInfo.thumbnailPromptEn}${textPrompt}, ${promptSuffix}, high-quality text rendering, 16:9 aspect ratio`;

        // background.js에 이미지 생성 요청
        const response = await chrome.runtime.sendMessage({
          action: 'ai_generate_images',
          data: {
            prompt: enhancedPrompt,
            count: 1,
            aspect: '16:9',
          },
        });

        if (response && response.success && response.images.length > 0) {
          // AI 생성 이미지는 이미 Firebase Storage URL로 반환됨
          currentBgImage = response.images[0];
          console.log(
            '[ThumbnailMaker] ✅ AI 생성 배경 이미지:',
            currentBgImage.substring(0, 80) + '...'
          );
          await updatePreview(); // 다시 렌더링
          saveState(); // 배경 생성 후 상태 저장
        } else {
          alert('이미지 생성에 실패했습니다: ' + (response?.error || '알 수 없는 오류'));
          await updatePreview(); // 실패 시 원복
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
  const undoBtn = document.getElementById('tm-undo');
  if (undoBtn)
    undoBtn.addEventListener('click', () => {
      if (history.currentIndex > 0) {
        history.currentIndex--;
        restoreState(history.states[history.currentIndex]);
      }
    });

  const redoBtn = document.getElementById('tm-redo');
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
        const undoBtn = document.getElementById('tm-undo');
        if (undoBtn) undoBtn.click();
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) {
        e.preventDefault();
        const redoBtn = document.getElementById('tm-redo');
        if (redoBtn) redoBtn.click();
      }
    }
  });

  // 텍스트 실시간 반영 (입력할 때마다 렌더링) - 상태 저장 포함
  document.getElementById('tm-template-type')?.addEventListener('change', () => {
    updatePreview();
    saveState();
  });

  const titleInput = document.getElementById('tm-title');
  if (titleInput)
    titleInput.addEventListener('input', () => {
      updatePreview();
      saveState(); // Undo/Redo용 상태 저장 (내부에서 triggerAutoSave 호출)
    });

  const subtitleInput = document.getElementById('tm-subtitle');
  if (subtitleInput)
    subtitleInput.addEventListener('input', () => {
      updatePreview();
      saveState();
    });

  // [신규] 타이포그래피 컨트롤 이벤트 리스너 - 상태 저장 포함
  const fontFamilySelect = document.getElementById('tm-font-family');
  if (fontFamilySelect)
    fontFamilySelect.addEventListener('change', () => {
      updatePreview();
      saveState();
    });

  const textColorInput = document.getElementById('tm-text-color');
  if (textColorInput)
    textColorInput.addEventListener('change', () => {
      updatePreview();
      saveState();
    });

  // [신규] 비율 변경 이벤트 - 상태 저장 포함
  const ratioSelect = document.getElementById('tm-ratio');
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
  const wrapper = document.getElementById('tm-canvas-wrapper');
  const overlay = document.getElementById('tm-drag-overlay');

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
  const insertBtn = document.getElementById('tm-insert');
  if (insertBtn)
    insertBtn.onclick = async () => {
      const btn = document.getElementById('tm-insert');
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
          document.getElementById('tm-title').value || thumbInfo.thumbnailText || '썸네일 이미지';

        // 1. 제목 가져오기
        const rawTitle =
          document.getElementById('tm-title').value || thumbInfo.thumbnailText || 'thumbnail';

        // 2. [SEO] 안전한 파일명으로 변환 (한글/영어/숫자 외 제거, 공백 -> 하이픈)
        // 예: "집 전체를 손끝으로!" -> "집-전체를-손끝으로-170..."
        const safeTitle = rawTitle
          .trim()
          .replace(/[^a-zA-Z0-9가-힣\s-]/g, '') // 특수문자 제거
          .replace(/\s+/g, '-'); // 공백을 하이픈으로

        const seoFilename = `${safeTitle}-${Date.now()}.png`; // 중복 방지를 위해 시간 추가

        // 3. Firebase Storage에 업로드 (수정된 파일명 사용)
        const response = await chrome.runtime.sendMessage({
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
          document.getElementById('tm-title').value || thumbInfo.thumbnailText || '썸네일 이미지';
        if (onInsert) onInsert(dataUrl, altText);
        modal.remove();
      } finally {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    };

  // 정밀 편집 (TUI) 버튼 - 실제 기능 구현
  const editTuiBtn = document.getElementById('tm-edit-tui');
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
  const closeBtn = document.getElementById('tm-close');
  if (closeBtn) closeBtn.onclick = () => modal.remove();

  // 초기 1회 렌더링 (기본 배경 + 텍스트)
  updatePreview();

  // 초기 상태 저장
  saveState();
}
