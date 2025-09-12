import { Command } from 'commander';
import { Cloudways, api } from '../cloudways.js';

export function infoCommand() {
  const cmd = new Command('info');
  cmd
    .description('Show raw info for servers or a specific app (debugging)')
    .option('--app <APP_ID>', 'Application ID to inspect')
    .action(async (opts) => {
      try {
        if (opts.app) {
          const detailsPaths = [
            `/apps/${opts.app}`,
            `/app/${opts.app}`,
            `/apps/${opts.app}/credentials`,
            `/app/credentials?app_id=${opts.app}`,
          ];
          for (const p of detailsPaths) {
            try {
              const d = await api(p);
              console.log(p + ':');
              console.log(JSON.stringify(d, null, 2));
            } catch {}
          }
        } else {
          const servers = await Cloudways.getServers();
          console.log('Servers:');
          console.log(JSON.stringify(servers, null, 2));
        }
      } catch (e) {
        console.error('Failed to load info:', e?.message || String(e));
        process.exitCode = 1;
      }
    });
  return cmd;
}
