import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import inquirer from 'inquirer';
import { execa } from 'execa';
import { getSitesRoot, isSiteDir } from '../site.js';

export function rmAllCommand() {
  const cmd = new Command('rm-all');
  cmd
    .description('Remove all local site directories under the current directory (or CWL_SITES_ROOT); stops Docker first')
    .option('--yes', 'Skip confirmation prompt')
    .action(async (opts) => {
      const root = getSitesRoot();
      let names = [];
      try {
        names = await fs.readdir(root);
      } catch {}
      const sites = [];
      for (const n of names) {
        const p = path.join(root, n);
        try {
          const st = await fs.stat(p);
          if (st.isDirectory() && isSiteDir(p)) sites.push({ name: n, dir: p });
        } catch {}
      }

      if (!sites.length) {
        console.log(`No sites found under ${root}`);
        return;
      }

      if (!opts.yes) {
        const { confirm } = await inquirer.prompt([
          { type: 'confirm', name: 'confirm', default: false, message: `Delete ALL ${sites.length} sites under ${root}? This will stop containers and remove Docker volumes (DB data) for each site. This cannot be undone.` },
        ]);
        if (!confirm) {
          console.log('Aborted.');
          return;
        }
      }

      let ok = 0, fail = 0;
      for (const s of sites) {
        try {
          const downArgs = ['compose', 'down', '--remove-orphans', '--volumes'];
          try { await execa('docker', downArgs, { cwd: s.dir, stdio: 'inherit' }); } catch {}
          await fs.remove(s.dir);
          ok++;
          console.log(`Deleted: ${s.dir}`);
        } catch (e) {
          fail++;
          console.error(`Failed to delete ${s.dir}:`, e?.message || String(e));
        }
      }
      console.log(`Done. Deleted ${ok}, failed ${fail}.`);
    });
  return cmd;
}
