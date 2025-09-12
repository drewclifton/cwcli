import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { Cloudways } from '../cloudways.js';

async function wpUserExists(cwd, user) {
  try {
    const { stdout } = await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', 'user', 'get', user, '--field=roles', '--allow-root', '--skip-plugins', '--skip-themes', '--path=/var/www/html'], { cwd });
    const roles = String(stdout || '').toLowerCase();
    return { exists: true, isAdmin: roles.includes('administrator') };
  } catch {
    return { exists: false, isAdmin: false };
  }
}

function pickFromCreds(creds) {
  const candidates = [];
  const push = (v) => { if (v && typeof v === 'string') candidates.push(v); };
  if (!creds || typeof creds !== 'object') return [];
  // Common fields where admin username/email might appear
  push(creds.admin_username);
  push(creds.admin_email);
  push(creds.wp_admin_username);
  push(creds.wp_admin_email);
  push(creds?.app?.admin_username);
  push(creds?.app?.admin_email);
  push(creds?.application?.admin_username);
  push(creds?.application?.admin_email);
  push(creds?.application_credentials?.admin?.username);
  push(creds?.application_credentials?.admin?.email);
  // Favor email-like first
  const emails = candidates.filter(c => /@/.test(c));
  const rest = candidates.filter(c => !/@/.test(c));
  return [...new Set([...emails, ...rest])];
}

export async function resolvePreferredUser(siteDir, explicitUser) {
  if (explicitUser) return explicitUser;
  const metaPath = path.join(siteDir, '.cw', 'meta.json');
  let appId = null;
  try {
    const meta = await fs.readJson(metaPath);
    appId = meta?.sourceApp?.id || meta?.app?.id || null;
  } catch {}

  let candidates = [];
  if (appId) {
    try {
      const creds = await Cloudways.getAppCredentials(appId);
      candidates = pickFromCreds(creds);
    } catch {}
  }

  // Verify candidates exist and prefer administrators
  for (const u of candidates) {
    const { exists, isAdmin } = await wpUserExists(siteDir, u);
    if (exists && isAdmin) return u;
  }
  for (const u of candidates) {
    const { exists } = await wpUserExists(siteDir, u);
    if (exists) return u;
  }

  // Fallback to first administrator
  try {
    const { stdout } = await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', 'user', 'list', '--role=administrator', '--field=user_login', '--allow-root', '--skip-plugins', '--skip-themes', '--path=/var/www/html'], { cwd: siteDir });
    const first = (stdout || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean)[0];
    if (first) return first;
  } catch {}

  // Last resort
  return null;
}
