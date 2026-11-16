// Production entry: stageInstallers / assembleRelease, the same functions used
// by Actions. Protects the release contract: complete installers from one
// version/commit only; no hotfix/internal metadata in public assets. No existing
// tests existed in this new repo. Minimal failures: a mismatched commit, changed
// installer bytes, a missing platform or an extra hotfix file. Tier: unit with
// tiny synthetic files in isolated OS temp directories; no network/processes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assembleRelease, stageInstallers, validateVersion, lookupRelease } from './release.mjs';

const sha = 'a'.repeat(40);
const version = '1.2.3';
const options = { version, sha, notes: '修复启动问题。', buildURL: 'https://example.invalid/build/1' };

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'kero-releases-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifacts = path.join(root, 'artifacts');
  const staged = path.join(root, 'staged');
  mkdirSync(staged);
  for (const [key, suffix] of [['win32-x64', 'Setup.exe'], ['darwin-arm64', 'arm64.zip'],
    ['darwin-x64', 'x64.zip'], ['linux-x64', 'amd64.deb']]) {
    const dir = path.join(artifacts, version, key);
    mkdirSync(dir, { recursive: true });
    const name = `cindy-${version}-${suffix}`;
    const data = Buffer.from(`synthetic installer ${key}`);
    writeFileSync(path.join(dir, name), data);
    const [platform, arch] = key.split('-');
    writeFileSync(path.join(dir, 'build-info.json'), JSON.stringify({
      schemaVersion: 2, version, versionless: false, commitSha: sha, region: 'global',
      platform, arch, platformKey: key, privateBuildNote: 'must not be copied',
      files: [{ role: 'installer', name, size: data.length,
        sha256: createHash('sha256').update(data).digest('hex') },
      { role: 'hotfix', name: 'internal-hotfix.zip' }],
    }));
  }
  const stage = (platform) => {
    const out = path.join(root, platform);
    const assets = stageInstallers(artifacts, out, { ...options, platform });
    for (const file of readdirSync(out)) {
      writeFileSync(path.join(staged, file), readFileSync(path.join(out, file)));
    }
    return assets;
  };
  return { root, artifacts, staged, stage, out: path.join(root, 'dist') };
}

test('rejects placeholder and malformed release versions before any build', () => {
  for (const bad of ['0.0.0', 'v1.2.3', '1.2.3-beta', '01.2.3', '1.2.3\nother=value', '$(id)']) {
    assert.throws(() => validateVersion(bad), /Version must/);
  }
  assert.equal(validateVersion(version), version);
});

// Regression: the REST tag endpoint misses a draft whose tag is not yet
// published. The real lookup must recognize that pending tag and allow resume,
// while rejecting public releases and permission/API errors. Tier: unit.
test('finds pending draft tags for retry and blocks published versions and API failures', async () => {
  const token = 'synthetic-test-token';
  const request = (release) => async (url, init) => {
    if (url !== 'https://api.github.com/graphql' || JSON.parse(init.body).variables.tag !== 'v1.2.3') {
      return new Response('{}', { status: 404 });
    }
    return new Response(JSON.stringify({ data: { repository: { release } } }));
  };
  assert.deepEqual(await lookupRelease(version, { token, request: request({ isDraft: true }) }), { isDraft: true });
  assert.equal(await lookupRelease(version, { token, request: request(null) }), null);
  await assert.rejects(lookupRelease(version, { token, request: request({ isDraft: false }) }), /already public/);
  await assert.rejects(lookupRelease(version, { token, request: async () => new Response('{}', { status: 403 }) }), /HTTP 403/);
  await assert.rejects(lookupRelease(version, { token, request: async () => new Response(JSON.stringify({
    errors: [{ message: 'not authorized' }], data: { repository: null },
  })) }), /Cannot inspect release repository/);
});

test('assembles four renamed installers and reproducible checksums; excludes internal build data', t => {
  const f = fixture(t);
  for (const platform of ['windows', 'macos', 'linux']) f.stage(platform);
  const assets = assembleRelease(f.staged, f.out, options);
  assert.equal(assets.length, 4);
  assert.deepEqual(readdirSync(f.out).sort(), ['SHA256SUMS', 'kero-1.2.3-Setup.exe',
    'kero-1.2.3-amd64.deb', 'kero-1.2.3-arm64.zip', 'kero-1.2.3-x64.zip', 'release-metadata.json'].sort());
  assert.equal(readFileSync(path.join(f.out, 'kero-1.2.3-arm64.zip'), 'utf8'), 'synthetic installer darwin-arm64');
  assert.equal(readFileSync(path.join(f.out, 'SHA256SUMS'), 'utf8'),
    assets.map(a => `${createHash('sha256').update(readFileSync(path.join(f.out, a.name))).digest('hex')}  ${a.name}\n`).join(''));
  const metadata = JSON.parse(readFileSync(path.join(f.out, 'release-metadata.json')));
  assert.equal(metadata.sourceCommit, sha);
  assert.equal(JSON.stringify(metadata).includes('privateBuildNote'), false);
});

test('rejects wrong version, source commit or platform identity from build-info', t => {
  const f = fixture(t);
  const manifest = path.join(f.artifacts, version, 'win32-x64', 'build-info.json');
  const original = JSON.parse(readFileSync(manifest));
  for (const change of [{ version: '1.2.4' }, { commitSha: 'b'.repeat(40) },
    { arch: 'arm64' }, { region: 'cn' }, { versionless: true }]) {
    writeFileSync(manifest, JSON.stringify({ ...original, ...change }));
    assert.throws(() => stageInstallers(f.artifacts, path.join(f.root, `bad-${Object.keys(change)[0]}`),
      { ...options, platform: 'windows' }), /Build identity mismatch/);
  }
});

test('rejects tampered bytes at staging and again before release publication', t => {
  const f = fixture(t);
  const file = path.join(f.artifacts, version, 'win32-x64', `cindy-${version}-Setup.exe`);
  const data = readFileSync(file);
  writeFileSync(file, Buffer.alloc(data.length, 0));
  assert.throws(() => f.stage('windows'), /checksum mismatch/);
  writeFileSync(file, data);
  for (const platform of ['windows', 'macos', 'linux']) f.stage(platform);
  writeFileSync(path.join(f.staged, `kero-${version}-Setup.exe`), Buffer.alloc(data.length, 0));
  assert.throws(() => assembleRelease(f.staged, f.out, options), /checksum mismatch/);
});

test('rejects a missing platform or unexpected staged hotfix rather than publishing a partial release', t => {
  const f = fixture(t);
  f.stage('windows');
  assert.throws(() => assembleRelease(f.staged, f.out, options), /ENOENT/);
  f.stage('macos');
  f.stage('linux');
  writeFileSync(path.join(f.staged, 'unexpected-hotfix.zip'), 'internal');
  assert.throws(() => assembleRelease(f.staged, f.out, options), /Unexpected staged file/);
});

test('rejects manifest installer path traversal and mixed commits between platform artifacts', t => {
  const f = fixture(t);
  const manifest = path.join(f.artifacts, version, 'win32-x64', 'build-info.json');
  const original = JSON.parse(readFileSync(manifest));
  const invalid = structuredClone(original);
  invalid.files[0].name = '../secret';
  writeFileSync(manifest, JSON.stringify(invalid));
  assert.throws(() => f.stage('windows'), /Unexpected installer filename/);
  writeFileSync(manifest, JSON.stringify(original));
  for (const platform of ['windows', 'macos', 'linux']) f.stage(platform);
  const stagedInfo = path.join(f.staged, 'linux.json');
  const info = JSON.parse(readFileSync(stagedInfo));
  writeFileSync(stagedInfo, JSON.stringify({ ...info, sha: 'b'.repeat(40) }));
  assert.throws(() => assembleRelease(f.staged, f.out, options), /Staged build identity mismatch/);
});
