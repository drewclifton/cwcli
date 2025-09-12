#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { version } = require('../package.json');
import { authCommand } from './lib/commands/auth.js';
import { serversCommand } from './lib/commands/servers.js';
import { appsCommand } from './lib/commands/apps.js';
import { pullCommand } from './lib/commands/pull.js';
import { upCommand } from './lib/commands/up.js';
import { openCommand } from './lib/commands/open.js';
import { cloneCommand } from './lib/commands/clone.js';
import { pushCommand } from './lib/commands/push.js';
import { doctorCommand } from './lib/commands/doctor.js';
import { dbCommand } from './lib/commands/db.js';
import { initCommand } from './lib/commands/init.js';
import { downCommand } from './lib/commands/down.js';
import { statusCommand } from './lib/commands/status.js';
import { infoCommand } from './lib/commands/info.js';
import { sshCommand } from './lib/commands/ssh.js';
import { loginCommand } from './lib/commands/login.js';
import { adminCommand } from './lib/commands/admin.js';
import { quickCommand } from './lib/commands/quick.js';
import { rmCommand } from './lib/commands/rm.js';
import { sitesCommand } from './lib/commands/sites.js';
import { rmAllCommand } from './lib/commands/rm-all.js';
import { smoketestCommand } from './lib/commands/smoketest.js';

const program = new Command();
program
  .name('cwl')
  .description('Cloudways WordPress Local CLI\n\nSee README.md for full usage instructions')
  .version(version);

program.addCommand(authCommand());
program.addCommand(serversCommand());
program.addCommand(appsCommand());
program.addCommand(cloneCommand());
program.addCommand(pullCommand());
program.addCommand(upCommand());
program.addCommand(openCommand());
program.addCommand(pushCommand());
program.addCommand(doctorCommand());
program.addCommand(dbCommand());
program.addCommand(initCommand());
program.addCommand(downCommand());
program.addCommand(statusCommand());
program.addCommand(infoCommand());
program.addCommand(sshCommand());
program.addCommand(loginCommand());
program.addCommand(adminCommand());
program.addCommand(quickCommand());
program.addCommand(sitesCommand());
program.addCommand(rmCommand());
program.addCommand(rmAllCommand());
program.addCommand(smoketestCommand());

program.showHelpAfterError(chalk.gray('Use `cwl --help` for usage.'));
program.parseAsync(process.argv);
