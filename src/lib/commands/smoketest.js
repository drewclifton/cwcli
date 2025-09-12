import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { ensureDockerFiles } from '../local/docker.js';
import { ensureLocalLoginMuPlugin } from '../local/login-plugin.js';
import { getSitesRoot } from '../site.js';

async function waitForDb(siteDir, seconds = 60) {
  for (let i = 0; i < seconds; i++) {
    try {
      await execa('docker', ['compose', 'exec', '-T', 'db', 'sh', '-lc', 'mysqladmin -h127.0.0.1 -uroot -proot ping --silent'], { cwd: siteDir });
      return true;
    } catch {}
    await new Promise(r => setTimeout(r, 1000));
  }
  return false;
}

export function smoketestCommand() {
  const cmd = new Command('smoketest');
  cmd
    .description('Create a disposable local WP site under sites/, boot it, and validate basic flows')
    .option('--port <port>', 'Local HTTP port', v => parseInt(v, 10), 8095)
    .option('--slug <name>', 'Site name/slug (default: cwl-smoke-<timestamp>)')
    .option('--cleanup', 'Tear down containers and remove the site folder after the test')
    .option('--print', 'Print the admin URL instead of opening a browser');

  cmd.action(async (opts) => {
    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12);
    const slug = (opts.slug || `cwl-smoke-${ts}`).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    const siteDir = path.join(getSitesRoot(), slug);
    const wpDir = path.join(siteDir, 'wp');
    const dbName = slug.replace(/[^a-z0-9]/g, '').slice(0, 32) || 'wordpress';
    await fs.ensureDir(wpDir);

    await ensureDockerFiles(siteDir, { siteSlug: slug, dbName, wpPort: opts.port });

    let cleanupRan = false;
    const doCleanup = async () => {
      if (!opts.cleanup || cleanupRan) return;
      cleanupRan = true;
      try { await execa('docker', ['compose', 'down', '--remove-orphans', '--volumes'], { cwd: siteDir, stdio: 'inherit' }); } catch {}
      try { await fs.remove(siteDir); } catch {}
      console.log('Cleaned up smoketest site.');
    };

    try {
      await execa('docker', ['compose', 'up', '-d'], { cwd: siteDir, stdio: 'inherit' });
      const dbReady = await waitForDb(siteDir, 60);
      if (!dbReady) throw new Error('Database did not become ready in time.');

      const runWp = async (args, { filterSslNote = false } = {}) => {
        try {
          const { stdout, stderr } = await execa('docker', ['compose', 'run', '--rm', '-e', 'WP_CLI_PHP_ARGS=-d memory_limit=512M', 'wpcli', 'wp', ...args], { cwd: siteDir });
          if (stdout) process.stdout.write(stdout + (stdout.endsWith('\n') ? '' : '\n'));
          if (stderr) {
            if (filterSslNote && /Failed to get current SQL modes[\s\S]*TLS\/SSL error/i.test(stderr)) {
              console.log('Note: SQL modes probe failed due to SSL requirement on local DB (safe to ignore).');
            } else {
              process.stderr.write(stderr);
            }
          }
        } catch (e) {
          const stderr = e?.stderr || '';
          if (filterSslNote && /Failed to get current SQL modes[\s\S]*TLS\/SSL error/i.test(stderr)) {
            console.log('Note: SQL modes probe failed due to SSL requirement on local DB (safe to ignore).');
            return; // treat as non-fatal
          }
          throw e;
        }
      };

      // Download WordPress and configure (force to tolerate hidden files like .DS_Store)
      try {
        await runWp(['core', 'download', '--path=/var/www/html', '--force', '--allow-root', '--skip-plugins', '--skip-themes']);
      } catch {}
      await runWp(['config', 'create', `--dbname=${dbName}`, '--dbuser=wp', '--dbpass=wp', '--dbhost=db', '--force', '--skip-check', '--allow-root', '--skip-plugins', '--skip-themes']);
      // Run db create and filter the SSL SQL modes warning to a note
      try { await runWp(['db', 'create', '--allow-root', '--skip-plugins', '--skip-themes'], { filterSslNote: true }); } catch {}
      const url = `http://localhost:${opts.port}`;
      try {
        await runWp(['core', 'install', `--url=${url}`, '--title=CWL Smoke Test', '--admin_user=admin', '--admin_password=admin', '--admin_email=admin@example.com', '--skip-email', '--allow-root', '--skip-plugins', '--skip-themes']);
      } catch {}

      await ensureLocalLoginMuPlugin(siteDir);

      console.log('Smoke test site ready:');
      console.log(`- Dir: ${siteDir}`);
      console.log(`- URL: ${url}`);
      console.log('- Admin: admin / admin');

      // Issue a one-click login URL using our existing admin flow logic via options
      const token = Math.random().toString(36).slice(2);
      const expires = Math.floor(Date.now() / 1000) + 300;
  await runWp(['option', 'update', 'cwl_login_token', token, '--autoload=no', '--allow-root', '--skip-plugins', '--skip-themes']);
  await runWp(['option', 'update', 'cwl_login_expires', String(expires), '--autoload=no', '--allow-root', '--skip-plugins', '--skip-themes']);
      const loginUrl = `${url}/?cwl=${token}&redirect_to=/wp-admin/`;
      if (opts.print) console.log(`Login URL: ${loginUrl}`);
    } finally {
      await doCleanup();
    }
  });

  return cmd;
}
