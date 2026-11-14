import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  cleanupStorageArtifacts,
  DEFAULT_STORAGE_CONFIG,
  normalizeDbConfig,
  normalizeStorageConfig,
  resolveMediaDirectories,
  scanStorageArtifacts,
  testStorageConnection,
} from './storage.ts';

test('normalizeStorageConfig and normalizeDbConfig sanitize inputs and set safe bounds', () => {
  const s3Cfg = normalizeStorageConfig({
    driver: 's3',
    s3_endpoint: 'https://acct.r2.cloudflarestorage.com///',
    s3_bucket: ' my-bucket ',
    s3_prefix: '/shorts/prod/',
    auto_cleanup_cache_hours: 0,
    auto_cleanup_published_days: 999,
    keep_local_cache_after_upload: true,
  });
  assert.equal(s3Cfg.driver, 's3');
  assert.equal(s3Cfg.s3_endpoint, 'https://acct.r2.cloudflarestorage.com');
  assert.equal(s3Cfg.s3_bucket, 'my-bucket');
  assert.equal(s3Cfg.s3_prefix, 'shorts/prod');
  assert.equal(s3Cfg.auto_cleanup_cache_hours, 1);
  assert.equal(s3Cfg.auto_cleanup_published_days, 365);
  assert.equal(s3Cfg.keep_local_cache_after_upload, true);

  const dbCfg = normalizeDbConfig({
    driver: 'postgresql-url',
    json_path: ' ./custom/db.json ',
    table_prefix: 'ss-prod$!',
  });
  assert.equal(dbCfg.driver, 'postgresql-url');
  assert.equal(dbCfg.json_path, './custom/db.json');
  assert.equal(dbCfg.table_prefix, 'ssprod');
});

test('local storage directory scan, connection test, and selective cleanup work safely inside temp folder', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'shorts-storage-test-'));
  try {
    const cfg = normalizeStorageConfig({
      ...DEFAULT_STORAGE_CONFIG,
      driver: 'local',
      local_dir: tempRoot,
      auto_cleanup_cache_hours: 1,
    });
    const dirs = resolveMediaDirectories(cfg);

    const cacheFile = path.join(dirs.cacheDir, 'spec-temp.json');
    const publishedMp4 = path.join(dirs.rendersDir, 'rnd-pub-1.mp4');
    const unpublishedMp4 = path.join(dirs.rendersDir, 'rnd-draft-2.mp4');
    const compMp4 = path.join(dirs.compilationsDir, 'cmp-1.mp4');

    fs.writeFileSync(cacheFile, '{"ok":true}', 'utf8');
    fs.writeFileSync(publishedMp4, Buffer.alloc(1024, 1));
    fs.writeFileSync(unpublishedMp4, Buffer.alloc(2048, 2));
    fs.writeFileSync(compMp4, Buffer.alloc(4096, 3));

    const testRes = await testStorageConnection(cfg);
    assert.equal(testRes.ok, true);
    assert.equal(testRes.driver, 'local');

    const beforeScan = scanStorageArtifacts(cfg, path.join(tempRoot, 'db.json'));
    assert.equal(beforeScan.cache_count, 1);
    assert.equal(beforeScan.renders_count, 2);
    assert.equal(beforeScan.compilations_count, 1);
    assert.ok(beforeScan.total_bytes >= 1024 + 2048 + 4096);

    // 1. Clean cache only -> leaves MP4 renders untouched
    const cacheClean = cleanupStorageArtifacts({ cfg, scope: 'cache' });
    assert.equal(cacheClean.deletedCount, 1);
    assert.equal(fs.existsSync(cacheFile), false);
    assert.equal(fs.existsSync(publishedMp4), true);

    // 2. Clean published renders only -> removes rnd-pub-1.mp4, keeps rnd-draft-2.mp4 & cmp-1.mp4
    const pubClean = cleanupStorageArtifacts({
      cfg,
      scope: 'published_renders',
      publishedRenderIds: new Set(['rnd-pub-1']),
    });
    assert.equal(pubClean.deletedCount, 1);
    assert.equal(fs.existsSync(publishedMp4), false);
    assert.equal(fs.existsSync(unpublishedMp4), true);
    assert.equal(fs.existsSync(compMp4), true);

    // 3. Clean remaining media
    const allClean = cleanupStorageArtifacts({ cfg, scope: 'all_media' });
    assert.ok(allClean.deletedCount >= 2);
    assert.equal(fs.existsSync(unpublishedMp4), false);
    assert.equal(fs.existsSync(compMp4), false);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});
