// js/ui/preview.js

import { shortenLink } from "../utils.js";

// 최근 스크랩 미리보기 카드를 화면에 보여주는 함수
export function showRecentScrapPreview(scrapData) {
  const container = document.getElementById("cp-dock-container");
  // 컨테이너가 없으면 아무것도 하지 않음
  if (!container) return;

  // 이전에 있던 미리보기 카드는 삭제
  const oldCard = document.getElementById('cp-recent-scrap-preview');
  if (oldCard) oldCard.remove();

  const card = document.createElement('div');
  card.id = 'cp-recent-scrap-preview';

  // 애니메이션을 위해 width와 opacity를 사용 (transform 대신)
  card.style.cssText = `
    height: 72px;
    width: 0px; /* 처음엔 너비 0 */
    opacity: 0; /* 처음엔 투명 */
    background: #fff;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    border: 1px solid rgba(0,0,0,0.1);
    border-left: none;
    border-radius: 0 12px 12px 0;
    display: flex;
    align-items: center;
    padding: 0 16px;
    overflow: hidden; /* 내용이 삐져나오지 않도록 */
    white-space: nowrap; /* 내용이 한 줄로 표시되도록 */
    transition: all 0.5s cubic-bezier(0.16, 1, 0.3, 1);
    z-index: 1; /* 버튼보다 아래에 있도록 */
  `;

// 1. 이미지 부분을 별도의 변수로 분리
const imageElement = scrapData.image 
  ? // 이미지가 있을 경우: <img> 태그
    `<img src="${scrapData.image}" style="width: 48px; height: 48px; border-radius: 8px; margin-right: 12px; object-fit: cover; border: 1px solid #eee;" referrerpolicy="no-referrer">`
  : // 이미지가 없을 경우: 아이콘을 담은 <div> 태그
    `<div style="width: 48px; height: 48px; border-radius: 8px; margin-right: 12px; display: flex; align-items: center; justify-content: center; background-color: #f1f3f5;">
      <span style="font-size: 24px; filter: grayscale(1);">📝</span>
    </div>`;

// 2. 최종 HTML 조합
card.innerHTML = `
  ${imageElement}
  <div style="display: flex; flex-direction: column; overflow: hidden;">
    <div style="font-weight: 600; font-size: 15px; color: #111; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${scrapData.text ? scrapData.text.substring(0, 30) : '제목 없음'}</div>
    <div style="font-size: 13px; color: #777; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${new URL(scrapData.url).hostname}</div>
  </div>
`;

  // 컨테이너에 카드를 추가
  container.appendChild(card);

  // 나타나는 애니메이션 (너비와 투명도 변경)
  setTimeout(() => {
    card.style.width = '300px';
    card.style.opacity = '1';
  }, 50);

  // 3초 후에 사라지는 애니메이션
  setTimeout(() => {
    card.style.width = '0px';
    card.style.opacity = '0';
    setTimeout(() => card.remove(), 500);
  }, 3000);
}

// 토스트 메시지를 보여주는 함수
export function showToast(msg) {
  let toast = document.getElementById("cp-toast-modal");
  if (toast) toast.remove();
  
  toast = document.createElement("div");
  toast.id = "cp-toast-modal";
  toast.textContent = msg;
  toast.style.cssText = `
    position: fixed; left: 50%; top: 60px; transform: translateX(-50%);
    background: rgba(34,34,34,0.97); color: #fff; font-size: 15px; font-weight: 600;
    padding: 13px 32px; border-radius: 10px; box-shadow: 0 2px 12px rgba(0,0,0,0.13);
    z-index: 2147483647; opacity: 0; transition: opacity 0.3s;
  `;
  document.body.appendChild(toast);

  setTimeout(() => { toast.style.opacity = "1"; }, 10);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => { toast.remove(); }, 350);
  }, 1500);
}