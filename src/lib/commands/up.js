import { Command } from 'commander';
import { execa } from 'execa';
import fs from 'fs-extra';
import path from 'path';
import yaml from 'yaml';
import { withSiteArg } from '../site.js';

export function upCommand() {
  const cmd = new Command('up');
  cmd.option('-p, --port <port>', 'Local port', v => parseInt(v, 10));
  withSiteArg(cmd.description('Start local Docker for a site'), async ({ siteDir, opts }) => {
    const desiredPort = opts?.port;
    if (desiredPort) {
      const envPath = path.join(siteDir, '.env');
      let envTxt = '';
      if (await fs.pathExists(envPath)) envTxt = await fs.readFile(envPath, 'utf8');
      const lines = envTxt ? envTxt.split(/\r?\n/) : [];
      let saw = false;
      const next = lines
        .filter(l => !/^WP_PORT\s*=/.test(l))
        .concat([`WP_PORT=${desiredPort}`])
        .filter(l => l.trim() !== '');
      await fs.writeFile(envPath, next.join('\n') + '\n');

      const composePath = path.join(siteDir, 'docker-compose.yml');
      if (await fs.pathExists(composePath)) {
        try {
          const comp = yaml.parse(await fs.readFile(composePath, 'utf8')) || {};
          if (comp?.services?.nginx?.ports && Array.isArray(comp.services.nginx.ports)) {
            const newMap = `${desiredPort}:80`;
            comp.services.nginx.ports = [newMap];
            await fs.writeFile(composePath, yaml.stringify(comp));
          }
        } catch {}
      }
    }

    await execa('docker', ['compose', 'up', '-d'], { cwd: siteDir, stdio: 'inherit' });
    console.log('Containers started.');
  });
  return cmd;
}
