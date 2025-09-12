import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { Cloudways } from '../cloudways.js';
import { pullSite } from './pull.js';
import { getSitesRoot } from '../site.js';

export function quickCommand() {
  const cmd = new Command('quick');
  cmd
    .description('End-to-end: pull → up → DB import → open /wp-admin/ (auto-login)')
    .option('-a, --app <appId>', 'Cloudways application ID')
    .option('-s, --server <serverId>', 'Server ID to filter apps when prompting')
    .option('-d, --dir <dir>', 'Local directory for the site')
    .option('--port <port>', 'Local HTTP port', v => parseInt(v, 10))
    .option('--user <user>', 'Username to auto-login as')
    .option('--live', 'Pull directly from live (read-only)')
    .option('--yes', 'Assume yes for prompts')
    .action(async (opts) => {
      let appId = opts.app;
      const apps = await Cloudways.getApplications();
      const filtered = opts.server ? apps.filter(a => String(a.server.id) === String(opts.server)) : apps;
      if (!filtered.length) throw new Error('No applications found.');

      if (!appId) {
        const choices = filtered
          .map(({ app, server }) => ({ name: `${app.id} — ${app.label} (${server.label})`, value: app.id }))
          .sort((a, b) => String(a.name).localeCompare(String(b.name)));
        const ans = await inquirer.prompt([{
          type: 'list',
          name: 'app',
          message: 'Select an application to pull',
          choices
        }]);
        appId = ans.app;
      }

      // Determine default dir under ./sites/<slug> in current repo if not provided
      let dir = opts.dir;
      if (!dir) {
        const picked = filtered.find(x => String(x.app.id) === String(appId));
        const label = picked?.app?.label || `app-${appId}`;
        const slug = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
        dir = path.join(getSitesRoot(), slug);
      }

  const { siteDir } = await pullSite({ appId, dir, port: opts.port || 8080, live: !!opts.live, yes: !!opts.yes, archive: true });

      if (/\/Desktop\//.test(siteDir)) {
        console.log('Note: This site is under your Desktop. If Docker compose fails to start, enable File Sharing for this path in Docker Desktop Settings → Resources → File sharing.');
      }

      try {
        await execa('docker', ['compose', 'up', '-d'], { cwd: siteDir, stdio: 'inherit' });
      } catch (err) {
        const msg = String(err?.stderr || err?.stdout || err?.message || '');
        const likelyPerm = /operation not permitted|mount source path|permission/i.test(msg);
        if (likelyPerm && /\/Desktop\//.test(siteDir)) {
          console.error('\nDocker could not mount the Desktop path. Fix once:');
          console.error('- Open Docker Desktop → Settings → Resources → File sharing');
          console.error(`- Add: ${siteDir} (or /Users/${require('os').userInfo().username}/Desktop)`);
          console.error('- Apply & Restart, then re-run: npm run cwl -- quick');
          process.exit(1);
        }
        throw err;
      }

      // Reuse our CLI for DB import and admin open to avoid duplicating logic
  const cliEntry = path.resolve(process.cwd(), 'src', 'index.js');
  await execa(process.execPath, [cliEntry, 'db', 'import', siteDir], { stdio: 'inherit' });
  const adminArgs = ['admin', siteDir];
      if (opts.user) adminArgs.push('--user', opts.user);
      await execa(process.execPath, [cliEntry, ...adminArgs], { stdio: 'inherit' });
    });
  return cmd;
}
