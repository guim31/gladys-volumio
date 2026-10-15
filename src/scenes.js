// -----------------------------------------------------------------------------
// Scene actions (manifest `scene_actions`). Each handler gets the fields the
// core resolved (scene variables substituted, defaults applied) and the hub.
// Their keys are permanent once published. Throwing fails the action only:
// the scene logs it and goes on.
// -----------------------------------------------------------------------------

/** A number typed in a scene ("40", "40,5"), null when empty or not a number. */
export function optionalNumber(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return null;
  }
  const number = typeof raw === 'number' ? raw : Number(String(raw).trim().replace(',', '.'));
  return Number.isFinite(number) ? Math.min(100, Math.max(0, Math.round(number))) : null;
}

const flag = (raw) => raw === true || raw === 'true';

export const SCENE_ACTIONS = {
  async play_playlist(hub, { fields }) {
    await hub.playPlaylist(hub.target(fields.device), fields.playlist);
  },

  async play_favorite_radio(hub, { fields }) {
    await hub.playFavouriteRadio(hub.target(fields.device), fields.radio);
  },

  async play_url(hub, { fields }) {
    await hub.playUrl(hub.target(fields.device), fields.url, {
      title: fields.title,
      volume: optionalNumber(fields.volume),
      resume: flag(fields.resume),
    });
  },

  async set_play_mode(hub, { fields }) {
    await hub.setPlayMode(hub.target(fields.device), {
      shuffle: fields.shuffle,
      repeat: fields.repeat,
    });
  },

  async clear_queue(hub, { fields }) {
    await hub.clearQueue(hub.target(fields.device));
  },
};
