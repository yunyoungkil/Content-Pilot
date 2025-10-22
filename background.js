// background.js (수정 완료된 최종 버전)

console.debug("[DEBUG] background.js 로드됨 - 시작");

// ...existing code...
let isKanbanListenerActive = false;

/**
 * 객체 내의 모든 undefined 값을 재귀적으로 null로 변환하는 함수.
 * Firebase에 저장하기 전 데이터를 정제하는 데 사용됩니다.
 */
function cleanDataForFirebase(data) {
  if (data === undefined) return null;
  if (data === null || typeof data !== "object") return data;
  if (Array.isArray(data))
    return data.map((item) => cleanDataForFirebase(item));

  const cleanedObj = {};
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      const value = data[key];
      if (value !== undefined) {
        cleanedObj[key] = cleanDataForFirebase(value);
      }
    }
  }
  return cleanedObj;
}

/**
 * Blob 객체를 Base64 문자열로 변환하는 헬퍼 함수 (PRD v2.2)
 * 웹 이미지 URL을 다운로드하여 Gemini Vision API로 전송할 때 사용됩니다.
 * @param {Blob} blob - 변환할 Blob 객체
 * @returns {Promise<string>} Base64 데이터 URI (예: "data:image/jpeg;base64,/9j/4AAQ...")
 */
function convertBlobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      resolve(reader.result);
    };
    reader.readAsDataURL(blob);
  });
}

/**
 * FR-V-Validate (PRD v2.5): AI가 반환한 템플릿 데이터를 검증하는 함수
 * Firebase 저장 전에 필수 필드와 데이터 타입을 확인하여 불완전한 데이터를 차단합니다.
 * @param {Object} data - AI가 반환한 템플릿 JSON 객체
 * @throws {Error} 검증 실패 시 구체적인 에러 메시지와 함께 예외 발생
 */
function validateTemplateData(data) {
  if (!data) {
    throw new Error("AI가 유효한 데이터를 반환하지 않았습니다.");
  }

  // PRD v2.4 반응형 스키마 기준 필수 필드 검증 (유연하게)
  if (!data.name || typeof data.name !== "string") {
    data.name = "새 템플릿"; // 기본값 제공
    console.warn("[Validate] name 필드가 없어 기본값 '새 템플릿' 할당");
  }

  // background는 선택적으로 만들기
  if (!data.background || typeof data.background !== "object") {
    data.background = { type: "solid", value: "#FFFFFF" }; // 기본 흰색 배경
    console.warn("[Validate] background 필드가 없어 기본값 할당");
  }

  if (!Array.isArray(data.layers) || data.layers.length === 0) {
    throw new Error(
      "필수 필드 'layers'가 비어있거나 배열이 아닙니다. 최소 1개 이상의 레이어가 필요합니다."
    );
  }

  // 플레이스홀더 레이어 검증 (고충실도 복제 지원, 유연하게)
  const sloganLayer = data.layers.find(
    (l) =>
      l.type === "text" &&
      (l.text === "{{SLOGAN}}" ||
        (typeof l.text === "string" && l.text.length > 0))
  );

  // [복잡한 이미지용] 텍스트 레이어가 없으면 기본 텍스트 추가
  if (!sloganLayer) {
    console.warn("[Validate] 텍스트 레이어가 없어 기본 텍스트 레이어 추가");
    data.layers.push({
      type: "text",
      text: "제목",
      x: 0.5,
      y: 0.8,
      styles: {
        fontRatio: 0.05,
        fill: "#000000",
        align: "center",
      },
    });
  }

  // PRD v3.2: 타입별 상대 좌표 검증 (0.0 ~ 1.0 범위)
  for (let i = 0; i < data.layers.length; i++) {
    const layer = data.layers[i];

    // 공통 검증: 타입 필수
    if (
      !layer.type ||
      !["text", "shape", "svg", "image"].includes(layer.type)
    ) {
      throw new Error(
        `레이어 ${i}: type 필드가 누락되었거나 유효하지 않은 값입니다. (허용: text, shape, svg, image)`
      );
    }

    // 공통 검증: 좌표 범위 (강화된 검증)
    if (typeof layer.x !== "number" || isNaN(layer.x)) {
      throw new Error(
        `레이어 ${i}: x 좌표가 유효한 숫자가 아닙니다. (현재: ${layer.x})`
      );
    }
    if (typeof layer.y !== "number" || isNaN(layer.y)) {
      throw new Error(
        `레이어 ${i}: y 좌표가 유효한 숫자가 아닙니다. (현재: ${layer.y})`
      );
    }

    // 범위 검증 (자동 클리핑 대신 엄격 검증)
    if (layer.x < 0 || layer.x > 1) {
      throw new Error(
        `레이어 ${i}: x 좌표는 0.0~1.0 사이의 비율 값이어야 합니다. (현재: ${layer.x})`
      );
    }
    if (layer.y < 0 || layer.y > 1) {
      throw new Error(
        `레이어 ${i}: y 좌표는 0.0~1.0 사이의 비율 값이어야 합니다. (현재: ${layer.y})`
      );
    }

    // 타입별 검증
    if (layer.type === "text") {
      if (!layer.styles || typeof layer.styles !== "object") {
        throw new Error(`레이어 ${i}: styles 객체가 필요합니다.`);
      }

      if (typeof layer.styles.fontRatio !== "number") {
        throw new Error(`레이어 ${i}: styles.fontRatio가 숫자가 아닙니다.`);
      }

      if (layer.styles.fontRatio <= 0 || layer.styles.fontRatio > 1) {
        throw new Error(
          `레이어 ${i}: fontRatio는 0.0~1.0 사이의 비율 값이어야 합니다. (현재: ${layer.styles.fontRatio})`
        );
      }
    } else if (layer.type === "svg") {
      // SVG 레이어 검증 (pathData는 선택적, widthRatio/heightRatio 필수)
      if (layer.widthRatio && (layer.widthRatio <= 0 || layer.widthRatio > 1)) {
        throw new Error(
          `레이어 ${i}: widthRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`
        );
      }
      if (
        layer.heightRatio &&
        (layer.heightRatio <= 0 || layer.heightRatio > 1)
      ) {
        throw new Error(
          `레이어 ${i}: heightRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`
        );
      }
    } else if (layer.type === "shape") {
      // Shape 레이어 검증 (widthRatio/heightRatio 필수, styles는 선택적)
      if (!layer.widthRatio || !layer.heightRatio) {
        throw new Error(
          `레이어 ${i}: shape 타입은 widthRatio와 heightRatio가 필수입니다.`
        );
      }
      if (
        layer.widthRatio <= 0 ||
        layer.widthRatio > 1 ||
        layer.heightRatio <= 0 ||
        layer.heightRatio > 1
      ) {
        throw new Error(
          `레이어 ${i}: widthRatio, heightRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`
        );
      }
      if (!layer.shape || !["rect", "circle"].includes(layer.shape)) {
        throw new Error(
          `레이어 ${i}: shape 필드가 누락되었거나 유효하지 않은 값입니다. (허용: rect, circle)`
        );
      }
    } else if (layer.type === "image") {
      // 이미지 레이어 검증 (widthRatio/heightRatio 필수)
      if (!layer.widthRatio || !layer.heightRatio) {
        throw new Error(
          `레이어 ${i}: 이미지 타입은 widthRatio와 heightRatio가 필수입니다.`
        );
      }
      if (
        layer.widthRatio <= 0 ||
        layer.widthRatio > 1 ||
        layer.heightRatio <= 0 ||
        layer.heightRatio > 1
      ) {
        throw new Error(
          `레이어 ${i}: widthRatio, heightRatio는 0.0~1.0 사이의 비율 값이어야 합니다.`
        );
      }
    }
  }

  console.log(`[Template Validator] ✅ 템플릿 "${data.name}" 검증 통과`);
  return true;
}

async function getOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  if (creating) {
    await creating;
  } else {
    creating = chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["DOM_PARSER"],
      justification: "HTML 문자열을 파싱하기 위함",
    });
    await creating;
    creating = null;
  }
}

importScripts(
  "../lib/firebase-app-compat.js",
  "../lib/firebase-database-compat.js"
);

const firebaseConfig = {
  apiKey: "AIzaSyBR6hwdNaR_807gfkgDrw91MvqSBMNlUtY",
  authDomain: "content-pilot-7eb03.firebaseapp.com",
  databaseURL:
    "https://content-pilot-7eb03-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "content-pilot-7eb03",
  storageBucket: "content-pilot-7eb03.firebasestorage.app",
  messagingSenderId: "1062923832161",
  appId: "1:1062923832161:web:12dc37c0bfd2fb1ac05320",
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

/**
 * 지정된 URL의 채널과 관련된 모든 데이터를 Firebase에서 삭제하는 통합 함수.
 * @param {string} urlToDelete - 삭제할 채널의 원본 입력 URL
 */
async function deleteChannelData(urlToDelete) {
  const userId = "default_user";
  const channelsRef = firebase.database().ref(`channels/${userId}`);
  const channelsSnap = await channelsRef.once("value");
  const allChannels = channelsSnap.val();

  if (!allChannels) throw new Error("삭제할 채널 정보를 찾을 수 없습니다.");

  let sourceIdToDelete = null;
  let platformToDelete = null;
  let channelFound = false;

  // 1. 삭제할 채널을 찾고, ID/플랫폼 확보 및 로컬 객체에서 제거
  for (const type of ["myChannels", "competitorChannels"]) {
    for (const platform of ["blogs", "youtubes"]) {
      const channels = allChannels[type]?.[platform] || [];
      const channelIndex = channels.findIndex(
        (c) => c.inputUrl === urlToDelete
      );

      if (channelIndex > -1) {
        const channelInfo = channels[channelIndex];
        sourceIdToDelete =
          platform === "blogs"
            ? btoa(channelInfo.apiUrl).replace(/=/g, "")
            : channelInfo.apiUrl;
        platformToDelete = platform;

        allChannels[type][platform].splice(channelIndex, 1); // 목록에서 제거
        channelFound = true;
        break;
      }
    }
    if (channelFound) break;
  }

  if (!channelFound) {
    console.warn(`DB에서 '${urlToDelete}' 채널을 찾지 못해 삭제를 건너뜁니다.`);
    return; // 작업을 중단하고 경고만 남김
  }

  // 2. 모든 DB 삭제 작업을 병렬로 실행
  const deletePromises = [];

  // 2-1. 수정된 채널 목록을 /channels/ 경로에 다시 저장
  deletePromises.push(channelsRef.set(allChannels));

  // 2-2. /channel_meta/ 경로에서 메타 정보 삭제
  deletePromises.push(
    firebase.database().ref(`channel_meta/${sourceIdToDelete}`).remove()
  );

  // 2-3. /channel_content/ 경로에서 관련 콘텐츠 모두 삭제
  const contentRef = firebase
    .database()
    .ref(`channel_content/${platformToDelete}`);
  const contentPromise = contentRef
    .orderByChild("sourceId")
    .equalTo(sourceIdToDelete)
    .once("value")
    .then((snapshot) => {
      const contentToDelete = snapshot.val();
      if (contentToDelete) {
        const updates = {};
        for (const contentId in contentToDelete) {
          updates[contentId] = null; // null로 설정하여 삭제
        }
        return contentRef.update(updates);
      }
    });
  deletePromises.push(contentPromise);

  await Promise.all(deletePromises);

  console.log(`'${urlToDelete}' 채널과 관련된 모든 데이터 삭제 완료.`);
}

/**
 * 블로그 일반 URL에서 RSS 피드 주소를 추출합니다. (개선된 버전)
 */
async function resolveBlogUrl(url) {
  if (!url || !url.startsWith("http")) return null;
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return null;
  }
  const host = urlObj.hostname.toLowerCase();
  const origin = urlObj.origin;

  let platformRssPath = null;
  if (host.includes("tistory.com")) {
    platformRssPath = "/rss";
  } else if (host.includes("blog.naver.com")) {
    let naverId = null;
    const pathMatch = urlObj.pathname.match(/^\/([a-zA-Z0-9_-]+)/);
    if (pathMatch && pathMatch[1] && pathMatch[1] !== "PostList.naver") {
      naverId = pathMatch[1];
    } else {
      naverId = new URLSearchParams(urlObj.search).get("blogId");
    }
    if (naverId) return `https://rss.blog.naver.com/${naverId}.xml`;
    platformRssPath = "/rss";
  } else if (host.includes("wordpress.com") || host.includes("medium.com")) {
    platformRssPath = "/feed";
  } else if (host.includes("blogspot.com") || host.includes("blogger.com")) {
    platformRssPath = "/feeds/posts/default?alt=rss";
  }

  if (platformRssPath) return origin + platformRssPath;

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP 오류! 상태: ${response.status}`);
    const html = await response.text();
    const rssMatch = html.match(
      /<link[^>]*type=["']application\/(rss|atom)\+xml["'][^>]*href=["']([^"']*)["']/i
    );
    if (rssMatch && rssMatch[2]) {
      let rssUrl = rssMatch[2];
      if (rssUrl.startsWith("//")) rssUrl = `https:${rssUrl}`;
      else if (rssUrl.startsWith("/")) rssUrl = `${origin}${rssUrl}`;
      return rssUrl;
    }
    const fallbackUrl = url.endsWith("/") ? url + "feed" : url + "/feed";
    return fallbackUrl;
  } catch (error) {
    console.error(`RSS 주소 확인 실패 (${url}):`, error);
    return null;
  }
}

/**
 * 유튜브 일반 URL에서 채널 ID(UC...)를 추출하거나 API를 통해 변환합니다. (개선된 버전)
 */
async function resolveYoutubeUrl(url, apiKey) {
  if (!url) return null;
  if (url.startsWith("UC") && url.length === 24) return url;
  if (!url.startsWith("http")) return null;

  let urlObj;
  try {
    urlObj = new URL(url);
  } catch (e) {
    return null;
  }
  const path = urlObj.pathname;

  if (path.includes("/watch") || path.includes("/embed")) {
    const videoId = urlObj.searchParams.get("v");
    if (videoId && apiKey) {
      const videoApi = `https://www.googleapis.com/youtube/v3/videos?part=snippet&id=${videoId}&key=${apiKey}`;
      try {
        const response = await fetch(videoApi);
        const data = await response.json();
        if (data.items && data.items.length > 0)
          return data.items[0].snippet.channelId;
      } catch (error) {
        console.error(`Video URL에서 채널 ID 변환 실패 (${videoId}):`, error);
        return null;
      }
    }
  }

  const channelIdMatch = path.match(/\/channel\/([UC|c][a-zA-Z0-9_-]{22,24})/i);
  if (channelIdMatch && channelIdMatch[1]) return channelIdMatch[1];

  let identifier = null;
  let endpoint = null;
  const handleMatch = path.match(/\/@([a-zA-Z0-9_-]+)/i);
  const userMatch = path.match(/\/user\/([a-zA-Z0-9_-]+)/i);

  if (handleMatch && handleMatch[1]) {
    identifier = handleMatch[1];
    endpoint = `forHandle=@${identifier}`;
  } else if (userMatch && userMatch[1]) {
    identifier = userMatch[1];
    endpoint = `forUsername=${identifier}`;
  } else {
    return null;
  }

  if (endpoint && apiKey) {
    const api = `https://www.googleapis.com/youtube/v3/channels?part=id&${endpoint}&key=${apiKey}`;
    try {
      const response = await fetch(api);
      const data = await response.json();
      if (data.items && data.items.length > 0) return data.items[0].id;
    } catch (error) {
      console.error(`YouTube API를 통한 ID 변환 실패 (${identifier}):`, error);
    }
  }
  return null;
}
/**
 * 텍스트에서 AI를 통해 키워드를 추출하는 함수.
 * @param {string} text - 분석할 텍스트
 * @returns {Promise<string[]|null>} - 추출된 키워드 배열 또는 null
 */
async function extractKeywords(text) {
  console.log("키워드 추출 시도:", text.substring(0, 100) + "...");

  if (!text || text.trim().length < 20) {
    console.warn("텍스트가 너무 짧아 키워드 추출을 건너뜁니다.");
    return null;
  }

  const { isKeywordExtractionEnabled, geminiApiKey } =
    await chrome.storage.local.get([
      "isKeywordExtractionEnabled",
      "geminiApiKey",
    ]);
  if (!isKeywordExtractionEnabled || !geminiApiKey) {
    console.warn("키워드 추출 기능이 비활성화되었거나 API 키가 없습니다.");
    return null;
  }

  const MODEL_NAME = "gemini-2.0-flash";
  const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent?key=${geminiApiKey}`;

  // G-6 (A/C-2): 명확하고 간결한 프롬프트 설계
  const prompt = `당신은 전문 SEO 분석가이자 콘텐츠 전략가입니다. 다음 텍스트의 핵심 주제를 파악하여, 콘텐츠를 분류하고 검색 엔진 최적화(SEO)에 도움이 될 키워드를 추출해주세요.

[추출 규칙]
1.  **키워드 조합**: 총 5~7개의 키워드를 추출하며, 아래 두 종류를 적절히 조합해주세요.
    -   **핵심 키워드 (1-2 단어)**: 콘텐츠의 가장 중심이 되는 주제 (예: 'Gemini API', '콘텐츠 전략')
    -   **롱테일 키워드 (3단어 이상)**: 사용자의 구체적인 검색 의도가 담긴 긴 구문 (예: 'AI로 블로그 태그 자동 생성하기', '유튜브 채널 데이터 분석 방법')
2.  **구체성 및 명사 위주**: 명사, 고유명사, 전문 용어를 우선으로 사용합니다.
3.  **불용어 제외**: '방법', '소개', '정리' 등 일반적인 단어는 피합니다.

[응답 형식]
- 반드시 다른 설명이나 줄바꿈, \`\`\`json 같은 마크다운 없이, 순수한 JavaScript 배열 형식으로만 응답해주세요.
- 예: ["Gemini API", "콘텐츠 전략", "AI로 블로그 태그 자동 생성하기", "유튜브 채널 데이터 분석 방법", "SEO 키워드 추출"]

[분석할 텍스트]
"""
${text.substring(0, 2000)}
"""`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });

    const responseData = await response.json();

    if (!response.ok) {
      console.error("Gemini API 오류 응답:", responseData);
      throw new Error(`Gemini API 호출 실패: ${response.status}`);
    }
    if (!responseData.candidates || responseData.candidates.length === 0) {
      console.warn(
        "Gemini API가 안전 필터링 등의 이유로 응답을 반환하지 않았습니다.",
        responseData
      );
      return null;
    }

    const rawResult = responseData.candidates[0]?.content?.parts[0]?.text;

    console.log("Gemini 원본 응답:", rawResult);

    if (rawResult) {
      const arrayStringMatch = rawResult.match(/\[.*\]/s);
      if (arrayStringMatch) {
        try {
          const parsed = JSON.parse(arrayStringMatch[0]);
          console.log("✅ 추출된 키워드:", parsed);
          return parsed;
        } catch (e) {
          console.error(
            "❌ JSON 파싱 오류:",
            e,
            "원본 문자열:",
            arrayStringMatch[0]
          );
          return null;
        }
      }
    }
    console.warn("AI 응답에서 유효한 배열 형식을 찾지 못했습니다.");
    return null;
  } catch (error) {
    console.error("❌ Gemini 키워드 추출 중 전체 오류:", error);
    return null;
  }
}

async function fetchGaProperties(token) {
  const API_URL =
    "https://analyticsadmin.googleapis.com/v1beta/accountSummaries";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error("GA4 속성 목록을 가져오는데 실패했습니다.");

  const data = await response.json();
  const properties = [];
  data.accountSummaries?.forEach((account) => {
    account.propertySummaries?.forEach((prop) => {
      properties.push({
        id: prop.property.split("/")[1], // "properties/12345"에서 숫자만 추출
        name: prop.displayName,
      });
    });
  });
  return properties;
}

// ▼▼▼ [추가] 애드센스 계정 ID를 가져오는 함수 ▼▼▼
async function fetchAdSenseAccountId(token) {
  const API_URL = "https://adsense.googleapis.com/v2/accounts";
  const response = await fetch(API_URL, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null; // 애드센스 계정이 없는 경우 오류 대신 null 반환

  const data = await response.json();
  return data.accounts?.[0]?.name.split("/")[1] || null; // "accounts/pub-..."에서 ID만 추출
}

async function generateAndSendKeywords(data, sender) {
  const { cardId, status, title, description } = data;
  const keywordsRef = firebase
    .database()
    .ref(`kanban/${status}/${cardId}/recommendedKeywords`);

  const searchQueryPrompt = `
        당신은 특정 주제에 대한 자료 조사를 시작하는 전문 콘텐츠 기획자입니다.
        아래 아이디어를 바탕으로, 구체적인 통계, 사례, 근거, 반론 등을 찾기 위한 가장 효과적인 구글 검색어 5개를 추천해주세요.
        검색어는 각기 다른 관점에서 주제에 접근해야 하며, 사용자가 즉시 검색에 활용할 수 있도록 자연스러운 질문 형태나 핵심 키워드 조합으로 구성해주세요.
        
        [아이디어]
        - 제목: ${title}
        - 설명: ${description || "없음"}

        [응답 형식]
        - 다른 설명이나 마크다운 없이, 순수한 JavaScript 배열 형식으로만 응답해주세요.
        - 예: ["콘텐츠 마케팅 성공 KPI 측정 사례", "블로그 방문자 체류 시간 늘리는 방법", "2024년 SEO 트렌드 통계", "디지털 콘텐츠 유료화 실패 원인"]
    `;

  try {
    const resultText = await callGeminiAPI(searchQueryPrompt);
    // Gemini API 응답에서 배열 부분만 정확히 파싱
    const keywords = JSON.parse(resultText.match(/\[.*\]/s)[0]);

    // Firebase에 새로운 키워드를 덮어쓰기
    await keywordsRef.set(keywords);

    // UI에 새로운 키워드 전송
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: "search_queries_recommended",
        success: true,
        data: keywords,
        cardId, // 모달 재현을 위해 cardId, status, title 전달
        status,
        cardTitle: title,
      });
    }
  } catch (error) {
    console.error("AI 검색어 추천 생성 중 오류:", error);
    if (sender.tab?.id) {
      chrome.tabs.sendMessage(sender.tab.id, {
        action: "search_queries_recommended",
        success: false,
        error: error.message,
      });
    }
  }
}
// --- 2. 핵심 이벤트 리스너 ---

chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.tabs.sendMessage(tab.id, {
      action: "open_content_pilot_panel",
    });
  }
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // [DEBUG] 모든 메시지 수신 로그 - 강력한 확인
  console.log("[DEBUG] 🚨 onMessage 핸들러 실행됨:", msg.action);
  console.debug("[DEBUG] onMessage received:", msg.action, msg, sender);
  // 썸네일용 Gemini 슬로건 생성 (draft 전체와 outline 리스트를 함께 보냄)
  if (
    msg.action === "gemini_generate_thumbnail_texts" &&
    Array.isArray(msg.data?.outlines)
  ) {
    (async () => {
      try {
        const { geminiApiKey } = await chrome.storage.local.get([
          "geminiApiKey",
        ]);
        if (!geminiApiKey) {
          sendResponse({ success: false, error: "Gemini API 키가 없습니다." });
          return;
        }
        const outlines = msg.data.outlines;
        const draft = msg.data.draft || "";
        // draft와 outline을 함께 프롬프트에 포함
        const prompt = `아래는 콘텐츠 초안과 세션(아웃라인) 목록입니다.\n\n[초안]\n${draft}\n\n[세션 목록]\n${outlines
          .map((t, i) => `${i + 1}. ${t}`)
          .join(
            "\n"
          )}\n\n각 세션에 어울리는 썸네일용 짧은 슬로건 또는 키워드를 한글로 1개씩, 12자 이내로, 꾸밈말 없이 핵심만 배열로 추천해줘.\n예시: ["슬로건1", "슬로건2", ...]`;
        const res = await fetch(
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
            geminiApiKey,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          }
        );
        const data = await res.json();
        if (!res.ok) {
          console.error("[Gemini 슬로건] API 오류 응답:", data);
          sendResponse({ success: false, error: "Gemini API 오류", data });
          return;
        }
        // Gemini 응답에서 배열 파싱
        let slogans = [];
        try {
          const raw =
            data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
          const arrayMatch = raw.match(/\[.*\]/s);
          if (arrayMatch) {
            slogans = JSON.parse(arrayMatch[0]);
          } else {
            console.warn("[Gemini 슬로건] 배열 형식 파싱 실패, 원본:", raw);
          }
        } catch (e) {
          console.error("[Gemini 슬로건] 배열 파싱 예외:", e, data);
        }
        // 개수 맞추기 (실패 시 빈값 채움)
        if (!Array.isArray(slogans) || slogans.length !== outlines.length) {
          slogans = Array(outlines.length).fill("");
        }
        sendResponse({ success: true, slogans });
      } catch (e) {
        sendResponse({ success: false, error: e.message });
      }
    })();
    return true;
  }
  // 워크스페이스 draft 저장
  if (
    msg.action === "save_idea_draft" &&
    msg.ideaId &&
    msg.draft !== undefined
  ) {
    try {
      const db = firebase.database();
      // 아이디어 카드가 어떤 status(컬럼)에 있는지 찾아야 함
      db.ref("kanban")
        .once("value")
        .then((snapshot) => {
          const allCards = snapshot.val() || {};
          let foundStatus = null;
          for (const status in allCards) {
            if (allCards[status] && allCards[status][msg.ideaId]) {
              foundStatus = status;
              break;
            }
          }
          if (!foundStatus) {
            sendResponse({ success: false, message: "Idea card not found." });
            return;
          }
          db.ref(`kanban/${foundStatus}/${msg.ideaId}/draftContent`)
            .set(msg.draft)
            .then(() => {
              db.ref(`kanban/${foundStatus}/${msg.ideaId}/updatedAt`).set(
                firebase.database.ServerValue.TIMESTAMP
              );
              sendResponse({
                success: true,
                message: "Draft saved successfully.",
              });
            })
            .catch((error) => {
              console.error("Firebase Draft Save Error:", error);
              sendResponse({ success: false, error: error.message });
            });
        });
      return true; // 비동기 응답
    } catch (e) {
      sendResponse({ success: false, error: e.message });
    }
  }
  // K-4: 초안 삭제 핸들러
  if (msg.action === "delete_draft_content") {
    const cardId = msg.data.cardId;
    (async () => {
      if (!cardId) {
        sendResponse({ success: false, message: "Card ID is missing." });
        return;
      }
      try {
        // 아이디어가 어느 status에 있는지 찾기
        const kanbanRef = firebase.database().ref("kanban");
        const snapshot = await kanbanRef.once("value");
        const allCards = snapshot.val() || {};
        let foundStatus = null;
        for (const status in allCards) {
          if (allCards[status][cardId]) {
            foundStatus = status;
            break;
          }
        }
        if (!foundStatus) {
          sendResponse({ success: false, message: "Card not found." });
          return;
        }
        // draftContent를 null로 업데이트
        await firebase
          .database()
          .ref(`kanban/${foundStatus}/${cardId}/draftContent`)
          .set(null);
        sendResponse({ success: true });
      } catch (error) {
        console.error("Error deleting draft content:", error);
        sendResponse({ success: false, message: error.message });
      }
    })();
    return true;
  }
  // 스크랩 및 자료 관리
  if (msg.action === "scrap_element" && msg.data) {
    (async () => {
      const tags = await extractKeywords(msg.data.text);
      let scrapPayload = {
        ...msg.data,
        timestamp: Date.now(),
        tags: tags || null,
      };

      const cleanedScrapPayload = cleanDataForFirebase(scrapPayload);

      const scrapRef = firebase.database().ref("scraps").push();
      scrapRef
        .set(cleanedScrapPayload)
        .then(() => {
          if (sender.tab?.id) {
            chrome.tabs.sendMessage(
              sender.tab.id,
              { action: "cp_show_preview", data: cleanedScrapPayload },
              { frameId: 0 }
            );
          }
        })
        .catch((err) => {
          if (sender.tab?.id) {
            chrome.tabs.sendMessage(
              sender.tab.id,
              { action: "cp_show_toast", message: "❌ 스크랩 실패" },
              { frameId: 0 }
            );
          }
        });
    })();
    return true;
  } else if (msg.action === "cp_get_firebase_scraps") {
    firebase
      .database()
      .ref("scraps")
      .once("value", (snapshot) => {
        const val = snapshot.val() || {};
        const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));
        sendResponse({ data: arr });
      });
    return true;
  } else if (msg.action === "delete_scrap") {
    const scrapIdToDelete = msg.id;
    if (scrapIdToDelete) {
      firebase
        .database()
        .ref("scraps/" + scrapIdToDelete)
        .remove()
        .then(() => sendResponse({ success: true }))
        .catch((error) =>
          sendResponse({ success: false, error: error.message })
        );
    }
    return true;
  } else if (msg.action === "get_all_scraps") {
    firebase
      .database()
      .ref("scraps")
      .once("value", (snapshot) => {
        const val = snapshot.val() || {};
        const arr = Object.entries(val).map(([id, data]) => ({ id, ...data }));

        sendResponse({
          success: true,
          scraps: arr.sort((a, b) => b.timestamp - a.timestamp),
        });
      });
    return true;
    // (이전 placeholder/canvas 기반 핸들러 완전 제거, Gemini API만 사용)
  } else if (msg.action === "scrap_entire_analysis") {
    const analysisContent = msg.data;
    if (!analysisContent) {
      sendResponse({ success: false, error: "분석 콘텐츠가 비어있습니다." });
      return true;
    }

    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, "0");
    const day = String(today.getDate()).padStart(2, "0");
    const dateTag = `${year}-${month}-${day}`;

    const scrapPayload = {
      text: analysisContent,
      html: `<pre>${analysisContent}</pre>`,
      tag: "AI_ANALYSIS",
      url: `content-pilot://analysis/${Date.now()}`,
      // 2. '#AI리포트'를 삭제하고 날짜 태그를 추가합니다.
      tags: [`#성과분석`, `#${dateTag}`],
      timestamp: Date.now(),
    };

    const cleanedScrapPayload = cleanDataForFirebase(scrapPayload);
    const scrapRef = firebase.database().ref("scraps").push();
    scrapRef
      .set(cleanedScrapPayload)
      .then(() => {
        console.log("AI 분석 리포트가 스크랩북에 저장되었습니다.");
        sendResponse({
          success: true,
          message: "AI 분석 리포트가 저장되었습니다.",
        });
      })
      .catch((err) => {
        console.error("AI 리포트 스크랩 중 오류:", err);
        sendResponse({ success: false, error: err.message });
      });

    return true; // 비동기 응답
  }
  // FR3 (PRD v2.0/v2.2): AI 기반 썸네일 템플릿 자동 생성기
  else if (msg.action === "analyze_image_for_template") {
    console.debug("[DEBUG] analyze_image_for_template 트리거됨", msg.data);
    (async () => {
      // 분석 시작 알림
      chrome.runtime.sendMessage({ action: "ai_analysis_started" });
      try {
        console.debug("[DEBUG] Gemini Vision API 분석 시작");
        console.log(
          "[Template Analysis] 🚀 시작 - 템플릿 이름:",
          msg.data?.templateName
        );
        const startTime = Date.now();
        const { data } = msg; // { base64Image?, imageUrl?, templateName }

        // 1. [신규 v2.2] 이미지 소스(Base64 또는 URL) 처리
        let imageBase64Data;
        let imageMimeType = "image/jpeg"; // 기본값

        if (data.base64Image) {
          console.log("[Template Analysis] 📸 Base64 이미지 처리 중...");
          // 로컬 파일 (Base64)
          const parts = data.base64Image.split(",");
          if (parts.length === 2) {
            // MIME 타입 추출 (예: "data:image/png;base64," -> "image/png")
            const mimeMatch = parts[0].match(/data:(.+);base64/);
            if (mimeMatch) imageMimeType = mimeMatch[1];
            imageBase64Data = parts[1];
          } else {
            throw new Error("Invalid Base64 image format");
          }
        } else if (data.imageUrl) {
          // 웹 이미지 URL (v2.2 신규)
          const response = await fetch(data.imageUrl);
          if (!response.ok)
            throw new Error(
              `Failed to fetch image: ${response.status} ${response.statusText}`
            );

          // Content-Type에서 MIME 타입 추출
          const contentType = response.headers.get("Content-Type");
          if (contentType && contentType.startsWith("image/")) {
            imageMimeType = contentType;
          }

          // Blob으로 변환 후 Base64 인코딩
          const blob = await response.blob();
          const base64Result = await convertBlobToBase64(blob);
          imageBase64Data = base64Result.split(",")[1];
        } else {
          throw new Error("No image data provided (base64Image or imageUrl)");
        }

        // 디버그 로그: Base64 길이 및 MIME을 출력하여 런타임 진단을 쉽게 함
        try {
          const previewHead = (data.base64Image || "").slice(0, 300);
          console.debug(
            "[Template Analysis] 🧪 요청 디버그 - imageMimeType:",
            imageMimeType,
            "imageBase64 length:",
            (imageBase64Data || "").length
          );
          console.debug("[Template Analysis] 🧾 prompt head:", previewHead);
        } catch (dbgErr) {
          console.warn("[Template Analysis] 디버그 로그 생성 중 오류:", dbgErr);
        }

        // 2. [기존 v2.0] Gemini Vision API 호출
        const { geminiApiKey } = await chrome.storage.local.get([
          "geminiApiKey",
        ]);
        if (!geminiApiKey) {
          throw new Error(
            "Gemini API 키가 설정되지 않았습니다. 설정에서 API 키를 등록해주세요."
          );
        }

        const VISION_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiApiKey}`;
        console.debug(
          "[Template Analysis] 🌐 VISION_API_URL:",
          VISION_API_URL.replace(/(key=)[^&]+/, "$1<REDACTED>")
        );

        // CR1 (PRD v3.1): 유연한 JSON 스키마로 성공률 향상
        const templateSchema = {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "템플릿 이름",
            },
            background: {
              type: "object",
              properties: {
                type: {
                  type: "string",
                  enum: ["solid"],
                  description: "배경 타입",
                },
                value: {
                  type: "string",
                  description: "배경 색상 (HEX)",
                },
              },
            },
            layers: {
              type: "array",
              description: "시각적 요소 레이어 배열",
              items: {
                type: "object",
                properties: {
                  type: {
                    type: "string",
                    enum: ["text", "shape", "image"],
                    description: "레이어 타입",
                  },
                  text: {
                    type: "string",
                    description: "텍스트 레이어의 텍스트 내용",
                  },
                  shape: {
                    type: "string",
                    enum: ["rect", "circle"],
                    description: "도형 타입",
                  },
                  x: {
                    type: "number",
                    description: "X 좌표 (0.0~1.0)",
                  },
                  y: {
                    type: "number",
                    description: "Y 좌표 (0.0~1.0)",
                  },
                  widthRatio: {
                    type: "number",
                    description: "너비 비율 (0.0~1.0)",
                  },
                  heightRatio: {
                    type: "number",
                    description: "높이 비율 (0.0~1.0)",
                  },
                  styles: {
                    type: "object",
                    description: "스타일 속성",
                    properties: {
                      fontRatio: {
                        type: "number",
                        description: "폰트 크기 비율",
                      },
                      fill: {
                        type: "string",
                        description: "채우기 색상",
                      },
                      align: {
                        type: "string",
                        enum: ["left", "center", "right"],
                        description: "텍스트 정렬",
                      },
                    },
                  },
                },
                // 필수 필드 최소화
                required: ["type", "x", "y"],
              },
            },
          },
          // 필수 필드 최소화
          required: ["name", "layers"],
        };

        // CR3 (PRD v3.2 Enhanced + 복잡한 이미지 최적화): 단계별 분석으로 성공률 향상
        const jsonStructurePrompt = `
이미지를 분석하여 Canvas에서 렌더링할 수 있는 JSON 템플릿을 생성하세요.

**템플릿 이름**: "${data.templateName || "새 템플릿"}"

**단계별 분석**:

1. **배경 분석**: 주요 배경색을 HEX 코드로 (예: "#FFFFFF")

2. **요소 분류**:
   - 텍스트: type: "text" (단순한 텍스트만)
   - 도형: type: "shape" (rect, circle)
   - 복잡한 요소: type: "image" (3D 텍스트, 아이콘, 사진 등)

3. **좌표 지정**: 모든 x, y는 0.0~1.0 비율로

**중요 규칙**:
- 최소 1개의 텍스트 레이어 필수
- 복잡한 이미지는 type: "image"로 단순화
- 좌표는 이미지 중앙을 0.5, 0.5로

**예시**:
\`\`\`json
{
  "name": "복잡한 디자인",
  "background": {"type": "solid", "value": "#1A1A1A"},
  "layers": [
    {"type": "image", "x": 0.5, "y": 0.3, "widthRatio": 0.8, "heightRatio": 0.4, "src": null},
    {"type": "text", "text": "제목", "x": 0.5, "y": 0.7, "styles": {"fontRatio": 0.06, "fill": "#FFFFFF", "align": "center"}},
    {"type": "shape", "shape": "circle", "x": 0.8, "y": 0.2, "widthRatio": 0.1, "heightRatio": 0.1, "styles": {"fill": "#FF6B35"}}
  ]
}
\`\`\`

**출력**: JSON 객체만 반환
`;

        // CR2 (PRD v3.1): Gemini API 호출 시 generationConfig에 스키마 전달
        // [PRD v3.3 FR-B1] 재시도 로직 + 30초 타임아웃
        console.log("[Template Analysis] 🤖 Gemini Vision API 호출 준비 중...");
        let visionResponse;
        let retryCount = 0;
        const RETRY_DELAY = 3000;
        const FETCH_TIMEOUT = 300000; // 5분 타임아웃 (300초) - 복잡한 이미지 분석에 충분한 시간
        const MAX_RETRIES = 3; // 최대 재시도 횟수

        // [FR-B1] 타임아웃 헬퍼 함수
        const fetchWithTimeout = (url, options, timeout) => {
          return Promise.race([
            fetch(url, options),
            new Promise((_, reject) =>
              setTimeout(
                () =>
                  reject(
                    new Error(
                      "AI 분석 시간 초과: 이미지가 너무 복잡하거나 서버 응답이 없습니다."
                    )
                  ),
                timeout
              )
            ),
          ]);
        };

        while (retryCount < MAX_RETRIES) {
          try {
            console.log(
              `[Template Analysis] 📡 API 호출 시도 ${
                retryCount + 1
              }/${MAX_RETRIES}... (타임아웃: ${FETCH_TIMEOUT}ms)`
            );
            const apiStartTime = Date.now();

            // [FR-B1] fetch에 지정된 타임아웃 적용
            // 디버그 로그: 요청 직전 이미지/프롬프트 정보 출력
            try {
              console.log(
                "[Template Analysis] 🧪 요청 디버그 - imageMimeType:",
                imageMimeType,
                "imageBase64 length:",
                imageBase64Data ? imageBase64Data.length : 0
              );
              console.log(
                "[Template Analysis] 🧾 prompt head:",
                (jsonStructurePrompt || "").substring(0, 300)
              );
              console.log(
                "[Template Analysis] 🌐 VISION_API_URL:",
                VISION_API_URL
              );
            } catch (dbgErr) {
              console.warn(
                "[Template Analysis] ⚠️ 디버그 로그 생성 오류:",
                dbgErr.message
              );
            }

            // 실제 이미지 변수명 사용으로 수정
            visionResponse = await fetchWithTimeout(
              VISION_API_URL,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  contents: [
                    {
                      parts: [
                        {
                          inline_data: {
                            mime_type: imageMimeType,
                            data: imageBase64Data,
                          },
                        },
                        { text: jsonStructurePrompt },
                      ],
                    },
                  ],
                  generationConfig: {
                    temperature: 0.1,
                    responseMimeType: "application/json",
                    responseSchema: templateSchema,
                  },
                }),
              },
              FETCH_TIMEOUT
            );

            // 보조 헬퍼: 특정 프롬프트로 Gemini에 재요청 (재사용 가능)
            async function runVisionPrompt(promptText, opts = {}) {
              const schema = opts.schema || null;
              const temp =
                typeof opts.temperature === "number" ? opts.temperature : 0.15;
              const body = {
                contents: [
                  {
                    parts: [
                      {
                        inline_data: {
                          mime_type: imageMimeType,
                          data: imageBase64Data,
                        },
                      },
                      { text: promptText },
                    ],
                  },
                ],
              };
              if (schema) {
                body.generationConfig = {
                  temperature: temp,
                  responseMimeType: "application/json",
                  responseSchema: schema,
                };
              } else {
                body.generationConfig = {
                  temperature: temp,
                  responseMimeType: "application/json",
                };
              }

              const resp = await fetchWithTimeout(
                VISION_API_URL,
                {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                },
                FETCH_TIMEOUT
              );
              if (!resp.ok) {
                const err = await resp.text();
                throw new Error(`Vision API error: ${resp.status} ${err}`);
              }
              const data = await resp.json();
              const raw = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
              return raw;
            }

            const apiDuration = Date.now() - apiStartTime;
            console.log(
              `[Template Analysis] ⏱️ API 응답 시간: ${apiDuration}ms`
            );

            if (visionResponse.ok) {
              console.log("[Template Analysis] ✅ API 호출 성공!");
              break; // 성공하면 루프 탈출
            }

            const errorData = await visionResponse.json();
            console.error(`[Template Analysis] ❌ API 에러 응답:`, errorData);

            // 503 (과부하) 또는 429 (요청 제한) 에러인 경우에만 재시도
            if (
              visionResponse.status === 503 ||
              visionResponse.status === 429
            ) {
              retryCount++;
              if (retryCount < MAX_RETRIES) {
                console.warn(
                  `[Gemini Vision] ${visionResponse.status} 오류, ${retryCount}/${MAX_RETRIES} 재시도 중... (${RETRY_DELAY}ms 후)`
                );
                await new Promise((resolve) =>
                  setTimeout(resolve, RETRY_DELAY * retryCount)
                ); // 지수 백오프
                continue;
              }
            }

            // 재시도 불가능한 에러이거나 최대 재시도 횟수 초과
            console.error("[Gemini Vision] API 오류 응답:", errorData);

            // 사용자 친화적 에러 메시지
            let userMessage = errorData.error?.message || "알 수 없는 오류";
            if (visionResponse.status === 503) {
              userMessage =
                "Gemini API 서버가 현재 과부하 상태입니다. 잠시 후 다시 시도해주세요.";
            } else if (visionResponse.status === 429) {
              userMessage =
                "API 요청 한도를 초과했습니다. 잠시 후 다시 시도해주세요.";
            }

            throw new Error(
              `${userMessage} (상태 코드: ${visionResponse.status}${
                retryCount >= MAX_RETRIES ? ", 최대 재시도 횟수 초과" : ""
              })`
            );
          } catch (fetchError) {
            // 변경: 타임아웃(AI 분석 시간 초과)도 일시적 문제일 수 있으므로 재시도 대상으로 포함
            const isTimeout =
              fetchError.message &&
              fetchError.message.includes("AI 분석 시간 초과");
            const isNetworkErr =
              fetchError.message &&
              /network|failed to fetch|fetch error/i.test(fetchError.message);

            if ((isTimeout || isNetworkErr) && retryCount < MAX_RETRIES - 1) {
              retryCount++;
              console.warn(
                `[Gemini Vision] 일시적 오류(${
                  isTimeout ? "timeout" : "network"
                }), ${retryCount}/${MAX_RETRIES} 재시도 중...`,
                fetchError.message
              );
              await new Promise((resolve) =>
                setTimeout(resolve, RETRY_DELAY * retryCount)
              );
              continue;
            }

            // 마지막 재시도에서도 실패했을 경우: 스키마를 제거한 경량 프롬프트로 폴백 시도
            if (retryCount >= MAX_RETRIES - 1) {
              console.warn(
                "[Template Analysis] 최종 재시도 실패, 스키마 제거 경량 프롬프트로 폴백 시도"
              );
              try {
                // 간단한 프롬프트: 주요 레이어 정보를 리스트 형태의 JSON로 요청
                const lightweightPrompt = `이미지에서 주요 시각 요소를 추출하여 간단한 JSON 템플릿을 반환하세요. 최소한 각 레이어의 type(x,y,widthRatio,heightRatio)과 텍스트의 경우 text, 이미지의 경우 src(가능하면)를 포함하세요. 출력은 순수 JSON 객체여야 합니다.`;

                const fallbackRaw = await runVisionPrompt(lightweightPrompt, {
                  temperature: 0.08,
                });
                console.log(
                  "[Template Analysis] 폴백(경량) 응답 일부:",
                  fallbackRaw.substring(0, 300)
                );

                const fallbackJsonMatch =
                  fallbackRaw.match(/```json\s*(\{[\s\S]*?\})\s*```/) ||
                  fallbackRaw.match(/\{[\s\S]*\}/);
                if (fallbackJsonMatch) {
                  const fallbackJson =
                    fallbackJsonMatch[1] || fallbackJsonMatch[0];
                  try {
                    const fallbackParsed = JSON.parse(fallbackJson);
                    // 교체 전에 최소 레이어가 존재하는지 확인
                    if (
                      Array.isArray(fallbackParsed.layers) &&
                      fallbackParsed.layers.length > 0
                    ) {
                      console.log(
                        "[Template Analysis] ✅ 경량 폴백 템플릿 유효, parsedTemplate 교체"
                      );
                      parsedTemplate = fallbackParsed;
                      // 파싱 성공 시 루프 탈출하여 이후 보정/검증 단계로 이동
                      visionResponse = { ok: true };
                      break;
                    }
                  } catch (e) {
                    console.warn(
                      "[Template Analysis] ❌ 경량 폴백 JSON 파싱 실패:",
                      e.message
                    );
                    // 이 경우 최종 실패로 이어짐
                  }
                } else {
                  console.warn(
                    "[Template Analysis] ⚠️ 경량 폴백에서 JSON 추출 실패"
                  );
                }
              } catch (fallbackErr) {
                console.warn(
                  "[Template Analysis] ❌ 경량 폴백 요청 실패:",
                  fallbackErr.message
                );
              }
            }

            // 모든 조치 후에도 실패하면 원래 예외를 상위로 던짐
            throw fetchError;
          }
        }

        console.log("[Template Analysis] 📝 API 응답 파싱 중...");
        const visionData = await visionResponse.json();

        // [복잡한 이미지용] AI 분석 실패 시 폴백 템플릿 생성
        const createFallbackTemplate = (templateName) => {
          console.warn("[Fallback] AI 분석 실패로 기본 템플릿 생성");
          return {
            name: templateName || "기본 템플릿",
            background: { type: "solid", value: "#FFFFFF" },
            layers: [
              {
                type: "image",
                x: 0.5,
                y: 0.4,
                widthRatio: 0.8,
                heightRatio: 0.5,
                src: null,
              },
              {
                type: "text",
                text: "이미지 분석 중",
                x: 0.5,
                y: 0.8,
                styles: {
                  fontRatio: 0.05,
                  fill: "#666666",
                  align: "center",
                },
              },
            ],
          };
        };

        // 3. FR-V-Validate (PRD v2.5): JSON 파싱 및 강화된 검증
        const rawText =
          visionData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

        console.log(
          "[Template Analysis] 📄 AI 응답 원문:",
          rawText.substring(0, 200) + "..."
        );

        // JSON 추출 (코드 블록 또는 순수 JSON)
        let templateDataJson;
        const jsonMatch = rawText.match(/```json\s*(\{[\s\S]*?\})\s*```/);
        if (jsonMatch) {
          templateDataJson = jsonMatch[1];
          console.log("[Template Generator] 코드 블록에서 JSON 추출 완료");
        } else {
          const pureJsonMatch = rawText.match(/\{[\s\S]*\}/);
          if (pureJsonMatch) {
            templateDataJson = pureJsonMatch[0];
            console.log("[Template Generator] 순수 JSON 추출 완료");
          } else {
            throw new Error(
              "Gemini 응답에서 JSON을 추출할 수 없습니다. AI 응답: " +
                rawText.substring(0, 300)
            );
          }
        }

        // JSON 파싱 (복잡한 이미지용 강화)
        let parsedTemplate;
        try {
          parsedTemplate = JSON.parse(templateDataJson);
          console.log(
            "[Template Analysis] JSON 파싱 성공:",
            parsedTemplate.name
          );
          console.log(
            "[Template Analysis] 🔍 파싱된 원본 데이터:",
            JSON.stringify(parsedTemplate, null, 2)
          );
        } catch (parseError) {
          console.error("[Template Analysis] ❌ JSON 파싱 실패:", parseError);
          console.warn("[Template Analysis] ⚠️ 폴백 템플릿으로 전환");
          parsedTemplate = createFallbackTemplate(data.templateName);
        }

        // [PRD v3.3 FR-B2] AI 데이터 자동 보정 (Sanitization)
        const sanitizeTemplateData = (template) => {
          console.log("[Template Analysis] 🔧 데이터 자동 보정 시작...");
          let fixCount = 0;

          if (template.layers && Array.isArray(template.layers)) {
            template.layers.forEach((layer, idx) => {
              // 좌표 보정 (가장 중요!)
              if (typeof layer.x === "string") {
                layer.x = parseFloat(layer.x) || 0.5;
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: x를 문자열에서 숫자로 변환 (${layer.x})`
                );
              }
              if (typeof layer.y === "string") {
                layer.y = parseFloat(layer.y) || 0.5;
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: y를 문자열에서 숫자로 변환 (${layer.y})`
                );
              }

              // [강화] 좌표가 여전히 숫자가 아니면 기본값 할당
              if (typeof layer.x !== "number" || isNaN(layer.x)) {
                layer.x = 0.5; // 중앙
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: x가 유효하지 않아 기본값 0.5 할당`
                );
              }
              if (typeof layer.y !== "number" || isNaN(layer.y)) {
                layer.y = 0.5; // 중앙
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: y가 유효하지 않아 기본값 0.5 할당`
                );
              }

              // 크기 보정
              if (typeof layer.widthRatio === "string") {
                layer.widthRatio = parseFloat(layer.widthRatio) || 0.1;
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: widthRatio를 문자열에서 숫자로 변환`
                );
              }
              if (typeof layer.heightRatio === "string") {
                layer.heightRatio = parseFloat(layer.heightRatio) || 0.1;
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: heightRatio를 문자열에서 숫자로 변환`
                );
              }

              // [강화] 크기가 유효하지 않으면 기본값 할당
              if (
                typeof layer.widthRatio !== "number" ||
                isNaN(layer.widthRatio)
              ) {
                layer.widthRatio = 0.1; // 기본 크기
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: widthRatio가 유효하지 않아 기본값 0.1 할당`
                );
              }
              if (
                typeof layer.heightRatio !== "number" ||
                isNaN(layer.heightRatio)
              ) {
                layer.heightRatio = 0.1; // 기본 크기
                fixCount++;
                console.warn(
                  `[Sanitize] 레이어 ${idx}: heightRatio가 유효하지 않아 기본값 0.1 할당`
                );
              }

              // 텍스트 레이어 스타일 보정
              if (layer.type === "text") {
                // [복잡한 이미지용] 텍스트 레이어 필수 스타일 보정
                if (!layer.styles) {
                  layer.styles = {};
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 텍스트 레이어에 빈 styles 객체 추가`
                  );
                }

                if (typeof layer.styles.fontRatio !== "number") {
                  layer.styles.fontRatio = layer.styles.fontRatio || 0.05;
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: fontRatio 기본값 0.05 설정`
                  );
                }

                if (!layer.styles.fill) {
                  layer.styles.fill = "#000000"; // 검정색 기본값
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 텍스트 색상 기본값 #000000 설정`
                  );
                }

                if (!layer.styles.align) {
                  layer.styles.align = "center"; // 중앙 정렬 기본값
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 텍스트 정렬 기본값 center 설정`
                  );
                }

                // fontWeight 보정
                if (
                  layer.styles.fontWeight &&
                  typeof layer.styles.fontWeight === "number"
                ) {
                  layer.styles.fontWeight =
                    layer.styles.fontWeight >= 700 ? "bold" : "normal";
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: fontWeight를 숫자에서 문자열로 변환`
                  );
                }

                // [신규] 그림자(shadow) 속성 보정
                if (
                  layer.styles.shadow &&
                  typeof layer.styles.shadow === "object"
                ) {
                  if (typeof layer.styles.shadow.blur === "string") {
                    layer.styles.shadow.blur =
                      parseFloat(layer.styles.shadow.blur) || 0.01;
                    fixCount++;
                    console.warn(
                      `[Sanitize] 레이어 ${idx}: shadow.blur를 문자열에서 숫자로 변환`
                    );
                  }
                  if (typeof layer.styles.shadow.offsetX === "string") {
                    layer.styles.shadow.offsetX =
                      parseFloat(layer.styles.shadow.offsetX) || 0.005;
                    fixCount++;
                    console.warn(
                      `[Sanitize] 레이어 ${idx}: shadow.offsetX를 문자열에서 숫자로 변환`
                    );
                  }
                  if (typeof layer.styles.shadow.offsetY === "string") {
                    layer.styles.shadow.offsetY =
                      parseFloat(layer.styles.shadow.offsetY) || 0.005;
                    fixCount++;
                    console.warn(
                      `[Sanitize] 레이어 ${idx}: shadow.offsetY를 문자열에서 숫자로 변환`
                    );
                  }
                }
              }

              // Shape 레이어 스타일 보정
              if (layer.type === "shape") {
                // [복잡한 이미지용] 도형 레이어 보정
                if (!layer.shape) {
                  layer.shape = "rect"; // 사각형 기본값
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 도형 타입 기본값 rect 설정`
                  );
                }

                if (!layer.styles) layer.styles = {};
                if (!layer.styles.fill) {
                  layer.styles.fill = "#CCCCCC"; // 회색 기본값
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 도형 색상 기본값 #CCCCCC 설정`
                  );
                }

                if (typeof layer.styles.lineWidth === "string") {
                  layer.styles.lineWidth =
                    parseFloat(layer.styles.lineWidth) || 0.01;
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: lineWidth를 문자열에서 숫자로 변환`
                  );
                }
              }

              // [복잡한 이미지용] 이미지 레이어 보정
              if (layer.type === "image") {
                // 가능한 한 src를 보존하거나 다양한 필드명에서 매핑
                if (!layer.src) {
                  if (layer.url) {
                    layer.src = layer.url;
                    fixCount++;
                    console.warn(`[Sanitize] 레이어 ${idx}: url -> src 매핑`);
                  } else if (layer.imageUrl) {
                    layer.src = layer.imageUrl;
                    fixCount++;
                    console.warn(
                      `[Sanitize] 레이어 ${idx}: imageUrl -> src 매핑`
                    );
                  } else if (layer.base64) {
                    layer.src = layer.base64;
                    fixCount++;
                    console.warn(
                      `[Sanitize] 레이어 ${idx}: base64 -> src 매핑`
                    );
                  } else if (layer.data && layer.data.src) {
                    layer.src = layer.data.src;
                    fixCount++;
                    console.warn(
                      `[Sanitize] 레이어 ${idx}: data.src -> src 매핑`
                    );
                  } else {
                    // src가 없으면 null로 두되 플레이스홀더 렌더링을 허용
                    layer.src = null;
                  }
                }

                // styles 기본값 보장 (플레이스홀더 색상 등)
                if (!layer.styles) {
                  layer.styles = {};
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 이미지 레이어에 빈 styles 객체 추가`
                  );
                }
                if (!layer.styles.placeholderColor) {
                  layer.styles.placeholderColor = "#DDDDDD";
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: placeholderColor 기본값 설정 #DDDDDD`
                  );
                }

                if (!layer.widthRatio) {
                  layer.widthRatio = 0.5; // 기본 너비
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 이미지 너비 기본값 0.5 설정`
                  );
                }
                if (!layer.heightRatio) {
                  layer.heightRatio = 0.3; // 기본 높이
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: 이미지 높이 기본값 0.3 설정`
                  );
                }
              }

              // [신규] SVG 레이어 크기 보정 (선택적 필드)
              if (layer.type === "svg") {
                if (layer.widthRatio && typeof layer.widthRatio === "string") {
                  layer.widthRatio = parseFloat(layer.widthRatio) || 0.1;
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: SVG widthRatio를 문자열에서 숫자로 변환`
                  );
                }
                if (
                  layer.heightRatio &&
                  typeof layer.heightRatio === "string"
                ) {
                  layer.heightRatio = parseFloat(layer.heightRatio) || 0.1;
                  fixCount++;
                  console.warn(
                    `[Sanitize] 레이어 ${idx}: SVG heightRatio를 문자열에서 숫자로 변환`
                  );
                }
              }

              // [신규] 범위 초과 값 자동 보정 (0.0~1.0 범위)
              if (typeof layer.x === "number") {
                if (layer.x < 0) {
                  layer.x = 0;
                  fixCount++;
                  console.warn(`[Sanitize] 레이어 ${idx}: x < 0 → 0으로 보정`);
                }
                if (layer.x > 1) {
                  layer.x = 1;
                  fixCount++;
                  console.warn(`[Sanitize] 레이어 ${idx}: x > 1 → 1로 보정`);
                }
              }
              if (typeof layer.y === "number") {
                if (layer.y < 0) {
                  layer.y = 0;
                  fixCount++;
                  console.warn(`[Sanitize] 레이어 ${idx}: y < 0 → 0으로 보정`);
                }
                if (layer.y > 1) {
                  layer.y = 1;
                  fixCount++;
                  console.warn(`[Sanitize] 레이어 ${idx}: y > 1 → 1로 보정`);
                }
              }
            });
          }

          if (fixCount > 0) {
            console.log(
              `[Template Analysis] ✅ 데이터 보정 완료: ${fixCount}개 항목 수정됨`
            );
          } else {
            console.log(
              "[Template Analysis] ℹ️ 데이터 보정 불필요 (모든 값이 올바른 형식)"
            );
          }

          return template;
        };

        // 보조 전략: 파싱된 템플릿이 텍스트 레이어만 포함하는 경우, 더 강력한 프롬프트로 재요청
        const hasNonTextLayer = parsedTemplate.layers.some(
          (l) => l.type && l.type !== "text"
        );

        if (!hasNonTextLayer) {
          console.warn(
            "[Template Analysis] ⚠️ 파싱된 템플릿이 텍스트 전용입니다. 보조 프롬프트로 재요청합니다."
          );

          // 보조 프롬프트: 디자인 요소 분해(아이콘, 효과선, 도형, 그림자, 외곽선 등)를 강하게 요청
          const secondaryPrompt = `${jsonStructurePrompt}\n\n"SECONDARY_ANALYSIS": 이미 응답된 템플릿이 텍스트 중심으로 보입니다. 다음 규칙을 엄격히 적용해 다시 출력하세요: 1) 모든 시각적 장식을 개별 레이어로 분해 (effect_line, star, stroke, shadow, icon 등) 2) 단일 이미지 블롭 대신 가능한 경우 shape 또는 svg로 분해 3) 텍스트는 별도 레이어로 유지. 출력은 여전히 JSON 객체만 허용.`;

          try {
            const secondaryRaw = await runVisionPrompt(secondaryPrompt, {
              schema: templateSchema,
              temperature: 0.12,
            });
            console.log(
              "[Template Analysis] 🔁 보조 프롬프트 응답 일부: ",
              secondaryRaw.substring(0, 300)
            );

            const secondaryJsonMatch =
              secondaryRaw.match(/```json\s*(\{[\s\S]*?\})\s*```/) ||
              secondaryRaw.match(/\{[\s\S]*\}/);
            if (secondaryJsonMatch) {
              const secJson = secondaryJsonMatch[1] || secondaryJsonMatch[0];
              try {
                const secParsed = JSON.parse(secJson);
                // 보조 응답이 더 좋으면 교체
                const secHasNonText =
                  Array.isArray(secParsed.layers) &&
                  secParsed.layers.some((l) => l.type && l.type !== "text");
                if (secHasNonText) {
                  console.log(
                    "[Template Analysis] ✅ 보조 응답이 non-text 레이어를 포함합니다. 템플릿 교체 진행"
                  );
                  parsedTemplate = secParsed;
                } else {
                  console.warn(
                    "[Template Analysis] ℹ️ 보조 응답에서도 non-text 레이어를 찾지 못했습니다."
                  );
                }
              } catch (e) {
                console.warn(
                  "[Template Analysis] ❌ 보조 응답 JSON 파싱 실패:",
                  e.message
                );
              }
            } else {
              console.warn(
                "[Template Analysis] ⚠️ 보조 응답에서 JSON을 추출하지 못함"
              );
            }
          } catch (secErr) {
            console.warn(
              "[Template Analysis] ❌ 보조 프롬프트 요청 실패:",
              secErr.message
            );
            // 폴백: 계속 진행
          }
        }

        // 이후 표준 보정 및 검증 적용
        sanitizeTemplateData(parsedTemplate);

        // [신규 v2.5] validateTemplateData 함수로 철저한 검증
        validateTemplateData(parsedTemplate);

        // 4. 검증 통과 후 Firebase에 저장 (undefined → null 정제)
        console.log("[Template Analysis] 💾 Firebase 저장 중...");
        const cleanedTemplate = cleanDataForFirebase(parsedTemplate);
        const newTemplateRef = await firebase
          .database()
          .ref("thumbnail_templates")
          .push(cleanedTemplate);

        const totalDuration = Date.now() - startTime;
        console.log(
          `[Template Analysis] ✅ 완료! 템플릿 "${parsedTemplate.name}" 저장 (ID: ${newTemplateRef.key}, 총 ${totalDuration}ms)`
        );
        console.debug("[DEBUG] Gemini Vision API 분석 성공, 응답 전송 완료");
        sendResponse({
          success: true,
          template: parsedTemplate,
          id: newTemplateRef.key,
        });
        // 분석 종료 알림 (성공)
        chrome.runtime.sendMessage({ action: "ai_analysis_finished" });
      } catch (error) {
        console.error("[Template Generator] ❌ 오류:", error);
        console.debug("[DEBUG] Gemini Vision API 분석 실패, 에러:", error);

        // 분석 종료 알림 (실패)
        chrome.runtime.sendMessage({ action: "ai_analysis_finished" });

        // 구체적인 에러 메시지 반환 (v2.5)
        const errorMessage = error.message || "알 수 없는 오류가 발생했습니다.";
        sendResponse({
          success: false,
          error: `템플릿 분석 실패: ${errorMessage}`,
        });
        console.debug("[DEBUG] Gemini Vision API 분석 실패, 응답 전송 완료");
      }
    })();
    return true; // 비동기 응답
  }
  // FR5 (PRD v2.3): 템플릿 목록 조회
  else if (msg.action === "get_thumbnail_templates") {
    firebase
      .database()
      .ref("thumbnail_templates")
      .once("value", (snapshot) => {
        const val = snapshot.val() || {};
        const templates = Object.entries(val).map(([id, data]) => ({
          id,
          ...data,
        }));
        sendResponse({ success: true, templates });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }
  // FR-A-Delete (PRD v2.3): 템플릿 삭제
  else if (msg.action === "delete_template") {
    const templateId = msg.templateId;
    if (!templateId) {
      sendResponse({ success: false, error: "템플릿 ID가 없습니다." });
      return true;
    }

    firebase
      .database()
      .ref(`thumbnail_templates/${templateId}`)
      .remove()
      .then(() => {
        console.log(
          `[Template Manager] ✅ 템플릿 ID "${templateId}" 삭제 완료`
        );
        sendResponse({ success: true });
      })
      .catch((error) => {
        console.error("[Template Manager] ❌ 삭제 오류:", error);
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  // 채널 및 설정
  else if (msg.action === "save_channels_and_key") {
    const { youtubeApiKey, geminiApiKey, ...newChannelData } = msg.data;
    const userId = "default_user";

    (async () => {
      try {
        // 1. 기존 채널 목록을 가져와 삭제된 채널이 있는지 확인하고 데이터를 정리합니다.
        const channelsRef = firebase.database().ref(`channels/${userId}`);
        const oldChannelsSnap = await channelsRef.once("value");
        const oldChannels = oldChannelsSnap.val();

        if (oldChannels) {
          const oldUrls = new Set();
          ["myChannels", "competitorChannels"].forEach((type) => {
            ["blogs", "youtubes"].forEach((platform) => {
              (oldChannels[type]?.[platform] || []).forEach((c) =>
                oldUrls.add(c.inputUrl)
              );
            });
          });

          const newUrls = new Set();
          // 'myChannels'의 블로그 데이터 구조가 다르므로 별도 처리합니다.
          (newChannelData.myChannels?.blogs || []).forEach((b) =>
            newUrls.add(b.url)
          );
          (newChannelData.myChannels?.youtubes || []).forEach((y) =>
            newUrls.add(y)
          );
          (newChannelData.competitorChannels?.blogs || []).forEach((b) =>
            newUrls.add(b)
          );
          (newChannelData.competitorChannels?.youtubes || []).forEach((y) =>
            newUrls.add(y)
          );

          const deletedUrls = [...oldUrls].filter((url) => !newUrls.has(url));
          for (const url of deletedUrls) {
            // await deleteChannelData(url); // deleteChannelData 함수가 정의되어 있다고 가정
          }
        }

        // 2. 새로운 채널 데이터를 API URL로 변환하고 정리합니다.
        const resolvedChannels = {
          myChannels: { blogs: [], youtubes: [] },
          competitorChannels: { blogs: [], youtubes: [] },
        };

        // '내 채널' 블로그 처리 (객체 배열)
        if (newChannelData.myChannels?.blogs) {
          const blogPromises = newChannelData.myChannels.blogs.map(
            async (blog) => ({
              inputUrl: blog.url.trim(),
              apiUrl: await resolveBlogUrl(blog.url.trim()),
              gaPropertyId: blog.gaPropertyId || null,
            })
          );
          resolvedChannels.myChannels.blogs = (
            await Promise.all(blogPromises)
          ).filter((c) => c.apiUrl);
        }

        // '경쟁 채널' 블로그 처리 (문자열 배열)
        if (newChannelData.competitorChannels?.blogs) {
          const blogPromises = newChannelData.competitorChannels.blogs.map(
            async (url) => ({
              inputUrl: url.trim(),
              apiUrl: await resolveBlogUrl(url.trim()),
              gaPropertyId: null,
            })
          );
          resolvedChannels.competitorChannels.blogs = (
            await Promise.all(blogPromises)
          ).filter((c) => c.apiUrl);
        }

        // 유튜브 채널 처리 (문자열 배열)
        for (const type of ["myChannels", "competitorChannels"]) {
          if (newChannelData[type]?.youtubes) {
            const youtubePromises = newChannelData[type].youtubes.map(
              async (url) => ({
                inputUrl: url.trim(),
                apiUrl: await resolveYoutubeUrl(url.trim(), youtubeApiKey),
              })
            );
            resolvedChannels[type].youtubes = (
              await Promise.all(youtubePromises)
            ).filter((c) => c.apiUrl);
          }
        }

        // 3. 최종적으로 API 키와 정리된 채널 데이터를 저장합니다.
        await chrome.storage.local.set({ youtubeApiKey, geminiApiKey });
        await channelsRef.set(resolvedChannels);

        sendResponse({
          success: true,
          message:
            "채널 정보가 저장되었습니다. 백그라운드에서 데이터 수집을 시작합니다.",
        });

        // 4. 백그라운드에서 데이터 수집 및 UI 새로고침 신호를 보냅니다.
        fetchAllChannelData().then(() => {
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs
                  .sendMessage(tab.id, { action: "cp_data_refreshed" })
                  .catch((e) => {});
              }
            });
          });
        });
      } catch (error) {
        console.error("채널 저장/업데이트 처리 중 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "get_channels_and_key") {
    const userId = "default_user";
    Promise.all([
      chrome.storage.local.get(["youtubeApiKey", "geminiApiKey"]),
      firebase.database().ref(`channels/${userId}`).once("value"),
    ])
      .then(([storage, snapshot]) => {
        const rawChannelData = snapshot.val() || {};

        const channelDataForUI = {
          myChannels: {
            blogs: rawChannelData.myChannels?.blogs || [], // 객체 배열 전체를 전달
            youtubes: (rawChannelData.myChannels?.youtubes || []).map(
              (c) => c.inputUrl
            ),
          },
          competitorChannels: {
            blogs: (rawChannelData.competitorChannels?.blogs || []).map(
              (c) => c.inputUrl
            ),
            youtubes: (rawChannelData.competitorChannels?.youtubes || []).map(
              (c) => c.inputUrl
            ),
          },
        };

        const responseData = {
          ...channelDataForUI,
          youtubeApiKey: storage.youtubeApiKey,
          geminiApiKey: storage.geminiApiKey,
        };
        sendResponse({ success: true, data: responseData });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  } else if (msg.action === "delete_channel") {
    (async () => {
      try {
        await deleteChannelData(msg.url);
        sendResponse({ success: true });
      } catch (error) {
        console.error("채널 삭제 처리 중 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "get_channel_content") {
    const userId = "default_user";
    Promise.all([
      firebase.database().ref("channel_content").once("value"),
      firebase.database().ref("channel_meta").once("value"),
      firebase.database().ref(`channels/${userId}`).once("value"),
    ])
      .then(([contentSnap, metaSnap, channelsSnap]) => {
        const content = contentSnap.val() || {};
        const metas = metaSnap.val() || {};
        const channels = channelsSnap.val() || {
          myChannels: {},
          competitorChannels: {},
        };

        const blogs = Object.values(content.blogs || {}).filter(
          (item) => item !== null
        );
        const youtubes = Object.values(content.youtubes || {}).filter(
          (item) => item !== null
        );
        const allContent = [...blogs, ...youtubes];

        const responseData = {
          content: allContent,
          metas: metas,
          channels: channels,
        };

        sendResponse({ success: true, data: responseData });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  } else if (msg.action === "refresh_channel_data") {
    const { sourceId, platform } = msg;

    const userId = "default_user";
    firebase
      .database()
      .ref(`channels/${userId}`)
      .once("value", (snapshot) => {
        const channels = snapshot.val();
        if (!channels) {
          sendResponse({ success: false, error: "설정된 채널이 없습니다." });
          return;
        }

        let channelToFetch = null;
        let channelType = null;

        for (const type of ["myChannels", "competitorChannels"]) {
          const blogs = channels[type]?.blogs || [];
          const channel = blogs.find(
            (c) => btoa(c.apiUrl).replace(/=/g, "") === sourceId
          );
          if (channel) {
            channelToFetch = channel;
            channelType = type;
            break;
          }
        }

        if (!channelToFetch) {
          for (const type of ["myChannels", "competitorChannels"]) {
            const youtubes = channels[type]?.youtubes || [];
            const channel = youtubes.find((c) => c.apiUrl === sourceId);
            if (channel) {
              channelToFetch = channel;
              channelType = type;
              break;
            }
          }
        }

        if (channelToFetch) {
          if (platform === "blog") {
            fetchRssFeed(channelToFetch.apiUrl, channelType);
          } else if (platform === "youtube") {
            fetchYoutubeChannel(channelToFetch.apiUrl, channelType);
          }
          sendResponse({ success: true, message: "데이터 수집을 시작합니다." });
        } else {
          sendResponse({
            success: false,
            error: "요청한 채널을 찾을 수 없습니다.",
          });
        }
      });
    return true;
  } else if (msg.action === "clear_blog_content") {
    firebase
      .database()
      .ref("channel_content/blogs")
      .remove()
      .then(() =>
        sendResponse({
          success: true,
          message:
            "블로그 콘텐츠 데이터가 성공적으로 삭제되었습니다. 새로고침 후 재수집해주세요.",
        })
      )
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // AI 분석 및 아이디어
  else if (msg.action === "analyze_my_channel") {
    const { channelName, channelContent } = msg.data; // 채널 이름과 데이터를 분리
    const analysisDate = new Date().toLocaleDateString("ko-KR"); // 'YYYY. M. D.' 형식의 날짜 생성

    const dataSummary = channelContent
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 20)
      .map(
        (item) =>
          `제목: ${item.title}, 조회수: ${item.viewCount || 0}, 좋아요: ${
            item.likeCount || 0
          }`
      )
      .join("\n");

    const youtubeAnalysisPrompt = `
            ## "${channelName}" 유튜브 채널 성과 분석 (${analysisDate})

            당신은 전문 콘텐츠 전략가입니다. 아래 제공되는 유튜브 채널의 영상 데이터 목록을 분석해주세요.
            
            [데이터]
            ${dataSummary}

            [분석 요청]
            1. 어떤 주제의 영상들이 가장 높은 조회수와 좋아요를 기록했나요? (상위 3개 주제)
            2. 성공적인 영상들의 제목이나 내용에서 나타나는 공통적인 패턴이나 키워드는 무엇인가요?
            3. 위 분석 결과를 바탕으로, 이 채널이 다음에 만들면 성공할 만한 새로운 콘텐츠 아이디어 3가지를 구체적인 제목 예시와 함께 제안해주세요.

            결과는 한국어로, 친절하고 이해하기 쉬운 보고서 형식으로 작성해주세요.
        `;

    (async () => {
      const analysisResult = await callGeminiAPI(youtubeAnalysisPrompt);
      sendResponse({ success: true, analysis: analysisResult });
    })();

    return true;
  } else if (msg.action === "generate_content_ideas") {
    const { myContent, competitorContent, myAnalysisSummary } = msg.data;

    const myDataSummary = myContent
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 10)
      .map((item) => ` - ${item.title} (조회수: ${item.viewCount})`)
      .join("\n");

    const competitorDataSummary = competitorContent
      .sort((a, b) => (b.viewCount || 0) - (a.viewCount || 0))
      .slice(0, 10)
      .map((item) => ` - ${item.title} (조회수: ${item.viewCount})`)
      .join("\n");

    const youtubeIdeasPrompt = `
            당신은 최고의 유튜브 콘텐츠 전략가입니다. 아래 세 가지 정보를 종합하여, 나의 강점을 활용해 경쟁자를 이길 수 있는 새로운 아이디어 5가지를 제안해주세요.

            [정보 1: 내 채널의 핵심 성공 요인]
            ${myAnalysisSummary}

            [정보 2: 내 채널의 인기 영상 목록]
            ${myDataSummary}

            [정보 3: 경쟁 채널의 인기 영상 목록]
            ${competitorDataSummary}

            [요청]
            나의 핵심 성공 요인(정보 1)을 바탕으로, 경쟁 채널의 인기 요소(정보 3)를 전략적으로 결합하거나, 혹은 경쟁자보다 더 나은 가치를 제공할 수 있는 새로운 아이디어 5가지를 제안해주세요.
            각 아이디어는 "### 아이디어 제목" 형식으로 시작하고, 왜 이 아이디어가 전략적으로 유효한지에 대한 설명을 반드시 포함해주세요.
        `;

    (async () => {
      const ideasResult = await callGeminiAPI(youtubeIdeasPrompt);
      sendResponse({ success: true, ideas: ideasResult });
    })();

    return true;
  } else if (msg.action === "analyze_my_blog") {
    const { channelName, channelContent } = msg.data; // 채널 이름과 데이터를 분리
    const analysisDate = new Date().toLocaleDateString("ko-KR"); // 날짜 생성

    const topPosts = channelContent
      .sort((a, b) => (b.commentCount || 0) - (a.commentCount || 0))
      .slice(0, 20);

    const dataSummary = topPosts
      .map(
        (item) =>
          `제목: ${item.title}, 댓글: ${item.commentCount || 0}, 좋아요: ${
            item.likeCount || 0
          }, 글자수: ${item.textLength || 0}`
      )
      .join("\n");

    const titleList = topPosts
      .map((item, index) => `${index + 1}. ${item.title}`)
      .join("\n");

    const blogAnalysisPrompt = `
            ## "${channelName}" 블로그 성과 분석 (${analysisDate})

            당신은 최고의 블로그 콘텐츠 전략가입니다. 아래 제공되는 데이터를 분석해주세요.

            [분석 대상 데이터 요약]
            ${dataSummary}

            [분석 요청]
            1. (기존 분석 요청 1, 2, 3과 동일)

            [출력 형식]
            - 모든 분석이 끝난 후, 보고서의 마지막에 다음 형식으로 분석에 사용된 데이터 목록을 반드시 포함해주세요.
            
            ### 분석 기반 데이터 (상위 ${topPosts.length}개)
            ${titleList}
        `;

    (async () => {
      const analysisResult = await callGeminiAPI(blogAnalysisPrompt);
      sendResponse({ success: true, analysis: analysisResult });
    })();

    return true;
  } else if (msg.action === "ai_generate_images") {
    // Gemini 2.5 Flash Image REST API 연동
    (async () => {
      try {
        const {
          prompt = "",
          style = "none",
          aspect = "1:1",
          count = 3,
        } = msg.data || {};
        // 1. Gemini API 키를 안전하게 가져오기
        const { geminiApiKey } = await chrome.storage.local.get([
          "geminiApiKey",
        ]);
        if (!geminiApiKey) {
          sendResponse({
            success: false,
            error: "Gemini API 키가 설정되지 않았습니다.",
          });
          return;
        }

        // 2. 프롬프트 및 옵션 구성
        const model = "gemini-2.5-flash";
        const API_URL = `https://generativelanguage.googleapis.com/v1/models/${model}:generateContent?key=${geminiApiKey}`;
        // 3. 여러 장 요청: Gemini는 1회 1장만 반환하므로 count만큼 반복 호출
        const images = [];
        for (let i = 0; i < count; i++) {
          const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
            }),
          });
          const data = await res.json();
          if (!res.ok || !data.candidates) {
            sendResponse({
              success: false,
              error: data.error?.message || "Gemini 이미지 생성 실패",
            });
            return;
          }
          let found = false;
          for (const part of data.candidates[0].content.parts) {
            if (part.inlineData && part.inlineData.data) {
              images.push(`data:image/png;base64,${part.inlineData.data}`);
              found = true;
            }
          }
          if (!found) {
            sendResponse({
              success: false,
              error: "이미지 생성 결과가 없습니다.",
            });
            return;
          }
        }
        sendResponse({ success: true, images });
      } catch (e) {
        sendResponse({
          success: false,
          error: e?.message || "Gemini 호출 오류",
        });
      }
    })();
    return true;
  } else if (msg.action === "analyze_video_comments") {
    const videoId = msg.videoId;
    (async () => {
      const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");
      if (!youtubeApiKey) {
        sendResponse({
          success: false,
          error: "YouTube API 키가 설정되지 않았습니다.",
        });
        return;
      }

      const commentsUrl = `https://www.googleapis.com/youtube/v3/commentThreads?key=${youtubeApiKey}&videoId=${videoId}&part=snippet&maxResults=50&order=relevance`;

      try {
        const commentsResponse = await fetch(commentsUrl);
        const commentsData = await commentsResponse.json();

        if (commentsData.error) {
          throw new Error(commentsData.error.message);
        }

        const comments = commentsData.items.map(
          (item) => item.snippet.topLevelComment.snippet.textOriginal
        );
        if (comments.length === 0) {
          sendResponse({ success: false, error: "분석할 댓글이 없습니다." });
          return;
        }

        const commentsSummary = comments.join("\n---\n");

        const commentAnalysisPrompt = `
                당신은 데이터 분석가이자 콘텐츠 전략가입니다. 아래는 특정 유튜브 영상에 달린 시청자들의 댓글 모음입니다. 이 댓글들을 분석하여 채널 운영자에게 유용한 인사이트와 새로운 콘텐츠 아이디어를 제공해주세요.

                [댓글 데이터]
                ${commentsSummary}

                [분석 및 제안 요청]
                1. **핵심 니즈 파악**: 댓글에서 공통적으로 나타나는 시청자들의 질문, 문제점, 또는 원하는 정보를 3가지 핵심 주제로 요약해주세요.
                2. **콘텐츠 아이디어 제안**: 위에서 파악한 니즈를 해결해 줄 수 있는 새로운 유튜브 영상 아이디어 3가지를 제안해주세요.
                3. 각 아이디어는 **매력적인 유튜브 제목**과 **영상의 핵심 내용을 설명하는 짧은 문장**을 포함해야 합니다.
                4. 결과는 마크다운 형식으로 보기 좋게 정리해주세요.
            `;

        const analysisResult = await callGeminiAPI(commentAnalysisPrompt);
        sendResponse({ success: true, analysis: analysisResult });
      } catch (error) {
        console.error("댓글 조회 또는 분석 중 오류 발생:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();

    return true;
  }

  // Google 계정 연동
  else if (msg.action === "start_google_auth") {
    (async () => {
      try {
        // 1. 토큰 발급 (기존과 동일)
        const token = await new Promise((resolve, reject) => {
          chrome.identity.getAuthToken({ interactive: true }, (token) => {
            if (chrome.runtime.lastError)
              reject(new Error(chrome.runtime.lastError.message));
            else resolve(token);
          });
        });
        if (!token) throw new Error("인증 토큰을 받아오지 못했습니다.");

        // 2. 이메일, GA4 속성, 애드센스 ID를 병렬로 가져오기 (기존과 동일)
        const [userInfoResponse, gaProperties, adSenseAccountId] =
          await Promise.all([
            fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
              headers: { Authorization: `Bearer ${token}` },
            }),
            fetchGaProperties(token),
            fetchAdSenseAccountId(token),
          ]);
        const userInfo = await userInfoResponse.json();
        if (!userInfo.email)
          throw new Error("사용자 이메일을 가져오지 못했습니다.");

        // 3. 모든 정보를 chrome.storage에 저장 (기존과 동일)
        await chrome.storage.local.set({
          googleAuthToken: token,
          googleUserEmail: userInfo.email,
          gaProperties: gaProperties,
          adSenseAccountId: adSenseAccountId,
        });

        // ▼▼▼ [수정] UI 업데이트에 필요한 모든 데이터를 함께 보냅니다. ▼▼
        const responseData = {
          email: userInfo.email,
          gaProperties: gaProperties,
          adSenseAccountId: adSenseAccountId,
        };
        sendResponse({ success: true, data: responseData });
      } catch (error) {
        console.error("Google 인증 중 오류 발생:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  } else if (msg.action === "revoke_google_auth") {
    (async () => {
      try {
        const { googleAuthToken } = await chrome.storage.local.get(
          "googleAuthToken"
        );
        if (googleAuthToken) {
          // 1. 현재 토큰을 무효화합니다.
          await fetch(
            `https://oauth2.googleapis.com/revoke?token=${googleAuthToken}`
          );
          // 2. Chrome의 인증 캐시에서도 제거합니다.
          await new Promise((resolve) =>
            chrome.identity.removeCachedAuthToken(
              { token: googleAuthToken },
              resolve
            )
          );
        }

        // 3. storage에 저장된 모든 관련 정보를 삭제합니다.
        await chrome.storage.local.remove([
          "googleAuthToken",
          "googleUserEmail",
          "gaProperties",
          "adSenseAccountId",
          "selectedGaPropertyId",
        ]);

        sendResponse({ success: true });
      } catch (error) {
        console.error("Google 연동 해제 중 오류:", error);
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // 칸반 보드 및 워크스페이스
  if (msg.action === "get_kanban_data") {
    // 1. 요청한 탭에 현재 데이터를 즉시 보냅니다.
    firebase
      .database()
      .ref("kanban")
      .once("value", (snapshot) => {
        if (sender.tab?.id) {
          chrome.tabs
            .sendMessage(sender.tab.id, {
              action: "kanban_data_updated",
              data: snapshot.val() || {},
            })
            .catch((e) => {}); // 오류는 무시
        }
      });

    // 2. 실시간 리스너가 아직 등록되지 않았다면, 한 번만 등록합니다.
    if (!isKanbanListenerActive) {
      firebase
        .database()
        .ref("kanban")
        .on("value", (snapshot) => {
          const allCards = snapshot.val() || {};

          // 모든 탭에 데이터 변경 사항을 브로드캐스트합니다.
          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id) {
                chrome.tabs
                  .sendMessage(tab.id, {
                    action: "kanban_data_updated",
                    data: allCards,
                  })
                  .catch((e) => {});
              }
            });
          });
        });
      isKanbanListenerActive = true;
      console.log("Firebase 칸반 데이터 실시간 리스너를 활성화했습니다.");
    }
    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "move_kanban_card") {
    const { cardId, originalStatus, newStatus } = msg.data;
    const originalRef = firebase
      .database()
      .ref(`kanban/${originalStatus}/${cardId}`);
    originalRef.once("value", (snapshot) => {
      const cardData = snapshot.val();
      if (cardData) {
        const newRef = firebase.database().ref(`kanban/${newStatus}/${cardId}`);
        originalRef
          .remove()
          .then(() => newRef.set(cardData))
          .then(() => sendResponse({ success: true }))
          .catch((error) =>
            sendResponse({ success: false, error: error.message })
          );
      } else {
        sendResponse({
          success: false,
          error: "이동할 카드를 찾을 수 없습니다.",
        });
      }
    });
    return true;
  } else if (msg.action === "link_published_url") {
    const { cardId, url, status } = msg.data;
    if (!cardId || !url || !status) {
      sendResponse({ success: false, error: "필요한 정보가 부족합니다." });
      return true;
    }

    const cardRef = firebase.database().ref(`kanban/${status}/${cardId}`);
    cardRef
      .update({
        publishedUrl: url,
        performanceTracked: true,
      })
      .then(() => {
        console.log(`[G-16] 아이디어 카드(${cardId})와 URL(${url}) 연결 완료.`);
        sendResponse({ success: true });
        updateSinglePerformanceMetric({
          id: cardId,
          path: `kanban/${status}/${cardId}`,
          url: url,
        });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  } else if (msg.action === "add_idea_to_kanban") {
    const ideaObjectString = msg.data;

    if (!ideaObjectString) {
      sendResponse({ success: false, error: "아이디어 내용이 없습니다." });
      return true;
    }

    try {
      const ideaData = JSON.parse(ideaObjectString);

      const newCard = {
        title: ideaData.title || "제목 없음",
        description: ideaData.description || "",
        tags: ["#AI-추천", ...(ideaData.keywords || [])],
        recommendedKeywords: ideaData.recommendedSearches || [],
        outline: ideaData.outline || [],
        createdAt: Date.now(),
        longTailKeywords: ideaData.longTailKeywords || [],
        createdAt: Date.now(),
      };

      const newCardRef = firebase.database().ref("kanban/ideas").push();
      const newCardKey = newCardRef.key;

      newCardRef
        .set(newCard)
        .then(() => {
          sendResponse({ success: true, firebaseKey: newCardKey });
        })
        .catch((e) => {
          sendResponse({ success: false, error: e.message });
        });
    } catch (e) {
      // 여기서 파싱 에러가 발생하면, 프론트엔드에서 데이터가 잘못 전달된 것입니다.
      console.error(
        "add_idea_to_kanban 파싱 오류:",
        e,
        "전달받은 문자열:",
        ideaObjectString
      );
      sendResponse({
        success: false,
        error: "아이디어 데이터 파싱에 실패했습니다.",
      });
    }

    return true;
  } else if (msg.action === "remove_idea_from_kanban") {
    const firebaseKey = msg.key;
    if (!firebaseKey) {
      sendResponse({
        success: false,
        error: "삭제할 아이디어의 키가 없습니다.",
      });
      return true;
    }

    firebase
      .database()
      .ref(`kanban/ideas/${firebaseKey}`)
      .remove()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true; // 비동기 응답을 위해 true 반환
  } else if (msg.action === "link_scrap_to_idea") {
    const { ideaId, scrapId, status } = msg.data;
    if (!ideaId || !scrapId || !status) {
      sendResponse({
        success: false,
        error: "아이디어, 스크랩 ID 또는 상태가 없습니다.",
      });
      return true;
    }
    const scrapLinkRef = firebase
      .database()
      .ref(`kanban/${status}/${ideaId}/linkedScraps/${scrapId}`);
    scrapLinkRef
      .set(true)
      .then(() => sendResponse({ success: true }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  } else if (msg.action === "unlink_scrap_from_idea") {
    const { ideaId, scrapId, status } = msg.data;
    if (!ideaId || !scrapId || !status) {
      sendResponse({
        success: false,
        error: "ID 또는 상태가 유효하지 않습니다.",
      });
      return true;
    }

    const scrapLinkRef = firebase
      .database()
      .ref(`kanban/${status}/${ideaId}/linkedScraps/${scrapId}`);
    scrapLinkRef
      .remove()
      .then(() => {
        sendResponse({ success: true });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true;
  } else if (msg.action === "generate_draft_from_idea") {
    const ideaData = msg.data;
    (async () => {
      // 1. 모든 키워드를 수집하고 중복을 제거합니다.
      const allKeywords = new Set([
        ...(ideaData.tags || []).filter((t) => t !== "#AI-추천"),
        ...(ideaData.longTailKeywords || []),
      ]);
      const keywordsText = Array.from(allKeywords).join("\n- ");

      // 2. 연결된 자료 텍스트를 프롬프트 형식으로 만듭니다.
      const linkedScrapsText = (ideaData.linkedScrapsContent || [])
        .map((scrap, index) => `[참고 자료 ${index + 1}]\n${scrap.text}\n`)
        .join("\n");

      // 3. 모든 정보를 종합하여 '마스터 프롬프트'를 생성합니다.
      const prompt = `
            당신은 특정 주제에 대한 전문 작가입니다. 아래 제공된 모든 정보를 활용하여, SEO에 최적화되고 독자의 흥미를 끄는 완성도 높은 블로그 포스트 초안을 작성해주세요.

            ### 1. 최종 주제
            - ${ideaData.title}

            ### 2. 핵심 요약
            - ${ideaData.description || "주제에 대한 상세 설명"}

            ### 3. 현재까지 작성된 초안 (이 내용을 바탕으로 발전시켜주세요)
            ${ideaData.currentDraft || "(비어 있음)"}

            ### 4. 글의 구조 (이 목차를 반드시 따라주세요)
            ${(ideaData.outline || []).join("\n")}

            ### 5. 반드시 포함할 키워드 (중복 제거된 최종 목록)
            - ${keywordsText}

            ### 6. 핵심 참고 자료 (이 내용들을 근거로 본문을 작성해주세요)
            ${linkedScrapsText || "참고 자료 없음"}

            [작성 규칙]
            1. '현재까지 작성된 초안'이 비어있지 않다면, 그 내용을 존중하여 이어서 작성하거나 내용을 더 풍부하게 만들어주세요.
            2. '글의 최종 목표 구조'를 반드시 지켜주세요.
            3. '핵심 참고 자료'의 내용을 단순 요약하지 말고, 자연스럽게 인용하거나 재해석하여 본문을 풍부하게 만들어주세요.
        `;
      // 기존에 만들어둔 Gemini API 호출 함수를 재사용합니다.
      const draft = await callGeminiAPI(prompt);
      if (draft && !draft.startsWith("오류:")) {
        sendResponse({ success: true, draft: draft });
      } else {
        sendResponse({ success: false, error: draft });
      }
    })();

    return true; // 비동기 응답을 위해 true를 반환합니다.
  } else if (msg.action === "request_search_keywords") {
    const { cardId, status, title } = msg.data;

    (async () => {
      const keywordsRef = firebase
        .database()
        .ref(`kanban/${status}/${cardId}/recommendedKeywords`);
      const snapshot = await keywordsRef.once("value");
      const keywords = snapshot.val();

      if (keywords) {
        // 기존 키워드가 있으면 바로 전송
        if (sender.tab?.id) {
          chrome.tabs.sendMessage(sender.tab.id, {
            action: "search_queries_recommended",
            success: true,
            data: keywords,
            cardId,
            status,
            cardTitle: title,
          });
        }
      } else {
        // 기존 키워드가 없으면 새로 생성
        await generateAndSendKeywords(msg.data, sender);
      }
    })();
    return true;
  } else if (msg.action === "regenerate_search_keywords") {
    (async () => {
      await generateAndSendKeywords(msg.data, sender);
    })();
    return true;
  } else if (msg.action === "link_published_url") {
    const { cardId, url, status } = msg.data;
    if (!cardId || !url || !status) {
      sendResponse({ success: false, error: "필요한 정보가 부족합니다." });
      return true;
    }

    const cardRef = firebase.database().ref(`kanban/${status}/${cardId}`);
    cardRef
      .update({
        publishedUrl: url,
        performanceTracked: true,
      })
      .then(() => {
        console.log(`[G-16] 아이디어 카드(${cardId})와 URL(${url}) 연결 완료.`);
        sendResponse({ success: true });
        updateSinglePerformanceMetric({
          id: cardId,
          path: `kanban/${status}/${cardId}`,
          url: url,
        });
      })
      .catch((error) => sendResponse({ success: false, error: error.message }));

    return true;
  } else if (msg.action === "save_draft_content") {
    const { ideaId, status, draft } = msg.data;
    if (!ideaId || !status) {
      sendResponse({ success: false, error: "Idea ID or status is missing." });
      return true;
    }

    const currentRef = firebase.database().ref(`kanban/${status}/${ideaId}`);
    const newStatus = "in-progress";

    currentRef
      .once("value")
      .then((snapshot) => {
        const cardData = snapshot.val();
        if (!cardData) throw new Error("Card data not found for move.");

        const updates = { draftContent: draft };
        let movePromise = Promise.resolve();

        // 'ideas' 컬럼에 있을 때만 이동
        if (status === "ideas") {
          const newRef = firebase
            .database()
            .ref(`kanban/${newStatus}/${ideaId}`);
          const dataToMove = { ...cardData, ...updates };
          movePromise = newRef.set(dataToMove).then(() => currentRef.remove());
        } else {
          movePromise = currentRef.update(updates);
        }

        return movePromise;
      })
      .then(() => {
        sendResponse({
          success: true,
          moved: status === "ideas",
          newStatus: status === "ideas" ? newStatus : status,
        });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });

    return true;
  }
});

// Util: create a simple PNG data URL with text
function generatePlaceholderImage({
  width = 768,
  height = 768,
  text = "AI Image",
  subtitle = "",
}) {
  return new Promise((resolve) => {
    try {
      // OffscreenCanvas is available in service worker contexts in modern Chrome
      let canvas;
      if (typeof OffscreenCanvas !== "undefined") {
        canvas = new OffscreenCanvas(width, height);
      } else {
        // Fallback size
        canvas = new OffscreenCanvas(512, 512);
      }
      const ctx = canvas.getContext("2d");
      // background gradient
      const grad = ctx.createLinearGradient(0, 0, width, height);
      grad.addColorStop(0, "#1a73e8");
      grad.addColorStop(1, "#4285f4");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      // rounded rectangle overlay
      const pad = Math.round(Math.min(width, height) * 0.06);
      const r = Math.round(Math.min(width, height) * 0.04);
      drawRoundedRect(ctx, pad, pad, width - pad * 2, height - pad * 2, r);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fill();

      // title text
      ctx.fillStyle = "#ffffff";
      ctx.font = `bold ${Math.round(
        Math.min(width, height) * 0.06
      )}px ui-sans-serif,system-ui,Segoe UI`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      wrapText(
        ctx,
        text,
        width / 2,
        height / 2 - Math.round(height * 0.06),
        Math.round(width * 0.7),
        Math.round(Math.min(width, height) * 0.08)
      );

      // subtitle
      ctx.font = `500 ${Math.round(
        Math.min(width, height) * 0.035
      )}px ui-sans-serif,system-ui,Segoe UI`;
      ctx.fillStyle = "rgba(255,255,255,0.9)";
      wrapText(
        ctx,
        subtitle,
        width / 2,
        height / 2 + Math.round(height * 0.14),
        Math.round(width * 0.75),
        Math.round(Math.min(width, height) * 0.06)
      );

      const blobPromise = canvas.convertToBlob
        ? canvas.convertToBlob({ type: "image/png", quality: 0.92 })
        : new Promise((res) => canvas.toBlob(res));
      blobPromise.then((blob) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    } catch (e) {
      console.warn(
        "Placeholder canvas not available, fetching fallback image and converting to Data URL"
      );
      const url = `https://dummyimage.com/${width}x${height}/4285f4/ffffff.png&text=AI+Image`;
      fetch(url)
        .then((r) => r.blob())
        .then((blob) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.readAsDataURL(blob);
        })
        .catch(() =>
          resolve(
            "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGMAAQAABQABF3n2NQAAAABJRU5ErkJggg=="
          )
        );
    }
  });
}

function drawRoundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
  const words = String(text || "").split(" ");
  let line = "";
  let yy = y;
  const lines = [];
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + " ";
    const metrics = ctx.measureText(testLine);
    if (metrics.width > maxWidth && n > 0) {
      lines.push(line);
      line = words[n] + " ";
    } else {
      line = testLine;
    }
  }
  lines.push(line);
  const totalHeight = lines.length * lineHeight;
  yy -= totalHeight / 2;
  lines.forEach((l, i) => ctx.fillText(l.trim(), x, yy + i * lineHeight));
}

function truncate(str, max) {
  return (str || "").length > max ? str.slice(0, max - 1) + "…" : str;
}

// --- 3. 주기적 데이터 수집 로직 ---

chrome.runtime.onInstalled.addListener(() => {
  console.log("Content Pilot 설치됨. 알람을 설정합니다.");
  chrome.storage.local.set({
    isScrapingActive: false,
    highlightToggleState: false,
  });
  chrome.alarms.create("fetch-channels", {
    delayInMinutes: 1,
    periodInMinutes: 240,
  });
  chrome.alarms.create("update-performance-metrics", {
    delayInMinutes: 5,
    periodInMinutes: 360,
  });
});

chrome.runtime.onStartup.addListener(() => {
  console.log("Content Pilot 시작됨. 알람을 확인/설정합니다.");
  chrome.alarms.get("fetch-channels", (alarm) => {
    if (!alarm) {
      chrome.alarms.create("fetch-channels", {
        delayInMinutes: 1,
        periodInMinutes: 240,
      });
    }
  });
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fetch-channels") {
    console.log("알람 발생: 모든 채널 데이터를 수집합니다...");
    fetchAllChannelData();
  } else if (alarm.name === "update-performance-metrics") {
    console.log("알람 발생: 발행된 콘텐츠의 성과 지표를 업데이트합니다...");
    updateAllPerformanceMetrics();
  }
});

// --- 4. 데이터 수집 함수들 ---
async function fetchAllChannelData() {
  const userId = "default_user";
  // .once('value')는 Promise를 반환하므로 await를 사용합니다.
  const snapshot = await firebase
    .database()
    .ref(`channels/${userId}`)
    .once("value");
  const channels = snapshot.val();
  if (!channels) {
    console.log("설정된 채널 정보가 없습니다.");
    return; // Promise<void>를 반환하며 종료
  }

  const promises = [];
  ["myChannels", "competitorChannels"].forEach((type) => {
    if (channels[type]) {
      // 각 fetch 함수 호출을 promises 배열에 추가합니다.
      channels[type].blogs?.forEach((channel) =>
        promises.push(fetchRssFeed(channel.apiUrl, type))
      );
      channels[type].youtubes?.forEach((channel) =>
        promises.push(fetchYoutubeChannel(channel.apiUrl, type))
      );
    }
  });

  // 모든 데이터 수집 작업이 끝날 때까지 기다립니다.
  await Promise.all(promises);
  console.log("모든 채널 데이터 수집 완료.");
}

// --- ▼▼▼ [하이브리드 방식] 블로그 데이터 수집 함수 수정 ▼▼▼ ---
// background.js

async function fetchRssFeed(url, channelType) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const text = await response.text();

    let channelTitle = null;

    // 1단계: <channel> 태그 안에서 title 찾기 (RSS 2.0 방식)
    const channelBlockMatch = text.match(/<channel>([\s\S]*?)<\/channel>/);
    if (channelBlockMatch && channelBlockMatch[1]) {
      const titleInChannelMatch = channelBlockMatch[1].match(
        /<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
      );
      if (titleInChannelMatch && titleInChannelMatch[1]) {
        channelTitle = titleInChannelMatch[1];
      }
    }

    // 2단계: 1단계 실패 시, 첫 게시물(<item> 또는 <entry>) 이전의 <title> 찾기 (Atom 방식)
    if (!channelTitle) {
      const firstItemIndex = text.search(/<(item|entry)>/);
      const textBeforeItems =
        firstItemIndex > -1 ? text.substring(0, firstItemIndex) : text;
      const firstTitleMatch = textBeforeItems.match(
        /<title.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
      );
      if (firstTitleMatch && firstTitleMatch[1]) {
        channelTitle = firstTitleMatch[1].trim();
      }
    }

    const finalTitle = channelTitle || url;
    const sourceId = btoa(url).replace(/=/g, "");
    firebase.database().ref(`channel_meta/${sourceId}`).set({
      title: finalTitle,
      type: "blog",
      source: url,
      fetchedAt: Date.now(),
    });

    const items = text.match(/<(item|entry)>([\s\S]*?)<\/\1>/g) || [];

    for (const itemText of items.slice(0, 10)) {
      let itemLink = null;
      const atomLinkMatch = itemText.match(
        /<link[^>]*rel=["']alternate["'][^>]*href=["']([^"']*)["']/
      );
      if (atomLinkMatch && atomLinkMatch[1]) {
        itemLink = atomLinkMatch[1];
      } else {
        const rssLinkMatch = itemText.match(
          /<link>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/link>/
        );
        if (rssLinkMatch && rssLinkMatch[1]) {
          itemLink = rssLinkMatch[1];
        }
      }
      if (!itemLink) continue;

      // ▼▼▼ [수정] 게시물 제목과 날짜 추출 로직 변경 ▼▼▼
      const titleMatch = itemText.match(
        /<title.*?>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/
      );
      const pubDateMatch = itemText.match(
        /<(pubDate|published|updated)>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/\1>/
      );

      const title = titleMatch ? titleMatch[1] : "제목 없음";
      const timestamp = new Date(
        pubDateMatch ? pubDateMatch[2] : Date.now()
      ).getTime();
      // ▲▲▲ 수정 완료 ▲▲▲

      const fullLink = itemLink.replace(/\s/g, "");
      const linkForId = fullLink.split("?")[0];
      const contentId = btoa(linkForId).replace(/=/g, "");
      const contentRef = firebase
        .database()
        .ref(`channel_content/blogs/${contentId}`);

      const existingDataSnap = await contentRef.once("value");

      if (existingDataSnap.exists()) {
        const existingData = existingDataSnap.val();
        if (!existingData.tags && existingData.cleanText) {
          try {
            const tags = await extractKeywords(existingData.cleanText);
            if (tags) {
              contentRef.update({ tags: tags });
            }
          } catch (e) {
            console.error(`'${fullLink}' 태그 추가 중 오류:`, e);
          }
        }

        try {
          const postResponse = await fetch(fullLink);
          if (!postResponse.ok) continue;
          let postHtml = await postResponse.text();

          const naverIframeMatch = postHtml.match(
            /<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/
          );
          if (naverIframeMatch && naverIframeMatch[1]) {
            const iframeUrl = new URL(
              naverIframeMatch[1],
              "https://blog.naver.com"
            ).href;
            const iframeResponse = await fetch(iframeUrl);
            if (iframeResponse.ok) postHtml = await iframeResponse.text();
          }

          await getOffscreenDocument();
          const parsedData = await new Promise((resolve) => {
            chrome.runtime.sendMessage(
              {
                action: "parse_html_in_offscreen",
                html: postHtml,
                baseUrl: fullLink,
              },
              (response) => resolve(response)
            );
          });

          if (parsedData && parsedData.success) {
            contentRef.update({
              commentCount: parsedData.metrics.commentCount,
              likeCount: parsedData.metrics.likeCount || null,
              readTimeInSeconds: parsedData.metrics.readTimeInSeconds || null,
              fetchedAt: Date.now(),
            });
          }
        } catch (updateError) {
          console.error(`'${fullLink}' 가벼운 업데이트 중 오류:`, updateError);
        }
      } else {
        const postResponse = await fetch(fullLink);
        if (!postResponse.ok) continue;
        let postHtml = await postResponse.text();
        const naverIframeMatch = postHtml.match(
          /<iframe[^>]+id="mainFrame"[^>]+src="([^"]+)"/
        );
        if (naverIframeMatch && naverIframeMatch[1]) {
          const iframeUrl = new URL(
            naverIframeMatch[1],
            "https://blog.naver.com"
          ).href;
          const iframeResponse = await fetch(iframeUrl);
          if (iframeResponse.ok) postHtml = await iframeResponse.text();
        }

        await getOffscreenDocument();
        const parsedData = await new Promise((resolve) => {
          chrome.runtime.sendMessage(
            {
              action: "parse_html_in_offscreen",
              html: postHtml,
              baseUrl: fullLink,
            },
            (response) => {
              if (chrome.runtime.lastError)
                resolve({
                  success: false,
                  error: chrome.runtime.lastError.message,
                });
              else resolve(response);
            }
          );
        });

        if (parsedData && parsedData.success) {
          const tags = await extractKeywords(parsedData.cleanText);
          const finalData = {
            title: title, // 여기서 수정된 title이 사용됩니다.
            fullLink,
            pubDate: timestamp, // 여기서 수정된 timestamp가 사용됩니다.
            description: parsedData.description,
            thumbnail: parsedData.thumbnail,
            cleanText: parsedData.cleanText,
            sourceId,
            channelType,
            fetchedAt: Date.now(),
            ...parsedData.metrics,
            tags: tags || null,
          };
          const cleanedFinalData = cleanDataForFirebase(finalData);
          contentRef.set(cleanedFinalData);

          chrome.tabs.query({}, (tabs) => {
            tabs.forEach((tab) => {
              if (tab.id)
                chrome.tabs
                  .sendMessage(tab.id, {
                    action: "cp_item_updated",
                    data: cleanedFinalData,
                  })
                  .catch((e) => {});
            });
          });
        }
      }
    }
  } catch (error) {
    console.error(`Failed to fetch or parse RSS for ${url}:`, error);
  }
}

async function fetchYoutubeChannel(channelId, channelType) {
  const { youtubeApiKey } = await chrome.storage.local.get("youtubeApiKey");

  if (!youtubeApiKey) {
    console.warn(
      "YouTube API 키가 설정되지 않았습니다. YouTube 데이터 수집을 건너킵니다."
    );
    return;
  }

  let channelTitle = channelId;

  const channelInfoUrl = `https://www.googleapis.com/youtube/v3/channels?key=${youtubeApiKey}&id=${channelId}&part=snippet`;
  try {
    const channelInfoResponse = await fetch(channelInfoUrl);
    const channelInfoData = await channelInfoResponse.json();
    if (channelInfoData.items && channelInfoData.items.length > 0) {
      channelTitle = channelInfoData.items[0].snippet.title;
    }
  } catch (error) {
    console.error(`YouTube 채널 정보 조회 실패 (${channelId}):`, error);
  }

  const userId = "default_user";
  const channelDataSnap = await firebase
    .database()
    .ref(`channels/${userId}`)
    .once("value");
  const channelData = channelDataSnap.val();

  const allChannels = (channelData?.myChannels?.youtubes || []).concat(
    channelData?.competitorChannels?.youtubes || []
  );
  const storedChannel = allChannels.find((c) => c.apiUrl === channelId);
  const inputUrl = storedChannel ? storedChannel.inputUrl : channelId;

  firebase.database().ref(`channel_meta/${channelId}`).set({
    title: channelTitle,
    type: "youtube",
    source: channelId,
    inputUrl: inputUrl,
    fetchedAt: Date.now(),
  });

  const videoListUrl = `https://www.googleapis.com/youtube/v3/search?key=${youtubeApiKey}&channelId=${channelId}&part=id&order=date&maxResults=10`;
  try {
    const videoListResponse = await fetch(videoListUrl);
    const videoListData = await videoListResponse.json();
    if (!videoListData.items) {
      console.error(
        `YouTube 영상 목록 조회 오류 (${channelId}):`,
        videoListData.error?.message || "알 수 없는 오류"
      );
      return;
    }

    const videoIds = videoListData.items
      .map((item) => item.id.videoId)
      .filter(Boolean);
    if (videoIds.length === 0) return;

    const videoDetailsUrl = `https://www.googleapis.com/youtube/v3/videos?key=${youtubeApiKey}&id=${videoIds.join(
      ","
    )}&part=snippet,statistics`;
    const detailsResponse = await fetch(videoDetailsUrl);
    const detailsData = await detailsResponse.json();

    if (detailsData.items) {
      for (const item of detailsData.items) {
        const { id, snippet, statistics } = item;
        const existingDataSnap = await firebase
          .database()
          .ref(`channel_content/youtubes/${id}`)
          .once("value");
        const existingData = existingDataSnap.val();
        let tags =
          existingData && existingData.tags
            ? existingData.tags
            : await extractKeywords(snippet.description);

        const timestamp = new Date(snippet.publishedAt).getTime();
        const video = {
          videoId: id,
          title: snippet.title,
          description: snippet.description,
          publishedAt: timestamp,
          thumbnail: snippet.thumbnails?.default?.url,
          viewCount: statistics?.viewCount
            ? parseInt(statistics.viewCount, 10)
            : 0,
          likeCount: statistics?.likeCount
            ? parseInt(statistics.likeCount, 10)
            : 0,
          commentCount: statistics?.commentCount
            ? parseInt(statistics.commentCount, 10)
            : 0,
          channelId,
          sourceId: channelId,
          channelType,
          fetchedAt: Date.now(),
          tags: tags || null,
        };

        const cleanedVideoData = cleanDataForFirebase(video);
        firebase
          .database()
          .ref(`channel_content/youtubes/${cleanedVideoData.videoId}`)
          .set(cleanedVideoData);
      }
      console.log(`YouTube 채널 상세 정보 수집 성공: ${channelId}`);
    }
  } catch (error) {
    console.error(`YouTube 채널 데이터 수집 실패 (${channelId}):`, error);
  }
}

async function callGeminiAPI(prompt) {
  try {
    const { geminiApiKey } = await chrome.storage.local.get("geminiApiKey");
    if (!geminiApiKey) {
      return "오류: Gemini API 키가 설정되지 않았습니다. '채널 연동' 탭에서 API 키를 저장해주세요.";
    }

    const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`;

    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      const errorMessage =
        errorData.error?.message ||
        "자세한 내용은 서비스 워커 콘솔을 확인하세요.";
      return `오류: Gemini API 호출에 실패했습니다.\n상태: ${response.status}\n원인: ${errorMessage}`;
    }

    const responseData = await response.json();

    if (
      !responseData.candidates ||
      !responseData.candidates[0]?.content?.parts[0]?.text
    ) {
      return "오류: AI로부터 예상치 못한 형식의 응답을 받았습니다.";
    }

    return responseData.candidates[0].content.parts[0].text;
  } catch (error) {
    return "오류: AI 분석 중 예외가 발생했습니다. 개발자 콘솔을 확인해주세요.";
  }
}

// ▼▼▼ [추가] 성과 지표 수집을 위한 함수들 ▼▼▼

/**
 * 발행된 모든 콘텐츠의 성과 지표를 업데이트합니다.
 */
async function updateAllPerformanceMetrics() {
  const kanbanRef = firebase.database().ref("kanban");
  const snapshot = await kanbanRef.once("value");
  const allCards = snapshot.val() || {};

  const promises = [];
  for (const status in allCards) {
    for (const cardId in allCards[status]) {
      const card = allCards[status][cardId];
      if (card.performanceTracked && card.publishedUrl) {
        promises.push(
          updateSinglePerformanceMetric({
            id: cardId,
            path: `kanban/${status}/${cardId}`,
            url: card.publishedUrl,
          })
        );
      }
    }
  }
  await Promise.all(promises);
  console.log("모든 콘텐츠의 성과 지표 업데이트 완료.");
}

/**
 * 단일 콘텐츠의 GA 및 AdSense 데이터를 가져와 Firebase에 업데이트합니다.
 * @param {object} contentInfo - { id, path, url }
 */
async function updateSinglePerformanceMetric(contentInfo) {
  try {
    // 저장된 Google 인증 정보 및 채널 연동 시 설정한 ID들을 가져옵니다.
    const { googleAuthToken, myChannels } = await new Promise((resolve) =>
      chrome.storage.local.get(["googleAuthToken", "channels"], (result) => {
        resolve({
          googleAuthToken: result.googleAuthToken,
          myChannels: result.channels?.myChannels || { blogs: [] },
        });
      })
    );
    const { adSenseAccountId } = await chrome.storage.local.get(
      "adSenseAccountId"
    );

    if (!googleAuthToken) {
      console.warn(
        "Google 계정이 연동되지 않아 성과 지표를 수집할 수 없습니다."
      );
      return;
    }

    // 블로그 URL을 기반으로 해당 블로그에 설정된 GA Property ID를 찾습니다.
    const blogInfo = myChannels.blogs.find((b) =>
      contentInfo.url.includes(new URL(b.inputUrl).hostname)
    );
    const gaPropertyId = blogInfo?.gaPropertyId;

    if (!gaPropertyId || !adSenseAccountId) {
      console.warn(
        `성과 지표 수집에 필요한 ID가 없습니다. (GA: ${gaPropertyId}, AdSense: ${adSenseAccountId})`
      );
      return;
    }

    const [analyticsData, adsenseData] = await Promise.all([
      getAnalyticsData(googleAuthToken, gaPropertyId, contentInfo.url),
      getAdsenseData(googleAuthToken, adSenseAccountId, contentInfo.url),
    ]);

    const performanceData = {
      ...analyticsData,
      ...adsenseData,
      lastUpdatedAt: Date.now(),
    };

    // Firebase에 'performance' 자식 노드로 데이터 업데이트
    await firebase
      .database()
      .ref(contentInfo.path)
      .child("performance")
      .update(performanceData);
    console.log(`[G-14] 콘텐츠(${contentInfo.url}) 성과 지표 업데이트 완료.`);
  } catch (error) {
    console.error(
      `성과 지표 업데이트 중 오류 발생 (${contentInfo.url}):`,
      error
    );
  }
}

/**
 * [G-14] Google Analytics Data API를 호출하여 지표를 가져옵니다. (구현 필요)
 */
async function getAnalyticsData(token, propertyId, url) {
  const API_URL = `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`;
  const pagePath = new URL(url).pathname;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        dateRanges: [{ startDate: "28daysAgo", endDate: "today" }],
        dimensions: [{ name: "pagePath" }],
        metrics: [
          { name: "screenPageViews" },
          { name: "averageSessionDuration" },
        ],
        dimensionFilter: {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "EXACT", value: pagePath },
          },
        },
      }),
    });
    const data = await response.json();
    const row = data.rows?.[0];
    return {
      pageviews: parseInt(row?.metricValues?.[0]?.value || "0", 10),
      avgSessionDuration: parseFloat(row?.metricValues?.[1]?.value || "0.0"),
    };
  } catch (error) {
    console.error("GA 데이터 요청 실패:", error);
    return { pageviews: 0, avgSessionDuration: 0 };
  }
}

/**
 * [G-14] AdSense Management API를 호출하여 지표를 가져옵니다. (구현 필요)
 */
async function getAdsenseData(token, accountId, url) {
  // AdSense API는 'accounts/{accountId}' 형식을 요구합니다.
  const parentAccount = `accounts/${accountId}`;
  const API_URL = `https://adsense.googleapis.com/v2/${parentAccount}/reports:generate`;

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        dateRange: "LAST_30_DAYS",
        metrics: ["ESTIMATED_EARNINGS", "PAGE_VIEWS_RPM"],
        dimensions: ["URL_CHANNEL_NAME"],
        filters: [`URL_CHANNEL_NAME=="${url}"`],
      }),
    });
    const data = await response.json();
    const row = data.rows?.[0]?.cells;
    return {
      estimatedEarnings: parseFloat(row?.[1]?.value || "0.0"),
      pageRPM: parseFloat(row?.[2]?.value || "0.0"),
    };
  } catch (error) {
    console.error("AdSense 데이터 요청 실패:", error);
    return { estimatedEarnings: 0, pageRPM: 0 };
  }
}

console.debug("[DEBUG] background.js 로드됨 - 완료");
