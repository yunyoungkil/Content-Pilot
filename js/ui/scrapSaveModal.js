// js/ui/scrapSaveModal.js - 스크랩 저장 전 선택 모달

import { showToast } from "../utils.js";

/**
 * 스크랩 저장 전 채널 선택 모달 표시
 * @param {Object} scrapData - 스크랩 데이터
 * @param {string} activeChannelId - 현재 활성 채널 ID
 * @param {string} activeChannelName - 현재 활성 채널 이름
 */
export function showScrapSaveModal(scrapData, activeChannelId, activeChannelName) {
  // 기존 모달이 있으면 제거
  const existingModal = document.getElementById("scrap-save-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // 모달 생성
  const modal = document.createElement("div");
  modal.id = "scrap-save-modal";
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 2147483647;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
    font-family: "Noto Sans KR", "Roboto", Arial, sans-serif;
  `;

  const modalContent = document.createElement("div");
  modalContent.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 90%;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  `;

  const scrapPreview = scrapData.text 
    ? scrapData.text.substring(0, 100) + (scrapData.text.length > 100 ? "..." : "")
    : "스크랩 내용";

  modalContent.innerHTML = `
    <div style="margin-bottom: 20px;">
      <h3 style="margin: 0 0 8px 0; font-size: 18px; color: #333; font-weight: 600;">
        📝 스크랩 저장
      </h3>
      <p style="margin: 0; color: #666; font-size: 14px; line-height: 1.5;">
        ${scrapPreview}
      </p>
    </div>
    
    <div style="padding: 16px; background: #f8f9fa; border-radius: 8px; margin-bottom: 20px;">
      <label style="display: flex; align-items: center; gap: 12px; cursor: pointer;">
        <input type="checkbox" id="scrap-save-channel-only" style="width: 18px; height: 18px; cursor: pointer;">
        <div style="flex: 1;">
          <div style="font-weight: 500; color: #333; font-size: 14px; margin-bottom: 4px;">
            ${activeChannelName ? `'${activeChannelName}'에서만 사용` : "현재 채널에만 저장"}
          </div>
          <div style="font-size: 12px; color: #666; line-height: 1.4;">
            체크하지 않으면 <strong>공용 스크랩</strong>으로 저장되어<br>
            모든 채널에서 사용할 수 있습니다.
          </div>
        </div>
      </label>
    </div>
    
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button id="scrap-save-cancel-btn" style="padding: 10px 20px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer; font-size: 14px;">
        취소
      </button>
      <button id="scrap-save-confirm-btn" style="padding: 10px 20px; border-radius: 6px; border: none; background: #2d8cf0; color: white; cursor: pointer; font-size: 14px; font-weight: 500;">
        저장
      </button>
    </div>
  `;

  modal.appendChild(modalContent);
  document.body.appendChild(modal);

  // 이벤트 리스너
  const confirmBtn = modalContent.querySelector("#scrap-save-confirm-btn");
  const cancelBtn = modalContent.querySelector("#scrap-save-cancel-btn");
  const checkbox = modalContent.querySelector("#scrap-save-channel-only");

  confirmBtn.addEventListener("click", () => {
    const isChannelOnly = checkbox.checked;
    const targetChannelId = isChannelOnly ? activeChannelId : null;

    confirmBtn.disabled = true;
    confirmBtn.textContent = "저장 중...";

    // background.js로 스크랩 저장 요청
    chrome.runtime.sendMessage({
      action: "scrap_element",
      data: scrapData,
      channelId: targetChannelId // 사용자 선택에 따른 channelId
    }, (response) => {
      modal.remove();
      
      if (chrome.runtime.lastError) {
        showToast("❌ 스크랩 저장 실패: " + chrome.runtime.lastError.message);
        return;
      }

      if (response && response.success) {
        // 저장된 스크랩 데이터로 미리보기 표시
        const savedScrapData = {
          ...scrapData,
          channelId: targetChannelId
        };
        
        // 미리보기 표시
        window.postMessage({
          action: "cp_show_preview",
          data: savedScrapData
        }, "*");
        
        showToast(isChannelOnly ? "✅ 현재 채널에 저장되었습니다." : "✅ 공용 스크랩으로 저장되었습니다.");
      } else {
        showToast("❌ 스크랩 저장 실패");
      }
    });
  });

  cancelBtn.addEventListener("click", () => {
    modal.remove();
  });

  // 백드롭 클릭 시 닫기
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });

  // ESC 키로 닫기
  const handleEsc = (e) => {
    if (e.key === "Escape") {
      modal.remove();
      document.removeEventListener("keydown", handleEsc);
    }
  };
  document.addEventListener("keydown", handleEsc);
}

