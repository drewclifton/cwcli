import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import { saveCredentials, clearCredentials, getEmail, getCredentialsStatus } from '../cloudways.js';

export function authCommand() {
  const cmd = new Command('auth');
  cmd
    .description('Authenticate with Cloudways API')
    .option('-e, --email <email>', 'Cloudways account email')
    .option('-k, --key <apiKey>', 'Cloudways API key')
    .option('--clear', 'Clear stored credentials')
    .action(async (opts) => {
      if (opts.clear) {
        await clearCredentials();
        console.log('Credentials cleared.');
        return;
      }
  // Prefer provided flags or env to avoid prompting when possible
  const providedEmail = opts.email || process.env.CW_EMAIL || getEmail() || '';
      const providedKey = opts.key || process.env.CW_API_KEY || '';

      if (providedEmail && providedKey) {
        const spinner = ora('Saving credentials').start();
        await saveCredentials({ email: providedEmail, apiKey: providedKey });
        spinner.succeed('Credentials saved.');
        console.log('You can now run `cwl servers` or `cwl apps`.');
        return;
      }

      // Fall back to interactive prompts if any value missing
      const answers = await inquirer.prompt([
        { name: 'email', message: 'Email', default: providedEmail, validate: v => !!v || 'Required' },
        { name: 'apiKey', message: 'API Key', default: providedKey, mask: '*', type: 'password', validate: v => !!v || 'Required' },
      ]);
      const spinner = ora('Saving credentials').start();
      await saveCredentials({ email: answers.email, apiKey: answers.apiKey });
      spinner.succeed('Credentials saved.');
      console.log('You can now run `cwl servers` or `cwl apps`.');
    });
  cmd
    .command('status')
    .description('Show auth status (email, storage method, token validity)')
    .action(async () => {
      const s = getCredentialsStatus();
      console.log(JSON.stringify(s, null, 2));
    });
  cmd
    .command('logout')
    .description('Clear stored credentials and cached token')
    .action(async () => {
      await clearCredentials();
      console.log('Logged out and cleared credentials/token.');
    });
  return cmd;
}
