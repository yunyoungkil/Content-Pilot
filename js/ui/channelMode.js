// js/ui/channelMode.js (채널 중심 아키텍처 적용 버전)

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
            <h4>📊 성과 추적 연동</h4>
            <div class="input-group">
              <label>GA4 속성 ID (Property ID)</label>
              <input type="text" id="modal-ga-id" placeholder="123456789">
            </div>
            <div class="input-group">
              <label>AdSense 게시자 ID</label>
              <input type="text" id="modal-adsense-id" placeholder="pub-0000000000000000">
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
  `;
  container.appendChild(style);

  let myChannelsData = []; // 로컬 상태 관리

  // 데이터 로드
  chrome.runtime.sendMessage({ action: "get_channels_and_key" }, (response) => {
    if (response && response.success) {
      document.getElementById("youtube-api-key").value = response.data.youtubeApiKey || "";
      document.getElementById("gemini-api-key").value = response.data.geminiApiKey || "";
      
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
    const listEl = document.getElementById("my-channel-list");
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
  const modal = document.getElementById("channel-detail-modal");
  let currentEditingIndex = -1;

  // 상세 모달 열기
  function openDetailModal(index) {
    currentEditingIndex = index;
    const isNew = index === -1;
    const data = isNew ? { url: "", gaPropertyId: "", adSenseAccountId: "", competitors: [] } : myChannelsData[index];
    
    document.querySelector(".cp-modal-title").textContent = isNew ? "새 채널 추가" : "채널 상세 설정";
    document.getElementById("modal-blog-url").value = data.url;
    document.getElementById("modal-ga-id").value = data.gaPropertyId;
    document.getElementById("modal-adsense-id").value = data.adSenseAccountId;
    
    // 경쟁사 리스트 렌더링
    const compListEl = document.getElementById("modal-competitor-list");
    compListEl.innerHTML = "";
    data.competitors.forEach(url => addCompetitorInput(url));
    // 빈 입력칸 하나 추가 (UX)
    if (data.competitors.length === 0) addCompetitorInput("");
    modal.style.display = "flex";
  }

  // 경쟁사 입력칸 추가
  function addCompetitorInput(value = "") {
    const listEl = document.getElementById("modal-competitor-list");
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
  document.getElementById("add-my-channel-btn").addEventListener("click", () => openDetailModal(-1));
  document.getElementById("modal-add-competitor-btn").addEventListener("click", () => addCompetitorInput(""));
  
  document.querySelector(".cp-modal-close").addEventListener("click", () => modal.style.display = "none");
  document.getElementById("modal-cancel-btn").addEventListener("click", () => modal.style.display = "none");
  
  // 모달 적용 버튼 (임시 저장)
  document.getElementById("modal-apply-btn").addEventListener("click", () => {
    const url = document.getElementById("modal-blog-url").value.trim();
    if (!url) return alert("블로그 URL은 필수입니다.");
    const gaId = document.getElementById("modal-ga-id").value.trim();
    const adsenseId = document.getElementById("modal-adsense-id").value.trim();
    
    // 경쟁사 목록 수집
    const competitorInputs = document.querySelectorAll(".competitor-input");
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
    modal.style.display = "none";
  });

  // 최종 저장 버튼 (서버 전송)
  document.getElementById("save-all-channels-btn").addEventListener("click", () => {
    const youtubeApiKey = document.getElementById("youtube-api-key").value.trim();
    const geminiApiKey = document.getElementById("gemini-api-key").value.trim();
    const payload = {
      youtubeApiKey,
      geminiApiKey,
      myChannels: { blogs: myChannelsData } // 변경된 데이터 구조에 맞게 전송
    };
    chrome.runtime.sendMessage({
      action: "save_channels_and_key",
      data: payload
    }, (response) => {
      if (response && response.success) {
        alert("✅ 모든 설정이 저장되었습니다.");
      } else {
        alert("❌ 저장 실패: " + (response?.error || "알 수 없는 오류"));
      }
    });
  });
}
