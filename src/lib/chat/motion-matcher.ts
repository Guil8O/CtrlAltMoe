/**
 * Multi-language keyword → motion matcher.
 *
 * Scans user & assistant text for emotion-related keywords in 5 languages
 * (en, ja, ko, zh, es) and returns a suitable motionId from motion-tags.json.
 *
 * The matcher is emotion-focused: it finds EMOTION keywords, maps them to
 * mood tags, then picks an appropriate motion from the dynamic library.
 */

import { ensureMotionLibrary, type MotionDef } from '@/lib/vrm/animation-manager';

export type SupportedLang = 'en' | 'ja' | 'ko' | 'zh' | 'es';

/* ───── Emotion keyword dictionaries (emotion-related only) ───── */

interface KeywordEntry {
  keywords: string[];
  /** Maps to moodTags in motion-tags.json */
  mood: string;
  /** Which motion categories to search */
  categories: string[];
  /** Preferred altGroup if any */
  preferAltGroup?: string;
}

const EMOTION_KEYWORDS: Record<SupportedLang, KeywordEntry[]> = {
  en: [
    { keywords: ['happy', 'glad', 'joy', 'excited', 'delighted', 'cheerful', 'great', 'wonderful', 'awesome', 'fantastic', 'love', 'yay'],
      mood: 'happy', categories: ['idle', 'emotion', 'gesture'], preferAltGroup: 'idle_happy' },
    { keywords: ['sad', 'unhappy', 'depressed', 'lonely', 'heartbroken', 'miserable', 'gloomy', 'upset', 'cry', 'crying', 'tears'],
      mood: 'sad', categories: ['idle', 'emotion'], preferAltGroup: 'idle_sad' },
    { keywords: ['angry', 'furious', 'mad', 'rage', 'annoyed', 'irritated', 'pissed', 'hate', 'frustrated'],
      mood: 'angry', categories: ['idle', 'emotion'], preferAltGroup: 'idle_angry' },
    { keywords: ['surprised', 'shocked', 'amazed', 'stunned', 'wow', 'whoa', 'unbelievable', 'omg', 'what'],
      mood: 'surprised', categories: ['emotion', 'gesture'] },
    { keywords: ['bored', 'tired', 'sleepy', 'exhausted', 'yawn', 'drowsy', 'meh', 'whatever'],
      mood: 'bored', categories: ['idle', 'emotion'], preferAltGroup: 'idle_bored' },
    { keywords: ['dance', 'dancing', 'groove', 'party', 'celebrate', 'celebration'],
      mood: 'happy', categories: ['dance'] },
    { keywords: ['thank', 'thanks', 'grateful', 'appreciate', 'gratitude'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'thank' },
    { keywords: ['bye', 'goodbye', 'farewell', 'see you', 'later', 'cya'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['hello', 'hi', 'hey', 'greetings', 'howdy', 'yo', 'sup'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['agree', 'yes', 'yeah', 'correct', 'right', 'exactly', 'indeed', 'true', 'sure'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'nod' },
    { keywords: ['disagree', 'no', 'nah', 'wrong', 'incorrect', 'nope', 'refuse', 'never'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'shake' },
    { keywords: ['think', 'thinking', 'hmm', 'ponder', 'wonder', 'consider', 'curious'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'think' },
    { keywords: ['clap', 'applause', 'bravo', 'well done', 'congratulations', 'congrats'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'clap' },
    { keywords: ['sorry', 'apologize', 'apology', 'forgive', 'pardon', 'excuse me'],
      mood: 'sad', categories: ['gesture'], preferAltGroup: 'bow' },
    { keywords: ['victory', 'win', 'winner', 'won', 'triumph', 'success', 'achieved'],
      mood: 'happy', categories: ['emotion'], preferAltGroup: 'victory' },
    { keywords: ['disappointed', 'letdown', 'let down', 'failure', 'failed', 'damn', 'dammit', 'sigh'],
      mood: 'sad', categories: ['emotion'], preferAltGroup: 'disappointed' },
    { keywords: ['drunk', 'wasted', 'tipsy', 'hammered', 'intoxicated', 'alcohol', 'beer', 'wine', 'sake'],
      mood: 'neutral', categories: ['idle'], preferAltGroup: 'idle_drunk' },
  ],

  ja: [
    { keywords: ['嬉しい', '楽しい', '幸せ', 'うれしい', 'たのしい', 'しあわせ', 'やった', 'わーい', '最高', 'すごい'],
      mood: 'happy', categories: ['idle', 'emotion', 'gesture'], preferAltGroup: 'idle_happy' },
    { keywords: ['悲しい', '寂しい', 'つらい', '辛い', '泣く', '泣いて', '悔しい', 'かなしい', 'さみしい'],
      mood: 'sad', categories: ['idle', 'emotion'], preferAltGroup: 'idle_sad' },
    { keywords: ['怒り', '怒る', 'むかつく', 'いらいら', '腹立つ', 'ふざけるな', 'くそ', 'ちくしょう'],
      mood: 'angry', categories: ['idle', 'emotion'], preferAltGroup: 'idle_angry' },
    { keywords: ['驚き', 'びっくり', 'まじ', 'えっ', 'うそ', '信じられない', 'すげー'],
      mood: 'surprised', categories: ['emotion', 'gesture'] },
    { keywords: ['退屈', 'つまらない', '眠い', 'ねむい', '疲れた', 'だるい', 'あくび'],
      mood: 'bored', categories: ['idle', 'emotion'], preferAltGroup: 'idle_bored' },
    { keywords: ['踊り', '踊る', 'ダンス', 'パーティー', 'お祝い'],
      mood: 'happy', categories: ['dance'] },
    { keywords: ['ありがとう', '感謝', 'サンキュー'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'thank' },
    { keywords: ['さようなら', 'またね', 'バイバイ', 'じゃあね', 'おやすみ'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['こんにちは', 'やあ', 'おはよう', 'こんばんは', 'ハロー'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['うん', 'はい', 'そうだね', 'その通り', '賛成', 'いいよ'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'nod' },
    { keywords: ['いいえ', 'ダメ', '違う', 'ちがう', '反対', 'やだ', 'いや'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'shake' },
    { keywords: ['考える', 'うーん', 'そうだな', '思う', 'なるほど'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'think' },
    { keywords: ['拍手', 'すばらしい', 'おめでとう', 'ブラボー'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'clap' },
    { keywords: ['ごめん', 'すみません', '申し訳', 'ゆるして', '許して'],
      mood: 'sad', categories: ['gesture'], preferAltGroup: 'bow' },
    { keywords: ['勝利', '勝った', 'やったー', '成功'],
      mood: 'happy', categories: ['emotion'], preferAltGroup: 'victory' },
    { keywords: ['残念', 'がっかり', '失望', '失敗'],
      mood: 'sad', categories: ['emotion'], preferAltGroup: 'disappointed' },
    { keywords: ['酔った', '酔い', 'お酒', 'ビール', 'ワイン', '日本酒', '飲みすぎ'],
      mood: 'neutral', categories: ['idle'], preferAltGroup: 'idle_drunk' },
  ],

  ko: [
    { keywords: ['기뻐', '행복', '좋아', '신나', '최고', '대박', '짱', '즐거워', '사랑'],
      mood: 'happy', categories: ['idle', 'emotion', 'gesture'], preferAltGroup: 'idle_happy' },
    { keywords: ['슬퍼', '외로워', '괴로워', '울어', '눈물', '서러워', '아파'],
      mood: 'sad', categories: ['idle', 'emotion'], preferAltGroup: 'idle_sad' },
    { keywords: ['화나', '짜증', '열받', '분노', '미워', '싫어'],
      mood: 'angry', categories: ['idle', 'emotion'], preferAltGroup: 'idle_angry' },
    { keywords: ['놀라', '깜짝', '헐', '진짜', '대박', '미쳤', '어머'],
      mood: 'surprised', categories: ['emotion', 'gesture'] },
    { keywords: ['지루해', '심심해', '졸려', '피곤해', '하품'],
      mood: 'bored', categories: ['idle', 'emotion'], preferAltGroup: 'idle_bored' },
    { keywords: ['춤', '댄스', '파티', '축하'],
      mood: 'happy', categories: ['dance'] },
    { keywords: ['고마워', '감사', '감사합니다', '땡큐'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'thank' },
    { keywords: ['안녕', '잘가', '바이', '또 봐'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['응', '네', '맞아', '그래', '동의'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'nod' },
    { keywords: ['아니', '싫어', '안돼', '반대', '틀려'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'shake' },
    { keywords: ['생각', '음', '글쎄', '궁금'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'think' },
    { keywords: ['박수', '짝짝', '축하해', '잘했어'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'clap' },
    { keywords: ['미안', '죄송', '사과'],
      mood: 'sad', categories: ['gesture'], preferAltGroup: 'bow' },
    { keywords: ['승리', '이겼', '성공'],
      mood: 'happy', categories: ['emotion'], preferAltGroup: 'victory' },
    { keywords: ['실망', '실패', '아쉬워'],
      mood: 'sad', categories: ['emotion'], preferAltGroup: 'disappointed' },
    { keywords: ['취했', '술', '맥주', '소주', '와인'],
      mood: 'neutral', categories: ['idle'], preferAltGroup: 'idle_drunk' },
  ],

  zh: [
    { keywords: ['开心', '高兴', '快乐', '太好了', '喜欢', '爱', '棒', '厉害', '好耶'],
      mood: 'happy', categories: ['idle', 'emotion', 'gesture'], preferAltGroup: 'idle_happy' },
    { keywords: ['伤心', '难过', '悲伤', '寂寞', '哭', '痛苦', '委屈'],
      mood: 'sad', categories: ['idle', 'emotion'], preferAltGroup: 'idle_sad' },
    { keywords: ['生气', '愤怒', '烦', '火大', '讨厌', '恨'],
      mood: 'angry', categories: ['idle', 'emotion'], preferAltGroup: 'idle_angry' },
    { keywords: ['惊讶', '吃惊', '天啊', '什么', '不会吧', '真的吗', '哇'],
      mood: 'surprised', categories: ['emotion', 'gesture'] },
    { keywords: ['无聊', '困', '累', '打哈欠', '没意思'],
      mood: 'bored', categories: ['idle', 'emotion'], preferAltGroup: 'idle_bored' },
    { keywords: ['跳舞', '舞蹈', '派对', '庆祝'],
      mood: 'happy', categories: ['dance'] },
    { keywords: ['谢谢', '感谢', '多谢'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'thank' },
    { keywords: ['再见', '拜拜', '回见', '晚安'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['你好', '嗨', '哈喽'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['是', '对', '没错', '同意', '嗯', '好的'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'nod' },
    { keywords: ['不', '不是', '不行', '反对', '错', '才不'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'shake' },
    { keywords: ['想', '嗯', '思考', '好奇'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'think' },
    { keywords: ['鼓掌', '太棒了', '恭喜', '祝贺'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'clap' },
    { keywords: ['对不起', '抱歉', '不好意思'],
      mood: 'sad', categories: ['gesture'], preferAltGroup: 'bow' },
    { keywords: ['胜利', '赢了', '成功'],
      mood: 'happy', categories: ['emotion'], preferAltGroup: 'victory' },
    { keywords: ['失望', '遗憾', '失败'],
      mood: 'sad', categories: ['emotion'], preferAltGroup: 'disappointed' },
    { keywords: ['醉了', '喝酒', '啤酒', '红酒', '白酒'],
      mood: 'neutral', categories: ['idle'], preferAltGroup: 'idle_drunk' },
  ],

  es: [
    { keywords: ['feliz', 'contento', 'alegre', 'encantado', 'genial', 'maravilloso', 'increíble', 'amor', 'bien'],
      mood: 'happy', categories: ['idle', 'emotion', 'gesture'], preferAltGroup: 'idle_happy' },
    { keywords: ['triste', 'solo', 'deprimido', 'llorar', 'lágrimas', 'dolor', 'pena'],
      mood: 'sad', categories: ['idle', 'emotion'], preferAltGroup: 'idle_sad' },
    { keywords: ['enojado', 'furioso', 'molesto', 'rabia', 'odio', 'irritado'],
      mood: 'angry', categories: ['idle', 'emotion'], preferAltGroup: 'idle_angry' },
    { keywords: ['sorprendido', 'asombrado', 'impactado', 'guau', 'vaya', 'increíble', 'qué'],
      mood: 'surprised', categories: ['emotion', 'gesture'] },
    { keywords: ['aburrido', 'cansado', 'sueño', 'agotado', 'bostezo'],
      mood: 'bored', categories: ['idle', 'emotion'], preferAltGroup: 'idle_bored' },
    { keywords: ['bailar', 'baile', 'fiesta', 'celebrar', 'celebración'],
      mood: 'happy', categories: ['dance'] },
    { keywords: ['gracias', 'agradecido', 'agradezco'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'thank' },
    { keywords: ['adiós', 'chao', 'hasta luego', 'nos vemos'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['hola', 'hey', 'buenos días', 'buenas'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'wave' },
    { keywords: ['sí', 'claro', 'correcto', 'exacto', 'vale', 'de acuerdo'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'nod' },
    { keywords: ['no', 'nunca', 'incorrecto', 'negativo', 'jamás'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'shake' },
    { keywords: ['pensar', 'hmm', 'curioso', 'pregunto'],
      mood: 'neutral', categories: ['gesture'], preferAltGroup: 'think' },
    { keywords: ['aplauso', 'bravo', 'felicidades', 'enhorabuena'],
      mood: 'happy', categories: ['gesture'], preferAltGroup: 'clap' },
    { keywords: ['perdón', 'disculpa', 'lo siento'],
      mood: 'sad', categories: ['gesture'], preferAltGroup: 'bow' },
    { keywords: ['victoria', 'gané', 'éxito', 'triunfo'],
      mood: 'happy', categories: ['emotion'], preferAltGroup: 'victory' },
    { keywords: ['decepcionado', 'fracaso', 'falló'],
      mood: 'sad', categories: ['emotion'], preferAltGroup: 'disappointed' },
    { keywords: ['borracho', 'ebrio', 'cerveza', 'vino', 'alcohol'],
      mood: 'neutral', categories: ['idle'], preferAltGroup: 'idle_drunk' },
  ],
};

/* ───── Matcher core ───── */

interface MatchResult {
  motionId: string;
  confidence: number;
  matchedKeyword: string;
  mood: string;
}

/**
 * Scan text for emotion keywords and return the best matching motion.
 *
 * @param userText    — what the user said
 * @param assistantText — what the assistant replied
 * @param emotion     — current dominant emotion from LLM meta
 * @param language    — active language setting
 * @returns motionId or null
 */
export async function matchMotionFromText(
  userText: string,
  assistantText: string,
  emotion: string,
  language: SupportedLang = 'en',
): Promise<string | null> {
  const library = await ensureMotionLibrary();
  if (library.length === 0) return null;

  const combinedText = `${userText} ${assistantText}`.toLowerCase();
  const dict = EMOTION_KEYWORDS[language] ?? EMOTION_KEYWORDS.en;

  const matches: MatchResult[] = [];

  for (const entry of dict) {
    for (const kw of entry.keywords) {
      if (combinedText.includes(kw.toLowerCase())) {
        // Find matching motions
        const candidates = library.filter(m => {
          if (entry.preferAltGroup && m.altGroup === entry.preferAltGroup) return true;
          if (entry.categories.includes(m.category) && m.moodTags.includes(entry.mood)) return true;
          return false;
        });

        if (candidates.length > 0) {
          // Boost confidence if keyword matches current emotion
          const emotionBoost = entry.mood === emotion ? 0.3 : 0;
          // Boost if altGroup preferred
          const altBoost = entry.preferAltGroup ? 0.2 : 0;
          const confidence = 0.5 + emotionBoost + altBoost;

          // Pick a random candidate
          const pick = candidates[Math.floor(Math.random() * candidates.length)];
          matches.push({
            motionId: pick.id,
            confidence,
            matchedKeyword: kw,
            mood: entry.mood,
          });
        }
        break; // One keyword per entry is enough
      }
    }
  }

  if (matches.length === 0) return null;

  // Sort by confidence, pick highest
  matches.sort((a, b) => b.confidence - a.confidence);
  const best = matches[0];

  console.info(
    `[MotionMatcher] Matched "${best.matchedKeyword}" → ${best.motionId} (confidence: ${best.confidence.toFixed(2)}, mood: ${best.mood})`,
  );

  return best.motionId;
}

/**
 * Extract hobby-related keywords from conversation text.
 * This is used by animation-manager to boost matching hobbies.
 */
export function extractHobbyKeywords(text: string): string[] {
  const hobbyWords = [
    'dance', 'dancing', 'music', 'sing', 'singing', 'exercise', 'workout', 'yoga',
    'run', 'running', 'swim', 'sport', 'game', 'play', 'cook', 'cooking',
    'read', 'reading', 'paint', 'painting', 'draw', 'drawing', 'garden',
    // Japanese
    'ダンス', '踊り', '音楽', '歌', '運動', 'ヨガ', '料理', '読書', '絵',
    // Korean
    '댄스', '춤', '음악', '노래', '운동', '요가', '요리', '독서', '그림',
    // Chinese
    '舞蹈', '音乐', '唱歌', '运动', '瑜伽', '烹饪', '阅读', '画画',
    // Spanish
    'bailar', 'música', 'cantar', 'ejercicio', 'cocinar', 'leer', 'pintar',
  ];

  const lower = text.toLowerCase();
  return hobbyWords.filter(w => lower.includes(w));
}
