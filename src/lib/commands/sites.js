import { Command } from 'commander';
import fs from 'fs-extra';
import path from 'path';
import { getSitesRoot, isSiteDir } from '../site.js';

export function sitesCommand() {
  const cmd = new Command('sites');
  cmd.description('List local sites under the default sites root').action(async () => {
    const root = getSitesRoot();
    try {
      const names = await fs.readdir(root);
      const dirs = [];
      for (const n of names) {
        const p = path.join(root, n);
        try {
          const st = await fs.stat(p);
          if (st.isDirectory() && isSiteDir(p)) dirs.push(n);
        } catch {}
      }
      if (!dirs.length) {
        console.log(`No sites found under ${root}`);
      } else {
        for (const d of dirs.sort()) console.log(d);
      }
    } catch {
      console.log(`Sites root not found: ${root}`);
    }
  });
  return cmd;
}
