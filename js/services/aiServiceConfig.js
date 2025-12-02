// js/services/aiServiceConfig.js

/**
 * AI Service Configuration
 * 모든 상수, 설정 값, 기본값들을 중앙 집중화
 */

// API 설정
export const API_CONFIG = {
  // Gemini API 기본 설정
  GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta',

  // 타임아웃 설정 (밀리초)
  TRANSLATION_TIMEOUT: 5000,

  // 재시도 설정
  MAX_RETRIES: 3,
  RETRY_DELAY_BASE: 1000, // 기본 지연 시간
  RETRY_DELAY_MULTIPLIER: 2, // 지연 배율

  // 동시 실행 제한
  MAX_CONCURRENT_REQUESTS: 3,

  // 프롬프트 길이 제한
  MAX_PROMPT_LENGTH: 30000,
  OPTIMIZED_PROMPT_LENGTH: 15000,
};

// 썸네일 설정
export const THUMBNAIL_CONFIG = {
  // 시스템 프롬프트
  SYSTEM_PROMPT: `
CRITICAL INSTRUCTION: THE FINAL IMAGE MUST NOT CONTAIN ANY WRITTEN TEXT, LETTERS, CHARACTERS, OR NUMBERS. NO EXCEPTIONS.

당신은 블로그 썸네일 이미지 생성을 위한 프롬프트 작성 전문가입니다.
주어진 정보(제목, 설명)를 바탕으로 이미지를 생성할 때, 입력된 텍스트 내용 자체가 이미지 안에 글자로 나타나서는 절대 안 됩니다.
오직 내용을 시각적으로 상징하는 그래픽, 아이콘, 일러스트레이션 요소로만 구성된 DALL-E 3용 영어 프롬프트를 작성하십시오.

스타일 가이드:
- 현대적이고 트렌디한 플랫 디자인 일러스트레이션 스타일
`.trim(),

  // 크롭 비율들
  ASPECT_RATIOS: {
    SQUARE: 1,
    LANDSCAPE_4_3: 4 / 3,
    LANDSCAPE_16_9: 16 / 9,
  },

  // 파일명 접미사
  FILE_SUFFIXES: {
    SQUARE: '-1x1.png',
    LANDSCAPE_4_3: '-4x3.png',
    LANDSCAPE_16_9: '-16x9.png',
  },

  // 기본 썸네일 후보들
  DEFAULT_CANDIDATES: [
    {
      type: 'curiosity',
      thumbnailPromptEn: `High-quality, dramatic thumbnail for "${'${title}'}", mysterious atmosphere, question mark, vibrant colors, dramatic lighting, eye-catching composition, 16:9 aspect ratio`,
      thumbnailPromptKo: `"${'${title}'}"에 대한 호기심 자극형 썸네일`,
      thumbnailText: '이거 실화냐?',
    },
    {
      type: 'informative',
      thumbnailPromptEn: `Clean, professional background image for "${'${title}'}", bright lighting, organized layout, modern design, 16:9 aspect ratio`,
      thumbnailPromptKo: `"${'${title}'}"에 대한 정보 요약형 썸네일`,
      thumbnailText: '완벽 정리',
    },
    {
      type: 'emotional',
      thumbnailPromptEn: `Warm, cozy background image for "${'${title}'}", soft lighting, welcoming atmosphere, friendly colors, comfortable feeling, 16:9 aspect ratio`,
      thumbnailPromptKo: `"${'${title}'}"에 대한 감성/공감형 썸네일`,
      thumbnailText: '당신을 위한',
    },
  ],
};

// 제휴 링크 설정
export const AFFILIATE_CONFIG = {
  MAX_LINKS: 3,
  MIN_CONTENT_LENGTH: 50,
  KEYWORD_MATCH_THRESHOLD: 0.6,
};

// 콘텐츠 처리 설정
export const CONTENT_CONFIG = {
  // 마크다운 정리 패턴들
  MARKDOWN_CLEANUP: {
    CODE_BLOCK_START: /^```markdown\s*\n?/i,
    CODE_BLOCK_END: /\n?```\s*$/i,
    CODE_BLOCK_MD_START: /^```md\s*\n?/i,
    CODE_BLOCK_MD_END: /\n?```md\s*$/i,
    CODE_BLOCK_GENERIC: /^```\s*\n?/i,
  },

  // JSON-LD 추출 패턴
  JSON_LD_PATTERN: /<JSON-LD>([\s\S]*?)<\/JSON-LD>/gi,

  // 썸네일 정보 추출 패턴
  THUMBNAIL_INFO_PATTERN: /<썸네일정보>([\s\S]*?)<\/썸네일정보>/g,

  // HTML 태그 패턴들
  HTML_PATTERNS: {
    H1_TAG: /<h1[^>]*>([^<]+)<\/h1>/i,
    IMG_TAG: /<img[^>]*>/i,
  },
};

// 퍼머링크 설정
export const PERMALINK_CONFIG = {
  MAX_LENGTH: 100,
  TRANSLATION_PROMPT_TEMPLATE: `다음 한국어 제목을 SEO에 최적화된 영문 URL 슬러그로 변환해주세요.
- 영문, 숫자, 하이픈만 사용
- 소문자로 변환
- 공백은 하이픈으로
- 최대 100자
- 검색 최적화를 고려한 키워드 포함

제목: {title}

영문 슬러그만 반환해주세요 (설명 없이):`,
};

// 이미지 처리 설정
export const IMAGE_CONFIG = {
  // 지원 MIME 타입들
  SUPPORTED_MIME_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  DEFAULT_MIME_TYPE: 'image/jpeg',

  // 합성 프롬프트 템플릿
  SYNTHESIS_PROMPT_TEMPLATE: `
  [Instruction]
  Create a professional product photograph featuring the object from the [Provided Reference Image].
  [Composition]
  Place the object seamlessly into the following scene: "{thumbnailPrompt}".
  [Constraints]
  - Use the [Provided Reference Image] as the main subject.
  - Ensure natural lighting, shadows, and reflections matching the background.
  - Style: 4k, photorealistic, cinematic lighting.
  `.trim(),
};

// Firebase 스토리지 설정
export const STORAGE_CONFIG = {
  THUMBNAIL_PATH_TEMPLATE: 'thumbnails/{userId}/{permalink}-{ratio}.png',
  AI_IMAGE_PATH_TEMPLATE: 'thumbnails/{userId}/{timestamp}_{index}.png',
};

// UI 메시지 설정
export const UI_MESSAGES = {
  API_KEY_MISSING: 'Gemini API 키가 설정되지 않았습니다. 채널 관리에서 API 키를 입력해주세요.',
  API_KEY_INVALID: 'Gemini API 키가 없거나 유효하지 않습니다. 채널 관리에서 API 키를 확인해주세요.',
  THUMBNAIL_GENERATION_FAILED: '썸네일 생성에 실패했습니다.',
  DRAFT_GENERATION_FAILED: '초안 생성에 실패했습니다.',
};

// 로그 메시지 템플릿들
export const LOG_TEMPLATES = {
  API_CALL_START: '[callGeminiAPI] API 호출 시작 - prompt 길이: {length}',
  API_CALL_SUCCESS: '[callGeminiAPI] API 호출 성공 - 응답 길이: {length}',
  DRAFT_GENERATION_START: '[generateDraftFromIdea] 📝 초안 생성 시작',
  THUMBNAIL_GENERATION_START: '[generateDraftFromIdea] 🎨 썸네일 생성 시작',
  OUTLINE_GENERATION_SUCCESS: '[generateIdeaBriefing] 목차 생성 성공: {count}개 항목',
};
