# Cloudways WP Local CLI

Work on your Cloudways WordPress sites locally with one command.

- Authenticate to Cloudways
- List servers and apps
- Create clones on Cloudways
- Pull files + DB from Cloudways
- Spin up locally with Docker (Nginx, PHP-FPM, MariaDB, WP-CLI)
- Optionally push back to Cloudways

## Quick Install (npm)

```zsh
# Global install
npm install -g cwcli

# Verify
cwl --help
```

Alternatively with npx (no global install):

```zsh
npx -y cwcli --help
```

Notes:
- The command is `cwl` (primary). An alias `cwcli` is also available.
- Default sites root is your current working directory. Override with `CWL_SITES_ROOT`.

## Authentication

You can authenticate interactively or via environment variables.

```sh
# Interactive re-auth (prompts for email + API key)
cwl auth

# View current auth status (email, storage method, token validity)
cwl auth status

# Logout (clears stored email/key/token)
cwl auth logout
```

Environment variables override stored values when set (useful for CI or temporary sessions):

```sh
export CW_EMAIL="you@example.com"
export CW_API_KEY="<your-api-key>"
```

Sites root override:

```zsh
export CWL_SITES_ROOT=/absolute/path/to/sites
```

## Easiest Path (Single Command)

```zsh
# Authenticate once (email + API key)
cwl auth

# One-step: pick the app → pull → start Docker → import DB → open admin (logged-in)
cwl quick
```

The first run asks you to pick the Cloudways app. It creates the site under your current directory as `./<slug>` and opens http://localhost:8080 (or the port shown in the site’s `.env`).

Tip: need speed? Pull live (read-only) to skip server-side cloning:

```sh
cwl quick --live
```

## Simple Workflow (Explicit Steps)

```zsh
# 0) Check prerequisites (Docker Desktop, rsync, ssh)
cwl doctor

# 1) Authenticate (stores Cloudways API credentials)
cwl auth

# 2) List apps (find an APP_ID; try --sort name or --server <ID>)
cwl apps

# 3) Pull a site (creates ./<slug> in your current directory; omit --app to pick interactively)
cwl pull --app <APP_ID>
# Faster read-only from live (skips clone; exports live DB safely):
# cwl pull --app <PROD_APP_ID> --live

# 4) Start containers (Nginx, PHP-FPM, MariaDB, WP-CLI)
cwl up <site-name-or-path>

# 5) Import DB and rewrite URLs to http://localhost:<port> (from .env)
cwl db import <site-name-or-path>

# 6) Open in browser (add --admin to auto-login to /wp-admin/)
cwl open <site-name-or-path>
```

## Usage

- Global help: `cwl --help` (See README.md for full usage instructions)
- Per-command help: `cwl <command> --help`
- Common options used across commands:
	- `--dir <dir>` (deprecated): Explicit path to the site folder. Prefer positional site name or path.
	- `--port <port>`: Local HTTP port (defaults to `8080` if not set in `.env`).
	- `--yes`: Assume “yes” for prompts where supported.
	- `--live`: Pull directly from the live app (read-only), where supported.

### Site Folder Layout

After pulling or running quick/init, each site lives under your current directory as `./<slug>` and contains:

- `wp/`: WordPress files (`public_html` from Cloudways).
- `.cw/`: CLI artifacts like `db.sql[.gz]`, `nginx.conf`, `meta.json`, temp files.
- `docker-compose.yml`: Nginx + PHP-FPM + MariaDB + WP-CLI setup.
- `.env`: Values like `WP_PORT`, `SITE_SLUG`, `DB_NAME`.

You can run all `cwl` commands from anywhere using a positional site argument. If you pass a bare name, it resolves to `./<name>` under your current directory (or under `CWL_SITES_ROOT` if set). You can also pass an explicit path. The legacy `--dir` still works but is deprecated.

Sites root:
- Default is your current working directory.
- Override with `CWL_SITES_ROOT`:

```sh
export CWL_SITES_ROOT=/absolute/path/to/sites
```

## Command Reference + Examples

### `cwl quick`

End-to-end: pull → up → import DB → open `/wp-admin/` with auto-login.

```sh
# Let me pick an app interactively, use defaults
cwl quick

# Target a specific app, custom port, and auto-login as a user
cwl quick --app 123456 --port 8085 --user admin

# Fast read-only pull from live
cwl quick --live

# Filter list by server when prompting
cwl quick --server 7890
```

### `cwl auth`

Authenticate with Cloudways API. Credentials are stored securely when possible.

```sh
cwl auth
cwl auth --email you@example.com --key <API_KEY>
# Clear stored credentials
cwl auth --clear
```

### `cwl servers` and `cwl apps`

```sh
cwl servers
cwl apps
cwl apps --sort name           # A→Z by app label
cwl apps --server 12345        # Filter to a specific server
```

### `cwl pull`

Pull files + DB for an app and scaffold Docker locally.

```zsh
# Prompt to pick an app, create ./<slug>
cwl pull

# Explicit app and directory with custom port
cwl pull --app 123456 --dir ./my-site --port 8082

# Pull directly from live (read-only; exports live DB)
cwl pull --app 123456 --live --yes

# Use a single tar.gz stream (faster when master SSH is available)
cwl pull --app 123456 --archive
```

### `cwl up` / `cwl down` / `cwl status`

```zsh
cwl up my-site           # Start containers (resolves to ./my-site)
cwl up my-site --port 8090  # Change the local port and restart
cwl status my-site       # Show URL and docker compose ps
cwl down my-site         # Stop containers
# Explicit paths still work
cwl up ./my-site
cwl status ./my-site
cwl down ./my-site
```

### `cwl sites`

List local sites under the default sites root. A directory is considered a site if it contains markers like `docker-compose.yml`, `.cw/`, or `wp/`.

```zsh
cwl sites
```

### `cwl db import`

Import `.cw/db.sql[.gz]` into the local DB and rewrite URLs to your local host/port.

```zsh
cwl db import my-site
```

### `cwl open` and `cwl admin`

Open the local site or `/wp-admin/` with an auto-login token. You can specify a username and token TTL.

```zsh
cwl open my-site
cwl open my-site --admin --user editor --ttl 600

# Directly open /wp-admin/ auto-logged-in
cwl admin my-site --user admin --ttl 600
```

### `cwl login`

Generate a one-click login URL for the local site; print or open it.

```zsh
cwl login my-site --user admin --ttl 600 --print
```

### `cwl push`

Push local `wp/` and DB to a new or existing Cloudways app. The CLI will not push to your original live app; if the target equals the source (or pull was from live), a new clone is created automatically.

```zsh
# Create a new clone automatically and push
cwl push my-site

# Push to an existing target app
cwl push my-site --to-app 222222

# Create with a custom label, then push
cwl push my-site --new-label staging-2025-09-12

# Files only or DB only
cwl push my-site --files-only
cwl push my-site --db-only
```

### Deleting local sites

Delete one site (stops Docker and removes volumes, including DB data), then removes the folder:

```zsh
cwl rm my-site            # prompts for confirmation
cwl rm my-site --yes      # skip confirmation
```

Delete all sites under the sites root. This stops Docker for each site, prunes volumes, and deletes the folders:

```zsh
cwl rm-all                # prompts for confirmation
cwl rm-all --yes          # skip confirmation
```

### `cwl ssh`

Test SSH/SFTP connectivity for an app/server. Helpful for diagnosing rsync/SSH issues.

```zsh
cwl ssh            # pick an app
cwl ssh --app 123456
```

### `cwl info`

Prints raw Cloudways server/app info for debugging.

```zsh
cwl info               # servers overview
cwl info --app 123456  # details + credentials payloads (redacted upstream)
```

## Requirements

- macOS with Docker Desktop
- Node.js 18+
- SSH access to the Cloudways application user (password or SSH key). The CLI fetches the credentials via API.

## How it works

- Auth: Exchanges your email + API key for a short-lived token; stored securely.
- Pull: Uses API to resolve SFTP/MySQL creds, rsyncs `public_html` to `./wp`, dumps the DB to `.cw/db.sql`.
- Local run: Generates `docker-compose.yml` and `wp-config.php`, starts Nginx/PHP/MariaDB/WP-CLI.
- DB import: Loads `.cw/db.sql` into MariaDB and rewrites the site URL to `http://localhost:<port>`.
- Push: Never pushes to live. If the target is missing or equals the source (or your pull was from live), the CLI auto-creates a new clone on Cloudways and pushes there. It then runs a serialized-safe URL rewrite to the target domain.

### Deauth/Reauth

- Reauth with new credentials: `cwl auth` and provide a different email/API key.
- Deauth fully: `cwl auth logout` (clears stored credentials and cached token).
- Inspect current state: `cwl auth status`.
- Env override: `CW_EMAIL` and `CW_API_KEY` take precedence over stored values.

## Troubleshooting

- If rsync asks for a password and fails, install `sshpass` (or copy your SSH key to the app user).
- Start Docker Desktop before running `cwl up` or `cwl quick`.
- Re-auth with `cwl auth --clear` then `cwl auth`.

### Redis object cache drop-in locally

If your pulled site includes a persistent object cache drop-in (e.g., `wp/wp-content/object-cache.php` from Redis Object Cache or Object Cache Pro), WordPress may attempt to connect to a Redis server that isn’t present in the local Docker stack.

What we do by default:
- The CLI writes `wp/wp-config-local.php` with:
	- `define('WP_CACHE', false);`
	- `define('WP_REDIS_DISABLED', true);`
These ensure the drop-in stays inactive locally.

If you still see a Redis connection error:
1) Confirm the defines exist in `wp/wp-config-local.php`.
2) Stop and restart containers: `cwl down my-site && cwl up my-site`.
3) Optionally delete/rename the drop-in: `mv wp/wp-content/object-cache.php wp/wp-content/object-cache.php.bak`.

### Live pull vs. clone

- `--live` always pulls read-only from your production app and exports the live DB. This is fastest and safest when you only need a local copy.
- Without `--live`, the CLI can clone your source app on Cloudways first to avoid touching production during pull/push workflows.

### Docker folder permissions

- Symptom: "operation not permitted" or "mount source path ... permission denied" when starting containers.
- Fix: Allow Docker to access your project folder, then retry `cwl quick` (or `docker compose up -d` in the site dir).
- macOS: System Settings → Privacy & Security → Files and Folders → Docker: enable access for the folder (e.g., Desktop/Documents). Or Docker Desktop → Settings → Resources → File sharing → add your project path → Apply & Restart.
- Windows: Docker Desktop → Settings → Resources → File Sharing → add your project path → Apply & Restart. If using WSL2: Settings → Resources → WSL Integration → enable your distro.
- Linux: Ensure your user owns the project directory and has rw permissions. If SELinux is enabled, add `:Z` to volume mounts (e.g., `./wp:/var/www/html:Z`) or run `sudo chcon -Rt svirt_sandbox_file_t /path/to/project`.

## From Source (Contributors)

```zsh
git clone https://github.com/drewclifton/cwcli.git
cd cwcli
npm install
# One-time local link (adds `cwl` command pointing to this repo)
npm run setup
```

Verify:

```zsh
cwl --help
```

## Publishing (Maintainers)

Two options: GitHub Releases (CI) or manual CLI.

1) GitHub Releases (CI)
- Add a repo secret `NPM_TOKEN` with publish rights.
- Bump version and push tag:
	```zsh
	npm version patch -m "Release %s"
	git push origin HEAD --follow-tags
	```
- Create a GitHub Release for the new tag. The workflow publishes to npm.

2) Manual CLI
```zsh
npm login
npm publish --access public
```
