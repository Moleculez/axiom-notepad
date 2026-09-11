# Generated-file maintenance

Run from the repository root:

```sh
npm run clean:generated
# Identify all additional running/retained builds before applying:
npm run clean:generated -- --origin http://localhost:8080 --keep apps/web/.next/my-release
npm run clean:generated -- --apply --origin http://localhost:8080 --keep apps/web/.next/my-release
```

The command defaults to inventory only. It considers completed Next.js build
directories with server/static/BUILD_ID markers, three explicitly named tool caches
under `data`, and marked `data/previous-web-build-*` copies. It never selects a broad
workspace/data root. It does not follow symlink destinations. Redirected targets and
parents, missing build markers, changed targets and locked builds are rejected.

It retains configured build paths found in root `.env*` files, the default dev
directory, the most recently completed build, explicitly retained paths, locally
probed build IDs and anything modified during the last 24 hours. Configuration
values and secrets are not written to reports. An origin probe must succeed; it
never guesses which build a failed service was using. List every additional service
with `--origin` or its exact `--keep` path. Stop build writers before applying.

Database directories, stored attachments, backups, private configuration, installed
dependencies, all test evidence and source are excluded. Ambiguous directories are
left for manual review. This is not `git clean`, a database reset, or a Docker-wide
prune operation.

Applied runs write a private receipt in `data/maintenance/` with exact targets,
logical bytes removed, retained/skipped paths and failures. Regenerate builds with
`npm run build` and tool caches with their usual commands. Deleted generated files
are not moved to Trash; filesystem free-space gains can differ from logical bytes
because of snapshots, compression and shared blocks.

The September 11 cleanup removed 94 generated targets totaling 28.62 GiB of logical
file bytes. It preserved both running local services' builds, the latest validated
Canvas candidate and all private data/evidence. This is a historical receipt, not
a promise that a future cleanup will reclaim the same amount.
