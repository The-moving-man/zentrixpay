/**
 * Tests for the pre-publish checks.
 *
 * Two layers: synthetic snapshots exercise each rule in isolation (a check that
 * cannot fail is not a check), and one suite runs the manifest rules against
 * the package's real package.json so the shipped manifest stays publishable.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  binEntrypoints,
  checkBinEntrypoint,
  checkBuildOutput,
  checkDependencies,
  checkManifest,
  checkPackageContents,
  checkSmokeSupport,
  commandCheck,
  formatReport,
  hasFailures,
  runPackageChecks,
  type CheckResult,
  type PackageSnapshot,
} from "./prepublish.js";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const realManifest = JSON.parse(readFileSync(join(PACKAGE_DIR, "package.json"), "utf-8"));

const GOOD_MANIFEST = {
  name: "@zentrixpay/mcp",
  version: "1.0.0",
  description: "MCP server",
  license: "MIT",
  type: "module",
  main: "dist/index.js",
  bin: { "zentrixpay-mcp": "dist/index.js" },
  files: ["dist"],
  engines: { node: ">=20" },
  scripts: { smoke: "tsx scripts/smoke.ts" },
  dependencies: {},
};

function snapshot(overrides: Partial<PackageSnapshot> = {}): PackageSnapshot {
  return {
    manifest: GOOD_MANIFEST,
    files: ["dist/index.js", "dist/tools.js", "src/index.ts", "scripts/smoke.ts"],
    binSource: "#!/usr/bin/env node\nconsole.log('hi')",
    packedFiles: ["package.json", "dist/index.js", "dist/tools.js"],
    newestSourceMtime: 1_000,
    builtEntrypointMtime: 2_000,
    ...overrides,
  };
}

/** Look up one check by name. */
function result(results: CheckResult[], name: string): CheckResult {
  const found = results.find((r) => r.name === name);
  if (!found) throw new Error(`no check named ${name} in ${results.map((r) => r.name).join(", ")}`);
  return found;
}

describe("checkManifest", () => {
  it("passes a complete manifest", () => {
    expect(hasFailures(checkManifest(GOOD_MANIFEST))).toBe(false);
  });

  it.each([
    ["name", { name: "" }, "manifest:name"],
    ["version", { version: "1.0" }, "manifest:version"],
    ["private", { private: true }, "manifest:private"],
    ["description", { description: "" }, "manifest:description"],
    ["license", { license: undefined }, "manifest:license"],
    ["type", { type: "commonjs" }, "manifest:type"],
    ["main", { main: "src/index.ts" }, "manifest:main"],
    ["files", { files: undefined }, "manifest:files"],
    ["files without dist", { files: ["scripts"] }, "manifest:files"],
    ["engines", { engines: {} }, "manifest:engines"],
  ])("fails on a bad %s", (_label, override, checkName) => {
    const results = checkManifest({ ...GOOD_MANIFEST, ...override });
    expect(result(results, checkName).status).toBe("fail");
  });

  it("accepts a prerelease version", () => {
    const results = checkManifest({ ...GOOD_MANIFEST, version: "1.2.0-rc.1" });
    expect(result(results, "manifest:version").status).toBe("pass");
  });
});

describe("binEntrypoints", () => {
  it("reads the string and map forms", () => {
    expect(binEntrypoints({ bin: "dist/index.js" })).toEqual(["dist/index.js"]);
    expect(binEntrypoints({ bin: { a: "dist/a.js", b: "dist/b.js" } })).toEqual([
      "dist/a.js",
      "dist/b.js",
    ]);
    expect(binEntrypoints({})).toEqual([]);
  });
});

describe("checkBinEntrypoint", () => {
  it("passes a built, packed entrypoint with a shebang", () => {
    expect(hasFailures(checkBinEntrypoint(snapshot()))).toBe(false);
  });

  it("fails when no bin is declared", () => {
    const results = checkBinEntrypoint(
      snapshot({ manifest: { ...GOOD_MANIFEST, bin: undefined } }),
    );
    expect(result(results, "bin:declared").status).toBe("fail");
  });

  it("fails when bin points at TypeScript source", () => {
    const results = checkBinEntrypoint(
      snapshot({ manifest: { ...GOOD_MANIFEST, bin: { "zentrixpay-mcp": "src/index.ts" } } }),
    );
    expect(result(results, "bin:built").status).toBe("fail");
  });

  it("fails when the entrypoint has not been built", () => {
    const results = checkBinEntrypoint(snapshot({ files: ["src/index.ts"] }));
    expect(result(results, "bin:exists").status).toBe("fail");
    expect(result(results, "bin:exists").detail).toContain("pnpm build");
  });

  it("fails when the entrypoint is excluded from the tarball", () => {
    const results = checkBinEntrypoint(snapshot({ packedFiles: ["package.json"] }));
    expect(result(results, "bin:packed").status).toBe("fail");
  });

  it("fails when the shebang is missing", () => {
    const results = checkBinEntrypoint(snapshot({ binSource: "console.log('hi')" }));
    expect(result(results, "bin:shebang").status).toBe("fail");
  });

  it("normalizes a ./-prefixed bin path", () => {
    const results = checkBinEntrypoint(
      snapshot({ manifest: { ...GOOD_MANIFEST, bin: { "zentrixpay-mcp": "./dist/index.js" } } }),
    );
    expect(hasFailures(results)).toBe(false);
  });
});

describe("checkBuildOutput", () => {
  it("passes a fresh build", () => {
    expect(hasFailures(checkBuildOutput(snapshot()))).toBe(false);
  });

  it("fails when dist has no compiled output", () => {
    const results = checkBuildOutput(snapshot({ files: ["src/index.ts"] }));
    expect(result(results, "build:output").status).toBe("fail");
  });

  it("fails when dist is older than src", () => {
    const results = checkBuildOutput(
      snapshot({ newestSourceMtime: 5_000, builtEntrypointMtime: 1_000 }),
    );
    expect(result(results, "build:fresh").status).toBe("fail");
    expect(result(results, "build:fresh").detail).toContain("rebuild");
  });

  it("passes when the build and the newest source share a timestamp", () => {
    const results = checkBuildOutput(
      snapshot({ newestSourceMtime: 3_000, builtEntrypointMtime: 3_000 }),
    );
    expect(result(results, "build:fresh").status).toBe("pass");
  });

  it("fails when there is nothing to compare", () => {
    expect(
      result(checkBuildOutput(snapshot({ builtEntrypointMtime: null })), "build:fresh").status,
    ).toBe("fail");
    expect(
      result(checkBuildOutput(snapshot({ newestSourceMtime: null })), "build:fresh").status,
    ).toBe("fail");
  });
});

describe("checkPackageContents", () => {
  it("passes a tarball carrying only the runtime", () => {
    expect(hasFailures(checkPackageContents(snapshot()))).toBe(false);
  });

  it("fails on an empty file list", () => {
    const results = checkPackageContents(snapshot({ packedFiles: [] }));
    expect(result(results, "contents:listed").status).toBe("fail");
  });

  it("fails when dist is missing from the tarball", () => {
    const results = checkPackageContents(
      snapshot({ packedFiles: ["package.json", "src/index.ts"] }),
    );
    expect(result(results, "contents:runtime").status).toBe("fail");
  });

  it.each([
    ["src/index.ts", "contents:no-TypeScript-sources"],
    ["dist/validation.test.js", "contents:no-test-files"],
    ["dist/__snapshots__/x.snap", "contents:no-snapshots"],
    [".env", "contents:no-environment-files"],
    [".env.example", "contents:no-environment-files"],
    ["state.json", "contents:no-agent-state"],
    ["package-lock.json", "contents:no-lockfiles"],
  ])("rejects %s in the tarball", (path, checkName) => {
    const results = checkPackageContents(
      snapshot({ packedFiles: ["package.json", "dist/index.js", path] }),
    );
    expect(result(results, checkName).status).toBe("fail");
    expect(result(results, checkName).detail).toContain(path);
  });

  it("truncates a long offender list", () => {
    const offenders = Array.from({ length: 9 }, (_, i) => `src/f${i}.ts`);
    const results = checkPackageContents(
      snapshot({ packedFiles: ["package.json", "dist/index.js", ...offenders] }),
    );
    expect(result(results, "contents:no-TypeScript-sources").detail).toContain("+4 more");
  });
});

describe("checkDependencies", () => {
  it("passes when there are no workspace ranges", () => {
    expect(hasFailures(checkDependencies({ dependencies: { zod: "^3.0.0" } }))).toBe(false);
  });

  it("flags a workspace range pointing at a private package", () => {
    const results = checkDependencies(
      { dependencies: { "@zentrixpay/registry-client": "workspace:*" } },
      { "@zentrixpay/registry-client": { private: true } },
    );
    expect(result(results, "deps:resolvable").status).toBe("fail");
    expect(result(results, "deps:resolvable").detail).toContain("@zentrixpay/registry-client");
  });

  it("accepts a workspace range pointing at a publishable package", () => {
    const results = checkDependencies(
      { dependencies: { "@zentrixpay/registry-client": "workspace:*" } },
      { "@zentrixpay/registry-client": { private: false, version: "0.1.0" } },
    );
    expect(hasFailures(results)).toBe(false);
    expect(result(results, "deps:workspace").detail).toContain("pnpm publish");
  });
});

describe("checkSmokeSupport", () => {
  it("passes when the smoke script and driver exist", () => {
    expect(hasFailures(checkSmokeSupport(snapshot()))).toBe(false);
  });

  it("fails when the smoke script is missing", () => {
    const results = checkSmokeSupport(snapshot({ manifest: { ...GOOD_MANIFEST, scripts: {} } }));
    expect(result(results, "smoke:script").status).toBe("fail");
  });

  it("fails when the driver is missing", () => {
    const results = checkSmokeSupport(snapshot({ files: ["dist/index.js"] }));
    expect(result(results, "smoke:driver").status).toBe("fail");
  });
});

describe("report", () => {
  it("is deterministic and lists every failure", () => {
    const results = runPackageChecks(snapshot({ binSource: "no shebang" }));
    const report = formatReport(results);
    expect(report).toBe(formatReport(runPackageChecks(snapshot({ binSource: "no shebang" }))));
    expect(report).toContain("✗ bin:shebang");
    expect(report).toContain("pre-publish checks failed");
  });

  it("summarizes a clean run", () => {
    const report = formatReport(runPackageChecks(snapshot()));
    expect(report).toContain("pre-publish checks passed");
    expect(report).not.toContain("✗");
  });

  it("wraps command outcomes", () => {
    expect(commandCheck("tests", true, "144 passed").status).toBe("pass");
    expect(commandCheck("tests", false, "2 failed").status).toBe("fail");
  });
});

describe("the real package manifest", () => {
  it("passes every manifest check", () => {
    const results = checkManifest(realManifest);
    const failures = results.filter((r) => r.status === "fail");
    expect(failures.map((f) => `${f.name}: ${f.detail}`)).toEqual([]);
  });

  it("declares a bin entrypoint inside dist/", () => {
    const entrypoints = binEntrypoints(realManifest);
    expect(entrypoints.length).toBeGreaterThan(0);
    for (const entry of entrypoints) expect(entry).toMatch(/^\.?\/?dist\//);
  });

  it("exposes the prepublish check as a script", () => {
    expect(realManifest.scripts["prepublish:check"]).toContain("prepublish-check.ts");
  });
});
