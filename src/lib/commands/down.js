import { Command } from 'commander';
import { execa } from 'execa';
import { withSiteArg } from '../site.js';

export function downCommand() {
  const cmd = new Command('down');
  withSiteArg(cmd.description('Stop Docker containers for a site'), async ({ siteDir }) => {
    await execa('docker', ['compose', 'down', '--remove-orphans'], { cwd: siteDir, stdio: 'inherit' });
  });
  return cmd;
}
