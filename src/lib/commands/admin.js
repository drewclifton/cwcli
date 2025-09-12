import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import open from 'open';
import { execa } from 'execa';
import { ensureLocalLoginMuPlugin } from '../local/login-plugin.js';
import { randomBytes } from 'crypto';
import { resolvePreferredUser } from '../local/user.js';
import { withSiteArg } from '../site.js';

export function adminCommand() {
  const cmd = new Command('admin');
  withSiteArg(
    cmd
      .description('Open /wp-admin/ auto-logged-in for the local site')
      .option('-p, --port <port>', 'Local port', v => parseInt(v, 10))
      .option('--user <user>', 'Username to log in as')
      .option('--ttl <seconds>', 'Login link expiry in seconds (default 300)', v => parseInt(v, 10)),
    async ({ siteDir: cwd, opts }) => {
      const envPath = path.join(cwd, '.env');
      let port = opts.port;
      if (!port && await fs.pathExists(envPath)) {
        const env = await fs.readFile(envPath, 'utf8');
        const m = env.match(/WP_PORT=(\d+)/);
        if (m) port = parseInt(m[1], 10);
      }
      port = port || 8080;

  await ensureLocalLoginMuPlugin(cwd);
  const targetUser = opts.user || await resolvePreferredUser(cwd, null);
      const token = randomBytes(16).toString('hex');
      const ttl = Math.max(60, opts.ttl || 300);
      const expires = Math.floor(Date.now() / 1000) + ttl;

      const runWp = async (...args) => {
        await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', ...args], { cwd, stdio: 'inherit' });
      };
  await runWp('option', 'update', 'cwl_login_token', token, '--autoload=no', '--allow-root', '--skip-plugins', '--skip-themes');
  await runWp('option', 'update', 'cwl_login_expires', String(expires), '--autoload=no', '--allow-root', '--skip-plugins', '--skip-themes');

  const qs = new URLSearchParams({ cwl: token, redirect_to: '/wp-admin/' });
  if (targetUser) qs.set('user', targetUser);
      const url = `http://localhost:${port}/?${qs.toString()}`;
      await open(url);
    }
  );
  return cmd;
}
