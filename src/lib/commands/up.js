import { Command } from 'commander';
import { execa } from 'execa';
import { withSiteArg } from '../site.js';

export function upCommand() {
  const cmd = new Command('up');
  withSiteArg(cmd.description('Start local Docker for a site'), async ({ siteDir }) => {
    await execa('docker', ['compose', 'up', '-d'], { cwd: siteDir, stdio: 'inherit' });
    console.log('Containers started.');
  });
  return cmd;
}
