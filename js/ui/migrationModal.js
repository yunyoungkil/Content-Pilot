// js/ui/migrationModal.js - 마이그레이션 선택 모달

import { showToast } from "../utils.js";

/**
 * 마이그레이션 선택 모달 표시
 * @param {ShadowRoot} shadowRoot - Shadow DOM 루트
 * @param {Object} migrationInfo - 마이그레이션 정보
 * @param {number} migrationInfo.orphanCount - 고아 데이터 개수
 * @param {number} migrationInfo.channelCount - 채널 개수
 * @param {Array} migrationInfo.channelOptions - 채널 옵션 배열
 * @param {boolean} migrationInfo.autoAssign - 자동 할당 여부
 */
export function showMigrationModal(shadowRoot, migrationInfo) {
  const { orphanCount, channelCount, channelOptions, autoAssign } = migrationInfo;

  // 모달이 이미 있으면 제거
  const existingModal = shadowRoot.querySelector("#migration-modal");
  if (existingModal) {
    existingModal.remove();
  }

  // 모달 생성
  const modal = document.createElement("div");
  modal.id = "migration-modal";
  modal.className = "cp-modal-wrap";
  modal.style.cssText = `
    position: fixed;
    inset: 0;
    z-index: 10000;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.5);
  `;

  const modalContent = document.createElement("div");
  modalContent.className = "cp-modal";
  modalContent.style.cssText = `
    background: white;
    border-radius: 12px;
    padding: 24px;
    max-width: 500px;
    width: 90%;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.2);
  `;

  let modalHTML = `
    <div class="migration-modal-header" style="margin-bottom: 20px;">
      <h2 style="margin: 0 0 8px 0; font-size: 20px; color: #333;">📦 데이터 마이그레이션</h2>
      <p style="margin: 0; color: #666; font-size: 14px;">
        기존 데이터(${orphanCount}개)를 채널에 귀속시켜야 합니다.
      </p>
    </div>
  `;

  if (autoAssign) {
    // 단일 채널: 자동 할당
    modalHTML += `
      <div class="migration-auto-assign" style="padding: 16px; background: #e8f5e9; border-radius: 8px; margin-bottom: 20px;">
        <p style="margin: 0; color: #2e7d32; font-size: 14px;">
          ✅ 채널이 1개뿐이므로 모든 데이터를 <strong>${channelOptions[0].name}</strong>에 자동 할당합니다.
        </p>
      </div>
      <div class="migration-actions" style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="migration-cancel-btn" class="cp-btn cp-btn-secondary" style="padding: 10px 20px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer;">
          나중에
        </button>
        <button id="migration-confirm-btn" class="cp-btn cp-btn-primary" style="padding: 10px 20px; border-radius: 6px; border: none; background: #2d8cf0; color: white; cursor: pointer;">
          마이그레이션 실행
        </button>
      </div>
    `;
  } else {
    // 다중 채널: 사용자 선택
    modalHTML += `
      <div class="migration-channel-select" style="margin-bottom: 20px;">
        <label style="display: block; margin-bottom: 8px; font-weight: 500; color: #333;">
          기존 데이터를 어떤 채널에 귀속시키겠습니까?
        </label>
        <select id="migration-channel-select" style="width: 100%; padding: 10px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box;">
          <option value="__PUBLIC__">🌐 공용으로 유지 (모든 채널에서 사용 가능)</option>
          ${channelOptions.map(ch => `<option value="${ch.id}">📺 ${ch.name}</option>`).join("")}
        </select>
        <p style="margin: 8px 0 0 0; color: #666; font-size: 12px;">
          💡 공용으로 유지하면 모든 채널에서 데이터를 볼 수 있습니다.
        </p>
      </div>
      <div class="migration-actions" style="display: flex; gap: 8px; justify-content: flex-end;">
        <button id="migration-cancel-btn" class="cp-btn cp-btn-secondary" style="padding: 10px 20px; border-radius: 6px; border: 1px solid #ddd; background: #fff; cursor: pointer;">
          나중에
        </button>
        <button id="migration-confirm-btn" class="cp-btn cp-btn-primary" style="padding: 10px 20px; border-radius: 6px; border: none; background: #2d8cf0; color: white; cursor: pointer;">
          마이그레이션 실행
        </button>
      </div>
    `;
  }

  modalContent.innerHTML = modalHTML;
  modal.appendChild(modalContent);
  shadowRoot.appendChild(modal);

  // 이벤트 리스너
  const confirmBtn = modalContent.querySelector("#migration-confirm-btn");
  const cancelBtn = modalContent.querySelector("#migration-cancel-btn");
  const channelSelect = modalContent.querySelector("#migration-channel-select");

  confirmBtn.addEventListener("click", () => {
    let targetChannelId = null;
    
    if (autoAssign) {
      targetChannelId = channelOptions[0].id;
    } else if (channelSelect) {
      const selectedValue = channelSelect.value;
      targetChannelId = selectedValue === "__PUBLIC__" ? null : selectedValue;
    }

    confirmBtn.disabled = true;
    confirmBtn.textContent = "처리 중...";

    chrome.runtime.sendMessage({
      action: "run_data_migration",
      targetChannelId: targetChannelId
    }, (response) => {
      if (response && response.success) {
        // 마이그레이션 완료 상태 저장
        chrome.storage.local.set({ migration_completed: true }, () => {
          modal.remove();
          // [체크리스트 2-B 최적화] 완료 알림
          showToast("✅ 데이터 구조가 업데이트되었습니다. 모든 데이터가 정상적으로 보존되었습니다.");
          
          // 현재 탭 새로고침
          const activeTab = shadowRoot.querySelector(".cp-mode-tab.active");
          if (activeTab) {
            setTimeout(() => activeTab.click(), 500);
          }
        });
      } else {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "마이그레이션 실행";
        showToast(`❌ 마이그레이션 실패: ${response?.error || "알 수 없는 오류"}`);
      }
    });
  });

  cancelBtn.addEventListener("click", () => {
    modal.remove();
    // 나중에 다시 보여줄 수 있도록 상태 저장하지 않음
  });

  // 백드롭 클릭 시 닫기
  modal.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.remove();
    }
  });
}

/**
 * 마이그레이션 필요 여부 확인 및 모달 표시
 * @param {ShadowRoot} shadowRoot - Shadow DOM 루트
 */
export function checkAndShowMigrationModal(shadowRoot) {
  chrome.runtime.sendMessage({ action: "check_migration_needed" }, (response) => {
    if (response && response.success) {
      if (response.needsMigration) {
        showMigrationModal(shadowRoot, {
          orphanCount: response.orphanCount,
          channelCount: response.channelCount,
          channelOptions: response.channelOptions,
          autoAssign: response.autoAssign
        });
      }
    }
  });
}

