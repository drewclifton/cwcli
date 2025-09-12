import { execa } from 'execa';

export async function wp(cwd, args, options = {}) {
  return execa('docker', ['compose', 'exec', '-T', 'php', 'wp', ...args], { cwd, ...options });
}
