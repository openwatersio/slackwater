import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = import.meta.dirname;

interface PackageJson {
  name: string;
  workspaces?: string[];
  exports?: Record<string, unknown>;
}

const rootPkg: PackageJson = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));

/**
 * Resolve aliases for all workspace packages to their `src/index.ts` entry
 * points. Optionally exclude the current package (to avoid self-aliasing).
 */
export function aliases(exclude?: string): Record<string, string> {
  const result: Record<string, string> = {};

  for (const workspace of rootPkg.workspaces ?? []) {
    const pkgPath = resolve(root, workspace, "package.json");
    const pkg: PackageJson = JSON.parse(readFileSync(pkgPath, "utf-8"));

    if (pkg.name === exclude) continue;

    // Subpath entries first: an alias also matches `name/…`, so the bare name
    // would otherwise turn `@slackwater/react/map` into `src/index.ts/map`.
    for (const subpath of Object.keys(pkg.exports ?? {})) {
      const source = resolve(root, workspace, `src/${subpath.slice(2)}.ts`);
      if (subpath.startsWith("./") && existsSync(source)) {
        result[`${pkg.name}/${subpath.slice(2)}`] = source;
      }
    }
    result[pkg.name] = resolve(root, workspace, "src/index.ts");
  }

  return result;
}
