// -----------------------------------------------------------------------------
// Client of the Volumio REST API (`http://<host>:3000/api/v1/...`), the one
// the Volumio web interface and Home Assistant (pyvolumio) use. No account,
// no token: the API is open on the local network.
//
// Volumio answers HTTP 200 even when a command fails, with `{ "Error": ... }`
// or `{ "error": ... }` in the body: both are turned into a REFUSED error.
// -----------------------------------------------------------------------------

import { ArtworkError, readLimited } from '../artwork-resize.js';

export const ERROR_KINDS = Object.freeze({
  UNREACHABLE: 'unreachable', // no answer: address, network, player off
  HTTP: 'http', // an HTTP status other than 200
  REFUSED: 'refused', // Volumio answered with an error in the body
  INVALID: 'invalid', // not the JSON expected (not a Volumio?)
});

export class VolumioError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'VolumioError';
    this.kind = kind;
  }
}

export const REQUEST_TIMEOUT_MS = 5000;
// What a command may take: replaceAndPlay resolves a web radio first.
export const COMMAND_TIMEOUT_MS = 10_000;

export class VolumioClient {
  /**
   * @param {object} options
   * @param {string} options.host `host:port`
   * @param {typeof fetch} [options.fetch] HTTP seam (tests)
   */
  constructor({ host, fetch: fetchImpl }) {
    this.host = host;
    this.fetch = fetchImpl ?? globalThis.fetch;
  }

  get baseUrl() {
    return `http://${this.host}`;
  }

  /**
   * One request; resolves with the parsed JSON (or the text when `raw`).
   * @param {string} path from the API root, e.g. `getState`
   */
  async request(path, { method = 'GET', query, body, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    const url = new URL(`/api/v1/${path}`, this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }
    let response;
    try {
      response = await this.fetch(url.href, {
        method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'no answer' : (err?.cause?.code ?? err.message);
      throw new VolumioError(ERROR_KINDS.UNREACHABLE, `${this.host}: ${reason}`);
    }
    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new VolumioError(ERROR_KINDS.UNREACHABLE, `${this.host}: ${err.message}`);
    }
    if (response.status !== 200) {
      throw new VolumioError(ERROR_KINDS.HTTP, `${this.host}: HTTP ${response.status} on ${path}`);
    }
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new VolumioError(ERROR_KINDS.INVALID, `${this.host}: ${path} did not answer JSON`);
    }
    const error =
      data && typeof data === 'object' && !Array.isArray(data) && (data.Error ?? data.error);
    if (error) {
      const detail = typeof error === 'string' ? error : JSON.stringify(error);
      throw new VolumioError(ERROR_KINDS.REFUSED, `${this.host}: ${detail.slice(0, 120)}`);
    }
    return data;
  }

  /** Identity: `{ id, name, hardware, systemversion, ... }`. */
  getSystemInfo() {
    return this.request('getSystemInfo');
  }

  getState() {
    return this.request('getState');
  }

  /** The play queue, `[]` when empty. */
  async getQueue() {
    const data = await this.request('getQueue');
    return Array.isArray(data?.queue) ? data.queue : [];
  }

  /** The names of the Volumio playlists. */
  async listPlaylists() {
    const data = await this.request('listplaylists');
    return Array.isArray(data) ? data.filter((name) => typeof name === 'string' && name) : [];
  }

  /**
   * One level of the Volumio library (`radio/favourites`, `albums://`...):
   * its `navigation`; the root (sources) without `uri`.
   *
   * Volumio decodes the `uri` (and the search `query`) once more after the
   * HTTP layer did (`decodeURIComponent` in its REST plugin): it is encoded
   * twice, so the plugin receives the URI exactly as listed, the way the web
   * interface sends it over socket.io (`artists://Gamma%20%26%20Co`, a path
   * with a `%`).
   */
  async browse(uri) {
    const data = await this.request('browse', {
      query: uri ? { uri: encodeURIComponent(uri) } : {},
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    return data?.navigation ?? { lists: [] };
  }

  /** Search every source of the player: `navigation.lists`, one per kind and source. */
  async search(query) {
    const data = await this.request('search', {
      query: { query: encodeURIComponent(query) },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
    return data?.navigation ?? { lists: [] };
  }

  /** The other Volumio players this one knows on the network (its "zones"). */
  async getZones() {
    const data = await this.request('getzones');
    return Array.isArray(data?.zones) ? data.zones : [];
  }

  /**
   * A playback command: `play`, `pause`, `stop`, `prev`, `next`, `volume`,
   * `random`, `repeat`, `playplaylist`, `clearQueue`, `seek`...
   */
  command(cmd, params = {}) {
    return this.request('commands/', {
      query: { cmd, ...params },
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }

  /** Empty the queue, add these items and play (`{ item }`, `{ list, index }` or one item). */
  replaceAndPlay(payload) {
    return this.request('replaceAndPlay', {
      method: 'POST',
      body: payload,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }

  /** Add items at the end of the queue, without playing them. */
  addToQueue(items) {
    return this.request('addToQueue', {
      method: 'POST',
      body: items,
      timeoutMs: COMMAND_TIMEOUT_MS,
    });
  }

  /** The absolute URL of an album art path (`/albumart?...`), as the Volumio docs say. */
  artUrl(path) {
    if (typeof path !== 'string' || path === '') {
      return null;
    }
    if (/^https?:\/\//i.test(path)) {
      return path;
    }
    try {
      return new URL(path, this.baseUrl).href;
    } catch {
      return null;
    }
  }

  /**
   * Download an image, refused past `maxBytes` (album art), read as a stream
   * so a huge answer never sits in memory.
   * @returns {Promise<Buffer>}
   */
  async download(url, { maxBytes, timeoutMs = REQUEST_TIMEOUT_MS }) {
    let response;
    try {
      response = await this.fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new VolumioError(
        ERROR_KINDS.UNREACHABLE,
        `album art: ${err?.cause?.code ?? err.message}`,
      );
    }
    if (response.status !== 200) {
      throw new VolumioError(ERROR_KINDS.HTTP, `album art: HTTP ${response.status}`);
    }
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await response.body?.cancel?.().catch(() => {});
      throw new VolumioError(ERROR_KINDS.INVALID, `album art: ${declared} bytes`);
    }
    try {
      return await readLimited(response.body, maxBytes);
    } catch (err) {
      throw new VolumioError(
        err instanceof ArtworkError ? ERROR_KINDS.INVALID : ERROR_KINDS.UNREACHABLE,
        `album art: ${err.message}`,
      );
    }
  }
}
