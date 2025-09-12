import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { withSiteArg } from '../site.js';

async function readEnv(siteDir) {
  const envPath = path.join(siteDir, '.env');
  let env = {};
  if (await fs.pathExists(envPath)) {
    const txt = await fs.readFile(envPath, 'utf8');
    for (const line of txt.split(/\r?\n/)) {
      const m = line.match(/^([A-Z_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  }
  return env;
}

export function dbCommand() {
  const cmd = new Command('db');
  cmd.description('Database utilities');

  withSiteArg(
    cmd
      .command('import')
      .description('Import .cw/db.sql[.gz] into the local DB and rewrite URLs'),
    async ({ siteDir }) => {
      // Start containers if needed
      try { await execa('docker', ['compose', 'ps'], { cwd: siteDir }); } catch {}

      // Wait for DB readiness (up to ~60s)
      for (let i = 0; i < 60; i++) {
        try {
          await execa('docker', ['compose', 'exec', '-T', 'db', 'sh', '-lc', 'mysqladmin -h127.0.0.1 -uroot -proot ping --silent'], { cwd: siteDir });
          break;
        } catch (e) {
          await new Promise(r => setTimeout(r, 1000));
          if (i === 59) throw new Error('Database did not become ready in time.');
        }
      }

      // Import
      const dumpGz = path.join(siteDir, '.cw/db.sql.gz');
      const dump = path.join(siteDir, '.cw/db.sql');
      if (!await fs.pathExists(dumpGz) && !await fs.pathExists(dump)) {
  console.log('No DB dump found at .cw/db.sql[.gz]. Run `cwl pull` first.');
        return;
      }

      const env = await readEnv(siteDir);
      const dbName = env.DB_NAME || 'wordpress';
      console.log(`Importing into DB '${dbName}'...`);
      if (await fs.pathExists(dumpGz)) {
        await execa('bash', ['-lc', `gunzip -c .cw/db.sql.gz | docker compose exec -T db sh -lc "mysql -h127.0.0.1 -uroot -proot ${dbName}"`], { cwd: siteDir, stdio: 'inherit' });
      } else {
        await execa('bash', ['-lc', `docker compose exec -T db sh -lc "mysql -h127.0.0.1 -uroot -proot ${dbName}" < ./.cw/db.sql`], { cwd: siteDir, stdio: 'inherit' });
      }

      // Get prod URL and replace to local
      const port = env.WP_PORT || 8080;
      const newUrl = `http://localhost:${port}`;
      try {
        const { stdout } = await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', 'option', 'get', 'siteurl', '--allow-root', '--skip-plugins', '--skip-themes', '--path=/var/www/html'], { cwd: siteDir });
        const oldUrl = stdout.trim();
        if (oldUrl && oldUrl !== newUrl) {
          console.log(`Replacing URLs: ${oldUrl} -> ${newUrl}`);
          await execa('docker', ['compose', 'run', '--rm', 'wpcli', 'wp', 'search-replace', oldUrl, newUrl, '--all-tables', '--precise', '--skip-columns=guid', '--allow-root', '--skip-plugins', '--skip-themes', '--path=/var/www/html'], { cwd: siteDir, stdio: 'inherit' });
        }
      } catch (e) {
        console.warn('URL rewrite skipped (wp option get siteurl failed).');
      }
      console.log('DB import finished.');
    }
  );

  return cmd;
}
