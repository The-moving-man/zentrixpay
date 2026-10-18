# Project

## Getting started

### Prerequisites

- **Node.js** (v18 or newer recommended)

This project uses [pnpm](https://pnpm.io/) as its package manager. You do **not** need to install pnpm globally — the recommended way is to enable it through Node's built-in [Corepack](https://nodejs.org/api/corepack.html):

```sh
corepack enable
```

Once Corepack is enabled, `pnpm` will be available on your `PATH` and will automatically use the version pinned in the project's `package.json` (`packageManager` field).

### Installing dependencies

```sh
pnpm install
```

## Git hooks

This repository uses [Husky](https://typicode.github.io/husky/) to run Git hooks (for example, `pre-commit` and `commit-msg`). These hooks invoke `pnpm exec` to run tooling such as linters and commit-message checks.

If `pnpm` is not available on your `PATH`, the hooks will fall back to running pnpm via `npx pnpm@<version>` (using the version pinned in `package.json`). This means commits will still work on a machine that only has Node.js installed, as long as `npx` can download the pinned pnpm version.

If neither `pnpm` nor `npx` is available, the hooks will fail with a clear message explaining how to fix the setup. To resolve it, either:

1. Enable Corepack (recommended):

   ```sh
   corepack enable
   ```

2. Or install pnpm globally:

   ```sh
   npm install -g pnpm
   ```

After enabling Corepack or installing pnpm, re-run `pnpm install` so the hooks are set up correctly.

## Contributing

1. Fork and clone the repository.
2. Enable Corepack (`corepack enable`) or install pnpm globally.
3. Run `pnpm install`.
4. Create a branch, make your changes, and commit. The Git hooks will run automatically.
5. Open a pull request.

If you run into issues with the Git hooks, make sure `pnpm` (or `npx`) is available on your `PATH` and that you have run `pnpm install` after cloning.
