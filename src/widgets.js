// -----------------------------------------------------------------------------
// Dashboard widget `now_playing` (manifest `widgets`): what a player plays —
// title, artist, album, cover, source, volume, play mode — what the core's
// music box cannot show, with play/pause, next, a volume form and a playlist
// form (the forms behind a button need Gladys 5.2.0).
//
// Budget of the core: 8 components, 2 texts, 1 status list, 4 buttons. Here:
// heading + caption, the cover, one status list, four buttons.
// -----------------------------------------------------------------------------

import { WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { MAX_MEDIA, WIDGET_KEY } from './hub.js';
import { ERROR_TEXT, LANGS, each, pick, sourceLabel } from './texts.js';

// Every text of the widget, in the four languages.
export const TEXT = {
  noPlayer: {
    en: 'No Volumio player added yet: open the Discovery tab of the integration.',
    fr: "Aucun lecteur Volumio ajouté : ouvrez l'onglet Découverte de l'intégration.",
    de: 'Noch kein Volumio-Player hinzugefügt: Öffne den Tab „Entdecken“ der Integration.',
    es: 'Aún no se ha añadido ningún reproductor Volumio: abra la pestaña Descubrir de la integración.',
  },
  nothing: {
    en: 'Nothing playing',
    fr: 'Aucune lecture',
    de: 'Keine Wiedergabe',
    es: 'Nada en reproducción',
  },
  player: { en: 'Player', fr: 'Lecteur', de: 'Player', es: 'Reproductor' },
  state: { en: 'State', fr: 'État', de: 'Status', es: 'Estado' },
  source: { en: 'Source', fr: 'Source', de: 'Quelle', es: 'Fuente' },
  volume: { en: 'Volume', fr: 'Volume', de: 'Lautstärke', es: 'Volumen' },
  shuffle: { en: 'Shuffle', fr: 'Aléatoire', de: 'Zufallswiedergabe', es: 'Aleatorio' },
  repeat: { en: 'Repeat', fr: 'Répétition', de: 'Wiederholen', es: 'Repetir' },
  on: { en: 'On', fr: 'Activé', de: 'An', es: 'Activado' },
  off: { en: 'Off', fr: 'Désactivé', de: 'Aus', es: 'Desactivado' },
  muted: { en: 'Muted', fr: 'Muet', de: 'Stumm', es: 'Silenciado' },
  playing: { en: 'Playing', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproduciendo' },
  paused: { en: 'Paused', fr: 'En pause', de: 'Pausiert', es: 'En pausa' },
  stopped: { en: 'Stopped', fr: 'Arrêté', de: 'Gestoppt', es: 'Detenido' },
  unreachable: {
    en: 'Unreachable',
    fr: 'Injoignable',
    de: 'Nicht erreichbar',
    es: 'Inaccesible',
  },
  play: { en: 'Play', fr: 'Lecture', de: 'Wiedergabe', es: 'Reproducir' },
  pause: { en: 'Pause', fr: 'Pause', de: 'Pause', es: 'Pausa' },
  next: { en: 'Next', fr: 'Suivant', de: 'Weiter', es: 'Siguiente' },
  previous: { en: 'Previous', fr: 'Précédent', de: 'Zurück', es: 'Anterior' },
  playlist: { en: 'Playlist', fr: 'Playlist', de: 'Playlist', es: 'Lista' },
  mute: { en: 'Mute', fr: 'Muet', de: 'Stumm', es: 'Silenciar' },
  cover: {
    en: 'Album cover',
    fr: "Pochette de l'album",
    de: 'Albumcover',
    es: 'Portada del álbum',
  },
  formMissing: {
    en: 'This form needs Gladys 5.2 or later.',
    fr: 'Ce formulaire demande Gladys 5.2 ou plus récent.',
    de: 'Dieses Formular braucht Gladys 5.2 oder neuer.',
    es: 'Este formulario necesita Gladys 5.2 o posterior.',
  },
};

// Toasts after a widget action (the core does not say the user's language).
export const TOAST = {
  playing: TEXT.playing,
  paused: TEXT.paused,
  next: { en: 'Next track', fr: 'Piste suivante', de: 'Nächster Titel', es: 'Pista siguiente' },
  previous: {
    en: 'Previous track',
    fr: 'Piste précédente',
    de: 'Vorheriger Titel',
    es: 'Pista anterior',
  },
  volume: {
    en: (volume) => `Volume ${volume} %`,
    fr: (volume) => `Volume ${volume} %`,
    de: (volume) => `Lautstärke ${volume} %`,
    es: (volume) => `Volumen ${volume} %`,
  },
  playlist: {
    en: (name) => `Playing the playlist ${name}`,
    fr: (name) => `Lecture de la playlist ${name}`,
    de: (name) => `Playlist ${name} wird abgespielt`,
    es: (name) => `Reproduciendo la lista ${name}`,
  },
};

// Action keys of the widget buttons (also echoed back by the core).
export const ACTIONS = Object.freeze({
  TOGGLE: 'toggle',
  NEXT: 'next',
  PREVIOUS: 'previous',
  VOLUME: 'volume',
  PLAYLIST: 'playlist',
});

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const statusText = (state) =>
  state.status === 'play' ? TEXT.playing : state.status === 'pause' ? TEXT.paused : TEXT.stopped;

/**
 * The content for one player.
 * @param {object} view `{ name, reachable, error, state, artKey, playlists }`
 * @param {string} language the user's language
 */
export function buildContent(view, language) {
  const t = (key) => pick(TEXT[key], language);
  if (!view) {
    return {
      ttl_seconds: 300,
      components: [
        { type: 'text', variant: 'heading', text: 'Volumio' },
        { type: 'text', variant: 'body', text: t('noPlayer') },
      ],
    };
  }
  if (!view.reachable || !view.state) {
    return {
      ttl_seconds: 60,
      components: [
        { type: 'text', variant: 'heading', text: clip(view.name, 40) },
        {
          type: 'status',
          items: [
            {
              label: t('state'),
              value: view.error
                ? clip(pick(ERROR_TEXT[view.error], language), 40)
                : t('unreachable'),
              icon: 'wifi-off',
              color: WIDGET_COLORS.DANGER,
            },
          ],
        },
      ],
    };
  }
  const { state } = view;
  const playing = state.status === 'play';
  const idle = state.status === 'stop' && !state.title;
  const caption = [state.artist, state.album].filter(Boolean).join(' — ') || view.name;
  const components = [
    {
      type: 'text',
      variant: 'heading',
      text: clip(idle ? t('nothing') : state.title || t('nothing'), 40),
    },
    { type: 'text', variant: 'caption', text: clip(caption, 80) },
  ];
  if (view.artKey && !idle) {
    components.push({ type: 'image', key: view.artKey, alt: t('cover'), fit: 'contain' });
  }
  const items = [
    { label: t('player'), value: clip(view.name, 40), icon: 'speaker' },
    {
      label: t('state'),
      value: pick(statusText(state), language),
      icon: playing ? 'play' : state.status === 'pause' ? 'pause' : 'square',
      color: playing ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.NEUTRAL,
    },
  ];
  const source = sourceLabel(state, language);
  if (source && !idle) {
    items.push({ label: t('source'), value: clip(source, 40), icon: 'radio' });
  }
  items.push({
    label: t('volume'),
    value: state.mute ? t('muted') : state.volume === null ? '—' : `${state.volume} %`,
    icon: state.mute ? 'volume-x' : 'volume-2',
  });
  items.push(
    { label: t('shuffle'), value: state.random ? t('on') : t('off'), icon: 'shuffle' },
    { label: t('repeat'), value: state.repeat ? t('on') : t('off'), icon: 'repeat' },
  );
  components.push({ type: 'status', items });

  components.push(
    {
      type: 'button',
      label: playing ? t('pause') : t('play'),
      icon: playing ? 'pause' : 'play',
      action: { key: ACTIONS.TOGGLE },
    },
    { type: 'button', label: t('next'), icon: 'skip-forward', action: { key: ACTIONS.NEXT } },
  );
  if (state.volumeControl) {
    components.push({
      type: 'button',
      label: t('volume'),
      icon: 'volume-2',
      action: {
        key: ACTIONS.VOLUME,
        fields: [
          {
            key: 'volume',
            type: 'number',
            label: each((lang) => pick(TEXT.volume, lang)),
            min: 0,
            max: 100,
            required: true,
            default: state.volume ?? 30,
          },
          {
            key: 'mute',
            type: 'boolean',
            label: each((lang) => pick(TEXT.mute, lang)),
            default: state.mute,
          },
        ],
      },
    });
  } else {
    components.push({
      type: 'button',
      label: t('previous'),
      icon: 'skip-back',
      action: { key: ACTIONS.PREVIOUS },
    });
  }
  const playlists = (view.playlists ?? []).slice(0, MAX_MEDIA);
  if (playlists.length) {
    components.push({
      type: 'button',
      label: t('playlist'),
      icon: 'list',
      action: {
        key: ACTIONS.PLAYLIST,
        fields: [
          {
            key: 'playlist',
            type: 'select',
            label: each((lang) => pick(TEXT.playlist, lang)),
            required: true,
            default: playlists[0],
            options: playlists.map((name) => ({
              value: name,
              label: Object.fromEntries(LANGS.map((lang) => [lang, clip(name, 40)])),
            })),
          },
        ],
      },
    });
  } else if (state.volumeControl) {
    components.push({
      type: 'button',
      label: t('previous'),
      icon: 'skip-back',
      action: { key: ACTIONS.PREVIOUS },
    });
  }
  return { ttl_seconds: playing ? 30 : 120, components };
}

/** What the widget needs from the hub, read now. */
async function readView(hub, art, deviceExternalId) {
  const record = hub.view(deviceExternalId);
  if (!record) {
    return null;
  }
  const view = {
    name: record.name,
    reachable: record.reachable === true,
    error: record.error,
    state: record.state,
    artKey: null,
    playlists: [],
  };
  if (!view.reachable || !record.state) {
    return view;
  }
  const [artKey, media] = await Promise.all([
    art.resolve(record.client, record.state.albumart).catch(() => null),
    hub.media(record).catch(() => null),
  ]);
  view.artKey = artKey;
  view.playlists = media?.playlists ?? [];
  return view;
}

/** A widget action needs the record behind the widget. */
function recordFor(hub, settings) {
  const record = hub.view(settings?.device);
  if (!record) {
    throw new Error(pick(TEXT.noPlayer, hub.language));
  }
  return record;
}

/** Same message in every language, from a table of functions. */
const toast = (table, ...args) => each((lang) => pick(table, lang)(...args));

export const WIDGETS = {
  [WIDGET_KEY]: {
    async get(hub, art, { settings = {}, language = 'en' } = {}) {
      return buildContent(await readView(hub, art, settings.device), language);
    },

    async action(hub, { actionKey, settings, values }) {
      const record = recordFor(hub, settings);
      switch (actionKey) {
        case ACTIONS.TOGGLE: {
          const willPlay = record.state?.status !== 'play';
          await hub.toggle(record);
          return willPlay ? TOAST.playing : TOAST.paused;
        }
        case ACTIONS.NEXT:
          await hub.command(record, 'next', {}, 'next track');
          return TOAST.next;
        case ACTIONS.PREVIOUS:
          await hub.command(record, 'prev', {}, 'previous track');
          return TOAST.previous;
        case ACTIONS.VOLUME: {
          if (!values || values.volume === undefined) {
            throw new Error(pick(TEXT.formMissing, hub.language));
          }
          const volume = Math.min(100, Math.max(0, Math.round(Number(values.volume))));
          await hub.setVolume(record, volume);
          if (typeof values.mute === 'boolean' && values.mute !== Boolean(record.state?.mute)) {
            await hub.setMute(record, values.mute);
          }
          return toast(TOAST.volume, volume);
        }
        case ACTIONS.PLAYLIST: {
          if (!values?.playlist) {
            throw new Error(pick(TEXT.formMissing, hub.language));
          }
          const name = await hub.playPlaylist(record, values.playlist);
          return toast(TOAST.playlist, clip(name, 120));
        }
        default:
          throw new Error(`Unknown widget action ${actionKey}`);
      }
    },
  },
};
