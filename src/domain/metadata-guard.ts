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
2. Hook (<= 6 words, <= 45 chars): Short, punchy on-screen text for the top safe zone. Must create an instant open loop (question, prediction, or timing promise).
3. Description: 2-3 crisp lines (what happens + why it's satisfying/surprising + one engaging question for comments), a short synthetic/code disclosure line ("Rendered in code with synthesized audio."), and ONLY 3-4 relevant #hashtags at the very bottom (never 6+ hashtags).
4. Tags: 8-14 focused lowercase search tags, combined length <= 400 chars.
5. Policy & Safety: Zero fake promises ("100% impossible", "free money", "sub4sub", "watch before deleted"), zero copyrighted pop-song claims, zero misleading clickbait, zero forbidden channel topics.
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
    title = 'Code-Rendered Physics & Sound Simulation';
  }

  let hookLine = (input.hookLine ?? '').replace(/#\w+/g, '').replace(/\s+/g, ' ').trim();
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
    bodyLines.push(cleanLine.trimEnd());
  }

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1] === '') bodyLines.pop();
  const cappedHashtags = (collectedHashtags.length > 0 ? collectedHashtags : ['#shorts', '#satisfying', '#physics', '#simulation']).slice(0, 4);
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
  'Which moment gave you chills? Drop the timestamp below.',
  'Did you predict the ending before the final 3 seconds?',
  'Listen with headphones — did you hear the harmonic shift?',
  'Comment what pattern or melody you want rendered next.',
  'How many loops did you watch before noticing the symmetry?',
  'Rate the satisfaction from 1 to 10 in the comments.',
];

const DISCLOSURES = [
  '100% procedural math & physics simulation with synthesized audio — zero stock footage.',
  'Every frame and sound wave is computed deterministically in code.',
  'Generated via real-time physics & WebAudio synthesis (no camera, no reuploads).',
];

const HASHTAG_POOLS: Record<string, string[][]> = {
  music: [
    ['#shorts', '#music', '#satisfying', '#synthesizer'],
    ['#shorts', '#oddlysatisfying', '#melody', '#asmr'],
    ['#shorts', '#bouncingball', '#physics', '#sounddesign'],
  ],
  sort: [
    ['#shorts', '#ballsort', '#satisfying', '#plinko'],
    ['#shorts', '#colorsorting', '#oddlysatisfying', '#asmr'],
    ['#shorts', '#physics', '#marbles', '#loop'],
  ],
  algo: [
    ['#shorts', '#algorithm', '#sorting', '#computerscience'],
    ['#shorts', '#coding', '#soundofsorting', '#satisfying'],
    ['#shorts', '#visualization', '#math', '#asmr'],
  ],
  phys: [
    ['#shorts', '#physics', '#science', '#satisfying'],
    ['#shorts', '#simulation', '#hypnotic', '#oddlysatisfying'],
    ['#shorts', '#chaostheory', '#pendulum', '#loop'],
  ],
  math: [
    ['#shorts', '#mathart', '#geometry', '#satisfying'],
    ['#shorts', '#mathematics', '#spirograph', '#hypnotic'],
    ['#shorts', '#fractals', '#simulation', '#loop'],
  ],
};

function buildTitleAndHookPool(input: DiversifyMetadataInput, subj: ExtractedSubject): Array<{ title: string; hook: string; pattern: string; body: string }> {
  const song = subj.song ?? 'this Classic Melody';
  const eng = input.engine;
  const n = subj.n ?? 24;
  const dur = subj.dur ?? 26;

  if (eng === 'hop' || eng === 'rain' || eng === 'ring' || eng === 'multiply') {
    const noun =
      eng === 'rain'
        ? 'Falling Balls'
        : eng === 'ring'
          ? 'Orbiting Ball'
          : eng === 'multiply'
            ? 'Multiplying Balls'
            : 'Bouncing Ball';
    return [
      {
        title: `Can ${noun} Nail Every Beat of ${song}? 🎶`,
        hook: `Wait for the final bar`,
        pattern: 'question',
        body: `Each impact triggers an exact synthesized pitch from ${song}, timed to the millisecond.`,
      },
      {
        title: `How ${song} Sounds When Driven Purely by Gravity`,
        hook: `Gravity plays the melody`,
        pattern: 'statement',
        body: `Instead of a human performer, gravity and collision physics drive every single note of ${song}.`,
      },
      {
        title: `1 Rule Turns Collisions Into ${song} ✨`,
        hook: `Every bounce = 1 note`,
        pattern: 'number-contrast',
        body: `Watch the trajectory build tension until the melody locks into full harmony.`,
      },
      {
        title: `Name ${song} Before the 5-Second Mark 🎹`,
        hook: `Guess the melody in 5s`,
        pattern: 'challenge',
        body: `Test your ear: every visual strike corresponds to a frequency in ${song}.`,
      },
      {
        title: `Inside the Geometry of ${song} (${dur}s Loop)`,
        hook: `Audio meets geometry`,
        pattern: 'statement',
        body: `Motion trajectories and harmonic intervals stay phase-locked across the entire ${dur}-second cycle.`,
      },
      {
        title: `What Happens When ${noun} Speed Up on ${song}? ⚡`,
        hook: `Tempo escalates every second`,
        pattern: 'question',
        body: `As collision frequency climbs, the rhythm compresses into an intricate sonic cascade.`,
      },
    ];
  }

  if (eng === 'plinko' || input.category === 'sort') {
    const bins = subj.bins ?? 4;
    return [
      {
        title: `${n} Marbles, ${bins} Bins: Zero Sorting Mistakes`,
        hook: `${n} balls. ${bins} bins.`,
        pattern: 'number-contrast',
        body: `${n} color-coded spheres weave through offset pegs and settle cleanly into ${bins} matched bins.`,
      },
      {
        title: `How Do ${n} Falling Balls Sort Into ${bins} Colors? 🌈`,
        hook: `How do they self-sort?`,
        pattern: 'question',
        body: `Pre-calibrated peg deflections guide chaotic drops into crisp chromatic order.`,
      },
      {
        title: `Pick a Bin Before All ${n} Balls Drop 👇`,
        hook: `Pick your winning color`,
        pattern: 'challenge',
        body: `Each peg impact triggers a harmonic chime while the ${bins} color columns race to fill up.`,
      },
      {
        title: `Chaos Above, ${bins} Perfect Stacks Below`,
        hook: `Chaos becomes order`,
        pattern: 'statement',
        body: `Watch ${n} trajectories collide at the funnel before snapping into neat parallel columns.`,
      },
      {
        title: `Why Zero Balls Miss Their Bin (${n} Drops)`,
        hook: `Zero errors allowed`,
        pattern: 'mystery',
        body: `Deterministic trajectories ensure every single marble reaches its matching color bin on cue.`,
      },
      {
        title: `Peg Maze Physics: ${n} Spheres Finding ${bins} Targets 🎯`,
        hook: `Every bounce guides home`,
        pattern: 'statement',
        body: `Gravity and angled pins turn a messy ${n}-ball release into ${bins} clean vertical bands.`,
      },
      {
        title: `Which of the ${bins} Color Columns Fills Up First?`,
        hook: `First column to finish?`,
        pattern: 'question',
        body: `Follow your chosen color through ${n} cascading bounces from top funnel to bottom slot.`,
      },
      {
        title: `Satisfying Marble Cascade: ${bins} Lanes, ${n} Hits`,
        hook: `Pure Plinko harmony`,
        pattern: 'number-contrast',
        body: `Timed collision spacing keeps the stream rhythmic from first drop to final marble.`,
      },
    ];
  }

  if (eng === 'sorting' || input.category === 'algo') {
    const algo = (subj.algo ?? 'Sorting').toUpperCase();
    return [
      {
        title: `Hear ${n} Shuffled Bars Become Order via ${algo}`,
        hook: `Listen to ${algo}`,
        pattern: 'statement',
        body: `Every array comparison and swap emits a pitched tone as ${n} values organize themselves.`,
      },
      {
        title: `Why ${algo} Sounds Completely Different on ${n} Items 🔊`,
        hook: `${algo} vs ${n} elements`,
        pattern: 'question',
        body: `Algorithmic complexity leaves an unmistakable acoustic fingerprint from chaos to sorted rainbow.`,
      },
      {
        title: `Can You Spot the Pivot Phase in ${algo}?`,
        hook: `Spot the pivot moment`,
        pattern: 'challenge',
        body: `Track how ${algo} partitions ${n} scrambled elements step by step until the final sweep.`,
      },
      {
        title: `From Pure Noise to Clean Sweep in ${n} Steps (${algo})`,
        hook: `Chaos to clean sweep`,
        pattern: 'number-contrast',
        body: `Auditory algorithm visualization turns raw computer science comparisons into crisp synth sweeps.`,
      },
      {
        title: `Code Sonification: ${algo} Organizing ${n} Random Values`,
        hook: `${algo} in audio form`,
        pattern: 'statement',
        body: `Watch scrambled hues snap into gradient alignment while each swap triggers a marimba pitch.`,
      },
      {
        title: `${n} Unsorted Elements Meet ${algo} Logic ⚡`,
        hook: `Watch the rainbow lock`,
        pattern: 'mystery',
        body: `Notice the final verification pass sweep cleanly up the frequency scale once sorted.`,
      },
    ];
  }

  if (eng === 'pendwave' || eng === 'orbits' || eng === 'dpend' || eng === 'lorenz') {
    const label =
      eng === 'pendwave'
        ? 'Pendulums'
        : eng === 'orbits'
          ? 'Orbits'
          : eng === 'dpend'
            ? 'Double Pendulums'
            : 'Trajectories';
    const singular =
      eng === 'pendwave'
        ? 'Harmonic Wave'
        : eng === 'orbits'
          ? 'Planetary Resonance'
          : eng === 'dpend'
            ? 'Butterfly Effect'
            : 'Lorenz Attractor';
    return [
      {
        title: `Wait for Second ${dur}: ${n} ${label} Snap Back Into Sync`,
        hook: `Wait for second ${dur}`,
        pattern: 'countdown',
        body: `${n} independent oscillators drift through shifting waves before realigning simultaneously at ${dur}s.`,
      },
      {
        title: `Why ${n} ${label} Form Hidden Waves Before Chaos`,
        hook: `Hidden waves appear`,
        pattern: 'question',
        body: `Tiny initial differences compound into intricate phase patterns over a ${dur}-second window.`,
      },
      {
        title: `Order -> Drift -> Realignment Across ${n} ${label} ✨`,
        hook: `Order, drift, return`,
        pattern: 'statement',
        body: `Every phase crossing rings an overtone while ${n} coupled paths evolve smoothly in 9:16.`,
      },
      {
        title: `Could You Track All ${n} ${label} Without Blinking?`,
        hook: `Track the outer wave`,
        pattern: 'challenge',
        body: `Keep your eye on the phase boundary as the visual density flips mid-cycle.`,
      },
      {
        title: `${singular} in ${dur}s: ${n} Coupled Paths Collide With Rhythm`,
        hook: `${singular} live`,
        pattern: 'number-contrast',
        body: `Integer frequency ratios create snakes, double helices, and sudden full-line reunions.`,
      },
      {
        title: `Halfway Through, ${n} ${label} Split Into Two Opposite Patterns`,
        hook: `Watch the halfway split`,
        pattern: 'mystery',
        body: `At T/2 odd and even indices invert phases completely before converging back home.`,
      },
      {
        title: `Hypnotic Phase Math: ${n} Moving Dots, Zero Randomness 🌊`,
        hook: `Pure phase geometry`,
        pattern: 'statement',
        body: `What looks chaotic at second 9 is actually strict periodic arithmetic playing out live.`,
      },
      {
        title: `How Long Until ${n} Diverging ${label} Meet Again? (${dur}s)`,
        hook: `Count until reunion`,
        pattern: 'question',
        body: `Each neighbor gains one extra cycle over ${dur} seconds so all ${n} finish together.`,
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
        title: `Watch ${pet} Petals Lock Into Place (${ratioDesc})`,
        hook: `Watch the curve close`,
        pattern: 'statement',
        body: `Every loop step adds glowing precision until the hypotrochoid curve meets its origin.`,
      },
      {
        title: `Count the ${pet} Petals Before the Final Turn ✨`,
        hook: `One rule, ${pet} petals`,
        pattern: 'challenge',
        body: `Polar & gear equations prove how integer ratios create botanical symmetry.`,
      },
      {
        title: `1 Continuous Line Draws ${pet} Symmetrical Petals (${ratioDesc})`,
        hook: `1 line draws ${pet} petals`,
        pattern: 'number-contrast',
        body: `No brushes or keyframes — just parametric trig equations plotted at 60 steps per second.`,
      },
    ];
  }

  if (eng === 'lissa') {
    const r = subj.ratio ?? '3:2';
    return [
      {
        title: `Visualizing a ${r} Musical Interval as a Knot 🎻`,
        hook: `Ratio ${r} in motion`,
        pattern: 'statement',
        body: `Two perpendicular sine waves oscillating at ${r} weave this shifting Lissajous figure.`,
      },
      {
        title: `What Does a ${r} Frequency Ratio Look Like?`,
        hook: `Sound has a shape`,
        pattern: 'question',
        body: `Phase drift rotates the ${r} curve in 3D space while matching synth overtones play.`,
      },
      {
        title: `Pure Sound Geometry: Oscilloscope ${r} Loop ✨`,
        hook: `Watch the knot twist`,
        pattern: 'mystery',
        body: `Harmonic frequency ratios produce closed knots whose lobes match the numerator and denominator.`,
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
        title: `How Can Rotating Circles Only Draw ${shape}? 🔄`,
        hook: `Only circles. Watch.`,
        pattern: 'question',
        body: `Discrete Fourier transform turns any closed silhouette into stacked rotating vectors.`,
      },
      {
        title: `Guess What ${terms} Stacked Circles Are Drawing 👀`,
        hook: `Guess the silhouette`,
        pattern: 'challenge',
        body: `Wait for the outer pen tip to complete its full ${dur}-second revolution around ${shape}.`,
      },
    ];
  }

  if (eng === 'times') {
    const pts = subj.n ?? 200;
    const kMax = subj.kMax ?? 10;
    return [
      {
        title: `${pts} Circle Points + Multiplication = Cardioid Surprise ❤️`,
        hook: `Times tables make art`,
        pattern: 'statement',
        body: `Connecting i to k×i mod ${pts} as k sweeps from 2 to ${kMax} reveals hidden caustic curves.`,
      },
      {
        title: `What Happens When Multiplication Climbs to ${kMax} on ${pts} Dots?`,
        hook: `Watch k sweep to ${kMax}`,
        pattern: 'question',
        body: `Modular arithmetic turns simple straight chords into glowing envelope curves.`,
      },
      {
        title: `Cardioid to Nephroid: ${pts} Chords Shifting Live ✨`,
        hook: `Simple rule, deep order`,
        pattern: 'mystery',
        body: `Notice how integer multipliers k=2, 3, 4 flash clear petal cusps before dissolving.`,
      },
    ];
  }

  if (eng === 'phyllo') {
    const seeds = subj.n ?? 1400;
    const rangeTxt = subj.angleRange ? `Sweeping ${subj.angleRange}` : `137.5° Golden Angle`;
    return [
      {
        title: `Why ${seeds} Seeds Need Exactly 137.5° (${rangeTxt}) 🌻`,
        hook: `Why 137.5 degrees?`,
        pattern: 'question',
        body: `With ${seeds} points packed radially, ${rangeTxt} shows why nature favors the golden ratio.`,
      },
      {
        title: `Change 0.2° and Watch ${seeds} Sunflower Spirals Break`,
        hook: `0.2° breaks the spiral`,
        pattern: 'number-contrast',
        body: `Packing ${seeds} seeds around the center reveals Fibonacci spirals only near 137.508°.`,
      },
      {
        title: `${seeds} Golden-Angle Points Blooming in Real Time 🌻`,
        hook: `Nature's packing code`,
        pattern: 'statement',
        body: `Every new point turns by the irrational golden angle so gaps never align into spokes.`,
      },
    ];
  }

  if (eng === 'sieve') {
    const limit = subj.n ?? 100;
    return [
      {
        title: `Every Composite Falls Away Under ${limit} (Prime Sieve) 🔢`,
        hook: `Primes under ${limit}`,
        pattern: 'statement',
        body: `Crossing off multiples from 2 upward leaves only the prime numbers below ${limit}.`,
      },
      {
        title: `How a 2,000-Year-Old Grid Finds All Primes Below ${limit}`,
        hook: `Ancient prime filter`,
        pattern: 'question',
        body: `Each strike plays a tone as the Sieve of Eratosthenes clears composite numbers up to ${limit}.`,
      },
    ];
  }

  if (eng === 'pi') {
    const cols = subj.digits ?? '314';
    const mass = subj.mass ?? '10,000 kg';
    return [
      {
        title: `${mass} vs 1 kg: ${cols} Bounces Compute Pi 🤯`,
        hook: `${cols} bounces = Pi`,
        pattern: 'number-contrast',
        body: `Galperin's elastic collision theorem: a ${mass} block triggers ${cols} hits — exact digits of π.`,
      },
      {
        title: `Why Two Sliding Blocks Know the Digits of Pi (${cols} Hits)`,
        hook: `Physics computes Pi`,
        pattern: 'question',
        body: `Conservation of momentum & energy turns ${mass} vs 1 kg into a mechanical π calculator.`,
      },
    ];
  }

  if (eng === 'galton') {
    const balls = subj.n ?? 250;
    const rows = subj.rows ?? 12;
    return [
      {
        title: `${balls} Random Drops Across ${rows} Rows Form a Bell Curve 🔔`,
        hook: `Chance draws order`,
        pattern: 'statement',
        body: `${balls} marbles take ${rows} random left/right bounces yet build a clean normal distribution.`,
      },
      {
        title: `How ${balls} Unpredictable Balls Always Agree on One Shape`,
        hook: `${balls} coin flips live`,
        pattern: 'question',
        body: `Binomial probability turns individual chaos across ${rows} peg rows into smooth symmetry.`,
      },
    ];
  }

  if (eng === 'race') {
    const isTauto = subj.raceMode === 'tauto';
    return isTauto
      ? [
          {
            title: `Drop From Any Height — Why All ${n} Balls Tie at the Bottom 🥣`,
            hook: `Any height, exact tie`,
            pattern: 'mystery',
            body: `On a cycloid bowl (tautochrone), steeper starts accelerate faster so every height finishes together.`,
          },
          {
            title: `The Curve Where Higher Drops Never Lose Time`,
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
            title: `Can You Pick the Fastest Ramp Before Release?`,
            hook: `Pick the fastest slide`,
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
      title: `Watch Code Reveal Hidden Symmetry: ${cleanSubject}`,
      hook: `Hidden math symmetry`,
      pattern: 'statement',
      body: `A clean mathematical rule unfolds frame-by-frame with synchronized audio cues.`,
    },
    {
      title: `Why Does ${cleanSubject} Produce This Exact Pattern? 📐`,
      hook: `Why this exact shape?`,
      pattern: 'question',
      body: `Small parameter steps transform simple equations into intricate geometric motion.`,
    },
    {
      title: `Can You Predict the Final Shape? (${cleanSubject})`,
      hook: `Predict the final curve`,
      pattern: 'challenge',
      body: `Watch the trace evolve across the full cycle before the geometry closes cleanly.`,
    },
    {
      title: `1 Simple Equation, Mesmerizing Result: ${cleanSubject}`,
      hook: `One rule. Pure order.`,
      pattern: 'number-contrast',
      body: `No keyframes or manual animation — purely numerical integration and harmonic tone mapping.`,
    },
    {
      title: `The Most Hypnotic Way to See ${cleanSubject} ✨`,
      hook: `Watch the pattern lock`,
      pattern: 'mystery',
      body: `Watch closely near the climax as overlapping arcs lock into symmetry.`,
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
