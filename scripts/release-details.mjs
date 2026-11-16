import { execFileSync } from 'node:child_process';

const repository = 'MasterAlanLab/Kero-releases';
const fallbackQuote = 'Stay hungry, stay foolish.';

function check(ok, message) {
  if (!ok) throw new Error(message);
}

function truncate(text, limit) {
  let result = '';
  for (const char of text) {
    if (result.length + char.length > limit) break;
    result += char;
  }
  return result;
}

export function releaseVersion(value) {
  const version = typeof value === 'string' ? value.replace(/^v/, '') : '';
  check(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version)
    && version !== '0.0.0', 'Version must be x.y.z or vx.y.z, excluding 0.0.0');
  return version;
}

export async function dailyTitle(version, { request = fetch, previousTitle } = {}) {
  version = releaseVersion(version);
  // Keep the same sentence when retrying an existing draft.
  if (typeof previousTitle === 'string' && previousTitle.startsWith(`v${version} -- "`)
    && previousTitle.length <= 160 && !/[\p{Cc}\p{Cf}]/u.test(previousTitle)) return previousTitle;
  let quote = '';
  try {
    const response = await request('https://v1.hitokoto.cn/', { signal: AbortSignal.timeout(5000) });
    if (response.ok) {
      const data = await response.json();
      if (typeof data.hitokoto === 'string') {
        quote = truncate(data.hitokoto.replace(/[\p{Cc}\p{Cf}]/gu, '').trim(), 80);
      }
    }
  } catch { /* A quote service outage must not block delivery. */ }
  const title = `v${version} -- "${quote || fallbackQuote}"`;
  check(title.length <= 160, 'Daily release title exceeds 160 characters');
  return title;
}

async function previousSourceCommit({ token, request }) {
  const response = await request(`https://api.github.com/repos/${repository}/releases/latest`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null; // First public release.
  check(response.ok, `Cannot read previous release (HTTP ${response.status})`);
  const release = await response.json();
  const asset = release.assets?.find(file => file.name === 'release-metadata.json');
  check(asset, 'Previous release has no source metadata; provide release_notes for this run');
  const url = new URL(asset.browser_download_url);
  check(url.origin === 'https://github.com' && !url.username && !url.password
    && url.pathname.startsWith(`/${repository}/releases/download/`) && !url.search && !url.hash,
  'Invalid source metadata URL');
  // Public asset download: never send either repository token to the CDN.
  const download = await request(url.href, { signal: AbortSignal.timeout(30000) });
  check(download.ok, `Cannot read source metadata (HTTP ${download.status})`);
  const metadata = await download.json();
  check(metadata.sourceRepository === 'MasterAlanLab/Kero'
    && /^[a-f0-9]{40}$/.test(metadata.sourceCommit), 'Invalid previous source commit');
  return metadata.sourceCommit;
}

export async function prepareReleaseDetails(sourceDir, {
  version, sha, token, notes = '', previousTitle, request = fetch,
  runGit = args => execFileSync('git', ['-C', sourceDir, ...args], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim(),
}) {
  version = releaseVersion(version);
  check(/^[a-f0-9]{40}$/.test(sha), 'Expected a full source commit SHA');
  check(typeof notes === 'string' && notes.length <= 16000, 'Release notes exceed 16000 characters');
  check(runGit(['rev-parse', 'HEAD']) === sha, 'Release notes source does not match build source');
  let body = notes.trim();
  if (!body) {
    const previous = await previousSourceCommit({ token, request });
    if (previous) {
      // A history rewrite or unrelated source ref must never silently publish
      // an incomplete commit range. A manual note can establish a new baseline.
      runGit(['merge-base', '--is-ancestor', previous, sha]);
    }
    const range = previous ? `${previous}..${sha}` : sha;
    const log = runGit(['log', '--no-merges', '--format=%s (%h)', range]);
    const entries = log ? log.split('\n') : [];
    const lines = entries.slice(0, 100).map(line => {
      const text = truncate(line.replace(/[\p{Cc}\p{Cf}]/gu, ''), 140);
      return `- ${text}`;
    });
    if (entries.length > 100) lines.push(`- 另有 ${entries.length - 100} 条提交未展开。`);
    body = `## 更新内容\n\n${lines.join('\n') || '- 重新构建客户端安装包。'}`;
  }
  check(body.length <= 16000, 'Generated release notes exceed 16000 characters');
  const title = await dailyTitle(version, { request, previousTitle });
  return { version, sha, title, notes: body };
}
