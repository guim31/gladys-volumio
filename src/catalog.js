// -----------------------------------------------------------------------------
// The Gladys 5.3 music panel and the `music.play-media` scene action
// (manifest `music`: browse, search, queue, append): the library of a Volumio
// player as MediaItems, what plays them, and the bytes of the artworks.
//
// Checked against a real Volumio 2 (REST and socket.io) and the Volumio 3
// sources (volumio3-backend: rest_api, musiclibrary, playqueue):
//   - `browse` without `uri` lists the sources ("Music Library", "Artists",
//     "Albums", "Playlists", "Web Radio", the plugins...) directly in
//     `navigation.lists`; any other level in `navigation.lists[].items`,
//     several lists per level (an artist: its albums, then its tracks). The
//     whole level comes back at once: the integration cuts the page.
//   - `search` answers every source at once, one list per kind and source
//     (tracks, artists, albums of the library, web radios...).
//   - An item is played by its `service` (the plugin) and `uri`. A web radio
//     also needs its title (and artwork) for the queue; a Volumio playlist
//     (`playlists/<name>`) is played by its name, and `addToQueue` ignores it
//     (nothing added, "success"): its tracks are added instead.
//   - `replaceAndPlay` empties the queue first and answers "success" even for
//     an URI that no longer exists (the queue then stays empty): checked after.
//   - There is no "play next" in the REST API (`playNext` over socket.io
//     exists only on recent Volumio 3): the items are added at the end, then
//     moved after the current track with `moveQueue` (socket.io, Volumio 2
//     and 3), and the result is checked.
//
// MediaItem ids: `JSON.stringify([service, uri])`, plus the title and the
// artwork of a web radio or a playlist (what Volumio needs to play them).
// They are what a scene keeps: they must stay stable, and a library URI is
// (albums://Artist/Album, music-library/<path>). An id over 512 characters
// is replaced by a hash, remembered in memory (scenes made of such an item
// need the integration not to restart: documented).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { MUSIC_MEDIA_TYPES, createLogger } from '@gladysassistant/integration-sdk';
import { ArtworkError, MAX_ARTWORK_DOWNLOAD, prepareArtwork } from './artwork-resize.js';
import { ACTION_TEXT, pick } from './texts.js';
import { parseState } from './volumio/model.js';

const logger = createLogger({ name: 'volumio-music' });

export const MAX_ID_LENGTH = 512;
// What a playlist adds at most (a Volumio playlist is a plain list of tracks).
export const MAX_ADDED = 500;
// The queue is checked this long after an addition (Volumio explodes an
// album or an artist before answering, a playlist after).
export const QUEUE_CHECK = { tries: 10, intervalMs: 300 };
// Artworks already made small enough, by key (the core caches one hour).
const PREPARED_ARTWORKS = 40;
const ARTWORK_TIMEOUT_MS = 8000;
const HASHED_IDS = 5000;

const T = MUSIC_MEDIA_TYPES;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** An error shown as is in the music panel or the scene log. */
const userError = (hub, text, ...args) => {
  const message = pick(text, hub.language);
  return new Error(typeof message === 'function' ? message(...args) : message);
};

// --- Ids ---------------------------------------------------------------------

/** Long ids by their hash (see the header). */
const hashedIds = new Map();

/**
 * The MediaItem id of a Volumio item.
 * @param {{ service: string, uri: string, title?: string, albumart?: string }} item
 * @param {boolean} [named] keep the title and the artwork (radio, playlist)
 */
export function mediaId({ service, uri, title, albumart }, named = false) {
  const candidates = named
    ? [
        [service, uri, title ?? '', albumart ?? ''],
        [service, uri, title ?? ''],
      ]
    : [];
  candidates.push([service, uri]);
  for (const candidate of candidates) {
    const id = JSON.stringify(candidate);
    if (id.length <= MAX_ID_LENGTH) {
      return id;
    }
  }
  const id = `h:${createHash('sha1').update(JSON.stringify(candidates[0])).digest('hex')}`;
  hashedIds.delete(id);
  hashedIds.set(id, candidates[0]);
  while (hashedIds.size > HASHED_IDS) {
    hashedIds.delete(hashedIds.keys().next().value);
  }
  return id;
}

/** The Volumio item of a MediaItem id, null when it is not one of ours. */
export function parseId(id) {
  if (typeof id !== 'string') {
    return null;
  }
  let value = hashedIds.get(id) ?? null;
  if (!value) {
    try {
      value = JSON.parse(id);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(value) || value.length < 2) {
    return null;
  }
  const [service, uri, title, albumart] = value;
  if (typeof service !== 'string' || typeof uri !== 'string' || !uri) {
    return null;
  }
  return {
    service,
    uri,
    title: typeof title === 'string' ? title : '',
    albumart: typeof albumart === 'string' ? albumart : '',
  };
}

// --- MediaItems ----------------------------------------------------------------

/** A Volumio playlist of the library: played by its name. */
const playlistName = (item) =>
  item.service === 'mpd' && item.uri.startsWith('playlists/') && !item.uri.includes('://')
    ? item.uri.slice('playlists/'.length)
    : null;

const baseName = (uri) => {
  const parts = String(uri ?? '')
    .split('/')
    .filter(Boolean);
  try {
    return decodeURIComponent(parts.at(-1) ?? '');
  } catch {
    return parts.at(-1) ?? '';
  }
};

/**
 * What a Volumio item is for the panel. Volumio names albums and artists
 * `folder` too: the URI tells them apart (`albums://A/B`, `artists://A`,
 * `artists://A/B` an album of an artist, `spotify:album:…` for a plugin).
 * @returns {{ type: string, browsable: boolean, playable: boolean }}
 */
export function kindOf(raw) {
  const type = String(raw?.type ?? '').toLowerCase();
  const uri = String(raw?.uri ?? '');
  const is = (kind, browsable, playable) => ({ type: kind, browsable, playable });
  if (['song', 'track', 'cuesong'].includes(type)) {
    return is(T.TRACK, false, true);
  }
  if (type === 'webradio' || type === 'mywebradio') {
    return is(T.RADIO, false, true);
  }
  if (type === 'playlist' || playlistName({ service: raw?.service, uri })) {
    return is(T.PLAYLIST, true, true);
  }
  const library = /^(albums|artists|genres):\/\/(.*)$/.exec(uri);
  if (library) {
    const depth = library[2].split('/').filter(Boolean).length;
    if (library[1] === 'artists' && depth === 1) {
      return is(T.ARTIST, true, true);
    }
    if (library[1] === 'genres' && depth === 1) {
      return is(T.FOLDER, true, false);
    }
    return depth === 0 ? is(T.FOLDER, true, false) : is(T.ALBUM, true, true);
  }
  // Plugins (Spotify, Tidal, Qobuz...): their own types (a "category" is a
  // folder) and URIs (`spotify:album:…`).
  if (/categor/.test(type)) {
    return is(T.FOLDER, true, false);
  }
  if (/\b(song|track)\b/.test(type) || /:track:/.test(uri)) {
    return is(T.TRACK, false, true);
  }
  if (/playlist/.test(type) || /:playlist:/.test(uri)) {
    return is(T.PLAYLIST, true, true);
  }
  if (/album/.test(type) || /:album:/.test(uri)) {
    return is(T.ALBUM, true, true);
  }
  if (/artist/.test(type) || /:artist:/.test(uri)) {
    return is(T.ARTIST, true, true);
  }
  return is(T.FOLDER, true, false);
}

const text = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * One MediaItem. A row without URI stays (neutral: neither browsable nor
 * playable): a dropped row would shift every page after it.
 * @param {object} hub
 * @param {object} record the player
 * @param {object} raw a Volumio item (browse, search, queue, a source)
 * @param {string} fallbackId when the row has no URI
 */
export function toMediaItem(hub, record, raw, fallbackId) {
  const uri = text(raw?.uri);
  const service = text(raw?.service) || text(raw?.plugin_name) || 'mpd';
  const title =
    text(raw?.title) ||
    text(raw?.name) ||
    text(raw?.album) ||
    text(raw?.artist) ||
    baseName(uri) ||
    '—';
  if (!uri) {
    return {
      id: fallbackId,
      type: T.FOLDER,
      title,
      subtitle: '',
      duration: null,
      browsable: false,
      playable: false,
    };
  }
  const kind = kindOf(raw);
  const named = kind.type === T.RADIO || kind.type === T.PLAYLIST;
  const item = {
    id: mediaId({ service, uri, title, albumart: text(raw?.albumart) }, named),
    type: kind.type,
    title,
    subtitle: subtitleOf(raw, kind.type, title),
    duration:
      kind.type === T.TRACK && Number(raw?.duration) > 0 ? Math.round(Number(raw.duration)) : null,
    browsable: kind.browsable,
    playable: kind.playable,
  };
  const art = record.client.artUrl(text(raw?.albumart));
  if (art) {
    item.artwork_key = hub.gladys.artworkKey(art);
  }
  return item;
}

function subtitleOf(raw, type, title) {
  const artist = text(raw?.artist);
  const album = text(raw?.album);
  if (type === T.TRACK) {
    return [artist, album].filter(Boolean).join(' · ');
  }
  if (type === T.ALBUM || type === T.RADIO) {
    return artist && artist !== '*' && artist !== title ? artist : '';
  }
  return '';
}

/** The rows of a browse level, in order (several lists per level). */
export function rowsOf(navigation, { root = false } = {}) {
  const rows = [];
  for (const list of Array.isArray(navigation?.lists) ? navigation.lists : []) {
    if (Array.isArray(list?.items)) {
      rows.push(...list.items.filter((item) => item && typeof item === 'object'));
    } else if (root && list && typeof list === 'object') {
      // The root: the sources themselves (`name`, `uri`, `plugin_name`).
      rows.push({ ...list, type: 'folder', service: list.plugin_name || 'mpd' });
    }
  }
  return rows;
}

/** Search results: one list per kind and source, taken in turn. */
export function mixResults(navigation, limit, type) {
  const lists = (Array.isArray(navigation?.lists) ? navigation.lists : [])
    .map((list) => (Array.isArray(list?.items) ? list.items.filter((item) => item?.uri) : []))
    .map((items) => (type ? items.filter((item) => kindOf(item).type === type) : items))
    .filter((items) => items.length);
  const mixed = [];
  const seen = new Set();
  for (let i = 0; mixed.length < limit && lists.some((items) => i < items.length); i += 1) {
    for (const items of lists) {
      const item = items[i];
      const key = item && `${item.service}\n${item.uri}`;
      if (item && !seen.has(key) && mixed.length < limit) {
        seen.add(key);
        mixed.push(item);
      }
    }
  }
  return mixed;
}

// --- Handlers ------------------------------------------------------------------

/** onMusicBrowse: the sources at the root, then each level by its id. */
export async function browse(hub, device, { parentId = null, offset = 0, limit = 50 } = {}) {
  const record = hub.target(device?.external_id);
  const parent = parentId === null || parentId === undefined ? null : parseId(parentId);
  if (parentId !== null && parentId !== undefined && !parent) {
    throw userError(hub, ACTION_TEXT.unknownMedia);
  }
  const navigation = await hub.catalogRead(record, `browse ${parent?.uri ?? '/'}`, (client) =>
    client.browse(parent?.uri),
  );
  const rows = rowsOf(navigation, { root: !parent });
  // Cut first: artworkKey keeps the 1000 latest URLs, a long level would push
  // out the keys of the page shown.
  const items = rows
    .slice(offset, offset + limit)
    .map((raw, index) =>
      toMediaItem(hub, record, raw, `row:${parent?.uri ?? ''}:${offset + index}`),
    );
  return { items, total: rows.length };
}

/** onMusicSearch: every source of the player, mixed. */
export async function search(hub, device, { query, type = null, limit = 20 } = {}) {
  const record = hub.target(device?.external_id);
  const navigation = await hub.catalogRead(record, `search`, (client) =>
    client.search(String(query ?? '')),
  );
  const items = mixResults(navigation, limit, type).map((raw, index) =>
    toMediaItem(hub, record, raw, `search:${index}`),
  );
  return { items };
}

/** onMusicQueueGet: a page of the queue; current_index on the whole queue. */
export async function queueGet(hub, device, { offset = 0, limit = 50 } = {}) {
  const record = hub.target(device?.external_id);
  const [queue, raw] = await hub.catalogRead(record, 'queue', (client) =>
    Promise.all([client.getQueue(), client.getState()]),
  );
  const state = parseState(raw);
  const position = Number.isInteger(state.position) ? state.position : null;
  const currentIndex =
    position !== null && position >= 0 && position < queue.length ? position : null;
  // Volumio names a queued track `name` and types every entry `track`: a
  // web radio is told by its service. No row is ever dropped.
  const items = queue.slice(offset, offset + limit).map((entry, index) => {
    const radio = entry?.service === 'webradio';
    const item = toMediaItem(
      hub,
      record,
      { ...entry, title: entry?.title ?? entry?.name, type: radio ? 'webradio' : 'song' },
      `queue:${offset + index}`,
    );
    if (radio) {
      item.duration = null;
    }
    return item;
  });
  return { items, currentIndex, total: queue.length };
}

/** onMusicQueuePlay: jump to an item of the queue. */
export async function queuePlay(hub, device, index) {
  const record = hub.target(device?.external_id);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid queue index ${index}`);
  }
  const queue = await hub.catalogRead(record, 'queue', (client) => client.getQueue());
  if (index >= queue.length) {
    throw userError(hub, ACTION_TEXT.notInQueue);
  }
  await hub.command(record, 'play', { N: index }, `play queue item ${index}`);
}

/** onMusicPlay: replace the queue, or add after the current track / at the end. */
export async function play(hub, device, media, mode = 'replace') {
  const record = hub.target(device?.external_id);
  const item = parseId(media?.id);
  if (!item) {
    throw userError(hub, ACTION_TEXT.unknownMedia);
  }
  const what = item.title || baseName(item.uri) || item.uri;
  if (mode === 'replace') {
    return replace(hub, record, item, what);
  }
  if (mode !== 'next' && mode !== 'append') {
    throw new Error(`Unknown play mode ${mode}`);
  }
  // Ask for the socket before anything is added: "next" cannot be done without it.
  if (mode === 'next') {
    return hub.withSocket(record, (socket) => enqueue(hub, record, item, what, socket));
  }
  return enqueue(hub, record, item, what, null);
}

/** What Volumio adds for an item (its `addToQueue` / `replaceAndPlay` body). */
const volumioItem = (item) => {
  const kind = kindOf({ service: item.service, uri: item.uri });
  const body = { service: item.service, uri: item.uri, title: item.title || baseName(item.uri) };
  if (item.service === 'webradio') {
    body.type = 'webradio';
  } else if (kind.type === T.TRACK) {
    body.type = 'song';
  }
  if (item.albumart) {
    body.albumart = item.albumart;
  }
  return body;
};

async function replace(hub, record, item, what) {
  const name = playlistName(item);
  if (name !== null) {
    // Volumio answers "Success" for a playlist it does not have, after
    // emptying the queue: check the name first.
    const playlists = await hub.catalogRead(record, 'playlists', (client) =>
      client.listPlaylists().catch((err) => {
        if (err.kind === 'refused') {
          return [];
        }
        throw err;
      }),
    );
    if (!playlists.includes(name)) {
      throw userError(hub, ACTION_TEXT.playlistNotFound, name, record.name);
    }
  }
  const body = volumioItem(item);
  if (name !== null) {
    body.title = name;
  }
  await hub.replaceAndPlay(record, body, `playing ${what}`);
  const queue = await waitForQueue(hub, record, (entries) => entries.length > 0);
  if (queue.length === 0) {
    throw userError(hub, ACTION_TEXT.nothingToPlay);
  }
}

/**
 * Add at the end, then (socket given: "next") move the new items after the
 * current track. Whichever block is smaller moves: the new items to their
 * place, or the old ones after the current track to the end.
 */
async function enqueue(hub, record, item, what, socket) {
  const items = await itemsToAdd(hub, record, item);
  const [before, raw] = await hub.catalogRead(record, 'queue', (client) =>
    Promise.all([client.getQueue(), client.getState()]),
  );
  const state = parseState(raw);
  await hub.addToQueue(record, items, `${socket ? 'next' : 'queued'}: ${what}`);
  const after = await waitForQueue(hub, record, (queue) => queue.length > before.length);
  if (after.length <= before.length) {
    throw userError(hub, ACTION_TEXT.nothingToPlay);
  }
  if (!socket) {
    return;
  }
  const current = Number.isInteger(state.position) ? state.position : -1;
  const added = after.length - before.length;
  const following = before.length - 1 - current;
  if (before.length === 0 || current < 0 || current >= before.length || following <= 0) {
    // Empty queue, or the current track is the last one: already in place.
    return;
  }
  if (added <= following) {
    for (let k = 0; k < added; k += 1) {
      socket.emit('moveQueue', { from: before.length + k, to: current + 1 + k });
    }
  } else {
    for (let k = 0; k < following; k += 1) {
      socket.emit('moveQueue', { from: current + 1, to: after.length - 1 });
    }
  }
  const expected = after[before.length]?.uri;
  const moved = await waitForQueue(hub, record, (queue) => queue[current + 1]?.uri === expected);
  if (moved[current + 1]?.uri !== expected) {
    logger.warn(
      `${hub.label(record)}: the items queued could not be moved after the current track`,
    );
    throw userError(hub, ACTION_TEXT.addedAtEnd);
  }
  hub.afterCommand(record);
}

/** A Volumio playlist is added track by track (addToQueue ignores it). */
async function itemsToAdd(hub, record, item) {
  if (playlistName(item) === null) {
    return [volumioItem(item)];
  }
  const navigation = await hub.catalogRead(record, `browse ${item.uri}`, (client) =>
    client.browse(item.uri),
  );
  const tracks = rowsOf(navigation)
    .filter((row) => typeof row.uri === 'string' && row.uri)
    .slice(0, MAX_ADDED)
    .map((row) => ({
      service: row.service || 'mpd',
      uri: row.uri,
      title: row.title ?? row.name ?? '',
      ...(row.albumart ? { albumart: row.albumart } : {}),
    }));
  if (tracks.length === 0) {
    throw userError(hub, ACTION_TEXT.nothingToPlay);
  }
  return tracks;
}

/** Read the queue until `done(queue)` (or the tries run out): the last one read. */
async function waitForQueue(hub, record, done) {
  return hub.catalogRead(record, 'queue', async (client) => {
    let queue = [];
    for (let attempt = 0; attempt < QUEUE_CHECK.tries; attempt += 1) {
      queue = await client.getQueue();
      if (done(queue)) {
        break;
      }
      await sleep(QUEUE_CHECK.intervalMs);
    }
    return queue;
  });
}

// --- Artwork -------------------------------------------------------------------

const prepared = new Map();

/**
 * onMusicGetArtwork: the image of a key handed out by artworkKey (a cover of
 * the player, `/albumart?…`, or of the Internet: a radio logo, a streaming
 * service), made small enough for the core when it is not.
 */
export async function artwork(hub, key) {
  const known = prepared.get(key);
  if (known) {
    return known;
  }
  const url = hub.gladys.artworkUrls?.get(key);
  if (!url) {
    throw new Error(`Unknown artwork ${key}`);
  }
  let base64;
  try {
    const bytes = await hub.downloadArtwork(url, {
      maxBytes: MAX_ARTWORK_DOWNLOAD,
      timeoutMs: ARTWORK_TIMEOUT_MS,
    });
    base64 = (await prepareArtwork(bytes)).toString('base64');
  } catch (err) {
    const reason = err instanceof ArtworkError ? err.message : (err.message ?? String(err));
    logger.debug(`Artwork ${key} not served: ${reason}`);
    throw new Error(`Artwork not available: ${reason}`, { cause: err });
  }
  prepared.set(key, base64);
  while (prepared.size > PREPARED_ARTWORKS) {
    prepared.delete(prepared.keys().next().value);
  }
  return base64;
}
