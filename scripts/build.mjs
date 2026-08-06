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
import { existsSync, readdirSync, rmSync } from 'node:fs';
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

await buildSingleFile(false);
await buildSingleFile(true);
await buildEsm();

console.log(
  [
    'Build complete:',
    '  dist/shoji.js, dist/shoji.min.js',
    '  dist/shoji.css, dist/shoji.min.css',
    '  dist/esm/** (+ .d.ts)',
  ].join('\n'),
);
