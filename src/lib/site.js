import fs from 'fs-extra';
import path from 'path';

export function getSitesRoot() {
  const root = process.env.CWL_SITES_ROOT || path.join(process.cwd(), 'sites');
  return path.resolve(root);
}

export function isSiteDir(dir) {
  try {
    const stats = fs.statSync(dir);
    if (!stats.isDirectory()) return false;
  } catch {
    return false;
  }
  const markers = [
    'docker-compose.yml',
    'docker-compose.yaml',
    path.join('wp', ''),
    path.join('.cw', ''),
  ];
  for (const m of markers) {
    const p = path.join(dir, m);
    if (p.endsWith(path.sep)) {
      if (fs.pathExistsSync(p)) return true;
    } else if (fs.pathExistsSync(p)) {
      return true;
    }
  }
  return false;
}

export function resolveSiteDir(siteOrDir, opts, cmd) {
  if (opts && opts.dir) {
    cmd?.configureOutput?.({
      outputError: (str, write) => write(str),
    });
    console.warn('Warning: --dir is deprecated; pass a site name or path instead.');
    return path.resolve(String(opts.dir));
  }

  if (siteOrDir) {
    let arg = String(siteOrDir);
    if (arg.startsWith('~')) {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      arg = arg.replace(/^~(?=$|\/)/, home);
    }
    const looksLikePath = arg.startsWith('.') || arg.startsWith('/') || arg.includes('/');
    if (looksLikePath) return path.resolve(arg);

    // Bare name: first prefer the sites root
    const candidateInSites = path.join(getSitesRoot(), arg);
    if (fs.pathExistsSync(candidateInSites)) return candidateInSites;

    // Fallback: if a same-level folder exists in CWD (useful for smoke tests), use it
    const candidateInCwd = path.resolve(arg);
    if (fs.pathExistsSync(candidateInCwd)) return candidateInCwd;

    // Default to sites root path even if it doesn't yet exist (handlers will validate)
    return candidateInSites;
  }

  const cwd = process.cwd();
  if (isSiteDir(cwd)) return cwd;

  throw new Error('No site specified. Provide a site name (under ./sites), a path, or run the command from within a site directory.');
}

export function withSiteArg(command, handler) {
  command
    .argument('[siteOrDir]', 'site name (under ./sites) or a path')
    .option('-d, --dir <path>', 'explicit site directory (deprecated)');

  command.action(async (siteOrDir, opts, cmd) => {
    try {
      const siteDir = resolveSiteDir(siteOrDir, opts, cmd);
      if (!fs.pathExistsSync(siteDir)) {
        throw new Error(`Directory not found: ${siteDir}`);
      }
      return await handler({ siteDir, siteOrDir, opts, cmd });
    } catch (e) {
      cmd?.error?.(e?.message || String(e));
    }
  });
  return command;
}
