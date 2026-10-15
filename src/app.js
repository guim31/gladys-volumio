// -----------------------------------------------------------------------------
// Registers every SDK handler on a GladysIntegration (or the SDK's fake Gladys)
// and returns the hub, so index.js stays a few lines and the tests drive the
// very same wiring.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { ArtCache } from './art.js';
import { normalizeConfig } from './config.js';
import { VolumioHub } from './hub.js';
import { SCENE_ACTIONS } from './scenes.js';
import { INIT_FAILED, LANGS, SEARCH_TEXT, mediaLine, pick } from './texts.js';
import { WIDGETS } from './widgets.js';

const logger = createLogger({ name: 'volumio-app' });

/**
 * @param {object} gladys GladysIntegration instance
 * @param {object} [options] test seams: fetch, createSocket, timers, timings, socketTimings, now
 */
export function registerHandlers(gladys, options = {}) {
  const hub = new VolumioHub({
    gladys,
    fetch: options.fetch,
    createSocket: options.createSocket,
    timers: options.timers ?? true,
    timings: options.timings,
    socketTimings: options.socketTimings,
    now: options.now,
  });
  const art = new ArtCache({ now: options.now });

  // Resolved once the hub has started; every handler waits for it, so a
  // command arriving during the first discovery is not lost.
  let resolveReady;
  const ready = new Promise((resolve) => {
    resolveReady = resolve;
  });
  let started = false;
  const whenReady =
    (fn) =>
    async (...args) => {
      await ready;
      return fn(...args);
    };

  gladys.on('connected', async () => {
    try {
      const config = normalizeConfig(await gladys.getConfig());
      if (started) {
        // A reconnection (Gladys restarted): send again what Gladys may have lost.
        await hub.resync(config);
        return;
      }
      started = true;
      await hub.start(config);
    } catch (err) {
      logger.error('Initialization failed', err);
      await gladys.setConnectionStatus(false, INIT_FAILED).catch(() => {});
    } finally {
      resolveReady();
    }
  });

  gladys.onScanRequest(whenReady(() => hub.rediscover()));

  gladys.onSetValue(whenReady((device, feature, value) => hub.setValue(device, feature, value)));

  // The hub reads the players on its own timer and push channel; the core's
  // poll only reads a player the hub has not read for most of a minute.
  gladys.onPoll(whenReady((device) => hub.pollDevice(device)));

  gladys.onDeviceCreated(whenReady((device) => hub.onDeviceCreated(device)));
  gladys.onDeviceDeleted(whenReady((device) => hub.onDeviceDeleted(device)));

  gladys.onConfigUpdated(
    whenReady(async (newConfig) => {
      logger.info('Configuration updated');
      await hub.reconfigure(normalizeConfig(newConfig));
    }),
  );

  gladys.onAction(
    'search',
    whenReady(async () => {
      logger.info('Search for players requested');
      return searchMessage(await hub.rediscover());
    }),
  );

  gladys.onAction(
    'list_media',
    whenReady(async () => {
      logger.info('Playlists and favourite radios requested');
      return mediaMessage(hub);
    }),
  );

  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(
      key,
      whenReady((fields) => handler(hub, { fields })),
    );
  }

  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(
      key,
      whenReady((request) => widget.get(hub, art, request)),
    );
    gladys.onWidgetAction(
      key,
      whenReady((actionKey, params, context = {}) =>
        widget.action(hub, { actionKey, params, ...context }),
      ),
    );
  }
  gladys.onWidgetGetImage(whenReady(async (imageKey) => art.get(imageKey)));

  return {
    hub,
    art,
    ready,
    stop: () => hub.stop(),
  };
}

/** The report shown under the "Search for players" button, in every language. */
export function searchMessage(summary) {
  return Object.fromEntries(
    Object.entries(SEARCH_TEXT).map(([language, text]) => [language, searchReport(summary, text)]),
  );
}

function searchReport({ players, mdns, invalidHosts }, text) {
  const lines = [];
  if (players.length === 0) {
    lines.push(text.none);
  } else {
    const reachable = players.filter((player) => player.reachable).length;
    lines.push(text.count(players.length, reachable));
    const items = players.map(({ name, host, version, reachable: up, live }) => {
      const how = up ? (live ? text.live : text.polled) : text.unreachable;
      return `${name} (${[host, version, how].filter(Boolean).join(', ')})`;
    });
    lines.push(`${items.join(', ')}.`);
  }
  if (players.length === 0 && mdns !== 'ok') {
    lines.push(text.noMdns);
  }
  if (invalidHosts.length > 0) {
    lines.push(text.ignored(invalidHosts.slice(0, 3).join(', ')));
  }
  return lines.join(' ');
}

/** The report of the "List playlists and favourite radios" button. */
export async function mediaMessage(hub) {
  const players = [...hub.records.values()].sort((a, b) => a.name.localeCompare(b.name));
  const lines = await Promise.all(
    players.map(async (record) => {
      try {
        const media = await hub.media(record, { fresh: true });
        return {
          name: record.name,
          playlists: media.playlists,
          radios: media.radios.map((radio) => radio.title),
        };
      } catch (err) {
        return { name: record.name, error: err.kind ?? 'unreachable' };
      }
    }),
  );
  return Object.fromEntries(
    LANGS.map((language) => [
      language,
      lines.length
        ? lines.map((line) => mediaLine(line, language)).join('\n')
        : pick(SEARCH_TEXT, language).none,
    ]),
  );
}
