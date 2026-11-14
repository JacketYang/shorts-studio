import { z } from 'zod';
import { canonicalStringify, sha256Hex } from './hash.ts';
import { semverSatisfies, TEMPLATE_REGISTRY } from './templates.ts';
import type { Channel, MelodyEntry, SpecBatch, ValidationIssue, VideoSpec } from './types.ts';

const HexColorSchema = z.string().regex(/^#[0-9A-Fa-f]{6}$/, '必须是 #RRGGBB 十六进制颜色');

export const MelodyNoteSchema = z.object({
  beat: z.number().min(0),
  pitch: z.number().int().min(0).max(127),
  dur: z.number().positive(),
  vel: z.number().int().min(1).max(127),
});

export const MelodyEntrySchema = z
  .object({
    schema: z.literal('melody/1'),
    id: z.string().min(3).max(80),
    channel_id: z.string().nullable().optional(),
    title: z.string().min(1).max(120),
    composer: z.string().min(1),
    death_year: z.number().int().nullable().optional(),
    source_url: z.string().min(1),
    license: z.enum(['public-domain', 'cc0', 'original']),
    key: z.string().min(1),
    tempo_bpm: z.number().min(40).max(240),
    time_signature: z.string().min(3),
    recognizability: z.number().int().min(1).max(5),
    tags: z.array(z.string()),
    tracks: z
      .array(
        z.object({
          name: z.string().min(1),
          notes: z.array(MelodyNoteSchema).min(4),
        })
      )
      .min(1),
    loopable: z.boolean(),
    last_used_at: z.string().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (val.license === 'public-domain') {
      const isTraditional = val.composer.toLowerCase() === 'traditional';
      if (!isTraditional && (val.death_year === undefined || val.death_year === null || val.death_year > 1950)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['death_year'],
          message: '公版曲目作曲者逝世年份必须 <= 1950（传统民歌请填 composer: "traditional"）',
        });
      }
    }
    for (let tIdx = 0; tIdx < val.tracks.length; tIdx++) {
      const notes = val.tracks[tIdx].notes;
      for (let i = 1; i < notes.length; i++) {
        if (notes[i].beat < notes[i - 1].beat) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['tracks', tIdx, 'notes', i, 'beat'],
            message: '音符 beat 必须单调不减',
          });
        }
      }
    }
  });

export const VideoSpecSchema = z.object({
  schema: z.literal('videospec/1'),
  spec_key: z.string().regex(/^[a-z0-9-]{6,80}$/, 'spec_key 需为 6-80 位小写字母/数字/连字符'),
  channel_slug: z.string().min(2).max(60),
  concept: z.object({
    working_title: z.string().min(3).max(160),
    hook_line: z.string().min(2).max(80),
    hook_style: z.enum(['prediction', 'escalation', 'mystery', 'countdown', 'contrast']),
    payoff: z.string().min(5).max(300),
    emotion: z.enum(['satisfying', 'curious', 'tense', 'funny', 'awe']),
    series: z
      .object({
        slug: z.string().min(2).max(80),
        episode: z.number().int().min(1),
        title: z.string().min(1).max(100),
      })
      .nullable(),
    novelty_notes: z.string().min(20, 'novelty_notes 至少 20 个字符，需说明实质差异'),
  }),
  format: z.object({
    aspect: z.enum(['9:16', '1:1']),
    width: z.number().int().min(720).max(1080),
    height: z.number().int().min(720).max(1920),
    fps: z.number().int().refine((v) => v === 30 || v === 60, 'fps 仅支持 30 或 60'),
    duration_sec: z.number().min(8).max(180),
    loop: z.object({
      enabled: z.boolean(),
      mode: z.enum(['visual-return', 'audio-return', 'none']),
    }),
  }),
  scene: z.object({
    template: z.string().min(2),
    template_version: z.string().min(1),
    seed: z.number().int().min(0),
    style: z.object({
      palette: z.object({
        family: z.enum(['neon', 'pastel', 'mono', 'warm', 'cool']),
        colors: z.array(HexColorSchema).min(1).max(8),
      }),
      background: z
        .object({
          type: z.enum(['solid', 'gradient', 'grid']),
          colors: z.array(HexColorSchema).min(1).max(4),
        })
        .optional(),
      trail: z
        .object({
          enabled: z.boolean(),
          length_frames: z.number().int().min(0).max(60),
          fade: z.number().min(0).max(1),
        })
        .optional(),
      camera: z
        .object({
          zoom_from: z.number().min(0.5).max(2.0),
          zoom_to: z.number().min(0.5).max(2.5),
          shake: z.number().min(0).max(1),
        })
        .optional(),
    }),
    params: z.record(z.string(), z.unknown()),
  }),
  timeline: z.array(
    z.discriminatedUnion('type', [
      z.object({
        t: z.number(),
        dur: z.number().positive(),
        type: z.literal('text'),
        role: z.enum(['hook', 'end_card', 'caption']),
        text: z.string().min(1).max(120),
        position: z.enum(['top-safe', 'center', 'bottom-safe']),
        style: z.string().optional(),
      }),
      z.object({
        t: z.number(),
        type: z.literal('event'),
        name: z.string().min(1),
        args: z.record(z.string(), z.unknown()).optional(),
      }),
      z.object({
        t: z.number(),
        type: z.literal('sfx'),
        sound: z.string().min(1),
        gain_db: z.number().min(-60).max(0).optional(),
      }),
    ])
  ),
  audio: z.object({
    mode: z.enum(['sim-driven', 'track', 'none']),
    music: z
      .object({
        melody_ref: z.discriminatedUnion('source', [
          z.object({ source: z.literal('library'), id: z.string().min(2) }),
          z.object({ source: z.literal('inline'), melody: MelodyEntrySchema }),
        ]),
        transpose: z.number().int().min(-24).max(24),
        tempo_bpm: z.number().min(40).max(240),
        instrument: z.string().min(1),
        note_mapping: z.enum(['per_collision', 'per_beat', 'per_event']),
        wrap: z.enum(['loop', 'clamp']),
        reverb: z.number().min(0).max(1),
      })
      .optional(),
    sfx: z
      .array(
        z.object({
          event: z.string().min(1),
          sound: z.string().min(1),
          gain_db: z.number().min(-60).max(0),
        })
      )
      .optional(),
    mix: z.object({
      target_lufs: z.number().min(-24).max(-6),
      true_peak_db: z.number().min(-6).max(0),
    }),
  }),
  publish: z.object({
    title: z.string().min(1).max(100, '标题不得超过 100 字符'),
    description: z.string().min(1).max(5000, '描述不得超过 5000 字符'),
    tags: z.array(z.string()).default([]),
    category_id: z.string().optional(),
    made_for_kids: z.boolean(),
    contains_synthetic_media: z.boolean(),
    default_language: z.string().min(2).max(10),
    first_comment: z.string().max(200).optional(),
    schedule: z
      .object({
        mode: z.enum(['auto', 'fixed']),
        at: z.string().optional(),
        window_local: z.tuple([z.string(), z.string()]).optional(),
      })
      .optional(),
  }),
  axes: z.object({
    mechanic: z.string().min(1),
    arena: z.string().min(1),
    rule: z.string().min(1),
    music_piece: z.string().min(1),
    hook_style: z.enum(['prediction', 'escalation', 'mystery', 'countdown', 'contrast']),
    title_pattern: z.enum(['question', 'number-contrast', 'challenge', 'statement', 'ellipsis']),
    ending: z.enum(['loop', 'reveal', 'cut']),
    palette_family: z.string().optional(),
    instrument: z.string().optional(),
  }),
  provenance: z.object({
    generator: z.object({
      kind: z.enum(['llm', 'human', 'bot']),
      model: z.string().optional(),
      prompt_version: z.string().optional(),
    }),
    trend_refs: z
      .array(
        z.object({
          source: z.string(),
          ref: z.string(),
          note: z.string().optional(),
        })
      )
      .optional(),
    created_at: z.string().min(1),
  }),
});

export const SpecBatchSchema = z.object({
  schema: z.literal('specbatch/1'),
  batch_id: z.string().min(3).max(100),
  generated_at: z.string().min(1),
  items: z.array(z.unknown()).min(1).max(50),
});

export const IdeaBatchSchema = z.object({
  schema: z.literal('ideabatch/1'),
  batch_id: z.string().min(3).max(100),
  items: z
    .array(
      z.object({
        idea_key: z.string().min(3),
        channel_slug: z.string().min(2),
        mechanic: z.string().min(1),
        arena: z.string().min(1),
        rule: z.string().min(1),
        music_piece: z.string().min(1),
        hook_style: z.enum(['prediction', 'escalation', 'mystery', 'countdown', 'contrast']),
        hook_line: z.string().min(2),
        title_candidates: z.array(z.string()).min(1),
        payoff: z.string().min(5),
        series: z.object({ slug: z.string(), episode: z.number().int().min(1) }).nullable().optional(),
        novelty_notes: z.string().min(10),
        source: z.object({ kind: z.string(), ref: z.string() }).optional(),
      })
    )
    .min(1),
});

export const TrendImportSchema = z.object({
  schema: z.literal('trendimport/1'),
  source: z.string().min(2),
  captured_at: z.string().min(4),
  region: z.string().min(2).default('US'),
  items: z
    .array(
      z.object({
        type: z.enum(['hashtag', 'sound', 'video', 'topic', 'search']),
        name: z.string().min(1),
        rank: z.number().int().min(1).default(1),
        metric: z
          .object({
            views: z.number().nonnegative().default(0),
            growth_pct: z.number().default(0),
          })
          .optional(),
        url: z.string().nullable().optional(),
        reference_only: z.boolean().optional(),
        note: z.string().optional(),
      })
    )
    .min(1),
});

export const ReferenceChannelsSchema = z.object({
  schema: z.literal('referencechannels/1'),
  items: z
    .array(
      z.object({
        name: z.string().min(1),
        handle: z.string().nullable().optional(),
        yt_channel_id: z.string().nullable().optional(),
        tags: z.array(z.string()).default([]),
        note: z.string().optional(),
      })
    )
    .min(1),
});

export function computeSpecHash(spec: VideoSpec): string {
  const payload = {
    channel_slug: spec.channel_slug,
    scene: spec.scene,
    timeline: spec.timeline,
    audio: spec.audio,
    title: spec.publish.title,
  };
  return sha256Hex(canonicalStringify(payload));
}

export interface BatchValidationResult {
  accepted: Array<{ index: number; spec: VideoSpec; spec_hash: string; channel_id: string }>;
  issues: ValidationIssue[];
}

export function validateImportPayload(
  rawPayload: unknown,
  ctx: {
    channels: Channel[];
    melodies: MelodyEntry[];
    existingSpecHashesByChannel: Map<string, Set<string>>;
    existingSpecKeysByChannel: Map<string, Set<string>>;
    overrideChannelSlug?: string;
  }
): BatchValidationResult {
  const issues: ValidationIssue[] = [];
  const accepted: BatchValidationResult['accepted'] = [];

  if (!rawPayload || typeof rawPayload !== 'object') {
    return {
      accepted: [],
      issues: [{ index: -1, path: '$', code: 'E001', level: 'error', message: '输入必须为合法 JSON 对象' }],
    };
  }

  const obj = rawPayload as Record<string, unknown>;
  let rawItems: unknown[] = [];

  if (obj.schema === 'videospec/1') {
    rawItems = [rawPayload];
  } else if (obj.schema === 'specbatch/1') {
    const batchParse = SpecBatchSchema.safeParse(rawPayload);
    if (!batchParse.success) {
      for (const err of batchParse.error.issues) {
        issues.push({
          index: -1,
          path: err.path.join('.') || '$',
          code: 'E001',
          level: 'error',
          message: err.message,
        });
      }
      return { accepted: [], issues };
    }
    rawItems = batchParse.data.items;
  } else {
    return {
      accepted: [],
      issues: [
        {
          index: -1,
          path: 'schema',
          code: 'E002',
          level: 'error',
          message: `不支持的 schema 版本: ${String(obj.schema ?? '缺失')}（仅支持 videospec/1 或 specbatch/1）`,
        },
      ],
    };
  }

  const seenBatchHashes = new Set<string>();
  const melodyMap = new Map(ctx.melodies.map((m) => [m.id, m]));
  const channelBySlug = new Map(ctx.channels.map((c) => [c.slug, c]));

  for (let i = 0; i < rawItems.length; i++) {
    const rawItem = rawItems[i];
    const prefix = obj.schema === 'specbatch/1' ? `items[${i}].` : '';
    const specKeyPreview =
      rawItem && typeof rawItem === 'object' && typeof (rawItem as Record<string, unknown>).spec_key === 'string'
        ? String((rawItem as Record<string, unknown>).spec_key)
        : undefined;

    const itemCopy =
      rawItem && typeof rawItem === 'object' && ctx.overrideChannelSlug
        ? { ...(rawItem as Record<string, unknown>), channel_slug: ctx.overrideChannelSlug }
        : rawItem;

    const parsed = VideoSpecSchema.safeParse(itemCopy);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const joinedPath = issue.path.join('.');
        let code = 'E001';
        if (joinedPath.startsWith('format.')) code = 'E020';
        if (joinedPath.startsWith('publish.title') || joinedPath.startsWith('publish.description')) code = 'E040';
        issues.push({
          index: i,
          spec_key: specKeyPreview,
          path: `${prefix}${joinedPath || '$'}`,
          code,
          level: 'error',
          message: issue.message,
        });
      }
      continue;
    }

    const spec = parsed.data as VideoSpec;
    let hasError = false;

    // E050: channel_slug exists
    const channel = channelBySlug.get(spec.channel_slug);
    if (!channel) {
      issues.push({
        index: i,
        spec_key: spec.spec_key,
        path: `${prefix}channel_slug`,
        code: 'E050',
        level: 'error',
        message: `频道 "${spec.channel_slug}" 不存在`,
      });
      hasError = true;
    }

    // E010: template exists and version satisfies
    const tmpl = TEMPLATE_REGISTRY[spec.scene.template];
    if (!tmpl || !semverSatisfies(tmpl.version, spec.scene.template_version)) {
      issues.push({
        index: i,
        spec_key: spec.spec_key,
        path: `${prefix}scene.template`,
        code: 'E010',
        level: 'error',
        message: !tmpl
          ? `模板 "${spec.scene.template}" 未注册`
          : `模板 "${spec.scene.template}" 版本 ${tmpl.version} 不满足要求 ${spec.scene.template_version}`,
      });
      hasError = true;
    } else {
      // E011: scene.params validates against template paramsSchema
      const paramParse = tmpl.paramsSchema.safeParse(spec.scene.params);
      if (!paramParse.success) {
        for (const pErr of paramParse.error.issues) {
          issues.push({
            index: i,
            spec_key: spec.spec_key,
            path: `${prefix}scene.params.${pErr.path.join('.')}`,
            code: 'E011',
            level: 'error',
            message: pErr.message,
          });
        }
        hasError = true;
      }
    }

    // E020: format aspect vs resolution sanity
    if (spec.format.aspect === '9:16' && spec.format.width >= spec.format.height) {
      issues.push({
        index: i,
        spec_key: spec.spec_key,
        path: `${prefix}format`,
        code: 'E020',
        level: 'error',
        message: '9:16 竖屏格式要求 height > width（如 1080x1920）',
      });
      hasError = true;
    }

    // E040: tags combined <= 500 chars
    const totalTagChars = spec.publish.tags.join(',').length;
    if (totalTagChars > 500) {
      issues.push({
        index: i,
        spec_key: spec.spec_key,
        path: `${prefix}publish.tags`,
        code: 'E040',
        level: 'error',
        message: `标签总字符数 (${totalTagChars}) 超过 500 上限`,
      });
      hasError = true;
    }

    // E030 / E031: Melody validation
    if (spec.audio.mode !== 'none') {
      if (!spec.audio.music) {
        issues.push({
          index: i,
          spec_key: spec.spec_key,
          path: `${prefix}audio.music`,
          code: 'E030',
          level: 'error',
          message: '音频模式为 sim-driven/track 时必须提供 audio.music',
        });
        hasError = true;
      } else if (spec.audio.music.melody_ref.source === 'library') {
        const refId = spec.audio.music.melody_ref.id;
        const mel = melodyMap.get(refId);
        if (!mel) {
          issues.push({
            index: i,
            spec_key: spec.spec_key,
            path: `${prefix}audio.music.melody_ref.id`,
            code: 'E030',
            level: 'error',
            message: `旋律库中不存在 "${refId}"`,
          });
          hasError = true;
        } else if (!['public-domain', 'cc0', 'original'].includes(mel.license)) {
          issues.push({
            index: i,
            spec_key: spec.spec_key,
            path: `${prefix}audio.music.melody_ref.id`,
            code: 'E031',
            level: 'error',
            message: `旋律 "${refId}" 授权不合规: ${mel.license}`,
          });
          hasError = true;
        }
      }
    }

    const specHash = computeSpecHash(spec);
    if (channel) {
      const chKeys = ctx.existingSpecKeysByChannel.get(channel.id);
      if (chKeys?.has(spec.spec_key)) {
        issues.push({
          index: i,
          spec_key: spec.spec_key,
          path: `${prefix}spec_key`,
          code: 'E042',
          level: 'error',
          message: `频道内 spec_key "${spec.spec_key}" 已存在`,
        });
        hasError = true;
      }
      const chHashes = ctx.existingSpecHashesByChannel.get(channel.id);
      if (chHashes?.has(specHash) || seenBatchHashes.has(`${channel.id}:${specHash}`)) {
        issues.push({
          index: i,
          spec_key: spec.spec_key,
          path: `${prefix}scene`,
          code: 'E041',
          level: 'error',
          message: `频道内存在相同内容的 spec_hash（重复规格，拒绝导入）`,
        });
        hasError = true;
      }
    }

    // Warnings W102 - W105
    const hookWords = spec.concept.hook_line.trim().split(/\s+/).filter(Boolean);
    if (hookWords.length > 6) {
      issues.push({
        index: i,
        spec_key: spec.spec_key,
        path: `${prefix}concept.hook_line`,
        code: 'W102',
        level: 'warn',
        message: `钩子文案共 ${hookWords.length} 个词，建议不超过 6 个词`,
      });
    }

    const hookTextItem = spec.timeline.find((t) => t.type === 'text' && t.role === 'hook');
    if (!hookTextItem || hookTextItem.t > 0.3) {
      issues.push({
        index: i,
        spec_key: spec.spec_key,
        path: `${prefix}timeline`,
        code: 'W103',
        level: 'warn',
        message: '缺少 t <= 0.3s 的 hook 文本轨道项',
      });
    }

    if (!spec.format.loop.enabled) {
      const hasEndCard = spec.timeline.some((t) => t.type === 'text' && t.role === 'end_card');
      if (!hasEndCard) {
        issues.push({
          index: i,
          spec_key: spec.spec_key,
          path: `${prefix}timeline`,
          code: 'W104',
          level: 'warn',
          message: '非循环视频建议在结尾添加 end_card',
        });
      }
    }

    if (spec.concept.series && /different color|new color|just changed/i.test(spec.concept.novelty_notes)) {
      issues.push({
        index: i,
        spec_key: spec.spec_key,
        path: `${prefix}concept.novelty_notes`,
        code: 'W105',
        level: 'warn',
        message: '系列内 novelty_notes 过于笼统，仅换配色不算实质差异',
      });
    }

    if (!hasError && channel) {
      seenBatchHashes.add(`${channel.id}:${specHash}`);
      accepted.push({
        index: i,
        spec,
        spec_hash: specHash,
        channel_id: channel.id,
      });
    }
  }

  return { accepted, issues };
}

export const VIDEO_SPEC_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'VideoSpec v1',
  type: 'object',
  required: ['schema', 'spec_key', 'channel_slug', 'concept', 'format', 'scene', 'timeline', 'audio', 'publish', 'axes', 'provenance'],
  properties: {
    schema: { const: 'videospec/1' },
    spec_key: { type: 'string', pattern: '^[a-z0-9-]{6,80}$' },
    channel_slug: { type: 'string' },
    concept: {
      type: 'object',
      required: ['working_title', 'hook_line', 'hook_style', 'payoff', 'emotion', 'novelty_notes'],
    },
    format: {
      type: 'object',
      required: ['aspect', 'width', 'height', 'fps', 'duration_sec', 'loop'],
    },
    scene: {
      type: 'object',
      required: ['template', 'template_version', 'seed', 'style', 'params'],
    },
    axes: {
      type: 'object',
      required: ['mechanic', 'arena', 'rule', 'music_piece', 'hook_style', 'title_pattern', 'ending'],
    },
  },
};
