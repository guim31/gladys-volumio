// -----------------------------------------------------------------------------
// Reading the Volumio answers: getState (also pushed over socket.io as
// `pushState`), getSystemInfo, the browse lists of the web radios, the queue.
// Pure functions: everything the rest of the code reads goes through here.
// -----------------------------------------------------------------------------

const STATUSES = ['play', 'pause', 'stop'];

const text = (value, max = 200) =>
  typeof value === 'string'
    ? value.trim().slice(0, max)
    : typeof value === 'number'
      ? String(value)
      : '';

const finite = (value) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/**
 * The player state, normalized.
 * @param {object} raw a getState answer or a pushState payload
 */
export function parseState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const volume = finite(source.volume);
  return {
    status: STATUSES.includes(source.status) ? source.status : 'stop',
    title: text(source.title),
    artist: text(source.artist),
    album: text(source.album),
    albumart: text(source.albumart, 2048),
    uri: text(source.uri, 2048),
    trackType: text(source.trackType, 40),
    service: text(source.service, 40),
    position: finite(source.position),
    // getState gives the elapsed time in milliseconds.
    seekMs: finite(source.seek),
    duration: finite(source.duration),
    volume: volume === null ? null : Math.min(100, Math.max(0, Math.round(volume))),
    mute: source.mute === true,
    random: source.random === true,
    repeat: source.repeat === true,
    repeatSingle: source.repeatSingle === true,
    // `stream` is `true`, or the stream type ("flac") on some versions.
    stream:
      source.stream === true || source.trackType === 'webradio' || source.service === 'webradio',
    volumeControl: source.disableVolumeControl !== true,
  };
}

/** A web radio or another endless stream: it is stopped, not paused, and never sought. */
export const isStream = (state) => Boolean(state?.stream);

/**
 * The identity of a player (getSystemInfo).
 * @returns {{ id: string, name: string, hardware: string, version: string }|null}
 */
export function parseSystemInfo(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const id = text(source.id, 64).toLowerCase();
  if (!/^[0-9a-z][0-9a-z-]{7,63}$/.test(id)) {
    return null;
  }
  return {
    id,
    name: text(source.name, 40) || 'Volumio',
    hardware: text(source.hardware, 40),
    version: text(source.systemversion, 20),
  };
}

/** The playable items of a browse answer (`navigation.lists[].items[]`). */
export function browseItems(navigation) {
  const items = [];
  for (const list of Array.isArray(navigation?.lists) ? navigation.lists : []) {
    for (const item of Array.isArray(list?.items) ? list.items : []) {
      if (item && typeof item.uri === 'string' && item.uri && typeof item.title === 'string') {
        items.push({
          title: text(item.title, 120),
          uri: item.uri,
          service: text(item.service, 40) || 'webradio',
          type: text(item.type, 40) || 'webradio',
          albumart: text(item.albumart, 2048),
        });
      }
    }
  }
  return items;
}

/** Compare names the way a user types them: case, accents and spaces ignored. */
export const sameName = (a, b) => fold(a) === fold(b);

export const fold = (value) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

/**
 * The queue entries, ready to be played again by replaceAndPlay (`list`):
 * getQueue names the title `name`, replaceAndPlay reads `title`.
 */
export function queueToList(queue) {
  return (Array.isArray(queue) ? queue : [])
    .filter((item) => item && typeof item.uri === 'string' && item.uri)
    .map((item) => {
      const entry = { ...item, title: item.title ?? item.name ?? '' };
      return entry;
    });
}

/** What changed in the track, for the "track changed" trigger. */
export const trackKey = (state) =>
  state.status === 'play' && (state.title || state.artist)
    ? JSON.stringify([state.title, state.artist, state.album])
    : null;
