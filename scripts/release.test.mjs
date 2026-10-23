import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));

function fixture(t, prerelease = false) {
  const cwd = mkdtempSync(join(tmpdir(), "slackwater-release-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const json = (path, value) => {
    writeFileSync(join(cwd, path), JSON.stringify(value));
  };
  mkdirSync(join(cwd, ".changeset"));
  json("package.json", {
    private: true,
    workspaces: ["packages/engine", "packages/cli"],
  });
  json("package-lock.json", { lockfileVersion: 3, packages: {} });
  json(".changeset/config.json", { changelog: false, baseBranch: "main" });
  if (prerelease) {
    json(".changeset/pre.json", { mode: "pre", tag: "beta", changesets: [] });
  }
  for (const name of ["engine", "cli"]) {
    mkdirSync(join(cwd, "packages", name), { recursive: true });
    json(`packages/${name}/package.json`, {
      name: `@release-test/${name}`,
      version: prerelease ? "1.0.0-beta.1" : "1.0.0",
    });
  }
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "Release test",
    GIT_AUTHOR_EMAIL: "release@example.com",
    GIT_COMMITTER_NAME: "Release test",
    GIT_COMMITTER_EMAIL: "release@example.com",
  };
  function run(command, args, extraEnv = {}) {
    return spawnSync(command, args, {
      cwd,
      env: { ...env, ...extraEnv },
      encoding: "utf8",
    });
  }
  for (const args of [
    ["init", "-b", "main"],
    ["add", "."],
    ["commit", "-m", "Fixture"],
  ]) {
    const result = run("git", args);
    assert.equal(result.status, 0, result.stderr);
  }
  symlinkSync(join(root, "node_modules"), join(cwd, "node_modules"), "dir");
  mkdirSync(join(cwd, "bin"));
  writeFileSync(
    join(cwd, "bin", "npm"),
    `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
fs.appendFileSync("npm-calls.jsonl", JSON.stringify(args) + "\\n");
if (args[0] === "view") process.exit(args[1].startsWith(process.env.ALREADY_PUBLISHED || "never/") ? 0 : 1);
if (args[0] !== "publish") process.exit(99);
process.exit(args[args.indexOf("-w") + 1] === process.env.FAIL_PACKAGE ? 1 : 0);
`,
    { mode: 0o755 },
  );
  return {
    cwd,
    run,
    publish(extraEnv = {}) {
      return run("bash", [join(root, "scripts/release.sh")], {
        PATH: [join(cwd, "bin"), join(root, "node_modules/.bin"), env.PATH].join(delimiter),
        CHANGESETS_OUTPUT: join(cwd, "output.ndjson"),
        ...extraEnv,
      });
    },
    events: () =>
      readFileSync(join(cwd, "output.ndjson"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse),
    calls: () =>
      readFileSync(join(cwd, "npm-calls.jsonl"), "utf8").trim().split("\n").map(JSON.parse),
  };
}

for (const prerelease of [false, true]) {
  test(`publishes in workspace order with ${prerelease ? "beta" : "latest"} tags and action release events`, (t) => {
    const f = fixture(t, prerelease);
    const result = f.publish();
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const version = prerelease ? "1.0.0-beta.1" : "1.0.0";
    assert.deepEqual(f.events(), [
      { type: "git-tag", tag: `@release-test/cli@${version}`, packageName: "@release-test/cli" },
      {
        type: "git-tag",
        tag: `@release-test/engine@${version}`,
        packageName: "@release-test/engine",
      },
    ]);
    assert.deepEqual(f.calls(), [
      ["view", `@release-test/engine@${version}`, "version"],
      [
        "publish",
        "--provenance",
        "-w",
        "@release-test/engine",
        "--access",
        "public",
        "--tag",
        prerelease ? "beta" : "latest",
      ],
      ["view", `@release-test/cli@${version}`, "version"],
      [
        "publish",
        "--provenance",
        "-w",
        "@release-test/cli",
        "--access",
        "public",
        "--tag",
        prerelease ? "beta" : "latest",
      ],
    ]);
    assert.equal(f.run("git", ["tag", "--list"]).stdout.trim().split("\n").length, 2);
  });
}

test("skips a package already on npm", (t) => {
  const f = fixture(t);
  const result = f.publish({ ALREADY_PUBLISHED: "@release-test/engine" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(
    f.calls().filter(([command]) => command === "publish"),
    [
      [
        "publish",
        "--provenance",
        "-w",
        "@release-test/cli",
        "--access",
        "public",
        "--tag",
        "latest",
      ],
    ],
  );
});

test("does not report existing git tags as new releases on a retry", (t) => {
  const f = fixture(t);
  const first = f.publish();
  assert.equal(first.status, 0, first.stdout + first.stderr);
  const retry = f.publish({
    ALREADY_PUBLISHED: "@release-test/",
    CHANGESETS_OUTPUT: join(f.cwd, "retry.ndjson"),
  });
  assert.equal(retry.status, 0, retry.stdout + retry.stderr);
  assert.equal(readFileSync(join(f.cwd, "retry.ndjson"), "utf8"), "");
});

test("stops publishing when a package fails", (t) => {
  const f = fixture(t);
  const result = f.publish({ FAIL_PACKAGE: "@release-test/engine" });
  assert.notEqual(result.status, 0);
  assert.deepEqual(
    f.calls().map((args) => args[args[0] === "view" ? 1 : 3]),
    ["@release-test/engine@1.0.0", "@release-test/engine"],
  );
});

test("versions pending prereleases once and refreshes the lockfile", (t) => {
  const f = fixture(t, true);
  const json = (path) => JSON.parse(readFileSync(join(f.cwd, path), "utf8"));
  const manifest = json("package.json");
  manifest.scripts = {
    version: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.version,
  };
  writeFileSync(join(f.cwd, "package.json"), JSON.stringify(manifest));
  writeFileSync(
    join(f.cwd, ".changeset/pre.json"),
    JSON.stringify({
      mode: "pre",
      tag: "beta",
      changesets: ["released"],
      initialVersions: {
        "@release-test/engine": "1.0.0-beta.0",
        "@release-test/cli": "1.0.0-beta.0",
      },
    }),
  );
  writeFileSync(
    join(f.cwd, ".changeset/released.md"),
    '---\n"@release-test/engine": patch\n---\nAlready released.\n',
  );
  writeFileSync(
    join(f.cwd, ".changeset/pending.md"),
    '---\n"@release-test/cli": patch\n---\nNext release.\n',
  );
  const migration = f.run(process.execPath, [
    join(root, "node_modules/@changesets/cli/bin.js"),
    "status",
  ]);
  assert.equal(migration.status, 0, migration.stdout + migration.stderr);
  const result = f.run("npm", ["run", "version"], {
    PATH: [join(root, "node_modules/.bin"), process.env.PATH].join(delimiter),
    npm_config_offline: "true",
    npm_config_audit: "false",
    npm_config_fund: "false",
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(json("packages/engine/package.json").version, "1.0.0-beta.1");
  assert.equal(json("packages/cli/package.json").version, "1.0.0-beta.2");
  assert.equal(json("package-lock.json").packages["packages/cli"].version, "1.0.0-beta.2");
  assert.ok(existsSync(join(f.cwd, ".changeset/pre/released.md")));
  assert.ok(existsSync(join(f.cwd, ".changeset/pre/pending.md")));
  assert.equal(existsSync(join(f.cwd, ".changeset/pending.md")), false);
});
