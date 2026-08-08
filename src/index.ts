import { Gallery } from './core';
import { ActiveThumbnail } from './plugins/activeThumbnail';
import { Autoplay } from './plugins/autoplay';
import { Fullscreen } from './plugins/fullscreen';
import { Layout } from './plugins/layout';
import { RotateFlip } from './plugins/rotateFlip';
import { Video } from './plugins/video';
import { Zoom } from './plugins/zoom';
import { version } from '../package.json';

import './styles/shoji.css';

export type {
  GalleryItem,
  GalleryOptions,
  GalleryEvents,
  MediaSource,
  VideoDescriptor,
  Unsubscribe,
} from './core';
export type { ShojiPlugin, PluginContext, VideoProviderRenderer } from './core/plugin';

/**
 * `new Shoji(el, options)` — the UMD global (CLAUDE.md: "UMD build exposes
 * exactly one global"). The default export *is* the constructor, not a
 * namespace object, so `<script src="shoji.js">` usage matches the default
 * import used by bundler/ESM consumers. Headless/tree-shaking consumers who
 * want the class as a named import can pull it from the `shoji/core`
 * subpath instead.
 *
 * Official plugins are attached as static properties (`Shoji.Autoplay`) so
 * the single-file build stays "one global" (CLAUDE.md) while still shipping
 * every official plugin's code — self-registering, no extra <script> tags —
 * per CLAUDE.md's single-file distribution requirement. A host opts a
 * gallery into one with `new Shoji(el, { plugins: [Shoji.Autoplay] })`.
 * Bundler users who only want to pull in specific plugins' code (tree-shaking
 * this static attachment away) should import from the `shoji/plugins/*`
 * subpath instead of this default export.
 */
const Shoji = Object.assign(Gallery, {
  Autoplay,
  Layout,
  ActiveThumbnail,
  Fullscreen,
  RotateFlip,
  Video,
  Zoom,
  /** `package.json`'s own version — the single source of truth, read via a named JSON import so a bundler can tree-shake away everything else in package.json (devDependencies, scripts, ...) rather than embedding the whole file. */
  version,
});

export default Shoji;
