import { Command } from 'commander';
import inquirer from 'inquirer';
import path from 'path';
import fs from 'fs-extra';
import { Cloudways } from '../cloudways.js';
import { execa } from 'execa';
import semver from 'semver';
import Client from 'ssh2-sftp-client';
import { Client as SSHClient } from 'ssh2';
import { ensureDockerFiles } from '../local/docker.js';
import { getSitesRoot } from '../site.js';
import { ensureLocalLoginMuPlugin } from '../local/login-plugin.js';

async function pickAppInteractively() {
  const list = await Cloudways.getApplications();
  const choice = await inquirer.prompt([
    {
      type: 'list',
      name: 'appId',
      message: 'Select app to pull',
      choices: list.map(({ server, app }) => ({
        name: `${app.id} — ${app.label} (server ${server.label} ${server.public_ip})`,
        value: app.id,
      })),
    },
  ]);
  return choice.appId;
}

export async function pullSite({ appId, dir, port, live = false, yes = false, archive = false }) {
  const chosenAppId = appId || await pickAppInteractively();

  const apps = await Cloudways.getApplications();
  const item = apps.find(({ app }) => String(app.id) === String(chosenAppId));
  if (!item) throw new Error('App not found');
  const { app, server } = item;

  if (live && !yes) {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      default: false,
      message: `Pulling LIVE app "${app.label}" (ID ${app.id}) directly. This is read-only but will export the live DB. Proceed?`,
    }]);
    if (!confirm) {
      console.log('Aborted.');
      process.exit(1);
    }
  }

  const siteSlug = app.label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const siteDir = dir || path.join(getSitesRoot(), siteSlug);
  const wpDir = path.join(siteDir, 'wp');
  await fs.ensureDir(wpDir);
  await fs.ensureDir(path.join(siteDir, '.cw'));

  await fs.writeJson(path.join(siteDir, '.cw/meta.json'), {
    sourceApp: { id: app.id, label: app.label },
    server: { id: server.id, label: server.label, ip: server.public_ip },
    siteSlug,
    fromLive: !!live,
  }, { spaces: 2 });

  // Credentials and paths
  const creds = await Cloudways.getAppCredentials(app.id);
  const public_ip = server.public_ip;
  const candidateUser = app.sys_user || creds?.sftp?.username || server.master_user || 'master';
  const candidatePass = app.sys_password || creds?.sftp?.password || server.master_password || undefined;
  const application_path = (creds?.application_path || creds?.app?.application_path || `applications/${app.id}`).replace(/^\/+/, '');

  const usingMaster = candidateUser === (server.master_user || 'master');
  const sysUser = app.sys_user || candidateUser;
  const sysRsyncCandidates = [
    `~/public_html/`,
    `/home/${sysUser}/public_html/`,
  ];
  const masterHome = `/home/${server.master_user || 'master'}`;
  const masterAppsRoot = `/home/${server.id}.cloudwaysapps.com`;
  const masterCandidates = [
    ...(app?.symlink ? [`${masterAppsRoot}/${app.symlink}/public_html/`] : []),
    ...(app?.sys_user ? [`${masterAppsRoot}/${app.sys_user}/public_html/`] : []),
    `${masterAppsRoot}/${application_path}/public_html/`,
    `${masterAppsRoot}/applications/${String(app.id)}/public_html/`,
  ];

  console.log(`Syncing files from ${public_ip} as ${candidateUser} ...`);
  // SSH port check
  try {
    await execa('nc', ['-z', '-G', '5', public_ip, '22']);
  } catch {
    throw new Error(`Cannot reach SSH on ${public_ip}:22. Whitelist your IP in Cloudways → Server → Security.`);
  }

  // Optionally prefer a tar-over-SSH single-stream transfer (fast, fewer files)
  let synced = false;
  let usedMasterFallback = false;
  let resolvedRemotePath = null;

  if (archive) {
    // We need master SSH (shell) to run tar; figure out remote base dir
    const masterUser = server.master_user || 'master';
    const baseCandidates = [
      ...(app?.symlink ? [`/home/${server.id}.cloudwaysapps.com/${app.symlink}`] : []),
      ...(app?.sys_user ? [`/home/${server.id}.cloudwaysapps.com/${app.sys_user}`] : []),
      `/home/${server.id}.cloudwaysapps.com/${application_path}`,
      `/home/${server.id}.cloudwaysapps.com/applications/${String(app.id)}`,
    ];
    for (const base of baseCandidates) {
      try {
        const { stdout } = await execa('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', `${masterUser}@${public_ip}`, `test -d '${base}/public_html' && echo ok || echo no`]);
        if (stdout.trim() === 'ok') {
          const tarCmd = `tar -C '${base}' --exclude='public_html/wp-config.php' --exclude='public_html/wp-content/cache' -czf - public_html`;
          await fs.ensureDir(wpDir);
          await execa('bash', ['-lc', `ssh -o StrictHostKeyChecking=no -o BatchMode=yes ${masterUser}@${public_ip} "${tarCmd}" | tar -C "${wpDir}" -xzf -`], { stdio: 'inherit' });
          resolvedRemotePath = `${base}/public_html/`;
          usedMasterFallback = true;
          synced = true;
          break;
        }
      } catch {}
    }
  }

  // Try rsync over SSH with progress and keepalives (if archive not used or failed)
  const sshOpts = 'ssh -o StrictHostKeyChecking=no -o BatchMode=yes -o ConnectTimeout=15 -o ServerAliveInterval=30 -o ServerAliveCountMax=10 -o TCPKeepAlive=yes';
  let progressArg = '--progress';
  try {
    const { stdout } = await execa('rsync', ['--version']);
    const m = stdout.match(/rsync\s+version\s+(\d+\.\d+(?:\.\d+)?)/i);
    const ver = m ? (m[1].includes('.') ? m[1] : `${m[1]}.0`) : '2.6.9';
    if (semver.valid(semver.coerce(ver)) && semver.gte(semver.coerce(ver), '3.1.0')) {
      progressArg = '--info=progress2';
    }
  } catch {}
  const mkRsyncArgs = (user, path) => ['-az', '-h', progressArg, '-e', sshOpts, '--delete', '--exclude', 'wp-config.php', '--exclude', 'wp-content/cache', `${user}@${public_ip}:${path}`, wpDir];

  for (const cand of (!synced && usingMaster ? masterCandidates : sysRsyncCandidates)) {
    try {
      if (synced) break;
      await execa('rsync', mkRsyncArgs(candidateUser, cand), { stdio: 'inherit' });
      resolvedRemotePath = cand;
      synced = true;
      break;
    } catch {}
  }
  if (!synced && server.master_user) {
    for (const cand of masterCandidates) {
      try {
        await execa('rsync', mkRsyncArgs(server.master_user, cand), { stdio: 'inherit' });
        resolvedRemotePath = cand;
        usedMasterFallback = true;
        synced = true;
        break;
      } catch {}
    }
  }

  // If rsync failed and we have a password, try SFTP as a last resort
  if (!synced && candidatePass) {
    try {
      const sftp = new Client();
      await sftp.connect({ host: public_ip, username: candidateUser, password: candidatePass, readyTimeout: 60000, keepaliveInterval: 15000, keepaliveCountMax: 10 });
      const sftpCandidates = usingMaster ? masterCandidates : [ 'public_html/', `/home/${sysUser}/public_html/` ];
      for (const cand of sftpCandidates) {
        if (await sftp.exists(cand)) {
          await sftp.downloadDir(cand, wpDir);
          resolvedRemotePath = cand;
          synced = true;
          break;
        }
      }
      await sftp.end();
    } catch {}
  }
  if (!synced && !usedMasterFallback && server.master_user && server.master_password) {
    try {
      const sftp = new Client();
      await sftp.connect({ host: public_ip, username: server.master_user, password: server.master_password, readyTimeout: 60000, keepaliveInterval: 15000, keepaliveCountMax: 10 });
      for (const cand of masterCandidates) {
        if (await sftp.exists(cand)) {
          await sftp.downloadDir(cand, wpDir);
          resolvedRemotePath = cand;
          usedMasterFallback = true;
          synced = true;
          break;
        }
      }
      await sftp.end();
    } catch {}
  }

  if (!synced) {
    throw new Error('Failed to sync files via SSH/SFTP. Check SSH access (whitelist IP) and credentials.');
  }

  // Dump DB via SSH mysqldump
  const dbFile = path.join(siteDir, '.cw/db.sql');
  await fs.ensureDir(path.dirname(dbFile));

  const dbUser = creds?.mysql?.username || app?.database_user || app?.mysql_user;
  const dbPass = creds?.mysql?.password || app?.database_password || app?.mysql_password;
  const dbName = creds?.mysql?.db_name || app?.database_name || app?.mysql_db_name || siteSlug;

  if (dbUser && dbPass && dbName) {
    if (usedMasterFallback) {
      const sshUser = server.master_user || 'master';
      // Probe remote mysqldump support for flags
      let flags = ['--single-transaction', '--quick', '--default-character-set=utf8mb4'];
      try {
        const { stdout } = await execa('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', `${sshUser}@${public_ip}`, 'mysqldump --help']);
        const help = (stdout || '').toLowerCase();
        if (help.includes('set-gtid-purged')) flags.push('--set-gtid-purged=OFF');
        if (help.includes('column-statistics')) flags.push('--column-statistics=0');
      } catch {}
      const remoteCmd = `set -o pipefail; mysqldump ${flags.join(' ')} -u${dbUser} -p${dbPass} ${dbName} | gzip -c`;
      const gzPath = `${dbFile}.gz`;
      try {
        await execa('bash', ['-lc', `ssh -o StrictHostKeyChecking=no -o BatchMode=yes ${sshUser}@${public_ip} "${remoteCmd}" > "${gzPath}"`], { stdio: 'inherit' });
      } catch (e) {
        throw new Error(`Remote mysqldump failed: ${e?.message || e}`);
      }
    } else if (candidatePass) {
      await new Promise((resolve, reject) => {
        const ssh = new SSHClient();
        let buffer = '';
        let errbuf = '';
        const dumpCmd = `mysqldump --single-transaction --quick --default-character-set=utf8mb4 -u${dbUser} -p${dbPass} ${dbName}`;
        ssh.on('ready', () => {
          ssh.exec(dumpCmd, (err, stream) => {
            if (err) return reject(err);
            stream.on('close', (code) => {
              ssh.end();
              if (code === 0) resolve(); else reject(new Error(`mysqldump exited with code ${code}${errbuf ? `: ${errbuf.trim()}` : ''}`));
            }).on('data', (data) => { buffer += data.toString('utf8'); })
              .stderr.on('data', (d) => { errbuf += d.toString('utf8'); });
          });
        }).on('error', reject)
          .connect({ host: public_ip, username: usedMasterFallback ? (server.master_user || 'master') : candidateUser, password: usedMasterFallback ? server.master_password : candidatePass, readyTimeout: 60000 });

        const interval = setInterval(async () => {
          if (buffer) { await fs.writeFile(dbFile, buffer); buffer = ''; }
        }, 500);
        const done = (fn) => (v) => { clearInterval(interval); fn(v); };
        resolve = done(resolve);
        reject = done(reject);
      });
    } else {
      const dumpCmd = `mysqldump --single-transaction --quick --default-character-set=utf8mb4 -u${dbUser} -p${dbPass} ${dbName}`;
      const sshArgs = ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', `${candidateUser}@${public_ip}`, dumpCmd];
      const { stdout } = await execa('ssh', sshArgs);
      await fs.writeFile(dbFile, stdout);
    }
  } else {
    console.warn('Database credentials not found via API. Skipping DB dump.');
  }

  await ensureDockerFiles(siteDir, { siteSlug, dbName, wpPort: port || 8080 });

  const wpConfigPath = path.join(wpDir, 'wp-config.php');
  if (!await fs.pathExists(wpConfigPath)) {
    const wpConfig = `<?php\n\n// Minimal wp-config for local dev generated by cw\ndefine('DB_NAME', '${dbName}');\ndefine('DB_USER', 'wp');\ndefine('DB_PASSWORD', 'wp');\ndefine('DB_HOST', 'db');\n$table_prefix = 'wp_';\n\nif (file_exists(__DIR__ . '/wp-config-local.php')) { require __DIR__ . '/wp-config-local.php'; }\n\nif (!defined('ABSPATH')) define('ABSPATH', __DIR__ . '/');\nrequire_once ABSPATH . 'wp-settings.php';\n`;
    await fs.writeFile(wpConfigPath, wpConfig);
  }

  const configLocal = `<?php\n// Local overrides\ndefine('WP_HOME', 'http://localhost:${port || 8080}');\ndefine('WP_SITEURL', 'http://localhost:${port || 8080}');\ndefine('WP_DEBUG', true);\n`;
  await fs.writeFile(path.join(wpDir, 'wp-config-local.php'), configLocal);

  // Install local one-click login mu-plugin
  await ensureLocalLoginMuPlugin(siteDir);

  console.log('\nPull complete. Next steps:');
  const siteName = path.basename(siteDir);
  const rootSites = getSitesRoot();
  const norm = (p) => p.replace(/\/+$/, '');
  const underSites = norm(siteDir).startsWith(norm(rootSites) + path.sep);
  const displayArg = underSites ? siteName : siteDir;
  console.log(`- Start containers: cwl up ${displayArg}`);
  console.log(`- Import DB: cwl db import ${displayArg}`);
  console.log(`- Open site: cwl open ${displayArg}`);

  return { siteDir, dbName };
}

export function pullCommand() {
  const cmd = new Command('pull');
  cmd
    .description('Pull files + DB from a Cloudways app and set up locally')
    .option('-a, --app <appId>', 'Cloudways application ID')
    .option('-d, --dir <dir>', 'Local directory for the site')
    .option('--port <port>', 'Local HTTP port', v => parseInt(v, 10), 8080)
    .option('--archive', 'Transfer files as a tar.gz stream (faster when SSH available)')
    .option('--live', 'Pull directly from the live app (read-only)')
    .option('--yes', 'Assume yes for prompts')
    .action(async (opts) => {
      await pullSite({ appId: opts.app, dir: opts.dir, port: opts.port, live: !!opts.live, yes: !!opts.yes, archive: !!opts.archive });
    });
  return cmd;
}
