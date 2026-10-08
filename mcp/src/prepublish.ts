/**
 * Pre-publish checks for the @zentrixpay/mcp package.
 *
 * Publishing an MCP server is easy to get subtly wrong: a `bin` entry that
 * points at a file the tarball does not contain, a stale `dist/` built before
 * the last source change, source and secrets shipped to the registry, or a
 * workspace-only dependency that cannot be installed by anyone outside this
 * repo. Each of those produces a package that installs cleanly and then fails
 * on the user's machine.
 *
 * This module holds the checks as pure functions over a snapshot of the
 * package, so they are deterministic and unit-testable. Gathering the snapshot
 * (running the test suite, building, invoking `npm pack --dry-run`) is the
 * runner's job — see `scripts/prepublish-check.ts`.
 */

export type CheckStatus = "pass" | "fail";

export interface CheckResult {
  /** Stable, human-readable check name. Used as the report key. */
  name: string;
  status: CheckStatus;
  /** What was found, and — when failing — how to fix it. */
  detail: string;
}

/** Everything the pure checks need to know about the package on disk. */
export interface PackageSnapshot {
  /** Parsed package.json. */
  manifest: Record<string, any>;
  /** Repo-relative paths that exist in the package directory. */
  files: string[];
  /** Source of the file named by `bin`, or null when it is missing/unreadable. */
  binSource: string | null;
  /** Paths npm would include in the tarball (from `npm pack --dry-run`). */
  packedFiles: string[];
  /** Newest mtime (epoch ms) across src/, or null when unknown. */
  newestSourceMtime: number | null;
  /** mtime (epoch ms) of the built entrypoint, or null when it does not exist. */
  builtEntrypointMtime: number | null;
}

const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/** Paths that must never reach the registry. */
const FORBIDDEN_IN_TARBALL: { label: string; matches: (path: string) => boolean }[] = [
  { label: "TypeScript sources", matches: (p) => p.startsWith("src/") },
  { label: "test files", matches: (p) => /\.test\.[cm]?[jt]s$/.test(p) },
  { label: "snapshots", matches: (p) => p.includes("__snapshots__/") },
  { label: "environment files", matches: (p) => /(^|\/)\.env(\.|$)/.test(p) },
  { label: "agent state", matches: (p) => p.endsWith("state.json") },
  { label: "lockfiles", matches: (p) => /(^|\/)(package-lock\.json|pnpm-lock\.yaml)$/.test(p) },
];

function pass(name: string, detail: string): CheckResult {
  return { name, status: "pass", detail };
}

function fail(name: string, detail: string): CheckResult {
  return { name, status: "fail", detail };
}

/** Build a CheckResult for a command the runner executed (tests, build, …). */
export function commandCheck(name: string, ok: boolean, detail: string): CheckResult {
  return ok ? pass(name, detail) : fail(name, detail);
}

/** Normalize a `bin` field (string or map) to the set of entrypoint paths. */
export function binEntrypoints(manifest: Record<string, any>): string[] {
  const bin = manifest.bin;
  if (typeof bin === "string") return [bin];
  if (bin && typeof bin === "object") {
    return Object.values(bin).filter((v): v is string => typeof v === "string");
  }
  return [];
}

/** Strip a leading "./" so manifest paths compare against tarball paths. */
function normalize(path: string): string {
  return path.replace(/^\.\//, "");
}

/** Manifest fields a published package needs. */
export function checkManifest(manifest: Record<string, any>): CheckResult[] {
  const results: CheckResult[] = [];

  results.push(
    typeof manifest.name === "string" && manifest.name.length > 0
      ? pass("manifest:name", `name is "${manifest.name}"`)
      : fail("manifest:name", "package.json has no name"),
  );

  results.push(
    typeof manifest.version === "string" && SEMVER.test(manifest.version)
      ? pass("manifest:version", `version is ${manifest.version}`)
      : fail(
          "manifest:version",
          `version ${JSON.stringify(manifest.version)} is not valid semver — bump it before publishing`,
        ),
  );

  results.push(
    manifest.private === true
      ? fail(
          "manifest:private",
          'package.json sets "private": true — npm/pnpm will refuse to publish it',
        )
      : pass("manifest:private", "package is publishable (not private)"),
  );

  results.push(
    typeof manifest.description === "string" && manifest.description.length > 0
      ? pass("manifest:description", "description is set")
      : fail("manifest:description", "add a description — it is shown on the registry page"),
  );

  results.push(
    typeof manifest.license === "string" && manifest.license.length > 0
      ? pass("manifest:license", `license is ${manifest.license}`)
      : fail("manifest:license", "add a license field"),
  );

  results.push(
    manifest.type === "module"
      ? pass("manifest:type", 'type is "module" (matches the compiled ESM output)')
      : fail("manifest:type", 'set "type": "module" — the build emits ESM'),
  );

  const main = typeof manifest.main === "string" ? normalize(manifest.main) : null;
  results.push(
    main && main.startsWith("dist/")
      ? pass("manifest:main", `main points at ${main}`)
      : fail("manifest:main", 'main must point into dist/ (e.g. "dist/index.js")'),
  );

  const files = Array.isArray(manifest.files) ? manifest.files.map(normalize) : null;
  results.push(
    files && files.some((entry) => entry === "dist" || entry.startsWith("dist/"))
      ? pass("manifest:files", `files is ${JSON.stringify(manifest.files)}`)
      : fail(
          "manifest:files",
          'add a "files" allowlist including "dist" — without it the tarball ships sources',
        ),
  );

  const engines = manifest.engines?.node;
  results.push(
    typeof engines === "string" && engines.length > 0
      ? pass("manifest:engines", `engines.node is ${engines}`)
      : fail("manifest:engines", 'declare engines.node (the server targets ">=20")'),
  );

  return results;
}

/** The `bin` entry must exist, live in dist/, and be a runnable node script. */
export function checkBinEntrypoint(snapshot: PackageSnapshot): CheckResult[] {
  const entrypoints = binEntrypoints(snapshot.manifest);
  if (entrypoints.length === 0) {
    return [
      fail(
        "bin:declared",
        'no "bin" entry — an MCP server should be launchable as a command (e.g. { "zentrixpay-mcp": "dist/index.js" })',
      ),
    ];
  }

  const results: CheckResult[] = [
    pass("bin:declared", `bin entrypoints: ${entrypoints.map(normalize).join(", ")}`),
  ];

  for (const raw of entrypoints) {
    const entry = normalize(raw);

    results.push(
      entry.startsWith("dist/")
        ? pass("bin:built", `${entry} is a build output`)
        : fail("bin:built", `${entry} must point into dist/, not at TypeScript source`),
    );

    results.push(
      snapshot.files.includes(entry)
        ? pass("bin:exists", `${entry} exists — run the build before publishing`)
        : fail("bin:exists", `${entry} does not exist — run \`pnpm build\``),
    );

    results.push(
      snapshot.packedFiles.includes(entry)
        ? pass("bin:packed", `${entry} is included in the tarball`)
        : fail(
            "bin:packed",
            `${entry} is declared in bin but excluded from the tarball — fix the "files" allowlist`,
          ),
    );

    results.push(
      snapshot.binSource?.startsWith("#!/usr/bin/env node")
        ? pass("bin:shebang", `${entry} starts with a node shebang`)
        : fail(
            "bin:shebang",
            `${entry} must start with "#!/usr/bin/env node" or it cannot run as a command`,
          ),
    );
  }

  return results;
}

/** The build output must exist and be newer than the sources it came from. */
export function checkBuildOutput(snapshot: PackageSnapshot): CheckResult[] {
  const results: CheckResult[] = [];
  const distFiles = snapshot.files.filter((f) => f.startsWith("dist/") && f.endsWith(".js"));

  results.push(
    distFiles.length > 0
      ? pass("build:output", `${distFiles.length} compiled file(s) in dist/`)
      : fail("build:output", "dist/ has no compiled output — run `pnpm build`"),
  );

  if (snapshot.builtEntrypointMtime === null) {
    results.push(fail("build:fresh", "no built entrypoint to compare against sources"));
  } else if (snapshot.newestSourceMtime === null) {
    results.push(fail("build:fresh", "could not read source timestamps"));
  } else if (snapshot.builtEntrypointMtime >= snapshot.newestSourceMtime) {
    results.push(pass("build:fresh", "build output is newer than every source file"));
  } else {
    results.push(
      fail("build:fresh", "dist/ is older than src/ — rebuild before publishing (`pnpm build`)"),
    );
  }

  return results;
}

/** The tarball must carry the runtime and nothing else. */
export function checkPackageContents(snapshot: PackageSnapshot): CheckResult[] {
  const results: CheckResult[] = [];
  const packed = snapshot.packedFiles;

  results.push(
    packed.length > 0
      ? pass("contents:listed", `${packed.length} file(s) in the tarball`)
      : fail("contents:listed", "npm pack listed no files"),
  );

  results.push(
    packed.includes("package.json")
      ? pass("contents:manifest", "package.json is included")
      : fail("contents:manifest", "package.json is missing from the tarball"),
  );

  results.push(
    packed.some((p) => p.startsWith("dist/"))
      ? pass("contents:runtime", "dist/ is included")
      : fail(
          "contents:runtime",
          "the tarball has no dist/ — the package would be empty at runtime",
        ),
  );

  for (const rule of FORBIDDEN_IN_TARBALL) {
    const offenders = packed.filter(rule.matches);
    results.push(
      offenders.length === 0
        ? pass(`contents:no-${rule.label.replace(/\s+/g, "-")}`, `no ${rule.label} in the tarball`)
        : fail(
            `contents:no-${rule.label.replace(/\s+/g, "-")}`,
            `${rule.label} would be published: ${offenders.slice(0, 5).join(", ")}${
              offenders.length > 5 ? `, +${offenders.length - 5} more` : ""
            }`,
          ),
    );
  }

  return results;
}

/**
 * Runtime dependencies must be installable outside this repo. `workspace:`
 * ranges are rewritten by `pnpm publish` but not by `npm publish`, and a range
 * pointing at a package that is never published cannot be rewritten at all.
 */
export function checkDependencies(
  manifest: Record<string, any>,
  workspacePackages: Record<string, { private?: boolean; version?: string }> = {},
): CheckResult[] {
  const dependencies: Record<string, string> = manifest.dependencies ?? {};
  const workspaceDeps = Object.entries(dependencies).filter(([, range]) =>
    range.startsWith("workspace:"),
  );

  if (workspaceDeps.length === 0) {
    return [pass("deps:workspace", "no workspace: ranges in dependencies")];
  }

  const results: CheckResult[] = [
    pass(
      "deps:workspace",
      `workspace: ranges present (${workspaceDeps
        .map(([name]) => name)
        .join(", ")}) — publish with \`pnpm publish\` so they are rewritten to real versions`,
    ),
  ];

  const unpublishable = workspaceDeps
    .map(([name]) => name)
    .filter((name) => workspacePackages[name]?.private === true);

  results.push(
    unpublishable.length === 0
      ? pass("deps:resolvable", "every workspace dependency is publishable")
      : fail(
          "deps:resolvable",
          `${unpublishable.join(", ")} is marked private, so consumers cannot install it — ` +
            "publish it first, bundle it, or inline the code",
        ),
  );

  return results;
}

/** The smoke test must be runnable by whoever verifies the package. */
export function checkSmokeSupport(snapshot: PackageSnapshot): CheckResult[] {
  const scripts: Record<string, string> = snapshot.manifest.scripts ?? {};
  const results: CheckResult[] = [];

  results.push(
    typeof scripts.smoke === "string"
      ? pass("smoke:script", `smoke script: ${scripts.smoke}`)
      : fail("smoke:script", 'add a "smoke" script that drives the server end to end'),
  );

  results.push(
    snapshot.files.includes("scripts/smoke.ts")
      ? pass("smoke:driver", "scripts/smoke.ts is present")
      : fail("smoke:driver", "scripts/smoke.ts is missing"),
  );

  return results;
}

/** Run every pure check over a snapshot, in report order. */
export function runPackageChecks(snapshot: PackageSnapshot): CheckResult[] {
  return [
    ...checkManifest(snapshot.manifest),
    ...checkBinEntrypoint(snapshot),
    ...checkBuildOutput(snapshot),
    ...checkPackageContents(snapshot),
    ...checkSmokeSupport(snapshot),
  ];
}

/** True when any check failed. */
export function hasFailures(results: CheckResult[]): boolean {
  return results.some((r) => r.status === "fail");
}

/** Render a deterministic report. Same input always produces the same text. */
export function formatReport(results: CheckResult[]): string {
  const failures = results.filter((r) => r.status === "fail");
  const lines = results.map((r) => `${r.status === "pass" ? "✓" : "✗"} ${r.name} — ${r.detail}`);
  lines.push("");
  lines.push(
    failures.length === 0
      ? `All ${results.length} pre-publish checks passed.`
      : `${failures.length} of ${results.length} pre-publish checks failed:`,
  );
  for (const failure of failures) lines.push(`  - ${failure.name}: ${failure.detail}`);
  return lines.join("\n");
}
