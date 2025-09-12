import { Command } from 'commander';
import inquirer from 'inquirer';
import { Cloudways } from '../cloudways.js';

export function cloneCommand() {
  const cmd = new Command('clone');
  cmd
    .description('Clone an app on Cloudways (server-side)')
    .option('-a, --app <appId>', 'Source app ID')
    .option('-s, --server <serverId>', 'Target server ID')
    .option('-l, --label <label>', 'Label for the new clone')
    .action(async (opts) => {
      let { app, server, label } = opts;
      if (!app) {
        const list = await Cloudways.getApplications();
        const ans = await inquirer.prompt([{
          type: 'list', name: 'app', message: 'Source app', choices: list.map(({server, app}) => ({ name: `${app.id} — ${app.label}`, value: app.id }))
        }]);
        app = ans.app;
      }
      if (!server) {
        const servers = await Cloudways.getServers();
        const ans = await inquirer.prompt([{
          type: 'list', name: 'server', message: 'Target server', choices: servers.map(s => ({ name: `${s.id} — ${s.label}`, value: s.id }))
        }]);
        server = ans.server;
      }
      if (!label) {
        const ans = await inquirer.prompt([{ name: 'label', message: 'New app label' }]);
        label = ans.label;
      }
      const res = await Cloudways.cloneApplication({ appId: app, targetServerId: server, label });
      console.log(JSON.stringify(res, null, 2));
    });
  return cmd;
}
