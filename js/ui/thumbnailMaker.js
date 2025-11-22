// js/ui/thumbnailMaker.js
import { renderTemplateFromData } from "./thumbnailGenerator.js";

/**
 * 썸네일 제작 모달을 엽니다.
 * @param {Object} draftData - 초안 생성 시 확보된 데이터 (thumbnailInfo 포함)
 * @param {Function} onInsert - '본문에 삽입' 클릭 시 실행할 콜백 (dataUrl 전달)
 */
export function openThumbnailMaker(draftData, onInsert) {
  // 1. 기존 데이터에서 썸네일 정보 추출 (없으면 기본값)
  const thumbInfo = draftData.thumbnailInfo || {
    thumbnailText: draftData.seoTitle || "제목을 입력하세요",
    thumbnailPromptEn: "Abstract modern background, minimalistic, professional, 4k, soft lighting",
    thumbnailPromptKo: "심플하고 모던한 배경"
  };

  console.log("[ThumbnailMaker] 초기화 데이터:", thumbInfo);

  // 2. 모달 컨테이너 생성 (어두운 테마 적용)
  const modal = document.createElement("div");
  modal.id = "cp-thumbnail-modal";
  modal.style.cssText = "position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:90%;max-width:640px;min-width:320px;background:#1e1e1e;color:#fff;z-index:2147483648;padding:24px;box-shadow:0 20px 50px rgba(0,0,0,0.5);border-radius:16px;font-family:'Pretendard', sans-serif;border:1px solid #333;max-height:90vh;overflow-y:auto;box-sizing:border-box;";
  
  // 프롬프트 텍스트 이스케이프 처리
  const escapedPromptEn = (thumbInfo.thumbnailPromptEn || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const escapedPromptKo = (thumbInfo.thumbnailPromptKo || '자동 설정됨').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const escapedThumbText = (thumbInfo.thumbnailText || '').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-shrink:0;">
      <h3 style="margin:0;font-size:18px;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
        <span>✨ AI 썸네일 메이커</span>
        <span style="font-size:11px;background:#6c5ce7;padding:2px 6px;border-radius:4px;">Beta</span>
      </h3>
      <button id="tm-close" style="background:none;border:none;color:#888;cursor:pointer;font-size:24px;line-height:1;flex-shrink:0;padding:0;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">&times;</button>
    </div>

    <div style="display:grid;grid-template-columns: 2fr 1fr; gap:12px; margin-bottom:16px;flex-shrink:0;">
      <div style="min-width:0;">
        <label style="display:block;font-size:12px;color:#aaa;margin-bottom:6px;">메인 텍스트 (12자 내외 추천)</label>
        <input id="tm-title" type="text" value="${escapedThumbText}" style="width:100%;padding:12px;background:#2d2d2d;border:1px solid #444;color:#fff;border-radius:8px;box-sizing:border-box;font-size:14px;">
      </div>
      <div style="min-width:0;">
        <label style="display:block;font-size:12px;color:#aaa;margin-bottom:6px;">배경 스타일</label>
        <button id="tm-gen-bg" style="width:100%;padding:12px;background:linear-gradient(135deg, #6c5ce7, #a29bfe);color:white;border:none;border-radius:8px;cursor:pointer;font-weight:600;transition:all 0.2s;box-shadow:0 4px 12px rgba(108, 92, 231, 0.3);white-space:nowrap;">
          🎨 배경 생성하기
        </button>
      </div>
    </div>
    
    <div style="background:#000;height:360px;min-height:200px;max-height:50vh;display:flex;align-items:center;justify-content:center;border-radius:12px;margin-bottom:20px;overflow:hidden;border:1px solid #333;position:relative;box-shadow:inset 0 0 20px rgba(0,0,0,0.5);flex-shrink:0;">
      <div id="tm-loading" style="position:absolute;display:none;flex-direction:column;align-items:center;gap:12px;z-index:10;">
        <div style="width:40px;height:40px;border:4px solid rgba(255,255,255,0.1);border-top-color:#fff;border-radius:50%;animation:tm-spin 1s linear infinite;"></div>
        <span style="color:#fff;font-size:14px;font-weight:500;">AI가 배경을 그리고 있습니다...</span>
      </div>
      <canvas id="tm-preview" width="1280" height="720" style="max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;"></canvas>
    </div>

    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;flex-shrink:0;">
      <div style="flex:1;min-width:200px;background:#2d2d2d;padding:10px 12px;border-radius:8px;display:flex;flex-direction:column;justify-content:center;">
        <span style="font-size:10px;color:#888;margin-bottom:2px;">적용된 프롬프트 (자동)</span>
        <span style="font-size:12px;color:#ccc;word-wrap:break-word;word-break:break-word;line-height:1.4;" title="${escapedPromptEn}">
          ${escapedPromptKo}
        </span>
      </div>
      
      <div style="display:flex;gap:8px;flex-shrink:0;">
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
  const canvas = modal.querySelector("#tm-preview");
  const ctx = canvas.getContext("2d");
  let currentBgImage = null; // 생성된 배경 이미지 데이터 (Base64)

  // 렌더링 함수 (thumbnailGenerator 엔진 활용)
  const updatePreview = async () => {
    const title = document.getElementById("tm-title").value;
    
    // 템플릿 데이터 조립
    const templateData = {
      name: "AI Auto Gen",
      background: currentBgImage 
        ? { type: "image", value: currentBgImage } // 이미지가 있으면 이미지 배경
        : { type: "gradient", value: "linear-gradient(135deg, #1e272e 0%, #485460 100%)" }, // 없으면 기본 그라디언트
      layers: [
        // 배경 이미지가 있을 때는 텍스트 가독성을 위해 어두운 오버레이 추가
        ...(currentBgImage ? [{ type: "shape", shape: "rect", x: 0.5, y: 0.5, widthRatio: 1, heightRatio: 1, styles: { fill: "rgba(0,0,0,0.3)" } }] : []),
        { 
          type: "text", 
          text: title, 
          x: 0.5, 
          y: 0.5, 
          styles: { 
            fill: "#ffffff", 
            fontRatio: 0.15, 
            fontWeight: "bold", 
            fontFamily: "'Pretendard', 'Noto Sans KR', sans-serif",
            align: "center", 
            baseline: "middle",
            shadow: { color: "rgba(0,0,0,0.8)", blur: 40, offsetX: 0, offsetY: 10 }
          } 
        }
      ]
    };

    // thumbnailGenerator.js의 렌더러 호출
    await renderTemplateFromData(ctx, templateData);
  };

  // 4. 이벤트 리스너 연결

  // [핵심] 배경 생성 버튼 클릭
  document.getElementById("tm-gen-bg").onclick = async () => {
    const btn = document.getElementById("tm-gen-bg");
    const loading = document.getElementById("tm-loading");
    
    // UI 로딩 상태 전환
    btn.disabled = true;
    btn.style.opacity = "0.7";
    btn.textContent = "⏳ 생성 중...";
    loading.style.display = "flex";
    
    // 캔버스 살짝 어둡게 처리
    ctx.fillStyle = "rgba(0,0,0,0.7)";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    try {
      // background.js에 이미지 생성 요청 (이미 확보된 프롬프트 사용)
      const response = await chrome.runtime.sendMessage({
        action: "ai_generate_images",
        data: {
          prompt: thumbInfo.thumbnailPromptEn, // 초안 생성 시 받은 영문 프롬프트 사용
          count: 1,
          aspect: "16:9"
        }
      });

      if (response && response.success && response.images.length > 0) {
        currentBgImage = response.images[0]; // Base64 이미지 저장
        await updatePreview(); // 다시 렌더링
      } else {
        alert("이미지 생성에 실패했습니다: " + (response?.error || "알 수 없는 오류"));
        await updatePreview(); // 실패 시 원복
      }
    } catch (e) {
      console.error("배경 생성 오류:", e);
      alert("오류가 발생했습니다.");
      await updatePreview();
    } finally {
      // UI 복원
      btn.disabled = false;
      btn.style.opacity = "1";
      btn.textContent = "🎨 배경 다시 생성";
      loading.style.display = "none";
    }
  };

  // 텍스트 실시간 반영 (입력할 때마다 렌더링)
  document.getElementById("tm-title").addEventListener("input", updatePreview);

  // 본문 삽입 버튼
  document.getElementById("tm-insert").onclick = async () => {
    const btn = document.getElementById("tm-insert");
    const originalText = btn.textContent;
    
    // 로딩 상태
    btn.disabled = true;
    btn.textContent = "⏳ 업로드 중...";
    
    try {
      const dataUrl = canvas.toDataURL("image/png");
      
      // Firebase Storage에 업로드
      const response = await chrome.runtime.sendMessage({
        action: "upload_thumbnail_to_storage",
        data: {
          dataUrl: dataUrl,
          filename: `thumbnail_${Date.now()}.png`
        }
      });
      
      if (response && response.success && response.url) {
        // 업로드된 URL을 사용
        if (onInsert) onInsert(response.url);
        modal.remove();
      } else {
        // 업로드 실패 시 Base64로 fallback
        console.warn("[ThumbnailMaker] Firebase Storage 업로드 실패, Base64로 fallback");
        if (onInsert) onInsert(dataUrl);
        modal.remove();
      }
    } catch (e) {
      console.error("[ThumbnailMaker] 업로드 오류:", e);
      // 오류 시 Base64로 fallback
      const dataUrl = canvas.toDataURL("image/png");
      if (onInsert) onInsert(dataUrl);
      modal.remove();
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  };

  // 정밀 편집 (TUI) 버튼 - 현재는 알림만 표시 (추후 연동)
  document.getElementById("tm-edit-tui").onclick = () => {
    // const dataUrl = canvas.toDataURL("image/png");
    alert("💡 준비 중입니다!\n\n현재 생성된 이미지를 TUI 편집기로 보내 스티커, 필터 등을 추가할 수 있는 기능이 곧 추가됩니다.");
    // TODO: window.postMessage로 TUI iframe 열기 구현 필요
  };

  // 닫기 버튼
  document.getElementById("tm-close").onclick = () => modal.remove();

  // 초기 1회 렌더링 (기본 배경 + 텍스트)
  updatePreview();
}

