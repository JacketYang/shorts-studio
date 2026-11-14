/**
 * 审计日志的可读化：把英文 action 代码映射成中文动作名，
 * 并把 payload 渲染成一句人话，避免首页暴露 JSON.stringify 原文。
 */

export interface AuditActionMeta {
  label: string;
  /** 归类：用于左侧色点，便于快速扫视 */
  tone: 'success' | 'info' | 'warn' | 'danger';
}

export const AUDIT_ACTION_LABELS: Record<string, AuditActionMeta> = {
  // 频道
  channel_initialized: { label: '频道初始化', tone: 'info' },
  channel_settings_updated: { label: '频道设置更新', tone: 'info' },
  youtube_channel_connected: { label: 'YouTube 频道已授权', tone: 'success' },
  youtube_credentials_deleted: { label: 'YouTube 凭据已解绑', tone: 'warn' },

  // 创意
  idea_expanded_to_spec: { label: '创意展开为规格', tone: 'info' },
  idea_deleted: { label: '创意已删除', tone: 'warn' },
  spec_deleted: { label: '创意规格已删除', tone: 'warn' },

  // 渲染
  render_completed: { label: '渲染完成', tone: 'success' },
  render_deleted: { label: '渲染记录已删除', tone: 'warn' },

  // 审核与发布
  review_approved_and_scheduled: { label: '审核通过并排期', tone: 'success' },
  resumable_upload_completed: { label: '视频上传完成', tone: 'success' },
  video_rescheduled: { label: '发布计划已调整', tone: 'info' },
  video_emergency_withdrawn: { label: '视频紧急下架', tone: 'danger' },
  video_added_to_playlist: { label: '视频已加入播放列表', tone: 'info' },
  batch_privacy_update: { label: '批量修改可见性', tone: 'info' },
  compilation_built: { label: '合辑已生成', tone: 'success' },

  // 远端视频
  remote_video_deleted: { label: '远端视频记录删除', tone: 'warn' },
  remote_video_metadata_updated: { label: '远端视频元数据更新', tone: 'info' },
  link_manual: { label: '手动关联视频', tone: 'info' },

  // 配置与运维
  ai_config_updated: { label: 'AI 配置更新', tone: 'info' },
  storage_config_updated: { label: '存储配置更新', tone: 'info' },
  storage_cleaned: { label: '磁盘清理', tone: 'info' },
  secrets_updated: { label: '平台凭据更新', tone: 'info' },
  secret_cleared: { label: '平台凭据清除', tone: 'warn' },

  // 评论
  reply: { label: '评论已回复', tone: 'success' },
  hide: { label: '评论已隐藏', tone: 'warn' },
  upload: { label: '执行上传', tone: 'info' },
};

export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action]?.label ?? action;
}

export function auditActionTone(action: string): AuditActionMeta['tone'] {
  return AUDIT_ACTION_LABELS[action]?.tone ?? 'info';
}

const TONE_CLASS: Record<AuditActionMeta['tone'], string> = {
  success: 'bg-emerald-500',
  info: 'bg-sky-400',
  warn: 'bg-amber-500',
  danger: 'bg-rose-500',
};

export function auditToneDotClass(action: string): string {
  return TONE_CLASS[auditActionTone(action)];
}

/**
 * 把 payload 渲染成一句可读摘要。取最常见的几个字段，避免整段 JSON。
 */
export function auditPayloadSummary(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return '';
  const p = payload as Record<string, unknown>;
  const bits: string[] = [];

  const push = (label: string, v: unknown, fmt?: (x: unknown) => string) => {
    if (v === undefined || v === null || v === '') return;
    bits.push(`${label} ${fmt ? fmt(v) : String(v)}`);
  };

  push('模板', p.template_version ?? p.template);
  push('规格', p.spec_key);
  push('标题', p.title);
  push('频道', p.slug);
  push('驱动', p.driver);
  push('隐私', p.privacy);
  push('原因', p.reason);

  if (typeof p.removed_records === 'object' && p.removed_records) {
    const r = p.removed_records as Record<string, number>;
    const total = Object.values(r).reduce((a, b) => a + b, 0);
    if (total > 0) bits.push(`清理 ${total} 条关联记录`);
  }
  push('文件', p.deleted_files, (v) => `${v} 个`);
  push('释放', p.freed_bytes, (v) => `${((Number(v) || 0) / 1048576).toFixed(1)} MB`);
  push('渲染', p.render_id);

  if (Array.isArray(p.changed_keys) && p.changed_keys.length > 0) {
    bits.push(`变更 ${p.changed_keys.length} 项凭据`);
  }
  if (Array.isArray(p.changed) && p.changed.length > 0) {
    bits.push(`变更 ${p.changed.length} 项`);
  }
  push('排期', p.scheduled_at, (v) =>
    typeof v === 'string' ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : String(v)
  );

  // 渲染相关：显示差异度与判定，而不是哈希
  push('差异度', p.novelty_score, (v) => `${v}/100`);
  push('判定', p.verdict, (v) => {
    const map: Record<string, string> = { pass: '通过', warn: '告警', block: '阻断' };
    return map[String(v)] ?? String(v);
  });
  push('QA', p.qa_passed, (v) => (v ? '通过' : '未通过'));
  push('耗时', p.duration_ms, (v) => `${Math.round(Number(v) / 1000)} 秒`);
  push('排期', p.scheduled_at, (v) =>
    typeof v === 'string' ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : String(v)
  );
  push('模型', p.model);
  push('合规审计', p.api_audit_verified, (v) => (v ? '已通过' : '未通过'));
  push('模式', p.mode, (v) => {
    const map: Record<string, string> = {
      semi_manual_ready: '半手动发布就绪',
      full_auto: '全自动',
      manual: '纯手动',
    };
    return map[String(v)] ?? String(v);
  });
  push('评论', p.parent_comment_id ?? p.comment_id);
  push('视频', p.video_id ?? p.yt_video_id);

  if (bits.length === 0) {
    // 兜底：只展示短的标量字段，跳过哈希/ID 类长字符串
    for (const [k, v] of Object.entries(p)) {
      if (bits.length >= 2) break;
      if (v === null || v === undefined || typeof v === 'object') continue;
      const str = String(v);
      if (str.length > 40) continue;      // 跳过长哈希
      if (/^(sha|sim|idem)/i.test(k)) continue;
      bits.push(`${k}=${str}`);
    }
  }

  return bits.join(' · ');
}

/**
 * 时间戳格式化：数据库统一存 ISO 8601 UTC（带 Z），
 * 展示时转成浏览器本地时区，并标注时区名，避免「这是几点」的歧义。
 */
export function formatAuditTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/** 相对时间：刚刚 / 3 分钟前 / 2 小时前，超过一天回退到绝对时间 */
export function formatAuditRelative(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diffSec = Math.round((Date.now() - d.getTime()) / 1000);
  if (diffSec < 45) return '刚刚';
  if (diffSec < 3600) return `${Math.round(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.round(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 7) return `${Math.round(diffSec / 86400)} 天前`;
  return '';
}

/** 当前浏览器时区缩写，用于表头标注 */
export function localTimeZoneLabel(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return '本地时间';
  }
}
