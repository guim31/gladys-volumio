// -----------------------------------------------------------------------------
// One Gladys device per Volumio player, with the music features of the core
// (the couples its music dashboard box and its "play a notification" scene
// action look for): volume, play, pause, previous, next, playback state,
// play a notification.
//
// Identity: the UUID Volumio gives the player (getSystemInfo, mDNS TXT
// `UUID`): the address can change (DHCP), the device stays.
//
// What the core has no feature for (title, artist, album, source, cover,
// mute, shuffle, repeat) is shown by the dashboard widget (src/widgets.js).
//
// Polling: published with `should_poll: true` every minute, but the core
// cannot be trusted to poll (GladysAssistant/Gladys#3198): the hub reads the
// players on its own timer and push channel, and the core's onPoll only
// reads a player the hub has not read for most of a minute.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';

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
});

// Values of music/playback_state (MUSIC_PLAYBACK_STATE in the core).
export const PLAYBACK = Object.freeze({ PLAYING: 1, PAUSED: 0 });

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
  },
  fr: {
    [FEATURE_KEYS.VOLUME]: 'Volume',
    [FEATURE_KEYS.PLAY]: 'Lecture',
    [FEATURE_KEYS.PAUSE]: 'Pause',
    [FEATURE_KEYS.PREVIOUS]: 'Piste précédente',
    [FEATURE_KEYS.NEXT]: 'Piste suivante',
    [FEATURE_KEYS.PLAYBACK_STATE]: 'État de la lecture',
    [FEATURE_KEYS.PLAY_NOTIFICATION]: 'Diffuser une notification',
  },
  de: {
    [FEATURE_KEYS.VOLUME]: 'Lautstärke',
    [FEATURE_KEYS.PLAY]: 'Wiedergabe',
    [FEATURE_KEYS.PAUSE]: 'Pause',
    [FEATURE_KEYS.PREVIOUS]: 'Vorheriger Titel',
    [FEATURE_KEYS.NEXT]: 'Nächster Titel',
    [FEATURE_KEYS.PLAYBACK_STATE]: 'Wiedergabestatus',
    [FEATURE_KEYS.PLAY_NOTIFICATION]: 'Benachrichtigung senden',
  },
  es: {
    [FEATURE_KEYS.VOLUME]: 'Volumen',
    [FEATURE_KEYS.PLAY]: 'Reproducir',
    [FEATURE_KEYS.PAUSE]: 'Pausa',
    [FEATURE_KEYS.PREVIOUS]: 'Pista anterior',
    [FEATURE_KEYS.NEXT]: 'Pista siguiente',
    [FEATURE_KEYS.PLAYBACK_STATE]: 'Estado de reproducción',
    [FEATURE_KEYS.PLAY_NOTIFICATION]: 'Difundir una notificación',
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

// Order = display order in Gladys.
const FEATURES = [
  {
    key: FEATURE_KEYS.VOLUME,
    // The player says the volume it reached: the state comes from it.
    definition: music(DEVICE_FEATURE_TYPES.MUSIC.VOLUME, { min: 0, max: 100, has_feedback: true }),
    value: (state) => state?.volume ?? null,
  },
  { key: FEATURE_KEYS.PLAY, definition: button(DEVICE_FEATURE_TYPES.MUSIC.PLAY) },
  { key: FEATURE_KEYS.PAUSE, definition: button(DEVICE_FEATURE_TYPES.MUSIC.PAUSE) },
  { key: FEATURE_KEYS.PREVIOUS, definition: button(DEVICE_FEATURE_TYPES.MUSIC.PREVIOUS) },
  { key: FEATURE_KEYS.NEXT, definition: button(DEVICE_FEATURE_TYPES.MUSIC.NEXT) },
  {
    key: FEATURE_KEYS.PLAYBACK_STATE,
    definition: music(DEVICE_FEATURE_TYPES.MUSIC.PLAYBACK_STATE, {
      min: 0,
      max: 1,
      read_only: true,
      keep_history: true,
    }),
    // Stopped reads as paused: the core knows playing and paused only.
    value: (state) =>
      state ? (state.status === 'play' ? PLAYBACK.PLAYING : PLAYBACK.PAUSED) : null,
  },
  {
    key: FEATURE_KEYS.PLAY_NOTIFICATION,
    definition: button(DEVICE_FEATURE_TYPES.MUSIC.PLAY_NOTIFICATION),
  },
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

/**
 * The states to publish for a player state (the features that have one).
 * @returns {Array<{ device_feature_external_id: string, state: number }>}
 */
export function featureStates(gladys, playerId, state) {
  const ids = deviceIds(gladys, playerId);
  return FEATURES.filter(({ value }) => typeof value === 'function')
    .map(({ key, value }) => ({
      device_feature_external_id: ids.feature(key),
      state: value(state),
    }))
    .filter(({ state: value }) => typeof value === 'number' && Number.isFinite(value));
}
