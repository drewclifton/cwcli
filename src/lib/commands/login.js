import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';

import { ensureLocalLoginMuPlugin } from '../local/login-plugin.js';
import { resolvePreferredUser } from '../local/user.js';
import { withSiteArg } from '../site.js';

export function loginCommand() {
  const cmd = new Command('login');
  withSiteArg(
    cmd
      .description('Open a one-click, logged-in admin session on the local site')
    .option('-u, --user <user>', 'Username to log in as (default: first admin)', '')
    .option('--ttl <seconds>', 'Seconds until the login link expires', (value) => parseInt(value, 10), 300)
    .option('--print', 'Print URL instead of opening the browser', false),
    async ({ siteDir, opts }) => {
      const wpDir = path.join(siteDir, 'wp');
    const muDir = path.join(wpDir, 'wp-content', 'mu-plugins');
  await fs.ensureDir(muDir);
  await ensureLocalLoginMuPlugin(siteDir);

      // Generate a short-lived token
      const token = (await import('crypto')).randomBytes(16).toString('hex');
      const expires = Math.floor(Date.now() / 1000) + Math.max(60, opts.ttl);

      const runWp = async (...args) => {
        await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', ...args], { cwd: siteDir, stdio: 'inherit' });
      };

      // Store token and expiry in options table without loading plugins/themes (plugin reads options on frontend request)
  await runWp('option', 'update', 'cwl_login_token', token, '--autoload=no', '--allow-root', '--skip-plugins', '--skip-themes');
  await runWp('option', 'update', 'cwl_login_expires', String(expires), '--autoload=no', '--allow-root', '--skip-plugins', '--skip-themes');

      // Determine local port from .env written by our generator
      let port = 8080;
      try {
        const envPath = path.join(siteDir, '.env');
        if (await fs.pathExists(envPath)) {
          const env = await fs.readFile(envPath, 'utf8');
          const m = env.match(/WP_PORT\s*=\s*(\d+)/);
          if (m) port = parseInt(m[1], 10);
        }
      } catch {}

  let targetUser = opts.user;
  try {
    if (!targetUser) {
      targetUser = await resolvePreferredUser(siteDir);
    }
  } catch {}

  const qs = new URLSearchParams({ cwl: token });
  if (targetUser) qs.set('user', targetUser);
  qs.set('redirect_to', '/wp-admin/');
  const url = `http://localhost:${port}/?${qs.toString()}`;

      if (opts.print) {
        console.log(url);
      } else {
        // macOS open
        try {
          await execa('open', [url]);
        } catch {
          console.log(url);
        }
      }
    }
  );
  return cmd;
}
