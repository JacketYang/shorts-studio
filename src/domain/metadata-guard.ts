import { firstThreeWords, jaccard3Gram, normalizeTitleForDupCheck } from './novelty.ts';

export interface MetadataAuditIssue {
  code: string;
  level: 'error' | 'warn';
  field: 'title' | 'hook' | 'description' | 'tags';
  message: string;
}

export interface MetadataAuditReport {
  score: number;
  passed: boolean;
  issues: MetadataAuditIssue[];
  stats: {
    titleLen: number;
    emojiCount: number;
    hashtagCount: number;
    tagChars: number;
    maxTitleSim: number;
    hookWords: number;
  };
}

export interface MetadataInput {
  title: string;
  hookLine: string;
  description: string;
  tags: string[];
  recentTitles?: string[];
  forbiddenTopics?: string[];
}

export interface DiversifyMetadataInput {
  id: string;
  engine: string;
  category: string;
  baseTitle: string;
  hookLine: string;
  description: string;
  tags: string[];
  params?: unknown;
  seed?: number;
  variant?: number;
  recentTitles?: string[];
  forbiddenTopics?: string[];
}

export interface DiversifiedMetadataResult {
  title: string;
  hookLine: string;
  description: string;
  tags: string[];
  patternUsed: string;
  audit: MetadataAuditReport;
}

export const DEFAULT_METADATA_REWRITE_PROMPT = `You are a YouTube Shorts metadata strategist for a code-rendered physics, math & synthesized-music simulation channel.

Goal: Rewrite the video's title, on-screen hook, description, and tags so each upload reads naturally, sparks curiosity in the first 2 seconds, stays 100% distinct from recent uploads, and complies strictly with YouTube policies.

Strict Rules:
1. Title (<= 65 chars ideal, hard max 95 chars): NO #hashtags in the title, max 1 emoji, NEVER copy or share the first 3 words with any title in "recent_openers_to_avoid". Include a concrete number, contrast, or musical/physics payoff when accurate.
2. Hook (<= 6 words, <= 45 chars): Short, punchy on-screen text for the top safe zone. Grounded in real mechanics or timing — zero generic bait.
3. Description: 2-3 crisp lines (governing equation/mechanism + acoustic note + one thoughtful viewer question), a short synthesis note, and ONLY 3-4 relevant #hashtags at the very bottom (never #shorts/#oddlysatisfying spam).
4. Tags: 8-14 focused lowercase search tags, combined length <= 400 chars.
5. Policy & Safety: Zero AI-slop cliches ("Wait for it", "Watch until the end", "Like & subscribe", "90% pick wrong", "oddly satisfying", "mind blown"), zero fake promises ("100% impossible", "free money", "sub4sub", "watch before deleted"), zero copyrighted pop-song claims, zero forbidden channel topics.
6. Output strictly valid JSON matching the schema.`;

const SPAM_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bsub\s*4\s*sub\b/i, label: 'sub4sub 互粉诱导' },
  { re: /\bsubscribe\s+or\b/i, label: '威胁式求订阅' },
  { re: /\bfree\s+(money|cash|robux|vbucks|gift\s*card)\b/i, label: '虚假福利/刷奖词' },
  { re: /\bwatch\s+before\s+(it'?s\s+)?deleted\b/i, label: '制造恐慌标题党' },
  { re: /\bclick\s+(the\s+)?link\s+in\s+(bio|description)\b/i, label: '引流垃圾话术' },
  { re: /\b100%\s*(impossible|guaranteed|proven)\b/i, label: '绝对化虚假承诺' },
  { re: /\bcopyrighted\b/i, label: '疑似版权敏感词' },
  { re: /\breupload\b/i, label: '搬运敏感词' },
  { re: /\bonly\s+0\.?0*1%\s+can\b/i, label: '低质诱骗式文案' },
];

const SLOP_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\bwatch\s+until\s+(?:the\s+)?end\b/gi, label: 'Watch until the end' },
  { re: /\bwait\s+for\s+(?:it|the\s+end|the\s+last\s+note)\b/gi, label: 'Wait for it' },
  { re: /\blike\s*(?:&|and)?\s*subscribe\s+for\s+more\b/gi, label: 'Like & subscribe 模板结尾' },
  { re: /\b90%\s+(?:pick|get|fail|miss)\b/gi, label: '90% pick wrong 模板' },
  { re: /\bevery\s+frame\s+is\s+generated\s+by\s+code\b/gi, label: '千篇一律免责句式' },
  { re: /\boddly\s+satisfying\b/gi, label: 'oddly satisfying 模板词' },
  { re: /\bmind\s*blown\b/gi, label: 'mind blown 模板词' },
  { re: /\byou\s+won'?t\s+believe\b/gi, label: 'you wont believe 诱饵句' },
  { re: /\bround\s+\d+\s+is\s+insane\b/gi, label: 'Round X is insane 模板' },
];

const EMOJI_RE = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;

function countEmojis(text: string): number {
  return (text.match(EMOJI_RE) ?? []).length;
}

function stripExcessEmojis(text: string, maxKeep: number): string {
  let seen = 0;
  return text
    .replace(EMOJI_RE, (m) => {
      seen++;
      return seen <= maxKeep ? m : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractHashtags(text: string): string[] {
  return Array.from(new Set((text.match(/#[A-Za-z0-9_\u4e00-\u9fa5]+/g) ?? []).map((t) => t.toLowerCase())));
}

export function auditPublishMetadata(input: MetadataInput): MetadataAuditReport {
  const title = (input.title ?? '').trim();
  const hook = (input.hookLine ?? '').trim();
  const desc = (input.description ?? '').trim();
  const tags = (input.tags ?? []).map((t) => t.trim()).filter(Boolean);
  const recentTitles = (input.recentTitles ?? []).map((t) => t.trim()).filter(Boolean);
  const forbidden = (input.forbiddenTopics ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean);

  const issues: MetadataAuditIssue[] = [];
  const emojiCount = countEmojis(title);
  const hashtags = extractHashtags(desc);
  const tagChars = tags.join(',').length;
  const hookWords = hook ? hook.split(/\s+/).filter(Boolean).length : 0;

  if (!title) {
    issues.push({ code: 'TITLE_EMPTY', level: 'error', field: 'title', message: '标题不能为空' });
  } else {
    if (title.length > 100) {
      issues.push({ code: 'TITLE_TOO_LONG', level: 'error', field: 'title', message: `标题 ${title.length} 字符，超过 YouTube 100 字符上限` });
    } else if (title.length > 68) {
      issues.push({ code: 'TITLE_TRUNCATE_RISK', level: 'warn', field: 'title', message: `标题 ${title.length} 字符，Shorts 竖屏移动端约在 60-68 字符处截断` });
    }
    if (/#\w+/.test(title)) {
      issues.push({ code: 'TITLE_HASHTAG_SPAM', level: 'warn', field: 'title', message: '标题中含 #标签（易显廉价且触发重复指纹，建议移至描述底部）' });
    }
    if (emojiCount > 2) {
      issues.push({ code: 'TITLE_EXCESS_EMOJI', level: 'warn', field: 'title', message: `标题含 ${emojiCount} 个 Emoji，建议不超过 1-2 个` });
    }
    const asciiLetters = title.replace(/[^A-Za-z]/g, '');
    const upperLetters = title.replace(/[^A-Z]/g, '');
    if (asciiLetters.length >= 12 && upperLetters.length / asciiLetters.length > 0.6) {
      issues.push({ code: 'TITLE_ALL_CAPS', level: 'warn', field: 'title', message: '标题全大写字母比例过高，易被判定为低质标题党' });
    }
  }

  if (!hook) {
    issues.push({ code: 'HOOK_EMPTY', level: 'warn', field: 'hook', message: '建议填写首秒画面钩子文案' });
  } else if (hookWords > 7 || hook.length > 48) {
    issues.push({ code: 'HOOK_TOO_LONG', level: 'warn', field: 'hook', message: `画面钩子偏长 (${hookWords} 词 / ${hook.length} 字符)，建议 ≤6 词以防安全区折行遮挡` });
  }

  if (desc.length < 20) {
    issues.push({ code: 'DESC_TOO_SHORT', level: 'warn', field: 'description', message: '描述过短，建议补充画面机制说明与互动提问' });
  } else if (desc.length > 5000) {
    issues.push({ code: 'DESC_TOO_LONG', level: 'error', field: 'description', message: '描述超过 5000 字符上限' });
  }

  if (hashtags.length > 10) {
    issues.push({ code: 'DESC_HASHTAG_SPAM', level: 'error', field: 'description', message: `描述含 ${hashtags.length} 个 #标签，易触发 YouTube 垃圾标签惩罚（建议 3-4 个）` });
  } else if (hashtags.length > 5) {
    issues.push({ code: 'DESC_HASHTAG_EXCESS', level: 'warn', field: 'description', message: `描述含 ${hashtags.length} 个 #标签，官方最佳实践建议精简至 3-5 个` });
  }

  if (tagChars > 500) {
    issues.push({ code: 'TAGS_TOO_LONG', level: 'error', field: 'tags', message: `Tags 总长度 ${tagChars} 字符，超过 500 上限` });
  } else if (tags.length > 20) {
    issues.push({ code: 'TAGS_EXCESS', level: 'warn', field: 'tags', message: `Tags 数量 ${tags.length} 过多，建议精选 8-15 个高相关词` });
  }

  const combinedText = `${title}\n${hook}\n${desc}\n${tags.join(' ')}`;
  for (const rule of SPAM_PATTERNS) {
    if (rule.re.test(combinedText)) {
      issues.push({ code: 'POLICY_SPAM_PHRASE', level: 'error', field: 'title', message: `命中审查高风险话术：${rule.label}` });
    }
  }
  const copyTextForSlop = `${title}\n${hook}\n${desc}`;
  const slopHits: string[] = [];
  for (const rule of SLOP_PATTERNS) {
    rule.re.lastIndex = 0;
    if (rule.re.test(copyTextForSlop)) {
      slopHits.push(rule.label);
    }
  }
  if (slopHits.length >= 2) {
    issues.push({
      code: 'POLICY_AI_SLOP_CLICHE',
      level: 'error',
      field: 'description',
      message: `命中多处同质化 AI 套话（${slopHits.join(' / ')}），请替换为具体音画细节`,
    });
  } else if (slopHits.length === 1) {
    issues.push({
      code: 'AI_SLOP_FILLER',
      level: 'warn',
      field: 'title',
      message: `含模板套话「${slopHits[0]}」，建议改写为具体机制或音色描述`,
    });
  }
  const lowerCombined = combinedText.toLowerCase();
  for (const topic of forbidden) {
    if (topic.length >= 2 && lowerCombined.includes(topic)) {
      issues.push({ code: 'FORBIDDEN_TOPIC', level: 'error', field: 'title', message: `命中频道禁用词/禁区主题：「${topic}」` });
    }
  }

  const normCand = normalizeTitleForDupCheck(title);
  const candFirst3 = firstThreeWords(title);
  let maxTitleSim = 0;
  let exactDup = false;
  let first3Dup = false;

  for (const prev of recentTitles) {
    if (!prev) continue;
    const normPrev = normalizeTitleForDupCheck(prev);
    if (normCand && normCand === normPrev) {
      exactDup = true;
      maxTitleSim = 1;
      break;
    }
    if (candFirst3 && candFirst3.split(' ').length >= 2 && candFirst3 === firstThreeWords(prev)) {
      first3Dup = true;
    }
    const sim = jaccard3Gram(title, prev);
    if (sim > maxTitleSim) maxTitleSim = sim;
  }

  if (exactDup) {
    issues.push({ code: 'DUP_EXACT_TITLE', level: 'error', field: 'title', message: '与频道近期作品标题完全重复，必须改写' });
  } else if (maxTitleSim >= 0.72) {
    issues.push({ code: 'DUP_HIGH_SIMILARITY', level: 'error', field: 'title', message: `与近期标题 3-gram 相似度达 ${Math.round(maxTitleSim * 100)}%，重复风险过高` });
  } else if (first3Dup) {
    issues.push({ code: 'DUP_FIRST_THREE_WORDS', level: 'warn', field: 'title', message: `开头前 3 词 "${candFirst3}" 与近期视频撞车，建议更换开头句式` });
  } else if (maxTitleSim >= 0.52) {
    issues.push({ code: 'DUP_MODERATE_SIMILARITY', level: 'warn', field: 'title', message: `与近期标题相似度 ${Math.round(maxTitleSim * 100)}%，建议换用不同视角` });
  }

  let score = 100;
  for (const issue of issues) {
    score -= issue.level === 'error' ? 25 : 9;
  }
  score = Math.max(0, Math.min(100, score));
  const passed = !issues.some((i) => i.level === 'error');

  return {
    score,
    passed,
    issues,
    stats: {
      titleLen: title.length,
      emojiCount,
      hashtagCount: hashtags.length,
      tagChars,
      maxTitleSim: Number(maxTitleSim.toFixed(2)),
      hookWords,
    },
  };
}

export function sanitizeMetadataCandidate(input: {
  title: string;
  hookLine: string;
  description: string;
  tags: string[];
  forbiddenTopics?: string[];
}): { title: string; hookLine: string; description: string; tags: string[] } {
  let title = (input.title ?? '')
    .replace(/#[A-Za-z0-9_\u4e00-\u9fa5]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  title = stripExcessEmojis(title, 1);

  for (const rule of SPAM_PATTERNS) {
    title = title.replace(rule.re, '').replace(/\s+/g, ' ').trim();
  }
  for (const rule of SLOP_PATTERNS) {
    rule.re.lastIndex = 0;
    title = title.replace(rule.re, '').replace(/\s+/g, ' ').trim();
  }
  for (const topic of input.forbiddenTopics ?? []) {
    const cleanTopic = topic.trim();
    if (cleanTopic.length >= 2) {
      const re = new RegExp(cleanTopic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      title = title.replace(re, '').replace(/\s+/g, ' ').trim();
    }
  }
  if (title.length > 96) {
    title = title.slice(0, 96).replace(/\s+\S*$/, '').trim() || title.slice(0, 96);
  }
  if (!title) {
    title = 'Deterministic Physics & Harmonic Simulation';
  }

  let hookLine = (input.hookLine ?? '').replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
  for (const rule of SLOP_PATTERNS) {
    rule.re.lastIndex = 0;
    hookLine = hookLine.replace(rule.re, '').replace(/\s+/g, ' ').trim();
  }
  hookLine = stripExcessEmojis(hookLine, 1);
  if (hookLine.length > 48) {
    hookLine = hookLine.slice(0, 48).replace(/\s+\S*$/, '').trim() || hookLine.slice(0, 48);
  }

  // Clean description: keep body lines + max 4 unique hashtags at bottom
  const rawDescLines = (input.description ?? '').split('\n');
  const collectedHashtags: string[] = [];
  const bodyLines: string[] = [];

  for (const line of rawDescLines) {
    const trimmed = line.trim();
    const tagsInLine = trimmed.match(/#[A-Za-z0-9_\u4e00-\u9fa5]+/g) ?? [];
    if (tagsInLine.length > 0 && trimmed.replace(/#[A-Za-z0-9_\u4e00-\u9fa5]+/g, '').trim() === '') {
      for (const h of tagsInLine) {
        const lower = h.toLowerCase();
        if (!collectedHashtags.includes(lower)) collectedHashtags.push(lower);
      }
      continue;
    }
    let cleanLine = line;
    for (const rule of SPAM_PATTERNS) {
      cleanLine = cleanLine.replace(rule.re, '').replace(/\s{2,}/g, ' ');
    }
    for (const rule of SLOP_PATTERNS) {
      rule.re.lastIndex = 0;
      cleanLine = cleanLine.replace(rule.re, '').replace(/\s{2,}/g, ' ');
    }
    if (cleanLine.trim()) bodyLines.push(cleanLine.trimEnd());
  }

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
  const cappedHashtags = (collectedHashtags.length > 0 ? collectedHashtags : ['#physics', '#simulation', '#kineticart', '#acoustics']).slice(0, 4);
  const cleanDesc = [...bodyLines, '', cappedHashtags.join(' ')].join('\n').trim().slice(0, 4900);

  // Dedupe tags & enforce <= 450 chars and <= 15 tags
  const cleanTags: string[] = [];
  const seenTag = new Set<string>();
  for (const rawTag of input.tags ?? []) {
    const t = rawTag.replace(/^#/, '').trim();
    if (!t) continue;
    const key = t.toLowerCase();
    if (seenTag.has(key)) continue;
    const nextLen = [...cleanTags, t].join(',').length;
    if (nextLen > 450 || cleanTags.length >= 15) break;
    seenTag.add(key);
    cleanTags.push(t);
  }

  return { title, hookLine, description: cleanDesc, tags: cleanTags };
}

function hashSeed(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface ExtractedSubject {
  song?: string;
  n?: number;
  bins?: number;
  dur?: number;
  algo?: string;
  digits?: string;
  mass?: string;
  petals?: string;
  gearR?: number;
  gearR2?: number;
  ratio?: string;
  shape?: string;
  terms?: number;
  kMax?: number;
  angleRange?: string;
  raceMode?: string;
  curvesCount?: number;
  rows?: number;
}

function gcdNum(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

function extractSubject(input: DiversifyMetadataInput): ExtractedSubject {
  const p = (input.params && typeof input.params === 'object' ? input.params : {}) as Record<string, unknown>;
  const songObj = p.song && typeof p.song === 'object' ? (p.song as Record<string, unknown>) : null;
  const out: ExtractedSubject = {};

  if (songObj && typeof songObj.name === 'string') {
    out.song = songObj.name;
  }
  if (typeof p.balls === 'number') out.n = p.balls;
  else if (typeof p.n === 'number') out.n = p.n;
  if (typeof p.bins === 'number') out.bins = p.bins;
  if (typeof p.rows === 'number') out.rows = p.rows;
  if (typeof p.T === 'number') out.dur = p.T;
  else if (typeof p.dur === 'number') out.dur = p.dur;
  else if (typeof p.duration === 'number') out.dur = p.duration;
  if (typeof p.algo === 'string') out.algo = p.algo;
  if (typeof p.shape === 'string') out.shape = p.shape;
  if (typeof p.terms === 'number') out.terms = p.terms;
  if (typeof p.k1 === 'number') out.kMax = p.k1;
  if (typeof p.mode === 'string') out.raceMode = p.mode;
  if (Array.isArray(p.curves)) out.curvesCount = p.curves.length;
  if (typeof p.a0 === 'number' && typeof p.a1 === 'number') {
    out.angleRange = `${p.a0}° to ${p.a1}°`;
  }
  if (typeof p.a === 'number' && typeof p.b === 'number') out.ratio = `${p.a}:${p.b}`;
  if (typeof p.digits === 'number') {
    out.digits = ['3', '31', '314', '3,141'][p.digits] ?? String(p.digits);
    out.mass = ['1 kg', '100 kg', '10,000 kg', '1,000,000 kg'][p.digits] ?? '100 kg';
  }
  if (typeof p.R === 'number' && typeof p.r === 'number') {
    out.gearR = p.R;
    out.gearR2 = p.r;
    out.petals = String(Math.round(p.R / gcdNum(p.R, p.r)));
  } else if (typeof p.n === 'number' && typeof p.dn === 'number') {
    out.petals = String((p.n * p.dn) % 2 === 1 ? p.n : 2 * p.n);
    out.ratio = `${p.n}/${p.dn}`;
  }
  if (!out.song) {
    const colonMatch = /:\s*([^#(\n]{3,36})/.exec(input.baseTitle);
    if (colonMatch && ['hop', 'rain', 'ring', 'multiply'].includes(input.engine)) {
      out.song = colonMatch[1].trim();
    }
  }
  return out;
}

const QUESTION_PROMPTS = [
  'Did the harmonic shift around the midpoint catch your ear?',
  'Which parameter change would make the most interesting follow-up study?',
  'Notice how the phase intervals tighten just before full alignment.',
  'Listening on headphones brings out the left-right panning across impacts.',
  'What classical motif or physical invariant should we test next?',
  'Look closely at the symmetry plane when the cycle turns around.',
];

const DISCLOSURES = [
  'Numerical integration at 60 steps/s paired with real-time WebAudio synthesis.',
  'Deterministic kinematics and frequency-locked synthesis — zero external samples.',
  'Computed live from the governing equations with tuned acoustic envelopes.',
];

const HASHTAG_POOLS: Record<string, string[][]> = {
  music: [
    ['#kineticmusic', '#acoustics', '#sounddesign'],
    ['#polyphony', '#synthesizer', '#harmonics'],
    ['#physicsmusic', '#instrument', '#timbre'],
  ],
  sort: [
    ['#plinko', '#kinematics', '#colorsort'],
    ['#probability', '#pegboard', '#physics'],
    ['#marbles', '#trajectory', '#simulation'],
  ],
  algo: [
    ['#algorithms', '#computerscience', '#sonification'],
    ['#sorting', '#datastructures', '#sounddesign'],
    ['#coding', '#visualization', '#acoustics'],
  ],
  phys: [
    ['#physics', '#harmonicmotion', '#simulation'],
    ['#chaostheory', '#pendulum', '#mechanics'],
    ['#science', '#dynamics', '#phasespace'],
  ],
  math: [
    ['#mathart', '#geometry', '#parametric'],
    ['#mathematics', '#spirograph', '#fourier'],
    ['#dynamicalsystems', '#calculus', '#simulation'],
  ],
};

function buildTitleAndHookPool(input: DiversifyMetadataInput, subj: ExtractedSubject): Array<{ title: string; hook: string; pattern: string; body: string }> {
  const song = subj.song ?? 'this Classic Melody';
  const eng = input.engine;
  const n = subj.n ?? 24;
  const dur = subj.dur ?? 26;
  const pObj = (input.params && typeof input.params === 'object' ? input.params : {}) as Record<string, unknown>;
  const voiceName = typeof pObj.voice === 'string' ? pObj.voice : 'marimba';

  if (eng === 'hop' || eng === 'rain' || eng === 'ring' || eng === 'multiply') {
    const noun =
      eng === 'rain'
        ? 'Falling Spheres'
        : eng === 'ring'
          ? 'Chord Reflections'
          : eng === 'multiply'
            ? 'Particle Splitting'
            : 'Ballistic Arcs';
    return [
      {
        title: `Kinetic ${voiceName} Study: ${noun} Performing ${song} 🎶`,
        hook: `${noun} voice ${song}`,
        pattern: 'statement',
        body: `Each impact triggers a synthesized ${voiceName} voice tuned directly to ${song}.`,
      },
      {
        title: `How Gravity Solves the Rhythm of ${song} via ${noun}`,
        hook: `Gravity times ${voiceName}`,
        pattern: 'question',
        body: `Kinematics replace a human performer: collision timestamps drive every interval of ${song}.`,
      },
      {
        title: `Arranged for ${voiceName}: ${song} Across ${dur}s of Motion ✨`,
        hook: `${voiceName} harmonic loop`,
        pattern: 'number-contrast',
        body: `Flight arcs and harmonic overtones stay locked across the ${dur}-second cycle.`,
      },
      {
        title: `Hearing ${song} Inside Exact Geometric Timing 🎹`,
        hook: `Acoustic timing study`,
        pattern: 'challenge',
        body: `Listen for how phrasing tightens whenever multiple bounces converge on the downbeat.`,
      },
      {
        title: `From Stillness to Resonance: ${song} Driven by ${noun}`,
        hook: `Resonance in motion`,
        pattern: 'statement',
        body: `Velocity and boundary geometry convert physical motion into clean ${voiceName} phrasing.`,
      },
      {
        title: `What Makes ${song} Work on Pure ${noun}? (${voiceName}) ⚡`,
        hook: `Physics meets phrasing`,
        pattern: 'question',
        body: `Adjusting height or reflection angle shifts the density while keeping pitch intervals intact.`,
      },
    ];
  }

  if (eng === 'plinko' || input.category === 'sort') {
    const bins = subj.bins ?? 4;
    const pegLayout = typeof pObj.pegLayout === 'string' ? pObj.pegLayout : 'stagger';
    return [
      {
        title: `${n} Marbles Route Cleanly Across ${bins} ${pegLayout} Peg Bins`,
        hook: `${n} spheres, ${bins} lanes`,
        pattern: 'number-contrast',
        body: `${n} color-coded spheres weave through a ${pegLayout} peg lattice and settle into ${bins} matched bins.`,
      },
      {
        title: `Peg Deflection Math: Separating ${n} Drops Into ${bins} Colors`,
        hook: `${pegLayout} lattice sort`,
        pattern: 'question',
        body: `Pre-calibrated peg impacts steer mixed drops into crisp chromatic columns.`,
      },
      {
        title: `Chromatic Funneling: ${bins} Target Columns Collect ${n} Spheres`,
        hook: `${bins} chromatic stacks`,
        pattern: 'statement',
        body: `Each peg collision sounds a harmonic note on ${voiceName} as columns fill steadily.`,
      },
      {
        title: `Inside a ${pegLayout} Quincunx: ${n} Rigid Bodies, ${bins} Bins`,
        hook: `Zero cross-bin errors`,
        pattern: 'mystery',
        body: `Deterministic trajectories ensure every single marble reaches its assigned target column.`,
      },
      {
        title: `Acoustic Routing on ${voiceName}: ${n} Bounces Finding ${bins} Goals`,
        hook: `Tuned pegboard collisions`,
        pattern: 'challenge',
        body: `Watch chaotic peg ricochets collapse into clean ordered columns scored by ${voiceName}.`,
      },
      {
        title: `Ballistic Sorting Architecture (${pegLayout}) for ${n} Rigid Marbles`,
        hook: `Ballistic path separation`,
        pattern: 'statement',
        body: `Every release seed is solved backward from bin geometry so ${bins} hues land neatly apart.`,
      },
    ];
  }

  if (eng === 'sorting' || input.category === 'algo') {
    const algo = (subj.algo ?? 'Sorting').toUpperCase();
    return [
      {
        title: `Auditory Trace of ${algo} Ordering ${n} Elements (${voiceName})`,
        hook: `${algo} over ${n} keys`,
        pattern: 'statement',
        body: `Every array comparison and swap emits a pitched ${voiceName} tone as ${n} values align.`,
      },
      {
        title: `Why ${algo} Creates a Distinct Harmonic Footprint on ${n} Items 🔊`,
        hook: `Acoustic footprint of ${algo}`,
        pattern: 'question',
        body: `Partitioning and swap patterns produce an unmistakable sonic signature from disorder to gradient.`,
      },
      {
        title: `Pivot & Merge Cadence: ${algo} Resolving ${n} Unsorted Values`,
        hook: `Listen to the pivot phase`,
        pattern: 'challenge',
        body: `Track how ${algo} structures ${n} scrambled keys step by step until the final verification sweep.`,
      },
      {
        title: `${n} Scrambled Hues Organized Live by ${algo} Logic`,
        hook: `${n} keys sorted in code`,
        pattern: 'number-contrast',
        body: `Algorithm sonification pairs computer science comparisons with crisp scale pitches.`,
      },
      {
        title: `Turning Array Inversions Into ${voiceName} Arpeggios: ${algo} (${n})`,
        hook: `Swaps drive pitch`,
        pattern: 'statement',
        body: `Notice the cadence tighten as ${algo} eliminates remaining out-of-order pairs across ${n} bars.`,
      },
      {
        title: `From Random Permutation to Gradient: ${algo} Timing Study`,
        hook: `Complexity made audible`,
        pattern: 'question',
        body: `Sub-quadratic partitions versus linear sweeps leave clear rhythmic contrasts in sound.`,
      },
    ];
  }

  if (eng === 'pendwave') {
    const view = typeof pObj.view === 'string' ? pObj.view : 'rows';
    const noteId = input.id.split('~')[0];
    return [
      {
        title: `Realignment at t=${dur}s: ${n} Detuned Pendulums Meet (${view})`,
        hook: `Full reunion at ${dur}s`,
        pattern: 'countdown',
        body: `${n} independent oscillators sweep through shifting waves before converging cleanly at ${dur}s.`,
      },
      {
        title: `Traveling Helices to Standing Waves Across ${n} Oscillators`,
        hook: `Phase symmetry live`,
        pattern: 'question',
        body: `Incremental period differences weave helical patterns over a ${dur}-second harmonic window.`,
      },
      {
        title: `Harmonic Phase Choir on ${voiceName}: ${n} Synchronized Bobs ✨`,
        hook: `${n}-pendulum resonance`,
        pattern: 'statement',
        body: `Every center-crossing sounds a ${voiceName} interval while ${n} paths evolve continuously.`,
      },
      {
        title: `Integer Frequency Ratios Split ${n} Bobs Into Twin Braids`,
        hook: `Pure phase geometry`,
        pattern: 'number-contrast',
        body: `At half-period T/2 odd and even indices invert completely before returning home.`,
      },
      {
        title: `How ${dur}s Acoustic Beats Emerge From ${n} Uncoupled Strings`,
        hook: `No springs between bobs`,
        pattern: 'question',
        body: `Zero mechanical coupling yet strict rational period steps create collective choreography (${noteId}).`,
      },
      {
        title: `Mach’s Wave Machine Rebuilt in ${view} Geometry (${dur}s Run)`,
        hook: `Physics of phase drift`,
        pattern: 'mystery',
        body: `Watch traveling crests fracture into polyrhythms and snapping triplets every quarter period.`,
      },
      {
        title: `Counting Phase Closures: T/3, T/2 & Full Sync at ${dur}s`,
        hook: `Fractional harmonic locks`,
        pattern: 'challenge',
        body: `Small integer step differences between adjacent pendulums turn chaos into momentary braids.`,
      },
      {
        title: `Polyrhythmic Envelope Sculpted by ${n} Independent Lengths (${voiceName})`,
        hook: `${voiceName} phase sweep`,
        pattern: 'statement',
        body: `Rendered in continuous 60-fps kinematics with harmonic scale triggers at equilibrium crossings.`,
      },
    ];
  }

  if (eng === 'orbits' || eng === 'dpend' || eng === 'lorenz') {
    const label = eng === 'orbits' ? 'Orbits' : eng === 'dpend' ? 'Double Pendulums' : 'Trajectories';
    const singular =
      eng === 'orbits'
        ? 'Planetary Resonance'
        : eng === 'dpend'
          ? 'Lyapunov Divergence'
          : 'Lorenz Attractor';
    return [
      {
        title: `${singular} Study Across ${n} ${label} (${dur}s Window) ✨`,
        hook: `${singular}`,
        pattern: 'statement',
        body: `Tiny initial differences compound into macroscopic divergence while triggering ${voiceName} cues.`,
      },
      {
        title: `Mapping Sensitive Dependence in ${n} Coupled ${label}`,
        hook: `Phase space evolution`,
        pattern: 'question',
        body: `Differential equations integrate live across ${dur} seconds to show attractor geometry.`,
      },
      {
        title: `Synchronized Until Chaos Breaks: ${n} ${label} in Orbit`,
        hook: `Precision vs divergence`,
        pattern: 'challenge',
        body: `Spot the exact moment neighboring trajectories shear apart despite nearly identical starts.`,
      },
      {
        title: `Strange Attractor Kinematics & ${voiceName} Sonification (${n} Paths)`,
        hook: `${voiceName} dynamics`,
        pattern: 'number-contrast',
        body: `Angular velocity and orbital sweeps drive tuned harmonic chimes throughout the trajectory.`,
      },
      {
        title: `Differential Phase Portrait: ${label} Sweeping Through Equilibrium`,
        hook: `RK4 solver live`,
        pattern: 'mystery',
        body: `Fourth-order Runge-Kutta integration preserves smooth orbital energy across all ${n} tracers.`,
      },
    ];
  }

  if (eng === 'spiro') {
    const pet = subj.petals ?? '7';
    const ratioDesc = subj.gearR && subj.gearR2 ? `${subj.gearR}:${subj.gearR2} gears` : `k=${subj.ratio ?? '5/2'}`;
    return [
      {
        title: `How ${ratioDesc} Trace a ${pet}-Petal Geometric Bloom 🌸`,
        hook: `${pet} petals from math`,
        pattern: 'question',
        body: `Rolling gear kinematics (${ratioDesc}) close cleanly after drawing ${pet} symmetrical petals.`,
      },
      {
        title: `Trigonometric Closure: ${pet} Petals From ${ratioDesc}`,
        hook: `${ratioDesc} petals lock`,
        pattern: 'statement',
        body: `Parametric gear motion (${ratioDesc}) closes cleanly after tracing ${pet} symmetrical petals.`,
      },
      {
        title: `Count All ${pet} Symmetrical Lobes (${ratioDesc}) ✨`,
        hook: `One rule, ${pet} petals`,
        pattern: 'challenge',
        body: `Polar & gear equations prove how integer ratios create botanical symmetry.`,
      },
      {
        title: `1 Continuous Curve Plots ${pet} Balanced Petals (${ratioDesc})`,
        hook: `1 line draws ${pet} petals`,
        pattern: 'number-contrast',
        body: `Parametric trig equations plotted at 60 steps/s guide the trace back to its origin.`,
      },
    ];
  }

  if (eng === 'lissa') {
    const r = subj.ratio ?? '3:2';
    return [
      {
        title: `Visualizing a ${r} Musical Interval as an X-Y Knot 🎻`,
        hook: `Ratio ${r} in motion`,
        pattern: 'statement',
        body: `Two perpendicular sine waves oscillating at ${r} weave this shifting Lissajous figure.`,
      },
      {
        title: `What Does a ${r} Frequency Ratio Look Like in Phase Space?`,
        hook: `Sound has a geometry`,
        pattern: 'question',
        body: `Phase drift rotates the ${r} curve in 3D space while matching ${voiceName} overtones play.`,
      },
      {
        title: `Oscilloscope Harmonics: ${r} Phase-Sweep Portrait ✨`,
        hook: `Continuous ${r} drift`,
        pattern: 'mystery',
        body: `Harmonic frequency ratios produce closed knots whose lobes match numerator and denominator.`,
      },
    ];
  }

  if (eng === 'epicycle') {
    const shape = (subj.shape ?? 'a Shape').replace(/^a\s+/i, '');
    const terms = subj.terms ?? 70;
    return [
      {
        title: `${terms} Spinning Circles Trace ${shape} Using Fourier Math`,
        hook: `Circles draw ${shape}`,
        pattern: 'number-contrast',
        body: `${terms} epicycles spinning at harmonic speeds combine tip-to-tail to sketch ${shape}.`,
      },
      {
        title: `How Rotating Circles Reconstruct ${shape} Without Straight Lines 🔄`,
        hook: `${terms} rotating phasors`,
        pattern: 'question',
        body: `Discrete Fourier transform turns any closed silhouette into stacked rotating vectors.`,
      },
      {
        title: `Complex Phasors Synthesizing ${shape} Over ${dur}s (${voiceName})`,
        hook: `Discrete Fourier trace`,
        pattern: 'challenge',
        body: `Follow the outer pen tip as all ${terms} stacked vectors complete a ${dur}-second revolution.`,
      },
    ];
  }

  if (eng === 'times') {
    const pts = subj.n ?? 200;
    const kMax = subj.kMax ?? 10;
    return [
      {
        title: `${pts} Circle Points + Multiplication = Cardioid Caustic ❤️`,
        hook: `Times tables make curves`,
        pattern: 'statement',
        body: `Connecting i to k×i mod ${pts} as k sweeps from 2 to ${kMax} reveals sharp optical caustics.`,
      },
      {
        title: `How Multiplier k=2→${kMax} Transforms ${pts} Circle Chords`,
        hook: `k sweeps from 2 to ${kMax}`,
        pattern: 'question',
        body: `Modular arithmetic turns simple straight chords into smooth epicycloid envelopes.`,
      },
      {
        title: `Cardioid to Nephroid: ${pts} Modular Chords Shifting Live ✨`,
        hook: `Simple rule, deep order`,
        pattern: 'mystery',
        body: `Integer multipliers k=2, 3, 4 flash clear petal cusps as straight chords tangent the envelope.`,
      },
    ];
  }

  if (eng === 'phyllo') {
    const seeds = subj.n ?? 1400;
    const rangeTxt = subj.angleRange ? `Sweeping ${subj.angleRange}` : `137.5° Golden Angle`;
    return [
      {
        title: `Why ${seeds} Seeds Need Exactly 137.5° (${rangeTxt}) 🌻`,
        hook: `Why 137.508 degrees?`,
        pattern: 'question',
        body: `With ${seeds} points packed radially, ${rangeTxt} shows why nature favors the golden ratio.`,
      },
      {
        title: `0.2° Drift Breaks All ${seeds} Fibonacci Sunflower Spirals`,
        hook: `0.2° breaks the lattice`,
        pattern: 'number-contrast',
        body: `Packing ${seeds} seeds around the center reveals Fibonacci spirals only near 137.508°.`,
      },
      {
        title: `${seeds} Golden-Angle Points Blooming via Vogel’s Law 🌻`,
        hook: `Botanical packing code`,
        pattern: 'statement',
        body: `Every new point turns by the irrational golden angle so gaps never align into spokes.`,
      },
    ];
  }

  if (eng === 'sieve') {
    const limit = subj.n ?? 100;
    return [
      {
        title: `Composite Multiples Stripped Below ${limit} (Prime Sieve) 🔢`,
        hook: `Primes under ${limit}`,
        pattern: 'statement',
        body: `Crossing off multiples from 2 upward isolates every prime number below ${limit}.`,
      },
      {
        title: `How a 2,000-Year-Old Grid Filters Every Prime Under ${limit}`,
        hook: `Ancient prime filter`,
        pattern: 'question',
        body: `Each strike sounds ${voiceName} as the Sieve of Eratosthenes clears composites up to ${limit}.`,
      },
    ];
  }

  if (eng === 'pi') {
    const cols = subj.digits ?? '314';
    const mass = subj.mass ?? '10,000 kg';
    return [
      {
        title: `${mass} vs 1 kg: ${cols} Elastic Bounces Compute Pi`,
        hook: `${cols} bounces = Pi`,
        pattern: 'number-contrast',
        body: `Galperin's elastic collision theorem: a ${mass} block triggers ${cols} hits — exact digits of π.`,
      },
      {
        title: `Why Two Sliding Blocks Encode the Digits of Pi (${cols} Hits)`,
        hook: `Momentum computes Pi`,
        pattern: 'question',
        body: `Conservation of momentum & energy turns ${mass} vs 1 kg into a mechanical π counter.`,
      },
    ];
  }

  if (eng === 'galton') {
    const balls = subj.n ?? 250;
    const rows = subj.rows ?? 12;
    return [
      {
        title: `${balls} Random Drops Across ${rows} Rows Form a Bell Curve 🔔`,
        hook: `Binomial trials live`,
        pattern: 'statement',
        body: `${balls} marbles take ${rows} random left/right bounces yet build a clean normal distribution.`,
      },
      {
        title: `How ${balls} 50/50 Peg Bounces Converge on One Bell Envelope`,
        hook: `${balls} independent trials`,
        pattern: 'question',
        body: `Binomial probability turns individual deflections across ${rows} peg rows into smooth symmetry.`,
      },
    ];
  }

  if (eng === 'race') {
    const isTauto = subj.raceMode === 'tauto';
    return isTauto
      ? [
          {
            title: `Release From Any Height — All ${n} Spheres Tie at the Bottom 🥣`,
            hook: `Any height, exact tie`,
            pattern: 'mystery',
            body: `On a cycloid bowl (tautochrone), steeper starts accelerate faster so every height finishes together.`,
          },
          {
            title: `Why Higher Drops Inside a Cycloid Never Lose Time`,
            hook: `Isochronous physics`,
            pattern: 'question',
            body: `Huygens' tautochrone curve equalizes travel time regardless of release height.`,
          },
        ]
      : [
          {
            title: `${subj.curvesCount ?? 4} Ramps Race Gravity: Why Straight Loses 🏁`,
            hook: `Straight line loses`,
            pattern: 'challenge',
            body: `Among ${subj.curvesCount ?? 4} paths, the longer cycloid drop builds speed early and wins cleanly.`,
          },
          {
            title: `Variational Calculus Test: Which Descent Curve Wins?`,
            hook: `Cycloid vs straight arc`,
            pattern: 'question',
            body: `The brachistochrone problem proves the shortest distance is not the fastest descent.`,
          },
        ];
  }

  const cleanSubject = input.baseTitle
    .replace(/#\w+/g, '')
    .replace(EMOJI_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);

  return [
    {
      title: `Parametric Kinematics & Harmonic Mapping: ${cleanSubject}`,
      hook: `Governing equations live`,
      pattern: 'statement',
      body: `A clean mathematical rule unfolds frame-by-frame with synchronized ${voiceName} audio cues.`,
    },
    {
      title: `Why Does ${cleanSubject} Produce This Exact Geometry? 📐`,
      hook: `Why this exact shape?`,
      pattern: 'question',
      body: `Small parameter steps transform simple equations into intricate geometric motion.`,
    },
    {
      title: `Tracing Phase Closure Across ${cleanSubject}`,
      hook: `Follow the phase closure`,
      pattern: 'challenge',
      body: `Trace the curve evolve across the full cycle before the geometry locks cleanly.`,
    },
    {
      title: `1 Governing Equation, Continuous Symmetry: ${cleanSubject}`,
      hook: `One rule. Pure order.`,
      pattern: 'number-contrast',
      body: `Pure numerical integration and harmonic ${voiceName} tone mapping.`,
    },
    {
      title: `Inside the Phase Portrait of ${cleanSubject} ✨`,
      hook: `Phase portrait study`,
      pattern: 'mystery',
      body: `Overlapping trajectories lock into symmetry near the climax of the ${dur}-second run.`,
    },
  ];
}

export function diversifyMetadataLocal(input: DiversifyMetadataInput): DiversifiedMetadataResult {
  const subj = extractSubject(input);
  const candidates = buildTitleAndHookPool(input, subj);
  const baseHash = hashSeed(`${input.id}|${input.engine}|${input.seed ?? 0}`);
  const variant = Math.max(0, input.variant ?? 0);
  const recent = input.recentTitles ?? [];
  const forbidden = input.forbiddenTopics ?? [];

  const firstParagraph =
    (input.description ?? '')
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 20 && !l.startsWith('#') && !/^every frame is generated/i.test(l)) ?? '';

  const hashtagOptions = HASHTAG_POOLS[input.category] ?? HASHTAG_POOLS.phys;

  let best: DiversifiedMetadataResult | null = null;
  let bestScore = -999;

  for (let offset = 0; offset < Math.max(candidates.length * 2, 10); offset++) {
    const idx = (baseHash + variant + offset) % candidates.length;
    const slot = candidates[idx];
    const qIdx = (baseHash + variant + offset * 3) % QUESTION_PROMPTS.length;
    const dIdx = (baseHash + offset) % DISCLOSURES.length;
    const hIdx = (baseHash + variant + offset) % hashtagOptions.length;

    const rawDescParts = [
      slot.body,
      firstParagraph && jaccard3Gram(firstParagraph, slot.body) < 0.45 ? firstParagraph : '',
      QUESTION_PROMPTS[qIdx],
      '',
      DISCLOSURES[dIdx],
      '',
      hashtagOptions[hIdx].join(' '),
    ].filter((x, i, arr) => !(x === '' && arr[i - 1] === ''));

    const sanitized = sanitizeMetadataCandidate({
      title: slot.title,
      hookLine: slot.hook,
      description: rawDescParts.join('\n'),
      tags: [...input.tags, input.engine, input.category, 'procedural animation', 'physics simulation'],
      forbiddenTopics: forbidden,
    });

    const audit = auditPublishMetadata({
      title: sanitized.title,
      hookLine: sanitized.hookLine,
      description: sanitized.description,
      tags: sanitized.tags,
      recentTitles: recent,
      forbiddenTopics: forbidden,
    });

    // Rank heavily against any title duplication with recent history
    const rankScore =
      audit.score -
      audit.stats.maxTitleSim * 45 -
      (audit.issues.some((i) => i.code === 'DUP_FIRST_THREE_WORDS') ? 25 : 0);

    if (rankScore > bestScore) {
      bestScore = rankScore;
      best = {
        ...sanitized,
        patternUsed: slot.pattern,
        audit,
      };
    }

    if (audit.passed && audit.stats.maxTitleSim < 0.48 && !audit.issues.some((i) => i.code.startsWith('DUP_'))) {
      break;
    }
  }

  return best!;
}
