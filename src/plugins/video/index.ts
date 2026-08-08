import type { PluginContext, ShojiPlugin } from '../../core/plugin';
import { renderYouTube } from './youtube';

/**
 * DESIGN.md §4-video — renders `{ video: { provider: 'youtube', id } }`
 * items (produced by `scan.ts`'s `data-shoji-video` host detection, or
 * authored directly in dynamic mode) as a real YouTube embed instead of
 * `SlideManager`'s native-`<video>` fallback, which can't play a YouTube
 * URL at all. Purely a renderer: no options, no toolbar button, no poster/
 * thumbnail handling — the slide shows nothing until the embed itself is
 * ready, same as every other slide type. Autoplay (§4-autoplay) picks up
 * real play/pause/ended sync automatically; see `youtube.ts`'s
 * `wirePlayableContract`.
 */
export const Video: ShojiPlugin = {
  name: 'video',

  init(ctx: PluginContext): () => void {
    return ctx.ui.registerVideoProvider('youtube', renderYouTube);
  },
};
