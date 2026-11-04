# Working on Stock & List (for coding agents)

Standing rules for every session. See README.md and PLAN.md for the project itself.

## Git

- Commit straight to `main` and push to `main`. Don't create feature branches.

## Chrome extension version

- Any change under `apps/extension/` that ships to users (code, manifest, permissions, styles) needs a
  version bump in `apps/extension/package.json` in the same push. The manifest's `version` is read
  from it by `apps/extension/build.mjs`.
- Use semver: patch (`0.2.0` → `0.2.1`) for fixes, minor (`0.2.0` → `0.3.0`) for new features or a
  permission change. Changes that only touch the extension's tests don't need a bump.
- Also bump when a shared change (`packages/shared/`) changes what the extension does, since it's bundled in.
- Check with `pnpm build:ext` and `grep '"version"' apps/extension/dist/manifest.json`.

## Before pushing

- `pnpm typecheck` and `pnpm test` pass.
