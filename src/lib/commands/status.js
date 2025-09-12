import { Command } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import { execa } from 'execa';
import { withSiteArg } from '../site.js';

export function statusCommand() {
  const cmd = new Command('status');
  withSiteArg(cmd.description('Show local site status (Docker containers, URL)'), async ({ siteDir: cwd }) => {
      let port = 8080;
      try {
        const env = await fs.readFile(path.join(cwd, '.env'), 'utf8');
        const m = env.match(/WP_PORT=(\d+)/);
        if (m) port = parseInt(m[1], 10);
      } catch {}
      console.log(`URL: http://localhost:${port}`);
      try {
        const { stdout } = await execa('docker', ['compose', 'ps'], { cwd });
        console.log(stdout);
      } catch (e) {
        console.log('Docker not running or compose file missing.');
      }
    });
  return cmd;
}
