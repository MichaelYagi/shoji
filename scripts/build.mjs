// Orchestrates the two build outputs CLAUDE.md requires from a single
// `npm run build`:
//   1. dist/shoji.(min.)js + dist/shoji.(min.)css — UMD, core + all plugins,
//      self-registering as the single global `Shoji`. This is the primary
//      release artifact.
//   2. dist/esm/** — tree-shakable per-plugin ESM entries + .d.ts, for
//      bundler users. Entries are discovered from src/plugins/*/index.ts so
//      new plugins pick up build support automatically.
import { build } from 'vite';
import dts from 'vite-plugin-dts';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const distDir = join(root, 'dist');

rmSync(distDir, { recursive: true, force: true });

/** Every `src/plugins/*` directory with a real `index.ts` — the one place both `findPluginEntries()` (ESM) and the standalone per-plugin UMD builds below discover the plugin roster from, so a new plugin picks up build support in both places automatically. */
function pluginDirNames() {
  const pluginsDir = join(root, 'src/plugins');
  if (!existsSync(pluginsDir)) return [];
  return readdirSync(pluginsDir, { withFileTypes: true })
    .filter(
      (dirent) => dirent.isDirectory() && existsSync(join(pluginsDir, dirent.name, 'index.ts')),
    )
    .map((dirent) => dirent.name);
}

function findPluginEntries() {
  const pluginsDir = join(root, 'src/plugins');
  const entries = {};
  for (const name of pluginDirNames()) {
    entries[`plugins/${name}/index`] = join(pluginsDir, name, 'index.ts');
  }
  return entries;
}

/** Single-file UMD bundle: core + all plugins, one JS + one CSS output. */
async function buildSingleFile(minify) {
  const cssName = minify ? 'shoji.min.css' : 'shoji.css';
  await build({
    root,
    configFile: false,
    build: {
      outDir: 'dist',
      emptyOutDir: false,
      cssCodeSplit: false,
      minify: minify ? 'esbuild' : false,
      cssMinify: minify,
      sourcemap: true,
      lib: {
        entry: resolve(root, 'src/index.ts'),
        name: 'Shoji',
        formats: ['umd'],
        fileName: () => (minify ? 'shoji.min.js' : 'shoji.js'),
      },
      rollupOptions: {
        // The default export *is* the constructor (`new Shoji(...)`), so the
        // UMD global must be that export directly, not a `{ default }` wrapper.
        output: {
          exports: 'default',
          // Vite's default CSS asset name doesn't vary with fileName(), so
          // the minified pass would silently overwrite the unminified one
          // (both land on "shoji.css") without pinning this explicitly.
          assetFileNames: () => cssName,
        },
      },
    },
  });
}

/**
 * `dist/core/shoji-core.(min.)js` + `.css` — Gallery alone, no plugin
 * statics attached, plus `dist/plugins/{name}.(min.)js` + `.css`, one per
 * official plugin below — a third distribution option alongside the
 * combined single-file bundle above and the tree-shakable ESM entries
 * below: a `<script>`-tag consumer who wants to pick exactly which
 * plugins ship, without adopting a bundler for it. Not real files under
 * `src/` (this build-only concern doesn't belong in the public source
 * tree) — see the `writeTmpEntry()` doc comment below for where each
 * entry actually lives instead.
 *
 * Each plugin build attaches itself onto the *already-loaded* `Shoji`
 * global via Rollup's dotted UMD `name` (`Shoji.Autoplay`) plus
 * `extend: true` — the same "one global" mechanism `src/index.ts`'s own
 * `Object.assign(Gallery, { Autoplay, ... })` uses for the combined
 * bundle, just attached one script tag at a time instead of all at once.
 * Load order matters: `shoji-core.js` must run before any plugin script,
 * same as `<script>` tag order always has to for any two scripts where
 * one extends what the other defines.
 *
 * Each entry is a tiny real file, not a virtual module — `build.lib.entry`
 * resolves its string as a file path itself, before Rollup's own plugin
 * pipeline (a virtual-module `resolveId`/`load` plugin, tried first and
 * genuinely working for `rollupOptions.input`, still failed here with
 * "Could not resolve entry module") ever gets a chance to intercept it.
 * Written into `dist/entries-tmp/` — already-gitignored (`dist/` as a
 * whole), and wiped by this same script's own `rmSync(distDir, ...)` at
 * the top on the *next* run even if this run's own cleanup, below, never
 * gets to — then deleted for real once every build below has read it.
 */
const tmpEntriesDir = join(distDir, 'entries-tmp');

function writeTmpEntry(fileName, code) {
  mkdirSync(tmpEntriesDir, { recursive: true });
  const path = join(tmpEntriesDir, fileName);
  writeFileSync(path, code, 'utf-8');
  return path;
}

async function buildCoreStandalone(minify) {
  const cssName = minify ? 'shoji-core.min.css' : 'shoji-core.css';
  const entry = writeTmpEntry(
    'shoji-core-standalone.ts',
    `export { Gallery as default } from ${JSON.stringify(resolve(root, 'src/core'))};\n` +
      `import ${JSON.stringify(resolve(root, 'src/styles/shoji.css'))};\n`,
  );
  await build({
    root,
    configFile: false,
    build: {
      outDir: 'dist/core',
      emptyOutDir: false,
      cssCodeSplit: false,
      minify: minify ? 'esbuild' : false,
      cssMinify: minify,
      sourcemap: true,
      lib: {
        entry,
        name: 'Shoji',
        formats: ['umd'],
        fileName: () => (minify ? 'shoji-core.min.js' : 'shoji-core.js'),
      },
      rollupOptions: {
        output: {
          exports: 'default',
          extend: true,
          assetFileNames: () => cssName,
        },
      },
    },
  });
}

/**
 * `dirName` → exported class name is a mechanical capitalize-first-letter
 * transform (`autoplay` → `Autoplay`, `rotateFlip` → `RotateFlip`,
 * `activeThumbnail` → `ActiveThumbnail`) — true for all seven official
 * plugins today, matching `src/index.ts`'s own import names exactly. Not
 * hardcoded as a lookup table, same "new plugins pick up build support
 * automatically" reasoning `findPluginEntries()` below already has;
 * revisit only if a future plugin's folder name genuinely doesn't follow
 * this convention.
 */
function pluginClassName(dirName) {
  return dirName.charAt(0).toUpperCase() + dirName.slice(1);
}

async function buildPluginStandalone(dirName, minify) {
  const className = pluginClassName(dirName);
  const cssName = minify ? `${dirName}.min.css` : `${dirName}.css`;
  const importPath = resolve(root, `src/plugins/${dirName}/index.ts`);
  const entry = writeTmpEntry(
    `plugin-standalone-${dirName}.ts`,
    `export { ${className} as default } from ${JSON.stringify(importPath)};\n`,
  );
  await build({
    root,
    configFile: false,
    build: {
      outDir: 'dist/plugins',
      emptyOutDir: false,
      cssCodeSplit: false,
      minify: minify ? 'esbuild' : false,
      cssMinify: minify,
      sourcemap: true,
      lib: {
        entry,
        name: `Shoji.${className}`,
        formats: ['umd'],
        fileName: () => (minify ? `${dirName}.min.js` : `${dirName}.js`),
      },
      rollupOptions: {
        output: {
          exports: 'default',
          extend: true,
          assetFileNames: () => cssName,
        },
      },
    },
  });
}

/** Tree-shakable ESM entries (core + index + one per plugin) with .d.ts. */
async function buildEsm() {
  const entries = {
    index: resolve(root, 'src/index.ts'),
    // Keyed "core/index" (not "core") so the emitted .js sits next to the
    // .d.ts vite-plugin-dts mirrors from src/core/index.ts — both entries
    // must resolve to the same relative path for the package.json "exports"
    // types/import pair to line up.
    'core/index': resolve(root, 'src/core/index.ts'),
    ...findPluginEntries(),
  };

  await build({
    root,
    configFile: false,
    plugins: [dts({ outDir: 'dist/esm', entryRoot: 'src', include: ['src'] })],
    build: {
      outDir: 'dist/esm',
      emptyOutDir: false,
      cssCodeSplit: true,
      minify: false,
      sourcemap: true,
      lib: {
        entry: entries,
        formats: ['es'],
      },
    },
  });
}

/**
 * `docs/examples/*.html` load the built single-file bundle directly
 * (`../dist/shoji.min.js`/`.css`, "same as a real <script> tag integration
 * would") — mirrored here into docs/dist/ (gitignored, same as dist/
 * itself, via the generic `dist/` pattern) rather than having the examples
 * reach up to the repo-root dist/ two levels away. That reach-up path only
 * ever worked for a *local* checkout; once docs/ gets published as a
 * standalone site (CI's publish-docs job, .github/workflows/ci.yml), the
 * examples move one level shallower relative to their own assets than they
 * are relative to the repo root, and a fixed "../../" stops landing in the
 * right place. Copying the bundle to live *inside* docs/ instead means the
 * exact same relative path is correct in both places, since docs/ (dist/
 * subfolder included) is published as a self-contained unit either way.
 */
function stampDocsVersion() {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
  const docsJsPath = join(root, 'docs/docs.js');
  const updated = readFileSync(docsJsPath, 'utf-8').replace(
    /^const DOCS_VERSION = '.*?';/m,
    `const DOCS_VERSION = 'v${version}';`,
  );
  writeFileSync(docsJsPath, updated, 'utf-8');
}

function copyDocsRuntimeAssets() {
  const docsDist = join(root, 'docs/dist');
  mkdirSync(docsDist, { recursive: true });
  for (const file of ['shoji.min.js', 'shoji.min.css']) {
    copyFileSync(join(distDir, file), join(docsDist, file));
  }
}

await buildSingleFile(false);
await buildSingleFile(true);
await buildCoreStandalone(false);
await buildCoreStandalone(true);
for (const dirName of pluginDirNames()) {
  await buildPluginStandalone(dirName, false);
  await buildPluginStandalone(dirName, true);
}
rmSync(tmpEntriesDir, { recursive: true, force: true });
await buildEsm();
copyDocsRuntimeAssets();
stampDocsVersion();

console.log(
  [
    'Build complete:',
    '  dist/shoji.js, dist/shoji.min.js',
    '  dist/shoji.css, dist/shoji.min.css',
    '  dist/core/shoji-core.(min.)js + .css',
    '  dist/plugins/{name}.(min.)js + .css',
    '  dist/esm/** (+ .d.ts)',
    '  docs/dist/shoji.min.js, docs/dist/shoji.min.css (for docs/examples/)',
    '  docs/docs.js (DOCS_VERSION stamped)',
  ].join('\n'),
);
