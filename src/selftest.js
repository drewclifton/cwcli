import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { getSitesRoot, resolveSiteDir, isSiteDir } from './lib/site.js';

(async () => {
  const pkg = JSON.parse(await fs.readFile('./package.json', 'utf8'));
  console.log('Package:', pkg.name, pkg.version);

  const assert = (cond, msg) => { if (!cond) { throw new Error(`Selftest failed: ${msg}`); } };

  const origCwd = process.cwd();
  const origEnv = { ...process.env };
  const tmp1 = await fs.mkdtemp(path.join(os.tmpdir(), 'cwl-'));
  const tmp2 = await fs.mkdtemp(path.join(os.tmpdir(), 'cwl-'));

  try {
    // Case 1: Default to CWD
    process.chdir(tmp1);
  delete process.env.CWL_SITES_ROOT;
  const root1 = await fs.realpath(getSitesRoot());
  const cwd1 = await fs.realpath(process.cwd());
  console.log('Debug: cwd1=', cwd1, 'root1=', root1);
  assert(root1 === cwd1, 'getSitesRoot should equal CWD when no env set');

  const siteA = path.join(tmp1, 'mysite');
    await fs.ensureDir(path.join(siteA, 'wp'));
    await fs.writeFile(path.join(siteA, 'docker-compose.yml'), 'version: "3"\n');
    assert(isSiteDir(siteA), 'isSiteDir should detect markers in CWD site');
  const resolvedA = await fs.realpath(resolveSiteDir('mysite'));
  const siteAReal = await fs.realpath(siteA);
  assert(resolvedA === siteAReal, 'resolveSiteDir("mysite") should resolve to CWD/mysite');

    // Case 2: Env override
    process.env.CWL_SITES_ROOT = tmp2;
  process.chdir(origCwd);
  const root2 = await fs.realpath(getSitesRoot());
  const envRoot = await fs.realpath(tmp2);
  console.log('Debug: envRoot=', envRoot, 'root2=', root2);
  assert(root2 === envRoot, 'getSitesRoot should honor CWL_SITES_ROOT');
  const resolvedB = resolveSiteDir('mysite2');
  const expectedRoot = getSitesRoot();
  const expectedB = path.join(expectedRoot, 'mysite2');
  assert(resolvedB === expectedB, 'resolveSiteDir should point under CWL_SITES_ROOT for bare name');

    console.log('Selftest: path resolution OK');
  } finally {
    process.chdir(origCwd);
    process.env = origEnv;
    try { await fs.remove(tmp1); } catch {}
    try { await fs.remove(tmp2); } catch {}
  }
})();
