// -----------------------------------------------------------------------------
// One Gladys device per Volumio player, with the music features of the core:
//   - volume, play, pause, previous, next, play a notification (1.0);
//   - playback state: 1 playing, 0 paused, 2 stopped (MUSIC_PLAYBACK_STATE),
//     writable since Gladys 5.3 (same external id as in 1.0, read-only then);
//   - now playing (Gladys 5.3): title, artist, album, artwork (an image key
//     served by src/catalog.js), duration and position (seconds, position
//     writable = seek), shuffle (Volumio's random), repeat (off, all, one:
//     Volumio's repeat + repeatSingle) and mute, all published together by
//     publishNowPlaying (src/hub.js).
//
// Feature keys equal the feature types, so the external ids follow the
// `${device}:${type}` default of publishNowPlaying: no featureExternalIds.
//
// Identity: the UUID Volumio gives the player (getSystemInfo, mDNS TXT
// `UUID`): the address can change (DHCP), the device stays.
//
// Polling: published with `should_poll: true` every minute, but the core
// cannot be trusted to poll (GladysAssistant/Gladys#3198): the hub reads the
// players on its own timer and push channel, and the core's onPoll only
// reads a player the hub has not read for most of a minute.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
  DEVICE_POLL_FREQUENCIES,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
} from '@gladysassistant/integration-sdk';
import { isStream } from './volumio/model.js';

export const DEVICE_TYPE = 'player';
export const HOST_PARAM = 'VOLUMIO_HOST';
export const POLL_FREQUENCY_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES;

// Suffixes of the feature external ids: permanent once published.
export const FEATURE_KEYS = Object.freeze({
  VOLUME: 'volume',
  PLAY: 'play',
  PAUSE: 'pause',
  PREVIOUS: 'previous',
  NEXT: 'next',
  PLAYBACK_STATE: 'playback_state',
  PLAY_NOTIFICATION: 'play_notification',
  // Gladys 5.3: the same as the feature types, the default of publishNowPlaying.
  TITLE: 'title',
  ARTIST: 'artist',
  ALBUM: 'album',
  ARTWORK: 'artwork',
  DURATION: 'duration',
  POSITION: 'position',
  SHUFFLE: 'shuffle',
  REPEAT: 'repeat',
  MUTE: 'mute',
});

// Values of music/playback_state (MUSIC_PLAYBACK_STATE in the core).
export const PLAYBACK = Object.freeze({
  PLAYING: MUSIC_PLAYBACK_STATE.PLAYING,
  PAUSED: MUSIC_PLAYBACK_STATE.PAUSED,
  IDLE: MUSIC_PLAYBACK_STATE.IDLE,
});

// Feature names, in the language chosen in the configuration (Gladys does not
// tell a device integration the user's language), close to the core's own
// labels. Frozen at creation in Gladys.
export const NAMES = {
  en: {
    [FEATURE_KEYS.VOLUME]: 'Volume',
    [FEATURE_KEYS.PLAY]: 'Play',
    [FEATURE_KEYS.PAUSE]: 'Pause',
    [FEATURE_KEYS.PREVIOUS]: 'Previous track',
    [FEATURE_KEYS.NEXT]: 'Next track',
    [FEATURE_KEYS.PLAYBACK_STATE]: 'Playback state',
    [FEATURE_KEYS.PLAY_NOTIFICATION]: 'Broadcast a notification',
    [FEATURE_KEYS.TITLE]: 'Title',
    [FEATURE_KEYS.ARTIST]: 'Artist',
    [FEATURE_KEYS.ALBUM]: 'Album',
    [FEATURE_KEYS.ARTWORK]: 'Artwork',
    [FEATURE_KEYS.DURATION]: 'Duration',
    [FEATURE_KEYS.POSITION]: 'Position',
    [FEATURE_KEYS.SHUFFLE]: 'Shuffle',
    [FEATURE_KEYS.REPEAT]: 'Repeat',
    [FEATURE_KEYS.MUTE]: 'Mute',
  },
  fr: {
    [FEATURE_KEYS.VOLUME]: 'Volume',
    [FEATURE_KEYS.PLAY]: 'Lecture',
    [FEATURE_KEYS.PAUSE]: 'Pause',
    [FEATURE_KEYS.PREVIOUS]: 'Piste précédente',
    [FEATURE_KEYS.NEXT]: 'Piste suivante',
    [FEATURE_KEYS.PLAYBACK_STATE]: 'État de la lecture',
    [FEATURE_KEYS.PLAY_NOTIFICATION]: 'Diffuser une notification',
    [FEATURE_KEYS.TITLE]: 'Titre',
    [FEATURE_KEYS.ARTIST]: 'Artiste',
    [FEATURE_KEYS.ALBUM]: 'Album',
    [FEATURE_KEYS.ARTWORK]: 'Pochette',
    [FEATURE_KEYS.DURATION]: 'Durée',
    [FEATURE_KEYS.POSITION]: 'Position',
    [FEATURE_KEYS.SHUFFLE]: 'Lecture aléatoire',
    [FEATURE_KEYS.REPEAT]: 'Répétition',
    [FEATURE_KEYS.MUTE]: 'Sourdine',
  },
  de: {
    [FEATURE_KEYS.VOLUME]: 'Lautstärke',
    [FEATURE_KEYS.PLAY]: 'Wiedergabe',
    [FEATURE_KEYS.PAUSE]: 'Pause',
    [FEATURE_KEYS.PREVIOUS]: 'Vorheriger Titel',
    [FEATURE_KEYS.NEXT]: 'Nächster Titel',
    [FEATURE_KEYS.PLAYBACK_STATE]: 'Wiedergabestatus',
    [FEATURE_KEYS.PLAY_NOTIFICATION]: 'Benachrichtigung senden',
    [FEATURE_KEYS.TITLE]: 'Titel',
    [FEATURE_KEYS.ARTIST]: 'Künstler',
    [FEATURE_KEYS.ALBUM]: 'Album',
    [FEATURE_KEYS.ARTWORK]: 'Cover',
    [FEATURE_KEYS.DURATION]: 'Dauer',
    [FEATURE_KEYS.POSITION]: 'Position',
    [FEATURE_KEYS.SHUFFLE]: 'Zufallswiedergabe',
    [FEATURE_KEYS.REPEAT]: 'Wiederholung',
    [FEATURE_KEYS.MUTE]: 'Stummschaltung',
  },
  es: {
    [FEATURE_KEYS.VOLUME]: 'Volumen',
    [FEATURE_KEYS.PLAY]: 'Reproducir',
    [FEATURE_KEYS.PAUSE]: 'Pausa',
    [FEATURE_KEYS.PREVIOUS]: 'Pista anterior',
    [FEATURE_KEYS.NEXT]: 'Pista siguiente',
    [FEATURE_KEYS.PLAYBACK_STATE]: 'Estado de reproducción',
    [FEATURE_KEYS.PLAY_NOTIFICATION]: 'Difundir una notificación',
    [FEATURE_KEYS.TITLE]: 'Título',
    [FEATURE_KEYS.ARTIST]: 'Artista',
    [FEATURE_KEYS.ALBUM]: 'Álbum',
    [FEATURE_KEYS.ARTWORK]: 'Carátula',
    [FEATURE_KEYS.DURATION]: 'Duración',
    [FEATURE_KEYS.POSITION]: 'Posición',
    [FEATURE_KEYS.SHUFFLE]: 'Reproducción aleatoria',
    [FEATURE_KEYS.REPEAT]: 'Repetición',
    [FEATURE_KEYS.MUTE]: 'Silencio',
  },
};

const music = (type, extra) => ({
  category: DEVICE_FEATURE_CATEGORIES.MUSIC,
  type,
  read_only: false,
  has_feedback: false,
  keep_history: false,
  ...extra,
});

// A button: the core sends 1. Same bounds as the core's own music services.
const button = (type) => music(type, { min: 1, max: 1 });

// Bound of the duration and the position (24 h: a long mix, an audiobook).
export const MAX_SECONDS = 86_400;

/** A writable music feature that Volumio confirms (push or the next read). */
const control = (type, max, extra = {}) =>
  music(type, { min: 0, max, has_feedback: true, ...extra });

/** A read-only string feature (the core stores its value as a text). */
const text = (type) =>
  // min and max are NOT NULL in the core database, meaningless for a text.
  music(type, { min: 0, max: 0, read_only: true });

// Order = display order in Gladys.
const FEATURES = [
  // The player says the volume it reached: the state comes from it.
  { key: FEATURE_KEYS.VOLUME, definition: control(DEVICE_FEATURE_TYPES.MUSIC.VOLUME, 100) },
  { key: FEATURE_KEYS.PLAY, definition: button(DEVICE_FEATURE_TYPES.MUSIC.PLAY) },
  { key: FEATURE_KEYS.PAUSE, definition: button(DEVICE_FEATURE_TYPES.MUSIC.PAUSE) },
  { key: FEATURE_KEYS.PREVIOUS, definition: button(DEVICE_FEATURE_TYPES.MUSIC.PREVIOUS) },
  { key: FEATURE_KEYS.NEXT, definition: button(DEVICE_FEATURE_TYPES.MUSIC.NEXT) },
  {
    // PAUSED 0, PLAYING 1, IDLE 2 (stopped); BUFFERING is never reported.
    // Read-only, max 1 and with history in 1.0: same external id, the
    // "Update" of the Discover tab makes it writable.
    key: FEATURE_KEYS.PLAYBACK_STATE,
    definition: control(DEVICE_FEATURE_TYPES.MUSIC.PLAYBACK_STATE, MUSIC_PLAYBACK_STATE.IDLE),
  },
  {
    key: FEATURE_KEYS.PLAY_NOTIFICATION,
    definition: button(DEVICE_FEATURE_TYPES.MUSIC.PLAY_NOTIFICATION),
  },
  { key: FEATURE_KEYS.TITLE, definition: text(DEVICE_FEATURE_TYPES.MUSIC.TITLE) },
  { key: FEATURE_KEYS.ARTIST, definition: text(DEVICE_FEATURE_TYPES.MUSIC.ARTIST) },
  { key: FEATURE_KEYS.ALBUM, definition: text(DEVICE_FEATURE_TYPES.MUSIC.ALBUM) },
  { key: FEATURE_KEYS.ARTWORK, definition: text(DEVICE_FEATURE_TYPES.MUSIC.ARTWORK) },
  {
    key: FEATURE_KEYS.DURATION,
    definition: music(DEVICE_FEATURE_TYPES.MUSIC.DURATION, {
      unit: DEVICE_FEATURE_UNITS.SECONDS,
      read_only: true,
      min: 0,
      max: MAX_SECONDS,
    }),
  },
  {
    key: FEATURE_KEYS.POSITION,
    definition: control(DEVICE_FEATURE_TYPES.MUSIC.POSITION, MAX_SECONDS, {
      unit: DEVICE_FEATURE_UNITS.SECONDS,
    }),
  },
  { key: FEATURE_KEYS.SHUFFLE, definition: control(DEVICE_FEATURE_TYPES.MUSIC.SHUFFLE, 1) },
  {
    key: FEATURE_KEYS.REPEAT,
    definition: control(DEVICE_FEATURE_TYPES.MUSIC.REPEAT, MUSIC_REPEAT_MODE.ONE),
  },
  { key: FEATURE_KEYS.MUTE, definition: control(DEVICE_FEATURE_TYPES.MUSIC.MUTE, 1) },
];

/** External ids of a player's device and features. */
export const deviceIds = (gladys, playerId) => gladys.externalIds(DEVICE_TYPE, playerId);

/** The player id of a device external id, null when it is not one of ours. */
export function playerIdOf(gladys, externalId) {
  const prefix = gladys.externalIds(DEVICE_TYPE, '').device;
  if (typeof externalId !== 'string' || !externalId.startsWith(prefix)) {
    return null;
  }
  const id = externalId.slice(prefix.length);
  return id && !id.includes(':') ? id : null;
}

/** The feature key of a feature external id of that player, null otherwise. */
export function featureKeyOf(gladys, playerId, externalId) {
  const ids = deviceIds(gladys, playerId);
  return Object.values(FEATURE_KEYS).find((key) => ids.feature(key) === externalId) ?? null;
}

/** The address kept in a created device's params. */
export const hostParam = (device) =>
  (device?.params ?? []).find((param) => param?.name === HOST_PARAM)?.value ?? null;

/**
 * The discovery payload of a player.
 * @param {object} gladys SDK client
 * @param {{ id: string, name: string, host: string }} player
 * @param {string} language feature names language
 */
export function buildDevice(gladys, player, language = 'fr') {
  const ids = deviceIds(gladys, player.id);
  const names = NAMES[language] ?? NAMES.fr;
  return {
    name: player.name,
    external_id: ids.device,
    should_poll: true,
    poll_frequency: POLL_FREQUENCY_MS,
    params: [{ name: HOST_PARAM, value: player.host }],
    features: FEATURES.map(({ key, definition }) => ({
      ...definition,
      name: names[key],
      external_id: ids.feature(key),
    })),
  };
}

const PLAYBACK_STATES = {
  play: MUSIC_PLAYBACK_STATE.PLAYING,
  pause: MUSIC_PLAYBACK_STATE.PAUSED,
  stop: MUSIC_PLAYBACK_STATE.IDLE,
};

const seconds = (value) => Math.max(0, Math.round(Number(value) || 0));

/** Nothing in the queue: no track, no artwork (Volumio then names its logo). */
export const nothingLoaded = (state) => !state.uri && !state.title && !state.artist;

/** music/repeat of a Volumio state: repeat + repeatSingle. */
export const repeatMode = (state) =>
  state.repeat
    ? state.repeatSingle
      ? MUSIC_REPEAT_MODE.ONE
      : MUSIC_REPEAT_MODE.ALL
    : MUSIC_REPEAT_MODE.OFF;

/**
 * The snapshot given to publishNowPlaying (Gladys 5.3), from parseState().
 *   - Nothing loaded (empty queue): the texts and the artwork are cleared
 *     explicitly (an absent key means "unchanged").
 *   - Stopped with a track still current (Volumio keeps it): IDLE, the track
 *     stays shown, position 0.
 *   - A web radio: duration 0 (live); its position is not capped, the SDK
 *     extrapolates it without a bound (a capped one would be published again
 *     and again).
 *   - No volume when the player has no mixer (Volumio says "").
 * @param {object} state parseState()
 * @param {{ artworkUrl?: string|null }} [options] the source given to artworkKey
 */
export function nowPlaying(state, { artworkUrl = null } = {}) {
  const loaded = !nothingLoaded(state);
  const stream = isStream(state);
  const duration = loaded && !stream ? seconds(state.duration) : 0;
  const elapsed = seconds((state.seekMs ?? 0) / 1000);
  const snapshot = {
    playback_state: PLAYBACK_STATES[state.status] ?? MUSIC_PLAYBACK_STATE.IDLE,
    title: loaded ? state.title : '',
    artist: loaded ? state.artist : '',
    album: loaded ? state.album : '',
    artwork_url: loaded ? artworkUrl : null,
    duration,
    position:
      loaded && state.status !== 'stop'
        ? duration > 0
          ? Math.min(elapsed, duration)
          : elapsed
        : 0,
    shuffle: state.random ? 1 : 0,
    repeat: repeatMode(state),
    mute: state.mute ? 1 : 0,
  };
  if (state.volume !== null) {
    snapshot.volume = state.volume;
  }
  return snapshot;
}
