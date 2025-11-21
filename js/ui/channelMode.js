// js/ui/channelMode.js (채널 중심 아키텍처 적용 버전)

import { showToast } from "../utils.js";

export function renderChannelMode(container) {
  container.innerHTML = `
    <div class="channel-settings-container">
      <div class="settings-header">
        <h2>⚙️ 채널 및 API 설정</h2>
        <p class="settings-desc">내 채널을 등록하고, 각 채널별로 경쟁사를 관리하세요.</p>
      </div>
      <div class="api-key-section">
        <div class="input-group">
          <label>YouTube Data API Key</label>
          <input type="password" id="youtube-api-key" placeholder="AIzaSy...">
        </div>
        <div class="input-group">
          <label>Gemini API Key</label>
          <input type="password" id="gemini-api-key" placeholder="AIzaSy...">
          </div>
      </div>
      <div class="api-key-section">
        <div class="input-group" style="margin-top: 16px; padding-top: 16px; border-top: 1px dashed #eee;">
           <div style="display: flex; justify-content: space-between; align-items: center;">
             <label style="margin: 0;">애드센스 URL 채널 동기화</label>
             <button id="sync-adsense-status-btn" class="cp-btn-secondary small">🔄 등록 상태 확인하기</button>
           </div>
           <p class="settings-desc" style="margin-top: 4px;">애드센스 관리자 페이지에 수동으로 등록된 URL 목록을 가져와 카드의 상태를 업데이트합니다.</p>
        </div>
      </div>
      <div class="my-channel-list-section">
        <div class="section-header">
          <h3>📺 내 채널 목록</h3>
          <button id="add-my-channel-btn" class="cp-btn-primary small">+ 채널 추가</button>
        </div>
        <div id="my-channel-list" class="channel-list">
        </div>
      </div>
      <div class="save-actions">
        <button id="save-all-channels-btn" class="cp-btn-primary full-width">설정 저장하기</button>
      </div>
    </div>
    
    <div id="channel-detail-modal" class="cp-modal-wrap" style="display: none;">
      <div class="cp-modal-backdrop"></div>
      <div class="cp-modal large">
        <div class="cp-modal-header">
          <div class="cp-modal-title">채널 상세 설정</div>
          <button class="cp-modal-close">×</button>
        </div>
        <div class="cp-modal-body">
          <div class="input-group">
            <label>블로그 URL <span class="required">*</span></label>
            <input type="text" id="modal-blog-url" placeholder="https://blog.naver.com/myid">
          </div>
          
          <div class="integration-section">
            <div class="section-header" style="margin-bottom: 12px;">
              <h4>📊 성과 추적 연동</h4>
              <button id="modal-google-login-btn" class="google-btn" style="padding: 8px 16px; font-size: 13px;">
                <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                  <g fill="#000" fill-rule="evenodd">
                    <path d="M17.64 9.2045c0-.6371-.0573-1.2516-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0772-1.7955 2.7164v2.2581h2.9087c1.7023-1.5668 2.6836-3.8741 2.6836-6.6149z" fill="#4285F4"/>
                    <path d="M9 18c2.4297 0 4.4673-.795 5.9564-2.1636l-2.9087-2.2581c-.8064.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.0364-3.7105H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853"/>
                    <path d="M3.9636 10.7273c-.18-.54-.2827-1.1168-.2827-1.7273s.1027-1.1873.2827-1.7273V4.9409H.9573C.3477 6.175.0009 7.5409.0009 9s.3468 2.825.9564 4.0591l3.0063-2.3318z" fill="#FBBC05"/>
                    <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5814-2.5814C13.4632.8918 11.4255 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9409L3.9636 7.2727C4.6718 5.1455 6.6559 3.5795 9 3.5795z" fill="#EA4335"/>
                  </g>
                </svg>
                Google 로그인
              </button>
            </div>
            <div id="google-auth-status" style="display: none; margin-bottom: 12px; padding: 8px; background: #e8f5e9; border-radius: 4px; font-size: 12px; color: #2e7d32;">
              <span id="google-auth-email"></span>
              <button id="modal-google-logout-btn" class="logout-btn" style="margin-left: 8px;">로그아웃</button>
            </div>
            <div class="input-group">
              <label>GA4 속성 ID (Property ID)</label>
              <select id="modal-ga-select" style="display: none; width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; margin-bottom: 8px;">
                <option value="">선택하세요</option>
              </select>
              <input type="text" id="modal-ga-id" placeholder="123456789 또는 Google 로그인으로 자동 입력">
            </div>
            <div class="input-group">
              <label>AdSense 게시자 ID</label>
              <input type="text" id="modal-adsense-id" placeholder="pub-0000000000000000 또는 Google 로그인으로 자동 입력">
            </div>
          </div>
          <div class="competitor-section">
            <div class="section-header">
              <h4>⚔️ 경쟁 채널 관리</h4>
              <button id="modal-add-competitor-btn" class="cp-btn-secondary small">+ 경쟁사 추가</button>
            </div>
            <div id="modal-competitor-list" class="competitor-list">
            </div>
          </div>
        </div>
        <div class="cp-modal-footer">
          <button class="cp-btn cp-btn-secondary" id="modal-cancel-btn">취소</button>
          <button class="cp-btn cp-btn-primary" id="modal-apply-btn">적용</button>
        </div>
      </div>
    </div>
  `;

  // 스타일 주입 (필요시 css 파일로 이동)
  const style = document.createElement('style');
  style.textContent = `
    .channel-settings-container { padding: 20px; max-width: 800px; margin: 0 auto; }
    .settings-header { margin-bottom: 24px; border-bottom: 1px solid #eee; padding-bottom: 16px; }
    .settings-header h2 { margin: 0 0 8px 0; font-size: 20px; }
    .settings-desc { margin: 0; color: #666; font-size: 13px; }
    .input-group { margin-bottom: 16px; }
    .input-group label { display: block; font-weight: 500; margin-bottom: 6px; font-size: 13px; color: #333; }
    .input-group input { width: 100%; padding: 8px 12px; border: 1px solid #ddd; border-radius: 6px; font-size: 14px; box-sizing: border-box; }
    
    .my-channel-list-section { margin-top: 32px; }
    .section-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .section-header h3 { margin: 0; font-size: 16px; }
    .channel-list { display: grid; gap: 12px; }
    
    .my-channel-card { 
      border: 1px solid #e0e0e0; border-radius: 8px; padding: 16px; background: #fff; 
      display: flex; justify-content: space-between; align-items: center;
      transition: box-shadow 0.2s;
    }
    .my-channel-card:hover { box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .channel-info-main { font-weight: 600; font-size: 15px; margin-bottom: 4px; }
    .channel-info-sub { font-size: 12px; color: #666; }
    
    .cp-btn-primary.small { padding: 6px 12px; font-size: 12px; }
    .cp-btn-secondary.small { padding: 4px 10px; font-size: 12px; }
    .action-btn { padding: 6px 12px; border: 1px solid #ddd; background: #fff; border-radius: 4px; cursor: pointer; font-size: 13px; margin-left: 8px; }
    .action-btn:hover { background: #f5f5f5; }
    .action-btn.delete { color: #d32f2f; border-color: #ffcdd2; }
    .action-btn.delete:hover { background: #ffebee; }
    
    .integration-section { background: #f8f9fa; padding: 16px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #e9ecef; }
    .integration-section h4 { margin: 0 0 12px 0; font-size: 14px; color: #444; }
    
    .competitor-section { margin-top: 20px; }
    .competitor-item { display: flex; gap: 8px; margin-bottom: 8px; align-items: center; }
    .competitor-item input { flex: 1; }
    .competitor-delete-btn { padding: 8px; color: #999; cursor: pointer; background: none; border: none; font-size: 18px; }
    .competitor-delete-btn:hover { color: #d32f2f; }
    
    /* 채널 상세 설정 모달 좌우 여백 추가 */
    #channel-detail-modal .cp-modal-body {
      padding: 24px;
    }
    #channel-detail-modal .cp-modal {
      max-width: min(90vw, 700px);
      margin: 0 auto;
    }
  `;
  container.appendChild(style);

  let myChannelsData = []; // 로컬 상태 관리

  // 데이터 로드
  chrome.runtime.sendMessage({ action: "get_channels_and_key" }, (response) => {
    if (response && response.success) {
      const youtubeApiKeyEl = container.querySelector("#youtube-api-key");
      const geminiApiKeyEl = container.querySelector("#gemini-api-key");
      if (youtubeApiKeyEl) youtubeApiKeyEl.value = response.data.youtubeApiKey || "";
      if (geminiApiKeyEl) geminiApiKeyEl.value = response.data.geminiApiKey || "";
      
      // 데이터 구조가 변경되었으므로 response.data.myChannels.blogs 사용
      // 각 블로그 객체에는 { inputUrl, gaPropertyId, adSenseAccountId, competitors: [] } 가 포함됨
      myChannelsData = (response.data.myChannels?.blogs || []).map(blog => ({
        url: blog.inputUrl || blog.url,
        gaPropertyId: blog.gaPropertyId || "",
        adSenseAccountId: blog.adSenseAccountId || "",
        competitors: (blog.competitors || []).map(c => c.inputUrl || c)
      }));
      
      renderMyChannels();
    }
  });

  // 내 채널 목록 렌더링
  function renderMyChannels() {
    const listEl = container.querySelector("#my-channel-list");
    if (!listEl) return;
    listEl.innerHTML = "";
    
    myChannelsData.forEach((channel, index) => {
      const card = document.createElement("div");
      card.className = "my-channel-card";
      card.innerHTML = `
        <div class="channel-info">
          <div class="channel-info-main">${channel.url}</div>
          <div class="channel-info-sub">
            경쟁사: ${channel.competitors.length}개 | GA4: ${channel.gaPropertyId ? '✅' : '❌'} | AdSense: ${channel.adSenseAccountId ? '✅' : '❌'}
          </div>
        </div>
        <div class="channel-actions">
          <button class="action-btn edit-btn">⚙️ 관리</button>
          <button class="action-btn delete delete-btn">삭제</button>
        </div>
      `;
      
      // 수정 버튼
      card.querySelector(".edit-btn").addEventListener("click", () => openDetailModal(index));
      
      // 삭제 버튼
      card.querySelector(".delete-btn").addEventListener("click", () => {
        if (confirm("이 채널을 삭제하시겠습니까?")) {
          myChannelsData.splice(index, 1);
          renderMyChannels();
        }
      });
      
      listEl.appendChild(card);
    });
    if (myChannelsData.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 30px; color: #888; border: 1px dashed #ddd; border-radius: 8px;">등록된 채널이 없습니다.<br>'+ 채널 추가' 버튼을 눌러 시작하세요.</div>`;
    }
  }

  // 모달 관련 변수
  const modal = container.querySelector("#channel-detail-modal");
  let currentEditingIndex = -1;
  let gaPropertiesList = []; // GA4 속성 목록

  // GA4 드롭다운 업데이트 (공통 함수)
  function updateGa4Dropdown(selectedId = "") {
    const gaSelectEl = container.querySelector("#modal-ga-select");
    const gaIdEl = container.querySelector("#modal-ga-id");
    
    if (gaSelectEl && gaPropertiesList.length > 0) {
      gaSelectEl.innerHTML = '<option value="">선택하세요</option>';
      gaPropertiesList.forEach(prop => {
        const option = document.createElement("option");
        option.value = prop.id;
        option.textContent = `${prop.name} (${prop.id})`;
        if (prop.id === selectedId) option.selected = true;
        gaSelectEl.appendChild(option);
      });
      gaSelectEl.style.display = "block";
      if (gaIdEl) gaIdEl.style.display = "none";
    } else {
      if (gaSelectEl) gaSelectEl.style.display = "none";
      if (gaIdEl) gaIdEl.style.display = "block";
    }
  }

  // 상세 모달 열기
  function openDetailModal(index) {
    console.log("[ChannelMode] openDetailModal 호출:", index);
    console.log("[ChannelMode] 모달 요소 (외부 변수):", modal);
    
    // 모달 요소를 다시 찾기 (container가 업데이트되었을 수 있음)
    const currentModal = container.querySelector("#channel-detail-modal");
    console.log("[ChannelMode] 모달 요소 (재검색):", currentModal);
    
    const targetModal = currentModal || modal;
    
    if (!targetModal) {
      console.error("[ChannelMode] 모달 요소를 찾을 수 없습니다!", {
        container: container,
        containerHTML: container.innerHTML.substring(0, 500)
      });
      return;
    }
    
    currentEditingIndex = index;
    const isNew = index === -1;
    const data = isNew ? { url: "", gaPropertyId: "", adSenseAccountId: "", competitors: [] } : myChannelsData[index];
    
    const modalTitle = container.querySelector(".cp-modal-title");
    if (modalTitle) modalTitle.textContent = isNew ? "새 채널 추가" : "채널 상세 설정";
    const blogUrlEl = container.querySelector("#modal-blog-url");
    const gaIdEl = container.querySelector("#modal-ga-id");
    const adsenseIdEl = container.querySelector("#modal-adsense-id");
    if (blogUrlEl) blogUrlEl.value = data.url;
    if (gaIdEl) gaIdEl.value = data.gaPropertyId;
    if (adsenseIdEl) adsenseIdEl.value = data.adSenseAccountId;
    
    // Google 로그인 상태 확인 (GA4 목록도 함께 로드)
    checkGoogleAuthStatus();
    
    // GA4 드롭다운 업데이트
    updateGa4Dropdown(data.gaPropertyId);
    
    // 경쟁사 리스트 렌더링
    const compListEl = container.querySelector("#modal-competitor-list");
    if (compListEl) {
      compListEl.innerHTML = "";
      data.competitors.forEach(url => addCompetitorInput(url));
      // 빈 입력칸 하나 추가 (UX)
      if (data.competitors.length === 0) addCompetitorInput("");
    }
    
    console.log("[ChannelMode] 모달 표시 전:", targetModal.style.display);
    targetModal.style.display = "flex";
    console.log("[ChannelMode] 모달 표시 후:", targetModal.style.display, "모달 요소:", targetModal);
  }

  // Google 로그인 상태 확인
  function checkGoogleAuthStatus() {
    chrome.storage.local.get(["googleUserEmail", "gaProperties", "adSenseAccountId"], (result) => {
      const authStatusEl = container.querySelector("#google-auth-status");
      const authEmailEl = container.querySelector("#google-auth-email");
      const loginBtn = container.querySelector("#modal-google-login-btn");
      
      if (result.googleUserEmail) {
        if (authStatusEl) authStatusEl.style.display = "block";
        if (authEmailEl) authEmailEl.textContent = `✅ ${result.googleUserEmail}`;
        if (loginBtn) loginBtn.style.display = "none";
        
        // GA4 속성 목록 저장
        if (result.gaProperties && Array.isArray(result.gaProperties)) {
          gaPropertiesList = result.gaProperties;
        }
        
        // AdSense 계정 ID 자동 입력 (모달이 열려있을 때만)
        if (result.adSenseAccountId && modal && modal.style.display !== "none") {
          const adsenseIdEl = container.querySelector("#modal-adsense-id");
          if (adsenseIdEl && !adsenseIdEl.value) {
            adsenseIdEl.value = result.adSenseAccountId;
          }
        }
      } else {
        if (authStatusEl) authStatusEl.style.display = "none";
        if (loginBtn) loginBtn.style.display = "inline-flex";
      }
    });
  }

  // 경쟁사 입력칸 추가
  function addCompetitorInput(value = "") {
    const listEl = container.querySelector("#modal-competitor-list");
    if (!listEl) return;
    const div = document.createElement("div");
    div.className = "competitor-item";
    div.innerHTML = `
      <input type="text" class="competitor-input" value="${value}" placeholder="경쟁사 블로그 URL">
      <button class="competitor-delete-btn" title="삭제">×</button>
    `;
    div.querySelector(".competitor-delete-btn").addEventListener("click", () => div.remove());
    listEl.appendChild(div);
  }

  // 이벤트 리스너
  const addChannelBtn = container.querySelector("#add-my-channel-btn");
  console.log("[ChannelMode] 채널 추가 버튼 찾기:", addChannelBtn);
  if (addChannelBtn) {
    addChannelBtn.addEventListener("click", () => {
      console.log("[ChannelMode] 채널 추가 버튼 클릭됨");
      const modal = container.querySelector("#channel-detail-modal");
      console.log("[ChannelMode] 모달 요소 찾기:", modal);
      openDetailModal(-1);
    });
  } else {
    console.error("[ChannelMode] 채널 추가 버튼을 찾을 수 없습니다!");
  }
  
  const addCompetitorBtn = container.querySelector("#modal-add-competitor-btn");
  if (addCompetitorBtn) {
    addCompetitorBtn.addEventListener("click", () => addCompetitorInput(""));
  }
  
  const modalCloseBtn = container.querySelector(".cp-modal-close");
  if (modalCloseBtn) {
    modalCloseBtn.addEventListener("click", () => {
      if (modal) modal.style.display = "none";
    });
  }
  
  const modalCancelBtn = container.querySelector("#modal-cancel-btn");
  if (modalCancelBtn) {
    modalCancelBtn.addEventListener("click", () => {
      if (modal) modal.style.display = "none";
    });
  }

  // Google 로그인 버튼
  const googleLoginBtn = container.querySelector("#modal-google-login-btn");
  if (googleLoginBtn) {
    googleLoginBtn.addEventListener("click", () => {
      googleLoginBtn.disabled = true;
      googleLoginBtn.textContent = "로그인 중...";
      
      chrome.runtime.sendMessage({ action: "start_google_auth" }, (response) => {
        googleLoginBtn.disabled = false;
        googleLoginBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
            <g fill="#000" fill-rule="evenodd">
              <path d="M17.64 9.2045c0-.6371-.0573-1.2516-.1636-1.8409H9v3.4814h4.8436c-.2086 1.125-.8427 2.0772-1.7955 2.7164v2.2581h2.9087c1.7023-1.5668 2.6836-3.8741 2.6836-6.6149z" fill="#4285F4"/>
              <path d="M9 18c2.4297 0 4.4673-.795 5.9564-2.1636l-2.9087-2.2581c-.8064.54-1.8368.8591-3.0477.8591-2.3441 0-4.3282-1.5832-5.0364-3.7105H.9573v2.3318C2.4382 15.9832 5.4818 18 9 18z" fill="#34A853"/>
              <path d="M3.9636 10.7273c-.18-.54-.2827-1.1168-.2827-1.7273s.1027-1.1873.2827-1.7273V4.9409L.9573 4.9409C.3477 6.175.0009 7.5409.0009 9s.3468 2.825.9564 4.0591l3.0063-2.3318z" fill="#FBBC05"/>
              <path d="M9 3.5795c1.3214 0 2.5077.4541 3.4405 1.3459l2.5814-2.5814C13.4632.8918 11.4255 0 9 0 5.4818 0 2.4382 2.0168.9573 4.9409L3.9636 7.2727C4.6718 5.1455 6.6559 3.5795 9 3.5795z" fill="#EA4335"/>
            </g>
          </svg>
          Google 로그인
        `;
        
        if (response && response.success) {
          // GA4 속성 목록 저장
          if (response.data.gaProperties) {
            gaPropertiesList = response.data.gaProperties;
            updateGa4Dropdown();
          }
          
          // AdSense 계정 ID 자동 입력
          if (response.data.adSenseAccountId) {
            const adsenseIdEl = container.querySelector("#modal-adsense-id");
            if (adsenseIdEl && !adsenseIdEl.value) {
              adsenseIdEl.value = response.data.adSenseAccountId;
            }
          }
          
          // 로그인 상태 UI 업데이트
          checkGoogleAuthStatus();
          
          alert("✅ Google 계정 연동이 완료되었습니다!");
        } else {
          alert("❌ Google 로그인 실패: " + (response?.error || "알 수 없는 오류"));
        }
      });
    });
  }

  // Google 로그아웃 버튼
  const googleLogoutBtn = container.querySelector("#modal-google-logout-btn");
  if (googleLogoutBtn) {
    googleLogoutBtn.addEventListener("click", () => {
      if (confirm("Google 계정 연동을 해제하시겠습니까?")) {
        chrome.runtime.sendMessage({ action: "revoke_google_auth" }, (response) => {
          if (response && response.success) {
            gaPropertiesList = [];
            checkGoogleAuthStatus();
            
            // GA4 드롭다운 숨기기
            const gaSelectEl = container.querySelector("#modal-ga-select");
            const gaIdEl = container.querySelector("#modal-ga-id");
            if (gaSelectEl) gaSelectEl.style.display = "none";
            if (gaIdEl) {
              gaIdEl.style.display = "block";
              gaIdEl.value = "";
            }
            
            // AdSense ID 초기화
            const adsenseIdEl = container.querySelector("#modal-adsense-id");
            if (adsenseIdEl) adsenseIdEl.value = "";
            
            alert("✅ Google 계정 연동이 해제되었습니다.");
          }
        });
      }
    });
  }

  // GA4 드롭다운 변경 시 입력 필드에 값 복사
  const gaSelectEl = container.querySelector("#modal-ga-select");
  if (gaSelectEl) {
    gaSelectEl.addEventListener("change", (e) => {
      const gaIdEl = container.querySelector("#modal-ga-id");
      if (gaIdEl) gaIdEl.value = e.target.value;
    });
  }
  
  // 모달 적용 버튼 (임시 저장)
  const modalApplyBtn = container.querySelector("#modal-apply-btn");
  if (modalApplyBtn) {
    modalApplyBtn.addEventListener("click", () => {
      const blogUrlEl = container.querySelector("#modal-blog-url");
      const gaIdEl = container.querySelector("#modal-ga-id");
      const adsenseIdEl = container.querySelector("#modal-adsense-id");
      
      if (!blogUrlEl) return;
      const url = blogUrlEl.value.trim();
      if (!url) {
        showToast("❌ 블로그 URL은 필수입니다.");
        blogUrlEl.focus();
        return;
      }
      
      // [체크리스트 4-3] URL 유효성 검사
      try {
        const urlObj = new URL(url);
        if (!urlObj.protocol.startsWith('http')) {
          showToast("❌ URL은 http:// 또는 https://로 시작해야 합니다.");
          blogUrlEl.focus();
          return;
        }
      } catch (e) {
        showToast("❌ 유효한 URL 형식이 아닙니다. (예: https://blog.naver.com/myid)");
        blogUrlEl.focus();
        return;
      }
      
      // GA4 ID는 드롭다운 또는 입력 필드에서 가져오기
      const gaSelectEl = container.querySelector("#modal-ga-select");
      const gaId = gaSelectEl && gaSelectEl.style.display !== "none" 
        ? gaSelectEl.value.trim() 
        : (gaIdEl ? gaIdEl.value.trim() : "");
      // [체크리스트 5] AdSense ID 저장 시 공백 제거 및 pub- 접두사 검증
      let adsenseId = adsenseIdEl ? adsenseIdEl.value.trim() : "";
      if (adsenseId && !adsenseId.startsWith('pub-')) {
        // pub- 접두사가 없으면 자동 추가 (사용자가 숫자만 입력한 경우 대비)
        if (/^\d+$/.test(adsenseId)) {
          adsenseId = `pub-${adsenseId}`;
        }
      }
      
      // 경쟁사 목록 수집
      const competitorInputs = container.querySelectorAll(".competitor-input");
      const competitors = Array.from(competitorInputs)
        .map(input => input.value.trim())
        .filter(val => val !== ""); // 빈 값 제거
      
      const newData = {
        url: url,
        gaPropertyId: gaId,
        adSenseAccountId: adsenseId,
        competitors: competitors
      };
      
      if (currentEditingIndex === -1) {
        myChannelsData.push(newData);
      } else {
        myChannelsData[currentEditingIndex] = newData;
      }
      
      renderMyChannels();
      if (modal) modal.style.display = "none";
    });
  }

  // 최종 저장 버튼 (서버 전송)
  const saveAllBtn = container.querySelector("#save-all-channels-btn");
  if (saveAllBtn) {
    saveAllBtn.addEventListener("click", () => {
      const youtubeApiKeyEl = container.querySelector("#youtube-api-key");
      const geminiApiKeyEl = container.querySelector("#gemini-api-key");
      const youtubeApiKey = youtubeApiKeyEl ? youtubeApiKeyEl.value.trim() : "";
      const geminiApiKey = geminiApiKeyEl ? geminiApiKeyEl.value.trim() : "";
      const payload = {
        youtubeApiKey,
        geminiApiKey,
        myChannels: { blogs: myChannelsData } // 변경된 데이터 구조에 맞게 전송
      };
      // [체크리스트 4-3 최적화] 저장 중 로딩 표시
      saveAllBtn.disabled = true;
      const originalText = saveAllBtn.textContent;
      saveAllBtn.textContent = "저장 중...";
      
      chrome.runtime.sendMessage({
        action: "save_channels_and_key",
        data: payload
      }, (response) => {
        saveAllBtn.disabled = false;
        saveAllBtn.textContent = originalText;
        
        if (response && response.success) {
          // [체크리스트 4-3] 저장 성공 피드백
          showToast("✅ 채널 설정이 저장되었습니다.");
          
          // [체크리스트 4-2] 실시간 동기화: 헤더의 채널 선택기 갱신
          const shadowRoot = container.closest("#content-pilot-host")?.shadowRoot || document.querySelector("#content-pilot-host")?.shadowRoot;
          if (shadowRoot) {
            import("./header.js").then(module => {
              module.addHeaderEventListeners(shadowRoot);
            });
          }
          
          // [체크리스트 3-🆎] 첫 채널 생성 후 자동 선택 및 대시보드 이동
          chrome.runtime.sendMessage({ action: "get_channels_and_key" }, (channelResponse) => {
            const myBlogs = channelResponse?.data?.myChannels?.blogs || [];
            const currentActiveChannelId = chrome.storage.local.get("activeChannelId", (res) => {
              const activeChannelId = res.activeChannelId;
              
              // 활성 채널이 없고, 채널이 1개 이상 있으면 첫 번째 채널 자동 선택
              if (!activeChannelId && myBlogs.length > 0) {
                const firstChannel = myBlogs[0];
                const firstChannelId = firstChannel.id || (firstChannel.apiUrl ? btoa(firstChannel.apiUrl).replace(/=/g, "") : "");
                
                if (firstChannelId) {
                  chrome.storage.local.set({ activeChannelId: firstChannelId }, () => {
                    // [체크리스트 3-🆎] 대시보드로 화면 전환
                    const shadowRoot = container.closest("#content-pilot-host")?.shadowRoot || document.querySelector("#content-pilot-host")?.shadowRoot;
                    if (shadowRoot) {
                      const mainArea = shadowRoot.querySelector("#cp-main-area");
                      const dashboardTab = shadowRoot.querySelector('[data-key="dashboard"]');
                      
                      if (mainArea && dashboardTab) {
                        // 대시보드 탭 활성화
                        shadowRoot.querySelectorAll(".cp-mode-tab").forEach(tab => tab.classList.remove("active"));
                        dashboardTab.classList.add("active");
                        
                        // 대시보드 렌더링
                        import("./dashboardMode.js").then(module => {
                          module.renderDashboard(mainArea);
                          module.addDashboardEventListeners(mainArea);
                        });
                        
                        // 헤더 이벤트 리스너 초기화
                        import("./header.js").then(module => {
                          module.addHeaderEventListeners(shadowRoot);
                        });
                        
                        showToast("✅ 첫 번째 채널이 선택되었습니다. 대시보드로 이동합니다.");
                      }
                    }
                  });
                }
              }
            });
          });
        } else {
          alert("❌ 저장 실패: " + (response?.error || "알 수 없는 오류"));
        }
      });
    });
  }

  // [추가] 애드센스 동기화 버튼 이벤트
  const syncBtn = container.querySelector("#sync-adsense-status-btn");
  if (syncBtn) {
    syncBtn.addEventListener("click", () => {
      syncBtn.disabled = true;
      syncBtn.textContent = "확인 중...";
      
      chrome.runtime.sendMessage({ action: "check_adsense_registration" }, (response) => {
        syncBtn.disabled = false;
        syncBtn.textContent = "🔄 등록 상태 확인하기";
        
        if (response && response.success) {
          const { totalRegistered, updatedCards, matchedCards, alreadyRegistered, notMatched } = response.data;
          
          // [팝업 메시지 개선] 더 명확한 메시지 표시
          let message = `✅ 확인 완료!\n\n`;
          message += `📋 수집된 등록 URL: ${totalRegistered}개\n`;
          message += `✅ 매칭된 카드: ${matchedCards || 0}개\n`;
          
          if (updatedCards > 0) {
            message += `🔄 업데이트된 카드: ${updatedCards}개\n`;
          } else if (matchedCards > 0 && alreadyRegistered === matchedCards) {
            message += `✅ 이미 등록된 카드: ${alreadyRegistered}개\n`;
            message += `\n💡 모든 카드가 이미 올바르게 등록되어 있어 추가 업데이트가 필요 없습니다.`;
          } else if (matchedCards === 0) {
            message += `⚠️ 매칭된 카드가 없습니다.\n`;
            message += `\n💡 발행된 콘텐츠의 URL이 AdSense에 등록되어 있는지 확인하세요.`;
          } else {
            message += `ℹ️ 업데이트된 카드: 0개\n`;
          }
          
          if (notMatched > 0) {
            message += `\n⚠️ 매칭 실패한 카드: ${notMatched}개`;
          }
          
          alert(message);
          // 대시보드나 칸반 데이터 갱신이 필요하면 여기서 트리거
        } else {
          alert("❌ 확인 실패: " + (response?.error || "알 수 없는 오류"));
        }
      });
    });
  }
}
