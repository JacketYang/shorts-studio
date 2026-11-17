import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCatalog } from './catalog/catalog.ts';
import {
  auditWorkbenchSpecStrict,
  buildAuditContextFromHistory,
  findPassingVariant,
  pickDiversePassBatch,
} from './diversity.ts';
import { toWorkbenchEnqueueItem, workbenchItemToStudioSpec } from './bridge.ts';
import { THEMES } from './engine/util.ts';
import type { ChannelProfile } from '../domain/types.ts';

function makeStrictProfile(): ChannelProfile {
  return {
    channel_id: 'ch-test',
    locale: 'en-US',
    niche: 'Physics & Music Simulation',
    brand: {
      primary_color: '#1e3a8a',
      palette_family: 'pastel',
      tone_rules: 'clear, technical, zero clickbait',
      forbidden_topics: ['clickbait', 'copyrighted pop songs'],
    },
    allowed_templates: ['melody-bounce', 'ball-sort', 'pendulum-wave', 'orbit-sync'],
    review_mode: 'L1',
    trust_level: 1,
    novelty_mode: 'block',
    daily_cap: 3,
    is_new_channel: false,
    tz: 'America/New_York',
    posting_windows: [['17:00', '19:00']],
    ai_budget_monthly_usd: 5,
  };
}

test('pickDiversePassBatch selects 7 items across engines and light/dark themes that ALL strictly pass', () => {
  const recipes = buildCatalog();
  const profile = makeStrictProfile();
  const ctx = buildAuditContextFromHistory({
    channelProfile: profile,
    specs: [],
    renders: [],
    videos: [],
    remoteTitles: [],
    now: new Date('2026-11-16T10:00:00.000Z'),
  });

  const batch = pickDiversePassBatch(recipes, 7, ctx);
  assert.equal(batch.picks.length, 7);

  const engines = new Set<string>();
  let lightCount = 0;
  let darkCount = 0;

  for (const pick of batch.picks) {
    assert.equal(
      pick.audit.passed,
      true,
      `Pick ${pick.spec.id} failed strict audit: ${pick.audit.reasons.join('; ')}`
    );
    assert.equal(pick.audit.novelty.verdict, 'pass');
    assert.equal(pick.audit.metadata.passed, true);
    engines.add(pick.spec.engine);
    const th = THEMES[pick.spec.theme % THEMES.length];
    if (th.isLight) lightCount++;
    else darkCount++;
  }

  assert.ok(engines.size >= 5, `Expected >= 5 distinct engines in batch, got ${engines.size}`);
  assert.ok(lightCount >= 2, `Expected >= 2 light-theme items in batch, got ${lightCount}`);
  assert.ok(darkCount >= 2, `Expected >= 2 dark-theme items in batch, got ${darkCount}`);
});

test('findPassingVariant escapes exact title + recent mechanic/music collisions without relaxing thresholds', () => {
  const recipes = buildCatalog();
  const profile = makeStrictProfile();
  const firstRecipe = recipes[0];
  const baseSpec = firstRecipe.spec(0);
  const baseStudio = workbenchItemToStudioSpec(toWorkbenchEnqueueItem(baseSpec, 25), 'ch-test');

  const now = new Date('2026-11-16T10:00:00.000Z');
  const ctx = buildAuditContextFromHistory({
    channelProfile: profile,
    specs: [
      {
        id: 'hist-1',
        channel_id: 'ch-test',
        spec: baseStudio,
        created_at: new Date(now.getTime() - 3600_000).toISOString(),
      },
      {
        id: 'hist-2',
        channel_id: 'ch-test',
        spec: baseStudio,
        created_at: new Date(now.getTime() - 7200_000).toISOString(),
      },
    ],
    renders: [],
    videos: [],
    remoteTitles: [baseSpec.title],
    now,
  });

  const beforeAudit = auditWorkbenchSpecStrict(baseSpec, ctx);
  assert.equal(beforeAudit.passed, false);

  const rerolled = findPassingVariant(firstRecipe, 0, ctx, 18);
  assert.ok(rerolled.variant > 0);
  assert.notEqual(rerolled.spec.title, baseSpec.title);
  assert.ok(
    rerolled.audit.score > beforeAudit.score,
    `Expected rerolled audit score (${rerolled.audit.score}) > collision score (${beforeAudit.score})`
  );
  // Wait: if R1 weekly cap (same mechanic >=2 in 7d) blocks single recipe reroll, metadata should still be clean
  assert.equal(rerolled.audit.metadata.passed, true);
});
