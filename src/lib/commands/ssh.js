import { Command } from 'commander';
import inquirer from 'inquirer';
import { execa } from 'execa';
import Client from 'ssh2-sftp-client';
import { Cloudways } from '../cloudways.js';

async function pickAppInteractively() {
  const list = await Cloudways.getApplications();
  const choice = await inquirer.prompt([
    {
      type: 'list',
      name: 'appId',
      message: 'Select app to test SSH',
      choices: list.map(({ server, app }) => ({
        name: `${app.id} — ${app.label} (server ${server.label} ${server.public_ip})`,
        value: app.id,
      })),
    },
  ]);
  return choice.appId;
}

async function tryTcp(ip) {
  try {
    await execa('nc', ['-vz', '-G', '5', ip, '22']);
    return { ok: true };
  } catch (e) {
    return { ok: false, err: e.shortMessage || e.message };
  }
}

async function trySshKey(user, ip) {
  try {
    const { stdout } = await execa('ssh', ['-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', `${user}@${ip}`, '-T', 'echo ok']);
    return { ok: stdout.trim() === 'ok' };
  } catch (e) {
    const msg = e.stderr || e.shortMessage || e.message;
    // Common Cloudways app-user message when shell disabled
    if (/shell|not enabled|sftp-only|This service allows sftp only/i.test(msg)) {
      return { ok: false, note: 'SFTP-only (no shell) for this user' };
    }
    if (/Permission denied|Authentication failed|All configured authentication methods failed/i.test(msg)) {
      return { ok: false, note: 'Key not accepted or no key loaded' };
    }
    return { ok: false, err: msg };
  }
}

async function trySftp(user, ip, password) {
  if (!password) return { ok: false, note: 'No password available' };
  const sftp = new Client();
  try {
    await sftp.connect({ host: ip, username: user, password, readyTimeout: 15000, keepaliveInterval: 10000, keepaliveCountMax: 6 });
    const homeOk = await sftp.exists('.');
    await sftp.end();
    return { ok: !!homeOk };
  } catch (e) {
    try { await sftp.end(); } catch {}
    return { ok: false, err: e.message };
  }
}

export async function sshTest({ appId }) {
  const chosenAppId = appId || await pickAppInteractively();
  const apps = await Cloudways.getApplications();
  const item = apps.find(({ app }) => String(app.id) === String(chosenAppId));
  if (!item) throw new Error('App not found');
  const { app, server } = item;

  const creds = await Cloudways.getAppCredentials(app.id);
  const ip = server.public_ip;
  const sysUser = app.sys_user || creds?.sftp?.username;
  const sysPass = app.sys_password || creds?.sftp?.password;
  const masterUser = server.master_user;
  const masterPass = server.master_password;

  console.log(`Testing connectivity to ${app.label} (app ${app.id}) on ${server.label} ${ip}`);

  const tcp = await tryTcp(ip);
  console.log(`- TCP 22: ${tcp.ok ? 'OK' : 'FAIL'}${tcp.err ? ` (${tcp.err})` : ''}`);
  if (!tcp.ok) {
    console.log('  Hint: In Cloudways → Server → Security, either allow all IPs or whitelist yours.');
    return 1;
  }

  let anySuccess = false;

  if (sysUser) {
    const sshSys = await trySshKey(sysUser, ip);
    console.log(`- SSH key as sys_user '${sysUser}': ${sshSys.ok ? 'OK' : 'NO'}` + (sshSys.note ? ` (${sshSys.note})` : sshSys.err ? ` (${sshSys.err})` : ''));
    anySuccess = anySuccess || sshSys.ok;
    const sftpSys = await trySftp(sysUser, ip, sysPass);
    console.log(`- SFTP as sys_user '${sysUser}': ${sftpSys.ok ? 'OK' : 'NO'}` + (sftpSys.note ? ` (${sftpSys.note})` : sftpSys.err ? ` (${sftpSys.err})` : ''));
    anySuccess = anySuccess || sftpSys.ok;
  } else {
    console.log('- sys_user: not provided by API');
  }

  if (masterUser) {
    const sshMaster = await trySshKey(masterUser, ip);
    console.log(`- SSH key as master '${masterUser}': ${sshMaster.ok ? 'OK' : 'NO'}` + (sshMaster.note ? ` (${sshMaster.note})` : sshMaster.err ? ` (${sshMaster.err})` : ''));
    anySuccess = anySuccess || sshMaster.ok;
    if (masterPass) {
      const sftpMaster = await trySftp(masterUser, ip, masterPass);
      console.log(`- SFTP as master '${masterUser}': ${sftpMaster.ok ? 'OK' : 'NO'}` + (sftpMaster.note ? ` (${sftpMaster.note})` : sftpMaster.err ? ` (${sftpMaster.err})` : ''));
      anySuccess = anySuccess || sftpMaster.ok;
    } else {
      console.log(`- SFTP as master '${masterUser}': password not available`);
    }
  } else {
    console.log('- master user: not provided by API');
  }

  if (!anySuccess) {
    console.log('\nNo successful method. Suggestions:');
    console.log('- Add your SSH public key under Server → Master Credentials.');
    console.log('- Ensure “Allow all IP addresses…” is enabled or whitelist your IP.');
    console.log('- If only sys_user exists, expect SFTP-only; DB dumps require master SSH.');
    return 2;
  }
  return 0;
}

export function sshCommand() {
  const cmd = new Command('ssh');
  cmd
    .description('Test SSH/SFTP connectivity for an app/server')
    .option('-a, --app <appId>', 'Cloudways application ID')
    .action(async (opts) => {
      const code = await sshTest({ appId: opts.app });
      if (code) process.exitCode = code;
    });
  return cmd;
}
