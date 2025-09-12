import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execa } from 'execa';
import { Cloudways } from '../cloudways.js';
import open from 'open';
import { withSiteArg } from '../site.js';

export function pushCommand() {
  const cmd = new Command('push');
  withSiteArg(
    cmd
      .description('Push local wp/ files and DB to Cloudways (new or existing app)')
    .option('--to-app <appId>', 'Existing target app ID (skip creating a new clone)')
    .option('--new-label <label>', 'Create a new clone with this label')
  .option('--files-only', 'Push files only, skip DB import')
  .option('--db-only', 'Push DB only, skip files')
  .option('--yes', 'Assume yes for prompts')
    ,
    async ({ siteDir: cwd, opts }) => {
      const metaPath = path.join(cwd, '.cw/meta.json');
      if (!await fs.pathExists(metaPath)) {
        throw new Error('Missing .cw/meta.json. Run `cwl pull` first in this directory.');
      }
      const meta = await fs.readJson(metaPath);

  let targetAppId = opts.toApp;
  let targetServerId = meta.server.id;

  // Prevent pushing to the original live app
  const sourceAppId = String(meta?.sourceApp?.id || '');

  if (!targetAppId && !opts.newLabel) {
        const ans = await inquirer.prompt([
          {
            type: 'list',
            name: 'mode',
            message: 'Where to push?',
            choices: [
              { name: 'Create NEW clone', value: 'new' },
              { name: 'Select EXISTING app', value: 'existing' },
            ],
          },
        ]);
        if (ans.mode === 'existing') {
          const apps = await Cloudways.getApplications();
          const pick = await inquirer.prompt([
            { type: 'list', name: 'app', message: 'Target app', choices: apps.map(({ app, server }) => ({ name: `${app.id} — ${app.label} on ${server.label}`, value: app.id })) }
          ]);
          targetAppId = pick.app;
        } else {
          const label = opts.newLabel || `${meta.sourceApp.label}-local-${Date.now()}`;
          const res = await Cloudways.cloneApplication({ appId: meta.sourceApp.id, targetServerId, label });
          targetAppId = res?.app_id || res?.id || res?.app?.id;
          console.log('Created new app:', targetAppId);
        }
      }

      // If target equals source or pushing from live, automatically create a clone unless user provided a different target
      if (!targetAppId || String(targetAppId) === sourceAppId || meta.fromLive) {
        const label = opts.newLabel || `${meta.sourceApp.label}-from-local-${Date.now()}`;
        const res = await Cloudways.cloneApplication({ appId: meta.sourceApp.id, targetServerId, label });
        targetAppId = res?.app_id || res?.id || res?.app?.id;
        console.log('Auto-created new target app to avoid pushing to live:', targetAppId);
      }

      // Get target credentials
      const apps = await Cloudways.getApplications();
      const target = apps.find(({ app }) => String(app.id) === String(targetAppId));
      if (!target) throw new Error('Target app not found');
      const creds = await Cloudways.getAppCredentials(target.app.id);
      const username = creds?.sftp?.username || target.app.application_credentials?.username;
      const password = creds?.sftp?.password || target.app.application_credentials?.password;
      const public_ip = target.server.public_ip;
      const application_path = target.app.application_path || target.app.path || target.app?.app_path || `applications/${target.app.id}`;

      const wpDir = path.join(cwd, 'wp');
      const remotePath = `/home/${username}/${application_path}/public_html/`;
      const sshTarget = `${username}@${public_ip}`;

      if (!opts.dbOnly) {
        console.log('Uploading files via rsync...');
        const rsyncBase = ['-az', '--delete',
          '--exclude', 'wp-content/cache',
          '--exclude', 'wp-content/mu-plugins/cw-local-login.php',
          wpDir + '/', `${sshTarget}:${remotePath}`
        ];
        if (password) {
          try {
            await execa('sshpass', ['-p', password, 'rsync', ...rsyncBase], { stdio: 'inherit' });
          } catch {
            await execa('rsync', rsyncBase, { stdio: 'inherit' });
          }
        } else {
          await execa('rsync', rsyncBase, { stdio: 'inherit' });
        }
      }

      // Import DB into remote
      const dbUser = creds?.mysql?.username || target.app?.database_user;
      const dbPass = creds?.mysql?.password || target.app?.database_password;
      const dbName = creds?.mysql?.db_name || target.app?.database_name;
      if (!opts.filesOnly && dbUser && dbPass && dbName) {
        // Determine target URL (remote siteurl)
        let targetUrl;
        try {
          const { stdout } = await execa('ssh', [sshTarget, `php -r '$o=json_encode(array("u"=>getenv("CW_APP_URL"))); echo $o;';`]);
          const parsed = JSON.parse(stdout || '{}');
          targetUrl = parsed.u;
        } catch {}
        if (!targetUrl) {
          const ans = await inquirer.prompt([{ name: 'url', message: 'Target site URL (e.g. https://staging.example.com)', validate: v => !!v || 'Required' }]);
          targetUrl = ans.url;
        }

        // Build local DB dump, rewrite localhost -> targetUrl in stream using WP-CLI
        // 1) Export DB from local container
        const tmpDump = path.join(cwd, '.cw/tmp_push.sql');
        // Determine local port from .env if present
        let envPort = 8080;
        try {
          const envTxt = await fs.readFile(path.join(cwd, '.env'), 'utf8');
          const m = envTxt.match(/WP_PORT=(\d+)/);
          if (m) envPort = parseInt(m[1], 10);
        } catch {}
        console.log('Exporting local DB...');
        await execa('bash', ['-lc', `docker compose exec -T db sh -lc "mysqldump --single-transaction --quick --default-character-set=utf8mb4 --set-gtid-purged=OFF -uroot -proot ${dbName}" > ./.cw/tmp_push.sql`], { cwd, stdio: 'inherit' });

        // 2) Optionally rewrite URLs in the dump using wpcli after import (safer for serialized data)
        console.log('Importing DB on remote...');
        const sshArgs = [sshTarget, `mysql -u${dbUser} -p${dbPass} ${dbName}`];
        const dumpContent = await fs.readFile(tmpDump);
        if (password) {
          try {
            await execa('sshpass', ['-p', password, 'ssh', ...sshArgs], { input: dumpContent, stdio: ['pipe', 'inherit', 'inherit'] });
          } catch {
            await execa('ssh', sshArgs, { input: dumpContent, stdio: ['pipe', 'inherit', 'inherit'] });
          }
        } else {
          await execa('ssh', sshArgs, { input: dumpContent, stdio: ['pipe', 'inherit', 'inherit'] });
        }

        // 3) Run search-replace on remote via WP-CLI if available
        console.log('Rewriting URLs on remote via WP-CLI (if available)...');
        const oldLocal = `http://localhost:${envPort}`; // best-effort default
        const wpCliCmd = `cd ${remotePath} && wp option get siteurl || true`; // try to get current siteurl on remote
        let remoteSiteUrl;
        try {
          const { stdout } = await execa('ssh', [sshTarget, wpCliCmd]);
          remoteSiteUrl = stdout.trim();
        } catch {}
        const fromUrl = oldLocal;
        const toUrl = targetUrl || remoteSiteUrl;
        if (toUrl) {
          const srCmd = `cd ${remotePath} && wp search-replace '${fromUrl}' '${toUrl}' --all-tables --precise || true`;
          try {
            if (password) {
              await execa('sshpass', ['-p', password, 'ssh', sshTarget, srCmd], { stdio: 'inherit' });
            } else {
              await execa('ssh', [sshTarget, srCmd], { stdio: 'inherit' });
            }
          } catch {}
        }
        await fs.remove(tmpDump);

        // Ensure the local-only mu-plugin is not left on remote
        try {
          const rmCmd = `rm -f ${remotePath}wp-content/mu-plugins/cw-local-login.php`;
          if (password) {
            await execa('sshpass', ['-p', password, 'ssh', sshTarget, rmCmd], { stdio: 'inherit' });
          } else {
            await execa('ssh', [sshTarget, rmCmd], { stdio: 'inherit' });
          }
        } catch {}
      } else if (!dbUser || !dbPass || !dbName) {
        console.warn('Missing remote DB credentials; skipped DB import.');
      }

      console.log('Push complete.');
    }
  );
  return cmd;
}
