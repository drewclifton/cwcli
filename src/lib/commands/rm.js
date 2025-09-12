import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { execa } from 'execa';
import inquirer from 'inquirer';
import { withSiteArg } from '../site.js';

export function rmCommand() {
  const cmd = new Command('rm');
  withSiteArg(
    cmd
      .description('Remove a local site directory (stops Docker first)')
      .option('--yes', 'Skip confirmation prompt'),
    async ({ siteDir, opts }) => {
      // Stop containers if possible
      try {
        const downArgs = ['compose', 'down', '--remove-orphans'];
        downArgs.push('--volumes');
        await execa('docker', downArgs, { cwd: siteDir, stdio: 'inherit' });
      } catch {}

      const name = path.basename(siteDir);
      if (!opts.yes) {
        const { confirm } = await inquirer.prompt([
          { type: 'confirm', name: 'confirm', default: false, message: `Delete site "${name}" at ${siteDir}? This will stop containers and remove Docker volumes (DB data). This cannot be undone.` },
        ]);
        if (!confirm) {
          console.log('Aborted.');
          return;
        }
      }

      await fs.remove(siteDir);
      console.log(`Deleted: ${siteDir}`);
    }
  );
  return cmd;
}
