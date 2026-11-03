// Production build: bundles our TypeScript (apps/server + the @zhb/* workspace packages) into one
// ESM file. Third-party packages stay external and are installed from the generated dist/package.json,
// which keeps native/WASM packages and their licences intact and the bundle small.
import { build } from 'esbuild';
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const gamePkg = JSON.parse(
  readFileSync(join(root, '../../packages/game-engine/package.json'), 'utf8'),
);
const sharedPkg = JSON.parse(
  readFileSync(join(root, '../../packages/shared/package.json'), 'utf8'),
);

// Runtime third-party deps = everything the server and the packages it bundles declare, minus workspace packages.
const wanted = { ...sharedPkg.dependencies, ...gamePkg.dependencies, ...pkg.dependencies };
const externals = Object.keys(wanted).filter((n) => !n.startsWith('@zhb/') && n !== 'three');

rmSync(join(root, 'dist'), { recursive: true, force: true });
mkdirSync(join(root, 'dist'), { recursive: true });

await build({
  entryPoints: [join(root, 'src/index.ts')],
  outfile: join(root, 'dist/index.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  minify: false,
  external: externals,
  logLevel: 'info',
});

// Pin the exact installed versions so a deploy is reproducible.
// A hoisted copy of a package can be a *different version* than the one a workspace package
// declared (e.g. a stale rapier pulled in by @types/three). Pick the installed copy that satisfies
// the declared range, and fail the build rather than ship an untested version.
function satisfies(version, range) {
  const m = /^[\^~]?(\d+)\.(\d+)\.(\d+)/.exec(range);
  const v = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m || !v) return false;
  const [, rM, rm, rp] = m.map(Number);
  const [, vM, vm, vp] = v.map(Number);
  if (range.startsWith('~')) return vM === rM && vm === rm && vp >= rp;
  if (range.startsWith('^')) {
    if (rM > 0) return vM === rM && (vm > rm || (vm === rm && vp >= rp));
    return vM === 0 && vm === rm && vp >= rp; // ^0.x.y: minor is the breaking boundary
  }
  return version === range;
}
const deps = {};
const lookupDirs = [
  join(root, '../../packages/game-engine/node_modules'),
  join(root, '../../packages/shared/node_modules'),
  join(root, 'node_modules'),
  join(root, '../../node_modules'),
];
for (const name of externals) {
  let found = null;
  for (const d of lookupDirs) {
    const f = join(d, name, 'package.json');
    if (!existsSync(f)) continue;
    const version = JSON.parse(readFileSync(f, 'utf8')).version;
    if (satisfies(version, wanted[name])) {
      found = version;
      break;
    }
  }
  if (!found) throw new Error(`no installed copy of ${name} satisfies ${wanted[name]}`);
  deps[name] = found;
}
writeFileSync(
  join(root, 'dist/package.json'),
  JSON.stringify(
    {
      name: 'zhb-server-dist',
      private: true,
      type: 'module',
      engines: { node: '>=22.12.0' },
      scripts: { start: 'node index.js' },
      dependencies: deps,
    },
    null,
    2,
  ) + '\n',
);
console.log('runtime dependencies:', deps);
