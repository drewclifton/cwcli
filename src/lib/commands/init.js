import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import open from 'open';
import { getEmail } from '../cloudways.js';
import { pullSite } from './pull.js';
import { execa } from 'execa';

export function initCommand() {
  const cmd = new Command('init');
  cmd
    .description('One-step: pick app → pull → start Docker → import DB → open browser')
    .option('-a, --app <appId>', 'Cloudways application ID')
    .option('-d, --dir <dir>', 'Local directory for the site (default: ./sites/<slug>)')
    .option('--port <port>', 'Local HTTP port', v => parseInt(v, 10), 8080)
  .option('--from-live', 'Pull directly from the live app (read-only)')
  .option('--yes', 'Assume yes for prompts')
    .action(async (opts) => {
      // Ensure auth exists
      if (!getEmail()) {
  console.log('You are not authenticated. Run: npm run cwl -- auth');
        return;
      }

  const { siteDir, dbName } = await pullSite({ appId: opts.app, dir: opts.dir, port: opts.port, live: !!opts.fromLive, yes: !!opts.yes });

      // Start Docker
      await execa('docker', ['compose', 'up', '-d'], { cwd: siteDir, stdio: 'inherit' });

      // Import DB
      const dumpPath = path.join(siteDir, '.cw/db.sql');
      if (await fs.pathExists(dumpPath)) {
        await execa('bash', ['-lc', `docker compose exec -T db sh -lc "mysql -uroot -proot ${dbName}" < ./.cw/db.sql`], { cwd: siteDir, stdio: 'inherit' });
      }

      // URL rewrite to local
      const newUrl = `http://localhost:${opts.port}`;
      try {
        const { stdout } = await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', 'option', 'get', 'siteurl'], { cwd: siteDir });
        const oldUrl = stdout.trim();
        if (oldUrl && oldUrl !== newUrl) {
          console.log(`Replacing URLs: ${oldUrl} -> ${newUrl}`);
          await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', 'search-replace', oldUrl, newUrl, '--all-tables', '--precise'], { cwd: siteDir, stdio: 'inherit' });
        }
      } catch (e) {
        console.warn('URL rewrite skipped (WP-CLI not ready or option lookup failed).');
      }

      // Open
      await open(`http://localhost:${opts.port}`);
    });
  return cmd;
}
