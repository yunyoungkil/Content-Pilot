// js/services/promptService.js

// Logger import removed (unused)

/**
 * [PROMPT_CONFIG] 프롬프트 구성 요소 정의
 * 추후 Firebase Remote Config에서 fetch하여 이 객체를 덮어쓰는 방식으로 확장 가능
 */
export const PROMPT_CONFIG = {
  // Layer 1: System Instruction (역할 및 기본 정체성)
  personas: {
    professional: {
      name: '전문가형',
      instruction:
        '당신은 해당 분야의 10년 차 권위 있는 전문가이자 칼럼니스트입니다. 독자에게 신뢰감을 주는 깊이 있는 통찰력을 제공해야 합니다.',
      baseTone: 'logical',
    },
    friendly: {
      name: '친근한형',
      instruction:
        '당신은 소통을 좋아하는 인기 인플루언서이자 옆집 언니/오빠 같은 블로거입니다. 독자와의 공감대를 형성하는 것을 최우선으로 합니다.',
      baseTone: 'emotional',
    },
    viral: {
      name: '바이럴형',
      instruction:
        '당신은 클릭을 유도하는 카피라이팅 전문가이자 트렌드 세터입니다. 독자의 호기심을 자극하고 도파민을 유발하는 글을 작성합니다.',
      baseTone: 'impact',
    },
  },

  // Layer 2: Tone Modifier (어조 및 말투 세부 조정)
  tones: {
    logical:
      "논리적이고 분석적인 어조를 사용하세요. 명확한 인과관계('따라서', '그러므로')를 명시하고, '~입니다', '~합니다' 체를 사용하세요.",
    emotional:
      "감성적이고 따뜻한 어조를 사용하세요. 대화하듯 자연스러운 구어체('~해요', '~네요')를 사용하고, 감탄사와 의문문을 적절히 섞으세요. 절대 반말('~해', '~야', '~지')을 사용하지 마세요. 항상 존댓말로 작성하세요.",
    impact:
      "짧고 강렬한 단문을 주로 사용하세요. '충격적인', '놀라운', '반드시' 같은 강력한 형용사를 사용하여 긴장감을 유지하세요.",
  },

  // Layer 3: Writing Skills (글쓰기 스킬 옵션)
  skills: {
    questioning:
      "- [스킬: 질문 던지기] 문단 시작이나 끝에 독자의 생각을 묻는 질문을 던져 참여를 유도하세요 (예: '여러분은 어떻게 생각하시나요?').",
    statistics:
      '- [스킬: 수치 증명] 주장을 뒷받침할 때는 구체적인 숫자나 비율을 예시로 들어 신뢰도를 높이세요 (가상의 예시라도 논리적이어야 함).',
    storytelling:
      '- [스킬: 스토리텔링] 딱딱한 설명 대신, 구체적인 상황 묘사나 에피소드로 이야기를 시작하여 몰입도를 높이세요.',
    comparison: "- [스킬: 비교 분석] 'A vs B' 구조를 사용하여 장단점을 명확하게 대조하세요.",
    cliffhanger:
      '- [스킬: 클리프행어] 다음 섹션을 읽지 않고는 못 배기도록 문단 마지막에 궁금증을 유발하는 문장을 배치하세요.',
  },
};

/**
 * PromptBuilder 클래스
 * 복잡한 프롬프트 생성 로직을 캡슐화
 */
export class PromptBuilder {
  constructor(personaKey = 'professional') {
    this.config = PROMPT_CONFIG;
    this.persona = this.config.personas[personaKey] || this.config.personas.professional;
    this.tone = this.config.tones[this.persona.baseTone];
    this.skills = [];
    this.trendContext = '';
  }

  // 톤앤매너 강제 오버라이드 (예: 전문가형인데 친근한 말투 원할 때)
  setTone(toneKey) {
    if (this.config.tones[toneKey]) {
      this.tone = this.config.tones[toneKey];
    }
    return this;
  }

  // 글쓰기 스킬 추가
  addSkill(skillKey) {
    if (this.config.skills[skillKey]) {
      this.skills.push(this.config.skills[skillKey]);
    }
    return this;
  }

  // 트렌드 데이터 주입
  setTrendContext(keywords, trends) {
    if (keywords?.length > 0 || trends?.length > 0) {
      this.trendContext = `

[Trend Data & Context]

- 핵심 키워드: ${keywords.join(', ')}

- 연관 트렌드: ${trends.join(', ')}

* 지침: 위 트렌드 키워드가 글의 맥락에 자연스럽게 녹아들도록 작성하여 SEO 점수를 극대화하세요.

`;
    }
    return this;
  }

  // 최종 시스템 프롬프트 조립
  buildSystemPrompt() {
    return `

[System Instruction]

${this.persona.instruction}



[Tone & Manner Guide]

${this.tone}



[Writing Skills Applied]

${this.skills.length > 0 ? this.skills.join('\n') : '기본 글쓰기 원칙을 준수하세요.'}



${this.trendContext}

`;
  }

  // 페르소나 이름 반환 (로깅용)
  getPersonaName() {
    return this.persona.name;
  }

  // 톤 이름 반환 (로깅용)
  getToneName() {
    // tone 객체에서 키 찾기
    for (const [key, value] of Object.entries(this.config.tones)) {
      if (value === this.tone) {
        return key;
      }
    }
    return 'default';
  }
}

/**
 * 페르소나 자동 감지 로직 (기존 로직 이관 및 개선)
 */
export function detectPersona(text) {
  const content = text.toLowerCase();
  let scores = { professional: 0, friendly: 0, viral: 0 };

  // 키워드 스코어링
  if (/후기|리뷰|일상|여행|맛집|추천|솔직|내돈내산|소통|이웃/.test(content)) scores.friendly += 3;
  if (/가이드|사용법|강좌|정리|뉴스|소식|트렌드|통계|분석|해결/.test(content))
    scores.professional += 3;
  if (/비밀|꿀팁|초간단|초보|모르는|충격|놀라운|반드시|절대|공개/.test(content)) scores.viral += 3;

  // 비판적 키워드 (전문가형으로 분류)
  if (/비교|장단점|문제점|vs/.test(content)) scores.professional += 2;

  // 점수가 같으면 professional 기본
  return Object.keys(scores).reduce((a, b) => (scores[a] >= scores[b] ? a : b));
}
