// js/services/aiServiceTypes.js

/**
 * AI Service Type Definitions
 * JSDoc 타입 정의 및 인터페이스 명세
 */

/**
 * @typedef {Object} IdeaData
 * @property {string} title - 콘텐츠 제목
 * @property {string} description - 콘텐츠 설명
 * @property {string[]} [tags] - 태그 배열
 * @property {string} [keywords] - 키워드 문자열
 * @property {string} [persona] - 페르소나 키
 * @property {string} [tone] - 톤앤매너
 * @property {string[]} [skills] - 추가 스킬 배열
 * @property {string} [currentDraft] - 현재 초안 내용
 * @property {string[]} [recommendedSearches] - 추천 검색어
 * @property {string[]} [longTailKeywords] - 롱테일 키워드
 * @property {string[]} [outline] - 목차 배열
 * @property {Object} [linkedScrapsContent] - 연결된 스크랩 내용
 * @property {Object} [origin] - 원본 콘텐츠 정보
 * @property {boolean} [autoInsertAffiliateLinks] - 제휴 링크 자동 삽입 여부
 * @property {Object} [publishInfo] - 발행 정보
 * @property {Object} [publishInfo.thumbnailInfo] - 썸네일 정보
 * @property {Object} [publishInfo.thumbnailUrls] - 썸네일 URL들
 * @property {Object} [publishInfo.jsonLdSchema] - JSON-LD 스키마
 * @property {Object} [publishInfo.permalink] - 퍼머링크
 * @property {string} [channelId] - 채널 ID
 */

/**
 * @typedef {Object} DraftGenerationOptions
 * @property {boolean} [generateDraft=true] - 초안 생성 여부
 * @property {boolean} [generateThumbnail=true] - 썸네일 생성 여부
 */

/**
 * @typedef {Object} DraftGenerationResult
 * @property {boolean} success - 성공 여부
 * @property {string} [error] - 오류 메시지 (실패 시)
 * @property {string} [draft] - 생성된 초안 HTML
 * @property {string} [permalink] - 생성된 퍼머링크
 * @property {string} [tags] - 태그 문자열
 * @property {string} [seoTitle] - SEO 제목
 * @property {Object[]} [thumbnailInfo] - 썸네일 정보 배열
 * @property {Object} [thumbnailUrls] - 썸네일 URL 객체
 * @property {boolean} [thumbnailPartialFailure] - 썸네일 부분 실패 여부
 * @property {Object} [jsonLdSchema] - JSON-LD 스키마
 */

/**
 * @typedef {Object} ThumbnailUrls
 * @property {string} url_1x1 - 1:1 비율 썸네일 URL
 * @property {string} url_4x3 - 4:3 비율 썸네일 URL
 * @property {string} url_16x9 - 16:9 비율 썸네일 URL
 * @property {string} altText - 대체 텍스트
 */

/**
 * @typedef {Object} ThumbnailCandidate
 * @property {string} type - 썸네일 타입 ('curiosity', 'informative', 'emotional')
 * @property {string} thumbnailPromptEn - 영어 썸네일 프롬프트
 * @property {string} thumbnailPromptKo - 한국어 썸네일 프롬프트
 * @property {string} thumbnailText - 썸네일 텍스트
 * @property {string} [textPosition='bottom'] - 텍스트 위치
 * @property {string} [altText] - 대체 텍스트
 */

/**
 * @typedef {Object} AffiliateLink
 * @property {string} url - 제휴 링크 URL
 * @property {string} productName - 상품명
 * @property {string[]} keywords - 키워드 배열
 * @property {Object} [cardData] - 카드 데이터
 * @property {string} [cardData.imageUrl] - 상품 이미지 URL
 */

/**
 * @typedef {Object} AffiliateLinkOptions
 * @property {number} [maxLinks=3] - 최대 링크 수
 */

/**
 * @typedef {Object} IdeaBriefingOptions
 * @property {boolean} [generateOutline=false] - 목차 생성 여부
 * @property {boolean} [generateMainKeywords=false] - 주요 키워드 생성 여부
 * @property {boolean} [generateLongTail=false] - 롱테일 키워드 생성 여부
 * @property {boolean} [generateKeywords=false] - 추천 검색어 생성 여부
 * @property {Function} [onProgress] - 진행률 콜백 함수
 * @property {string} [status='ideas'] - 상태 ('ideas', 'drafts', 'published')
 */

/**
 * @typedef {Object} ChannelInfo
 * @property {string} [inputUrl] - 채널 입력 URL
 * @property {string} [thumbnail] - 채널 썸네일
 * @property {string} [logo] - 채널 로고
 */

/**
 * @typedef {Object} ReferenceImage
 * @property {string} data - Base64 인코딩된 이미지 데이터
 * @property {string} mimeType - MIME 타입
 */

/**
 * @typedef {Object} KeywordGapResult
 * @property {string[]} gapKeywords - 갭 키워드 배열
 * @property {number} gapCount - 갭 키워드 수
 */

/**
 * @typedef {Object} ContentAnalysisResult
 * @property {string[]} myTags - 내 태그들
 * @property {string[]} competitorTags - 경쟁자 태그들
 */

/**
 * @typedef {Object} ApiResponse
 * @property {boolean} success - 성공 여부
 * @property {string} [error] - 오류 메시지
 * @property {*} [data] - 응답 데이터
 */

/**
 * @typedef {Object} ImageGenerationOptions
 * @property {string} prompt - 이미지 생성 프롬프트
 * @property {number} [count=1] - 생성할 이미지 수
 * @property {ReferenceImage} [referenceImage] - 참조 이미지
 */

/**
 * @typedef {Object} TemplateAnalysisResult
 * @property {boolean} success - 성공 여부
 * @property {*} [data] - 분석 데이터
 */

/**
 * @typedef {Object} ChannelAnalysisResult
 * @property {boolean} success - 성공 여부
 * @property {string} [analysis] - 분석 결과
 * @property {*} [data] - 추가 데이터
 */

/**
 * @typedef {Object} ContentIdeasResult
 * @property {boolean} success - 성공 여부
 * @property {Object[]} [ideas] - 생성된 아이디어들
 */

/**
 * @typedef {Object} KeywordsResult
 * @property {boolean} success - 성공 여부
 * @property {string[]} [keywords] - 생성된 키워드들
 */

/**
 * @typedef {Object} VideoCommentsResult
 * @property {boolean} success - 성공 여부
 * @property {Object[]} [comments] - 분석된 댓글들
 */

/**
 * @typedef {Object} JsonLdSchema
 * @property {string} '@type' - 스키마 타입 (예: 'BlogPosting')
 * @property {string} headline - 헤드라인
 * @property {string} description - 설명
 * @property {string} datePublished - 발행일 (YYYY-MM-DD)
 * @property {string} dateModified - 수정일 (YYYY-MM-DD)
 * @property {Object} author - 저자 정보
 * @property {string|string[]} image - 이미지 URL 또는 URL 배열
 * @property {string} [url] - 콘텐츠 URL
 */

/**
 * @typedef {Object} ProgressCallback
 * @param {number} progress - 진행률 (0-100)
 */

/**
 * @typedef {Object} MessageSender
 * @property {Object} [tab] - 탭 정보
 * @property {number} [tab.id] - 탭 ID
 */

/**
 * @typedef {Object} KeywordData
 * @property {string} cardId - 카드 ID
 * @property {string} status - 상태
 * @property {string} title - 제목
 */

/**
 * AI Service 함수들의 JSDoc 타입 정의
 * 실제 함수들은 aiService.js에 구현되어 있습니다.
 */

/**
 * Gemini API를 호출하여 텍스트 생성을 수행합니다.
 * @param {string} prompt - AI에게 전달할 프롬프트 텍스트
 * @returns {Promise<string>} 생성된 텍스트 응답
 * @throws {Error} API 키가 없거나 API 호출 실패 시 에러 발생
 */
export function callGeminiAPI(prompt) {}

/**
 * 키워드 갭 분석을 수행합니다.
 * @param {string[]} myContent - 내 콘텐츠 태그들
 * @param {string[][]} competitorContent - 경쟁자 콘텐츠 태그들
 * @returns {Promise<KeywordGapResult>} 갭 분석 결과
 */
export function analyzeKeywordGap(myContent, competitorContent) {}

/**
 * 채널 컨텍스트를 기반으로 트렌드 주제를 분석합니다.
 * @param {string} channelContext - 채널 컨텍스트
 * @returns {Promise<string>} 트렌드 분석 결과
 */
export function getEmergingTopics(channelContext) {}

/**
 * HTML에 제휴 링크를 후처리하여 삽입합니다.
 * @param {string} html - 처리할 HTML
 * @param {AffiliateLink[]} affiliateLinks - 제휴 링크 배열
 * @param {AffiliateLinkOptions} options - 처리 옵션
 * @returns {string} 처리된 HTML
 */
export function postProcessAffiliateHtml(html, affiliateLinks, options) {}

/**
 * 아이디어 데이터를 기반으로 AI 초안을 생성합니다.
 * @param {IdeaData} ideaData - 초안 생성에 필요한 데이터
 * @param {DraftGenerationOptions} options - 생성 옵션
 * @returns {Promise<DraftGenerationResult>} 생성된 초안 데이터
 */
export function generateDraftFromIdea(ideaData, options) {}

/**
 * 아이디어 브리핑을 생성합니다.
 * @param {string} cardId - 카드 ID
 * @param {string} title - 제목
 * @param {string} description - 설명
 * @param {IdeaBriefingOptions} options - 브리핑 옵션
 * @returns {Promise<void>}
 */
export function generateIdeaBriefing(cardId, title, description, options) {}

/**
 * AI 이미지를 생성합니다.
 * @param {string} prompt - 이미지 생성 프롬프트
 * @param {number} count - 생성할 이미지 수
 * @param {ReferenceImage} referenceImage - 참조 이미지
 * @returns {Promise<string[]>} 생성된 이미지 URL 배열
 */
export function generateAiImage(prompt, count, referenceImage) {}

/**
 * 이미지 템플릿을 분석합니다.
 * @param {*} data - 분석할 데이터
 * @returns {Promise<TemplateAnalysisResult>} 분석 결과
 */
export function analyzeImageForTemplate(data) {}

/**
 * 채널을 분석합니다.
 * @param {*} data - 분석할 데이터
 * @returns {Promise<ChannelAnalysisResult>} 분석 결과
 */
export function analyzeMyChannel(data) {}

/**
 * 콘텐츠 아이디어를 생성합니다.
 * @param {*} data - 입력 데이터
 * @returns {Promise<ContentIdeasResult>} 생성된 아이디어들
 */
export function generateContentIdeas(data) {}

/**
 * 키워드를 생성하고 전송합니다.
 * @param {KeywordData} data - 키워드 데이터
 * @param {MessageSender} sender - 메시지 발신자
 * @returns {Promise<KeywordsResult>} 키워드 결과
 */
export function generateAndSendKeywords(data, sender) {}

/**
 * 비디오 댓글을 분석합니다.
 * @param {string} videoId - 비디오 ID
 * @returns {Promise<VideoCommentsResult>} 분석 결과
 */
export function analyzeVideoComments(videoId) {}