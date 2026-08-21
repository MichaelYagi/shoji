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

function findPluginEntries() {
  const pluginsDir = join(root, 'src/plugins');
  if (!existsSync(pluginsDir)) return {};
  const entries = {};
  for (const dirent of readdirSync(pluginsDir, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const entry = join(pluginsDir, dirent.name, 'index.ts');
    if (existsSync(entry)) entries[`plugins/${dirent.name}/index`] = entry;
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
await buildEsm();
copyDocsRuntimeAssets();
stampDocsVersion();

console.log(
  [
    'Build complete:',
    '  dist/shoji.js, dist/shoji.min.js',
    '  dist/shoji.css, dist/shoji.min.css',
    '  dist/esm/** (+ .d.ts)',
    '  docs/dist/shoji.min.js, docs/dist/shoji.min.css (for docs/examples/)',
    '  docs/docs.js (DOCS_VERSION stamped)',
  ].join('\n'),
);
