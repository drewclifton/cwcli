import { Command } from 'commander';
import { execa } from 'execa';

async function check(cmd, args = ['--version']) {
  try {
    await execa(cmd, args);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.shortMessage || e.message };
  }
}

export function doctorCommand() {
  const cmd = new Command('doctor');
  cmd.description('Check local prerequisites').action(async () => {
    const checks = [
      ['docker', ['--version']],
      ['docker', ['compose', 'version']],
      ['rsync', ['--version']],
      ['ssh', ['-V']],
    ];
    for (const [c, a] of checks) {
      const res = await check(c, a);
      console.log(`${c} ${a.join(' ')}: ${res.ok ? 'OK' : 'MISSING'}${res.ok ? '' : ' — ' + res.error}`);
    }
  });
  return cmd;
}
