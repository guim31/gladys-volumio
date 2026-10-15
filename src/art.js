// -----------------------------------------------------------------------------
// Album art for the widget. The core never fetches a third-party URL: the
// content names an image key, the core asks onWidgetGetImage for its bytes
// and refuses anything over 300 KB or 4096 px, or not PNG / JPEG / WebP. There
// is no image library in the container (memory, image size): a cover that
// does not fit as Volumio serves it is simply not shown.
//
// The key derives from the URL (the core caches an image one hour by key),
// and each URL is checked once: the widget only names a key whose bytes
// passed the core's own checks (validateWidgetImage).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { validateWidgetImage } from '@gladysassistant/integration-sdk';

export const MAX_ART_BYTES = 300 * 1024;
const MAX_ENTRIES = 30;
// A cover that failed (not reachable, too big) is tried again after this.
const RETRY_MS = 10 * 60_000;

export class ArtCache {
  /** @param {{ now?: () => number }} [options] */
  constructor({ now } = {}) {
    this.now = now ?? (() => Date.now());
    /** @type {Map<string, { base64: string|null, at: number }>} by image key */
    this.entries = new Map();
  }

  static keyOf(url) {
    return `art-${createHash('sha1').update(url).digest('hex').slice(0, 24)}`;
  }

  /**
   * The image key of a player's current cover, null when there is none to show.
   * @param {object} client VolumioClient of the player
   * @param {string} albumart the `albumart` of its state
   */
  async resolve(client, albumart) {
    const url = client.artUrl(albumart);
    if (!url) {
      return null;
    }
    const key = ArtCache.keyOf(url);
    const known = this.entries.get(key);
    if (known && (known.base64 !== null || this.now() - known.at < RETRY_MS)) {
      return known.base64 === null ? null : key;
    }
    let base64;
    try {
      const bytes = await client.download(url, { maxBytes: MAX_ART_BYTES });
      const candidate = bytes.toString('base64');
      base64 = validateWidgetImage(candidate).length === 0 ? candidate : null;
    } catch {
      base64 = null;
    }
    this.entries.delete(key);
    this.entries.set(key, { base64, at: this.now() });
    while (this.entries.size > MAX_ENTRIES) {
      this.entries.delete(this.entries.keys().next().value);
    }
    return base64 === null ? null : key;
  }

  /** The raw base64 of a key handed out by resolve(); throws when unknown. */
  get(key) {
    const entry = this.entries.get(key);
    if (!entry?.base64) {
      throw new Error(`Unknown image ${key}`);
    }
    return entry.base64;
  }
}
