import { Command } from 'commander';
import { Cloudways } from '../cloudways.js';

export function appsCommand() {
  const cmd = new Command('apps');
  cmd
    .description('List Cloudways apps across servers')
    .option('--sort <mode>', 'Sort order: date (newest first) or name (A→Z)', 'date')
    .option('--server <serverId>', 'Filter by Server ID')
    .action(async (opts) => {
      try {
        let list = await Cloudways.getApplications();
        if (opts.server) {
          list = list.filter(({ server }) => String(server.id) === String(opts.server));
        }
        if (!list.length) {
          console.log('No applications found.');
          return;
        }
        const sortMode = (opts.sort || 'date').toLowerCase();
        const normLabel = (app) => (app.label ?? app.name ?? app.application_label ?? '').toString();
        const getCreated = (app) => {
          const c = app.created_at || app.created || app.createdAt;
          const t = c ? Date.parse(String(c).replace(' ', 'T') + 'Z') : 0;
          return Number.isNaN(t) ? 0 : t;
        };
        if (sortMode === 'name') {
          list.sort((a, b) => normLabel(a.app).localeCompare(normLabel(b.app), undefined, { sensitivity: 'base' }));
        } else {
          // default: date desc (newest first)
          list.sort((a, b) => getCreated(b.app) - getCreated(a.app));
        }
        for (const { server, app } of list) {
          const id = app.id ?? app.app_id ?? app.application_id ?? 'unknown';
          const label = normLabel(app) || 'unlabeled';
          console.log(`${id}\t${label}\tserver:${server.id}\t${server.label}\t${server.public_ip}`);
        }
      } catch (e) {
        const msg = e?.message || String(e);
        if (/Not authenticated/i.test(msg)) {
          console.error('Not authenticated. Run `cwl auth` and try again.');
        } else {
          console.error('Failed to list apps:', msg);
        }
        process.exitCode = 1;
      }
    });
  return cmd;
}
