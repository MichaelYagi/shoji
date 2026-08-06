/**
 * Discovers whatever sample media has been dropped into demo/assets/ at dev-server
 * time — no filename coordination needed between the demo pages and whatever gets
 * placed there. Empty until assets exist; every page degrades to "0 items" gracefully.
 */
const imageModules: Record<string, string> = import.meta.glob(
  './assets/*.{jpg,jpeg,png,webp,avif}',
  { eager: true, query: '?url', import: 'default' },
);

const videoModules: Record<string, string> = import.meta.glob('./assets/*.{mp4,webm,mov}', {
  eager: true,
  query: '?url',
  import: 'default',
});

export const images: string[] = Object.keys(imageModules)
  .sort()
  .map((key) => imageModules[key])
  .filter((src): src is string => Boolean(src));

const videoKeys = Object.keys(videoModules).sort();
export const video: string | undefined =
  videoKeys.length > 0 ? videoModules[videoKeys[0]!] : undefined;

export function guessMimeType(url: string): string {
  const clean = url.split(/[?#]/)[0] ?? url;
  const ext = clean.slice(clean.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'webm') return 'video/webm';
  if (ext === 'ogg' || ext === 'ogv') return 'video/ogg';
  return 'video/mp4';
}
