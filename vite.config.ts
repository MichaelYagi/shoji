import { defineConfig } from 'vite';

// Dev-only config: serves /demo against the live src/ tree. The production
// build (single-file bundle + tree-shakable ESM entries) is scripts/build.mjs,
// run via `npm run build` — Vite's own `build` mode is not used directly.
export default defineConfig({
  root: 'demo',
  server: {
    // This repo lives on a Windows-mounted path under WSL (/mnt/c/...), where
    // native filesystem events (inotify) don't reliably propagate through
    // DrvFs — Vite's default watcher silently misses edits and keeps serving
    // stale output. Polling is slower but actually detects changes here.
    watch: { usePolling: true, interval: 300 },
  },
});
