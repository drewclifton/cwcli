import { Command } from 'commander';
import { Cloudways } from '../cloudways.js';

export function serversCommand() {
  const cmd = new Command('servers');
  cmd.description('List Cloudways servers').action(async () => {
    const servers = await Cloudways.getServers();
    for (const s of servers) {
      console.log(`${s.id}\t${s.label}\t${s.public_ip}`);
    }
  });
  return cmd;
}
