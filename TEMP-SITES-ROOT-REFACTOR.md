# Sites Root Refactor Plan

Goal: Default sites root should be the current working directory (CWD), not `./sites`. Keep `CWL_SITES_ROOT` override.

## Tasks
- [x] Confirm current behavior and references
- [x] Change resolver: `getSitesRoot()` → `CWL_SITES_ROOT || process.cwd()`
- [x] Update error/help strings in `site.js`
- [x] Update command option/help text mentioning `./sites`
- [x] Update smoketest description to reflect CWD
- [x] Update README references to default `./sites` → CWD
- [x] Quick local verification via `sites` command in a new directory
- [ ] Optional: try `smoketest --cleanup` if Docker available
- [x] Commit and push changes

## Notes
- Ensure all commands derive paths via `getSitesRoot()` or `resolveSiteDir()`; remove hard-coded `./sites` wording.
- `rm-all` and `sites` act on CWD; safety remains via `isSiteDir()` markers.