# Contributing to ZentrixPay

Thanks for your interest in contributing to ZentrixPay! This guide will walk you through setting up the project locally, understanding the repository layout, following our commit conventions, running tests, and picking up your first issue.

## Prerequisites

- **Node.js** — version 20 or newer (we recommend the latest LTS).
- **pnpm** — we use pnpm as our package manager. It is enabled via Corepack, which ships with Node.js.
- **Git** — for cloning and version control.

## Setup

1. **Fork and clone the repository**

   ```bash
   git clone https://github.com/<your-username>/zentrixpay.git
   cd zentrixpay
   ```

2. **Enable Corepack**

   Corepack manages the pnpm version pinned by the repository, so you don't need to install pnpm globally.

   ```bash
   corepack enable
   ```

3. **Install dependencies**

   ```bash
   pnpm install
   ```

   This installs dependencies for every package in the workspace.

4. **Verify your setup**

   Run the test suite (see [Running tests](#running-tests)) to confirm everything is wired up correctly.

## Package layout

ZentrixPay is a pnpm workspace (monorepo). The top-level directories are:

| Path | Description |
| --- | --- |
| `server/` | Backend API and business logic. |
| `web/` | Frontend web application. |
| `mcp/` | Model Context Protocol (MCP) server and integrations. |
| `contract/` | Smart contracts and related tooling. |
| `packages/` | Shared libraries and internal packages used across the workspace. |

Each directory is its own package with its own `package.json`, scripts, and tests. Use pnpm's workspace filters to target a specific package.

## Commit conventions

We enforce commit message conventions with [commitlint](https://commitlint.js.org/) using the [Conventional Commits](https://www.conventionalcommits.org/) format. Commits that don't conform will be rejected by the `commit-msg` hook.

The format is:

```
<type>(<optional scope>): <description>

[optional body]

[optional footer(s)]
```

Common types:

- `feat` — a new feature
- `fix` — a bug fix
- `docs` — documentation only changes
- `test` — adding or updating tests
- `refactor` — code change that neither fixes a bug nor adds a feature
- `chore` — build process, tooling, or dependency changes
- `ci` — CI configuration changes

Examples:

```
feat(server): add rate limiting to the payments endpoint
fix(web): correct balance formatting for zero values
docs: update CONTRIBUTING.md for ZentrixPay
```

Keep the description in the imperative mood and under ~72 characters. Reference issues in the footer when relevant, e.g. `Closes #123`.

## Running tests

Tests live alongside each package. Run them per package with pnpm's filter flag:

```bash
# Run tests for a single package
pnpm --filter server test
pnpm --filter web test
pnpm --filter mcp test
pnpm --filter contract test

# Run tests for all packages
pnpm -r test
```

You can also run a package's scripts directly from its directory:

```bash
cd server
pnpm test
```

Before opening a pull request, make sure the tests for every package you touched pass.

## Finding and picking up issues

1. Browse the [issue tracker](https://github.com/<org>/zentrixpay/issues) and look for issues labeled **`good first issue`** or **`help wanted`** — these are ideal starting points.
2. Read the issue carefully, including any linked discussions or acceptance criteria.
3. Comment on the issue to let maintainers know you'd like to work on it. Wait for a maintainer to assign it to you before starting, to avoid duplicate work.
4. If you're unsure where to begin or the scope is unclear, ask questions in the issue thread — maintainers are happy to help.

## Opening a pull request

1. **Create a branch** off `main` with a descriptive name:

   ```bash
   git checkout -b feat/short-description
   ```

2. **Make your changes** and commit them following the [commit conventions](#commit-conventions).

3. **Run the tests** for the packages you changed and make sure they pass.

4. **Push your branch** and open a pull request against `main`.

5. **Fill out the PR description** — summarize the change, link the issue it closes (e.g. `Closes #123`), and note anything reviewers should pay attention to.

6. **Respond to review feedback.** A maintainer will review your PR; please address comments and push follow-up commits as needed.

Thanks again for contributing to ZentrixPay!