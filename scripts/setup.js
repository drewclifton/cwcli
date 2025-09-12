import { execa } from 'execa';
import os from 'os';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(path.join(__dirname, '..'));
const cliEntry = path.join(repoRoot, 'src', 'index.js');

function shellProfile() {
  const shell = process.env.SHELL || '';
  const home = os.homedir();
  if (shell.includes('zsh')) return path.join(home, '.zshrc');
  if (shell.includes('bash')) {
    const macBashProfile = path.join(home, '.bash_profile');
    return fs.existsSync(macBashProfile) ? macBashProfile : path.join(home, '.bashrc');
  }
  return path.join(home, '.profile');
}

async function ensureExecutable(file) {
  try {
    const stat = await fsp.stat(file);
    const mode = stat.mode | 0o111;
    await fsp.chmod(file, mode);
  } catch {}
}

async function tryNpmLink() {
  await ensureExecutable(cliEntry);
  await execa('npm', ['link'], { cwd: repoRoot, stdio: 'inherit' });
}

async function writeAlias() {
  const profile = shellProfile();
  const escaped = cliEntry.replace(/ /g, '\\\ ');
  const aliasLine = `\n# Cloudways Local CLI\nalias cwl="node ${escaped}"\n`;
  await fsp.appendFile(profile, aliasLine, 'utf8');
  return profile;
}

(async () => {
  console.log('Setting up cwl command...');
  try {
    await tryNpmLink();
    console.log('Success: cwl installed globally via npm link.');
    console.log('Try: cwl --help');
    process.exit(0);
  } catch (e) {
    console.warn('npm link failed, falling back to shell alias.');
    const profile = await writeAlias();
    console.log(`Alias added to ${profile}. Reload your shell or run:`);
    console.log(`  source ${profile}`);
    console.log('Then try: cwl --help');
    if (process.platform === 'win32') {
      console.log('Windows: create a PowerShell profile alias manually:');
      console.log(`  Add-Content $PROFILE 'Set-Alias cwl "node ${cliEntry}"'`);
    }
  }
})();
