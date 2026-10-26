// -----------------------------------------------------------------------------
// The Volumio hub: one record per player found (typed address, mDNS relayed
// by the core, zones of a known player, devices already created), read on a
// timer of the container and, when it works, kept up to date by the
// socket.io push of the player. Its states go to Gladys when they change,
// its commands come from the device features, the widget and the scenes.
//
// Only the players the user added to Gladys are read: the core drops the
// states of a device it does not know.
//
// Pace (HUB_TIMINGS): with the push channel open, one safety read every
// 5 minutes; without it, every 10 s while playing and every minute otherwise.
// A command is followed by a read, so the device shows its effect at once.
// -----------------------------------------------------------------------------

import {
  DEVICE_TRANSPORTS,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
  createLogger,
} from '@gladysassistant/integration-sdk';
import {
  FEATURE_KEYS,
  buildDevice,
  deviceIds,
  featureKeyOf,
  hostParam,
  nothingLoaded,
  nowPlaying,
  playerIdOf,
} from './devices.js';
import {
  MDNS_SERVICE,
  MDNS_TIMEOUT_SECONDS,
  mapLimit,
  mdnsCandidates,
  zoneCandidates,
} from './discovery.js';
import {
  ACTION_TEXT,
  CONNECTION_TEXT,
  ERROR_TEXT,
  LANGS,
  labelled,
  pick,
  sourceLabel,
} from './texts.js';
import { VolumioClient } from './volumio/client.js';
import {
  browseItems,
  isStream,
  parseState,
  parseSystemInfo,
  queueToList,
  sameName,
  trackKey,
} from './volumio/model.js';
import { VolumioSocket } from './volumio/socket.js';

const logger = createLogger({ name: 'volumio' });

export const WIDGET_KEY = 'now_playing';

// Scene trigger keys (manifest `scene_triggers`): permanent once published.
export const TRIGGERS = Object.freeze({ TRACK_CHANGED: 'track_changed' });

export const HUB_TIMINGS = {
  // Reads without the push channel: often while playing, rarely otherwise.
  playingPollMs: 10_000,
  idlePollMs: 60_000,
  // Push channel open: a safety read now and then.
  livePollMs: 5 * 60_000,
  // A player that failed once is read again this soon, then every minute.
  retryMs: 15_000,
  unreachablePollMs: 60_000,
  // Push channel: retry delays, after a drop and after a failed opening.
  socketQuickRetryMs: 30_000,
  socketRetryMs: 5 * 60_000,
  // Read again this long after a command when no push tells the result.
  commandSettleMs: 700,
  // A known player unreachable this long: look for its new address.
  rescanMs: 30 * 60_000,
  // Playlists and favourite radios, cached for the widget form.
  mediaCacheMs: 10 * 60_000,
  // The core's onPoll reads a player only if the hub has not for this long.
  corePollGapMs: 50_000,
  // Notifications: state check interval, and delay for the sound to start.
  notificationCheckMs: 1_000,
  notificationStartMs: 10_000,
  // The core accepts one widget refresh per 10 s: the next one waits.
  widgetRefreshGapMs: 10_000,
  // A command the REST API lacks (repeat one, play next) opens the socket.io
  // channel for it when the push is not running: this long at most.
  socketCommandWaitMs: 3_000,
};

// Playlists and radios shown in a widget form or a report, at most.
export const MAX_MEDIA = 50;
const FAVOURITE_URIS = ['radio/favourites', 'radio/myWebRadio'];
const PROBE_CONCURRENCY = 4;

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

export class VolumioHub {
  /**
   * @param {object} options
   * @param {object} options.gladys GladysIntegration (or the SDK's fake Gladys)
   * @param {typeof fetch} [options.fetch] HTTP seam (tests)
   * @param {(url: string) => object} [options.createSocket] WebSocket seam (tests)
   * @param {boolean} [options.timers] periodic timers (off in most tests)
   * @param {object} [options.timings] HUB_TIMINGS overrides
   * @param {object} [options.socketTimings] SOCKET_TIMINGS overrides
   * @param {() => number} [options.now]
   */
  constructor({ gladys, fetch, createSocket, timers = true, timings, socketTimings, now }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.createSocket = createSocket;
    this.timersEnabled = timers;
    this.timings = { ...HUB_TIMINGS, ...timings };
    this.socketTimings = socketTimings;
    this.now = now ?? (() => Date.now());
    this.config = null;
    /** @type {Map<string, object>} player records, by Volumio UUID */
    this.records = new Map();
    this.transports = new Map();
    this.connection = null;
    this.mdns = null;
    this.discoveredAt = 0;
    this.discovering = null;
    this.stopped = false;
    this.widgetRefreshAt = -Infinity;
    this.widgetTimer = null;
    /** Problems already logged, by key: their repeats go to debug. */
    this.warned = new Set();
  }

  // --- Logs ------------------------------------------------------------------
  // Info keeps the lifecycle only (players connected, lost, back, real-time
  // channel, user commands). A problem that repeats is logged once, then at
  // debug until it clears. LOG_LEVEL=debug shows everything.

  problem(key, message, level = 'warn') {
    if (this.warned.has(key)) {
      logger.debug(`${message} (again)`);
      return;
    }
    this.warned.add(key);
    logger[level](message);
  }

  resolved(key, message) {
    if (this.warned.delete(key) && message) {
      logger.info(message);
    }
  }

  label(record) {
    return `${record.name} (${record.host})`;
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(config) {
    await this.reconfigure(config);
  }

  /** Gladys reconnected (it restarted): send everything again. */
  async resync(config) {
    this.gladys.forgetPublishedStates?.();
    this.transports.clear();
    this.connection = null;
    await this.reconfigure(config);
  }

  async reconfigure(config) {
    this.config = config;
    if (!config.realtime) {
      for (const record of this.records.values()) {
        this.closeSocket(record);
      }
    }
    await this.discover();
    // A new config or a restarted Gladys: read the added players now.
    await Promise.all(
      [...this.records.values()]
        .filter((record) => record.active)
        .map((record) => this.read(record)),
    );
  }

  async stop() {
    this.stopped = true;
    clearTimeout(this.widgetTimer);
    for (const record of this.records.values()) {
      this.deactivate(record);
    }
  }

  // --- Discovery -------------------------------------------------------------

  newRecord({ id, host, name }) {
    return {
      id,
      host,
      name: name || 'Volumio',
      info: null,
      client: new VolumioClient({ host, fetch: this.fetch }),
      state: null,
      reachable: null,
      error: null,
      failures: 0,
      downSince: null,
      readAt: -Infinity,
      reading: null,
      timer: null,
      active: false,
      socket: null,
      socketTimer: null,
      live: false,
      wasLive: false,
      eio: 3,
      track: undefined,
      widgetKey: null,
      media: null,
      notifying: null,
      notification: null,
    };
  }

  /** Point a record at a new address (DHCP): new client, new push channel. */
  moveRecord(record, host) {
    if (record.host === host) {
      return;
    }
    logger.info(`${record.name}: now answers on ${host} (was ${record.host})`);
    record.host = host;
    record.client = new VolumioClient({ host, fetch: this.fetch });
    if (record.socket) {
      this.closeSocket(record);
      this.openSocket(record);
    }
  }

  /** Ask an address who it is. @returns {Promise<object>} the identity, throws otherwise */
  async probe(host) {
    const client = new VolumioClient({ host, fetch: this.fetch });
    const info = parseSystemInfo(await client.getSystemInfo());
    if (!info) {
      throw new Error(`${host}: no Volumio identity`);
    }
    return { ...info, host };
  }

  /**
   * Find the players: typed addresses, created devices, known records, mDNS,
   * then the zones of every player found. Publishes the devices.
   * Concurrent calls share the same run.
   */
  discover() {
    this.discovering ??= this.runDiscovery().finally(() => {
      this.discovering = null;
    });
    return this.discovering;
  }

  async runDiscovery() {
    this.discoveredAt = this.now();
    const created = this.createdDevices();
    const candidates = new Map();
    const add = (host, hint = {}) => {
      if (host && !candidates.has(host)) {
        candidates.set(host, hint);
      }
    };
    for (const host of this.config.hosts) {
      add(host);
    }
    for (const record of this.records.values()) {
      add(record.host, { id: record.id });
    }
    for (const device of created) {
      add(hostParam(device), { id: playerIdOf(this.gladys, device.external_id) });
    }
    for (const candidate of await this.scanMdns()) {
      add(candidate.host, candidate);
    }

    const found = new Map();
    const tried = new Set();
    const probeAll = async (hosts) => {
      const results = await mapLimit(hosts, PROBE_CONCURRENCY, (host) => this.probe(host));
      hosts.forEach((host, index) => {
        tried.add(host);
        const result = results[index];
        if (result.value && !found.has(result.value.id)) {
          found.set(result.value.id, result.value);
        } else if (result.error) {
          logger.debug(`Discovery: ${host} did not answer as a Volumio (${result.error.message})`);
        }
      });
    };
    await probeAll([...candidates.keys()]);

    // Volumio players know each other: ask each one found for its zones.
    const zoneHosts = [];
    await Promise.all(
      [...found.values()].map(async (player) => {
        try {
          const zones = await new VolumioClient({
            host: player.host,
            fetch: this.fetch,
          }).getZones();
          for (const zone of zoneCandidates(zones)) {
            if (!tried.has(zone.host) && !zoneHosts.includes(zone.host) && !found.has(zone.id)) {
              zoneHosts.push(zone.host);
            }
          }
        } catch (err) {
          logger.debug(`Discovery: no zones from ${player.host} (${err.message})`);
        }
      }),
    );
    await probeAll(zoneHosts);

    for (const player of found.values()) {
      let record = this.records.get(player.id);
      if (!record) {
        record = this.newRecord(player);
        this.records.set(player.id, record);
        logger.info(`Found ${player.name} at ${player.host} (Volumio ${player.version || '?'})`);
      } else {
        this.moveRecord(record, player.host);
      }
      record.name = player.name;
      record.info = player;
      if (record.reachable === false && !record.active) {
        record.reachable = true;
        record.error = null;
      }
      record.reachable ??= true;
    }
    // A created device not found this time is kept, with what Gladys knows.
    for (const device of created) {
      const id = playerIdOf(this.gladys, device.external_id);
      const host = hostParam(device);
      if (id && host && !this.records.has(id)) {
        this.records.set(id, this.newRecord({ id, host, name: device.name }));
      }
    }

    await this.publishDevices();
    this.syncCreated();
    await this.publishStatus();
    return this.summary();
  }

  /** The mDNS candidates relayed by the core; [] when it cannot scan. */
  async scanMdns() {
    if (typeof this.gladys.scanNetwork !== 'function') {
      this.mdns = 'unavailable';
      return [];
    }
    try {
      const results = await this.gladys.scanNetwork('mdns', {
        timeoutSeconds: MDNS_TIMEOUT_SECONDS,
      });
      const candidates = mdnsCandidates(results);
      this.mdns = candidates.length ? 'ok' : 'empty';
      logger.debug(`mDNS ${MDNS_SERVICE}: ${candidates.length} player(s)`);
      this.resolved('mdns');
      return candidates;
    } catch (err) {
      this.mdns = 'unavailable';
      // A core without mediated discovery, or a scan already running.
      this.problem('mdns', `mDNS discovery unavailable: ${err.message}`, 'debug');
      return [];
    }
  }

  createdDevices() {
    return (this.gladys.devices ?? []).filter(
      (device) => playerIdOf(this.gladys, device?.external_id) !== null,
    );
  }

  async publishDevices() {
    const devices = [...this.records.values()].map((record) =>
      buildDevice(this.gladys, record, this.language),
    );
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.resolved('publish-devices');
    } catch (err) {
      this.problem('publish-devices', `Publishing the devices failed: ${err.message}`, 'error');
    }
  }

  /** Read the players the user added, leave the others alone. */
  syncCreated() {
    const created = new Set(this.createdDevices().map((device) => device.external_id));
    for (const record of this.records.values()) {
      const isCreated = created.has(deviceIds(this.gladys, record.id).device);
      if (isCreated && !record.active) {
        this.activate(record);
      } else if (!isCreated && record.active) {
        this.deactivate(record);
      }
    }
  }

  /** "Search" in the Discovery tab, or the search action. */
  async rediscover() {
    return this.discover();
  }

  summary() {
    return {
      players: [...this.records.values()].map((record) => ({
        name: record.name,
        host: record.host,
        version: record.info?.version ?? '',
        reachable: record.reachable === true,
        live: record.live,
      })),
      mdns: this.mdns,
      invalidHosts: this.config.invalidHosts,
    };
  }

  // --- Device lifecycle (Gladys side) -------------------------------------------

  /** The user added a player: read it now (its earlier states were dropped). */
  async onDeviceCreated(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    if (!record.active) {
      this.activate(record);
    }
    await this.read(record, { force: true });
    this.nudgeWidget({ now: true });
  }

  async onDeviceDeleted(device) {
    const record = this.recordOf(device.external_id);
    if (record?.active) {
      this.deactivate(record);
    }
  }

  /** The core's onPoll (fallback): read the player unless the hub just did. */
  async pollDevice(device) {
    const record = this.recordOf(device.external_id);
    if (!record) {
      return;
    }
    if (this.now() - record.readAt < this.timings.corePollGapMs) {
      logger.debug(`${this.label(record)}: onPoll skipped, read recently`);
      return;
    }
    await this.read(record);
  }

  recordOf(externalId) {
    const id = playerIdOf(this.gladys, externalId);
    return id === null ? null : (this.records.get(id) ?? null);
  }

  activate(record) {
    record.active = true;
    this.read(record).catch(() => {});
    if (this.config.realtime) {
      this.openSocket(record);
    }
  }

  deactivate(record) {
    record.active = false;
    clearTimeout(record.timer);
    record.timer = null;
    this.closeSocket(record);
  }

  // --- Reading -----------------------------------------------------------------

  scheduleRead(record, delay = this.nextReadDelay(record)) {
    clearTimeout(record.timer);
    record.timer = null;
    if (!this.timersEnabled || this.stopped || !record.active) {
      return;
    }
    record.timer = setTimeout(() => {
      record.timer = null;
      this.read(record).catch((err) =>
        this.problem('read', `Read failed: ${err.message}`, 'error'),
      );
    }, delay);
  }

  nextReadDelay(record) {
    const t = this.timings;
    if (record.reachable === false) {
      return record.failures <= 1 ? t.retryMs : t.unreachablePollMs;
    }
    if (record.live) {
      return t.livePollMs;
    }
    return record.state?.status === 'play' ? t.playingPollMs : t.idlePollMs;
  }

  /** Read one player now. Concurrent calls share the read. */
  read(record, { force = false } = {}) {
    if (record.reading) {
      return force ? record.reading.then(() => this.read(record)) : record.reading;
    }
    record.reading = (async () => {
      try {
        const raw = await record.client.getState();
        await this.applyState(record, raw);
      } catch (err) {
        if (!err.kind) {
          throw err;
        }
        await this.applyFailure(record, err);
      } finally {
        record.reading = null;
        this.scheduleRead(record);
      }
    })();
    return record.reading;
  }

  async applyState(record, raw) {
    const state = parseState(raw);
    record.readAt = this.now();
    if (!record.connectedOnce) {
      logger.info(`${this.label(record)}: connected`);
    } else if (record.reachable === false) {
      const minutes = Math.round((this.now() - (record.downSince ?? this.now())) / 60_000);
      logger.info(`${this.label(record)} answers again after ${minutes} min`);
    }
    record.connectedOnce = true;
    record.reachable = true;
    record.error = null;
    record.failures = 0;
    record.downSince = null;
    record.state = state;

    await this.trackTransition(record, state);
    await this.publishStates(record);
    const widgetKey = JSON.stringify([
      state.status,
      state.title,
      state.artist,
      state.album,
      state.albumart,
      state.service,
      state.volume,
      state.mute,
      state.random,
      state.repeat,
    ]);
    if (widgetKey !== record.widgetKey) {
      record.widgetKey = widgetKey;
      this.nudgeWidget();
    }
    await this.publishStatus();
  }

  async applyFailure(record, err) {
    const wasKind = record.error;
    record.error = err.kind;
    record.failures += 1;
    if (record.reachable !== false) {
      record.downSince = this.now();
    }
    record.reachable = false;
    // One warning when the problem starts (or changes), not one per read.
    if (wasKind !== err.kind) {
      logger.warn(`${this.label(record)}: ${err.message}`);
    } else {
      logger.debug(`${this.label(record)}: ${err.message} (again)`);
    }
    if (record.widgetKey !== null) {
      record.widgetKey = null;
      this.nudgeWidget();
    }
    // A player that no longer answers is shown stopped (its last track
    // stays), never playing forever.
    await this.publishStates(record, { reachable: false });
    await this.publishStatus();
    // Down for a while: it may have a new address (DHCP).
    if (
      this.timersEnabled &&
      this.now() - record.downSince >= this.timings.rescanMs &&
      this.now() - this.discoveredAt >= this.timings.rescanMs
    ) {
      this.discover().catch((error) =>
        this.problem('rescan', `Discovery failed: ${error.message}`, 'error'),
      );
    }
  }

  /** "Track changed": a new title while playing, never our own notification. */
  async trackTransition(record, state) {
    if (record.notification) {
      return;
    }
    const key = trackKey(state);
    const previous = record.track;
    if (key !== null) {
      record.track = key;
    } else if (state.status !== 'play') {
      // Paused or stopped: the same track played again is a change.
      record.track = null;
    }
    if (previous === undefined || key === null || key === previous) {
      return;
    }
    try {
      await this.gladys.publishSceneEvent(TRIGGERS.TRACK_CHANGED, {
        device: deviceIds(this.gladys, record.id).device,
        title: state.title,
        artist: state.artist,
        album: state.album,
        source: sourceLabel(state, this.language),
      });
      this.resolved('scene-event');
    } catch (err) {
      this.problem('scene-event', `Scene event refused: ${err.message}`);
    }
  }

  // --- Push channel ----------------------------------------------------------------

  openSocket(record) {
    clearTimeout(record.socketTimer);
    record.socketTimer = null;
    if (this.stopped || !record.active || !this.config.realtime || record.socket) {
      return;
    }
    const socket = new VolumioSocket({
      host: record.host,
      eio: record.eio,
      createSocket: this.createSocket,
      timings: this.socketTimings,
      onState: (raw) => {
        if (record.socket !== socket) {
          return;
        }
        this.applyState(record, raw).catch((err) =>
          this.problem('push', `Push state failed: ${err.message}`, 'error'),
        );
      },
      onLive: () => {
        record.live = true;
        if (record.wasLive) {
          this.resolved(`socket:${record.id}`, `${this.label(record)}: real-time updates back`);
        } else {
          logger.info(`${this.label(record)}: real-time updates`);
        }
        record.wasLive = true;
        this.scheduleRead(record);
      },
      onClose: ({ opened, live, serverPinged, reason }) => {
        if (record.socket !== socket) {
          return;
        }
        record.socket = null;
        record.live = false;
        let delay;
        if (live && record.eio === 4 && !serverPinged) {
          // A socket.io 2 server also accepts Engine.IO 4, then waits for
          // pings the client never sends: it was a socket.io 2 after all.
          record.eio = 3;
        } else if (live) {
          // This protocol works with this player: keep it.
          record.eioKnown = true;
        }
        if (live) {
          this.problem(
            `socket:${record.id}`,
            `${this.label(record)}: real-time updates lost (${reason}), reading it instead`,
          );
          delay = this.timings.socketQuickRetryMs;
        } else {
          logger.debug(
            `${this.label(record)}: no real-time channel (EIO ${record.eio}, ${reason})`,
          );
          if (!opened && !record.eioKnown) {
            // Another socket.io generation: try the other protocol once, now.
            record.eio = record.eio === 3 ? 4 : 3;
            record.socketAttempts = (record.socketAttempts ?? 0) + 1;
          }
          delay =
            !opened && !record.eioKnown && record.socketAttempts % 2 === 1
              ? 0
              : this.timings.socketRetryMs;
        }
        if (live) {
          // Without the push, the reads take over at their own pace.
          this.scheduleRead(record);
        }
        this.scheduleSocket(record, delay);
      },
    });
    record.socket = socket;
    socket.start();
  }

  scheduleSocket(record, delay) {
    clearTimeout(record.socketTimer);
    if (!this.timersEnabled || this.stopped || !record.active || !this.config.realtime) {
      return;
    }
    record.socketTimer = setTimeout(() => {
      record.socketTimer = null;
      this.openSocket(record);
    }, delay);
  }

  closeSocket(record) {
    clearTimeout(record.socketTimer);
    record.socketTimer = null;
    record.socket?.close();
    record.socket = null;
    record.live = false;
  }

  // --- Publishing to Gladys ----------------------------------------------------------

  /**
   * The music features of a player, through publishNowPlaying (Gladys 5.3):
   * diffed by the SDK, the position sent only on a change of state or track,
   * or a seek (Gladys extrapolates it). Volume and mute go the same way: one
   * channel per feature.
   */
  async publishStates(record, { reachable = true } = {}) {
    if (!record.active) {
      return;
    }
    let snapshot;
    if (!reachable) {
      snapshot = { playback_state: MUSIC_PLAYBACK_STATE.IDLE, position: 0 };
    } else if (record.state) {
      snapshot = nowPlaying(record.state, {
        artworkUrl: record.client.artUrl(record.state.albumart),
      });
    } else {
      return;
    }
    try {
      await this.gladys.publishNowPlaying(deviceIds(this.gladys, record.id).device, snapshot);
      this.resolved('states');
    } catch (err) {
      this.problem('states', `States of ${this.label(record)} refused: ${err.message}`);
    }
  }

  /** Transport badges and the connection status, sent when they change. */
  async publishStatus() {
    await this.publishTransports();
    await this.publishConnectionStatus();
  }

  async publishTransports() {
    const entries = [];
    for (const record of this.records.values()) {
      if (!record.active || record.reachable === null) {
        continue;
      }
      const externalId = deviceIds(this.gladys, record.id).device;
      const transport = record.reachable ? DEVICE_TRANSPORTS.LOCAL : DEVICE_TRANSPORTS.UNREACHABLE;
      if (this.transports.get(externalId) !== transport) {
        entries.push({ external_id: externalId, transport });
      }
    }
    if (entries.length === 0) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      for (const entry of entries) {
        this.transports.set(entry.external_id, entry.transport);
      }
      this.resolved('transports');
    } catch (err) {
      this.problem('transports', `Transports refused: ${err.message}`);
    }
  }

  /** Connected when a player answers; the message names the others. */
  connectionStatus() {
    if (this.records.size === 0) {
      return {
        connected: false,
        message: this.config.invalidHosts.length
          ? CONNECTION_TEXT.invalidHosts
          : CONNECTION_TEXT.noPlayer,
      };
    }
    const failing = [...this.records.values()].filter((record) => record.reachable === false);
    if (failing.length === 0 && this.config.invalidHosts.length === 0) {
      return { connected: true };
    }
    const message = {};
    for (const language of LANGS) {
      const parts = failing.map((record) =>
        labelled(record.name, pick(ERROR_TEXT[record.error], language), language),
      );
      if (this.config.invalidHosts.length) {
        parts.push(pick(CONNECTION_TEXT.invalidHosts, language));
      }
      message[language] = parts.join(' · ').slice(0, 200);
    }
    return { connected: failing.length < this.records.size, message };
  }

  async publishConnectionStatus() {
    const status = this.connectionStatus();
    const key = JSON.stringify(status);
    if (key === this.connection) {
      return;
    }
    try {
      await this.gladys.setConnectionStatus(status.connected, status.message);
      this.connection = key;
      this.resolved('connection-status');
    } catch (err) {
      this.problem('connection-status', `Connection status refused: ${err.message}`);
    }
  }

  /**
   * Ask the core to pull the widget again. It accepts one call per 10 s and
   * drops the others: a change in that window is sent once the gap passed.
   */
  nudgeWidget({ now = false } = {}) {
    if (this.widgetTimer) {
      return;
    }
    const wait = this.widgetRefreshAt + this.timings.widgetRefreshGapMs - this.now();
    if (now || wait <= 0 || !this.timersEnabled) {
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
      return;
    }
    this.widgetTimer = setTimeout(() => {
      this.widgetTimer = null;
      this.widgetRefreshAt = this.now();
      this.gladys.requestWidgetRefresh(WIDGET_KEY);
    }, wait);
    this.widgetTimer.unref?.();
  }

  // --- Commands ------------------------------------------------------------------------

  /** The player of a device external id; throws a user-facing error otherwise. */
  target(deviceExternalId) {
    if (this.records.size === 0) {
      throw new Error(pick(ACTION_TEXT.noPlayer, this.language));
    }
    const record = deviceExternalId ? this.recordOf(deviceExternalId) : null;
    if (!record) {
      throw new Error(pick(ACTION_TEXT.unknownPlayer, this.language));
    }
    return record;
  }

  /** Send a command, log it, and show its effect. */
  async command(record, cmd, params = {}, what = cmd) {
    try {
      await record.client.command(cmd, params);
    } catch (err) {
      throw await this.commandError(record, err);
    }
    logger.info(`${this.label(record)}: ${what}`);
    this.afterCommand(record);
  }

  /**
   * The user-facing error of a failed command. A player that does not
   * answer is marked unreachable; one that refused is still there.
   */
  async commandError(record, err) {
    if (!err.kind) {
      return err;
    }
    if (err.kind === 'unreachable' || err.kind === 'http') {
      await this.applyFailure(record, err);
    }
    logger.warn(`${this.label(record)}: command failed: ${err.message}`);
    return new Error(
      labelled(record.name, pick(ERROR_TEXT[err.kind], this.language), this.language),
    );
  }

  /** After a command: the push says the result, else read it shortly. */
  afterCommand(record) {
    if (record.live) {
      record.socket?.requestState();
    } else if (this.timersEnabled) {
      this.scheduleRead(record, this.timings.commandSettleMs);
    } else {
      this.read(record).catch(() => {});
    }
  }

  /**
   * A device feature: volume, play, pause, previous, next, notification, and
   * since Gladys 5.3 the playback state, position, shuffle, repeat, mute.
   */
  async setValue(device, feature, value) {
    const record = this.target(device.external_id);
    const key = featureKeyOf(this.gladys, record.id, feature.external_id);
    switch (key) {
      case FEATURE_KEYS.VOLUME:
        return this.setVolume(record, value);
      case FEATURE_KEYS.PLAYBACK_STATE:
        return this.setPlayback(record, Number(value));
      case FEATURE_KEYS.POSITION:
        return this.seek(record, Number(value));
      case FEATURE_KEYS.SHUFFLE:
        return this.command(
          record,
          'random',
          { value: Number(value) === 1 },
          `shuffle ${Number(value) === 1 ? 'on' : 'off'}`,
        );
      case FEATURE_KEYS.REPEAT:
        return this.setRepeat(record, Number(value));
      case FEATURE_KEYS.MUTE:
        return this.setMute(record, Number(value) === 1);
      case FEATURE_KEYS.PLAY:
        return this.play(record);
      case FEATURE_KEYS.PAUSE:
        return this.pause(record);
      case FEATURE_KEYS.PREVIOUS:
        return this.command(record, 'prev', {}, 'previous track');
      case FEATURE_KEYS.NEXT:
        return this.command(record, 'next', {}, 'next track');
      case FEATURE_KEYS.PLAY_NOTIFICATION: {
        // The core waits 5 s for the answer: the sound and the resume of
        // the music run on their own, their errors are logged.
        const started = this.notify(record, String(value ?? ''), {
          volume: this.config.notificationVolume || null,
          resume: true,
        });
        started.catch(() => {});
        return undefined;
      }
      default:
        throw new Error(`Feature ${feature.external_id} cannot be controlled`);
    }
  }

  async setVolume(record, value) {
    const volume = Math.min(100, Math.max(0, Math.round(Number(value))));
    if (!Number.isFinite(volume)) {
      throw new Error(`Invalid volume ${value}`);
    }
    await this.command(record, 'volume', { volume }, `volume ${volume}`);
  }

  async setMute(record, mute) {
    await this.command(
      record,
      'volume',
      { volume: mute ? 'mute' : 'unmute' },
      mute ? 'mute' : 'unmute',
    );
  }

  play(record) {
    return this.command(record, 'play');
  }

  /** music/playback_state: 1 play, 0 pause (a web radio stops), 2 stop. */
  setPlayback(record, value) {
    switch (value) {
      case MUSIC_PLAYBACK_STATE.PLAYING:
        return this.play(record);
      case MUSIC_PLAYBACK_STATE.PAUSED:
        return this.pause(record);
      case MUSIC_PLAYBACK_STATE.IDLE:
        return this.command(record, 'stop');
      default:
        throw new Error(`Invalid playback state ${value}`);
    }
  }

  /** music/position: a seek, in seconds. A web radio cannot be sought. */
  async seek(record, value) {
    if (!Number.isFinite(value) || value < 0) {
      throw new Error(`Invalid position ${value}`);
    }
    const state = record.state;
    if (!state || nothingLoaded(state) || state.status === 'stop') {
      // Nothing to seek in: Volumio would ignore it.
      return;
    }
    if (isStream(state)) {
      throw new Error(pick(ACTION_TEXT.notSeekable, this.language));
    }
    const position = Math.round(value);
    await this.command(record, 'seek', { position }, `seek ${position} s`);
  }

  /**
   * music/repeat. The REST API sets repeat on or off (and always clears
   * "repeat one"); "repeat one" is a socket.io event (`setRepeat`).
   */
  async setRepeat(record, value) {
    if (value === MUSIC_REPEAT_MODE.ONE) {
      await this.withSocket(record, (socket) => {
        socket.emit('setRepeat', { value: true, repeatSingle: true });
      });
      logger.info(`${this.label(record)}: repeat one`);
      this.afterCommand(record);
      return;
    }
    if (value !== MUSIC_REPEAT_MODE.OFF && value !== MUSIC_REPEAT_MODE.ALL) {
      throw new Error(`Invalid repeat mode ${value}`);
    }
    const on = value === MUSIC_REPEAT_MODE.ALL;
    await this.command(record, 'repeat', { value: on }, `repeat ${on ? 'all' : 'off'}`);
  }

  /**
   * Run `fn(socket)` with a live socket.io channel to the player: the push
   * channel when it runs, else one opened for it (closed right after). For
   * what the REST API lacks; throws a user-facing error without a channel.
   */
  async withSocket(record, fn) {
    if (record.socket?.live) {
      return fn(record.socket);
    }
    for (const eio of record.eioKnown ? [record.eio] : [record.eio, record.eio === 3 ? 4 : 3]) {
      let settle;
      const outcome = new Promise((resolve) => {
        settle = resolve;
      });
      const socket = new VolumioSocket({
        host: record.host,
        eio,
        createSocket: this.createSocket,
        timings: { ...this.socketTimings, openTimeoutMs: this.timings.socketCommandWaitMs },
        onState: () => {},
        onLive: () => settle(true),
        onClose: () => settle(false),
      });
      socket.start();
      if (await outcome) {
        try {
          return await fn(socket);
        } finally {
          // Let the last packets leave before the channel closes.
          setTimeout(() => socket.close(), 500).unref?.();
        }
      }
      socket.close();
    }
    throw new Error(
      labelled(record.name, pick(ACTION_TEXT.noRealtime, this.language), this.language),
    );
  }

  /** A read for the music panel; errors become user-facing ones. */
  async catalogRead(record, what, fn) {
    logger.debug(`${this.label(record)}: ${what}`);
    try {
      return await fn(record.client);
    } catch (err) {
      throw await this.commandError(record, err);
    }
  }

  /** Add items at the end of the queue (the music panel, a scene). */
  async addToQueue(record, items, what) {
    try {
      await record.client.addToQueue(items);
    } catch (err) {
      throw await this.commandError(record, err);
    }
    logger.info(`${this.label(record)}: ${what}`);
    this.afterCommand(record);
  }

  /** The bytes of an artwork (a cover of a player, or of the Internet). */
  downloadArtwork(url, options) {
    return new VolumioClient({ host: 'artwork', fetch: this.fetch }).download(url, options);
  }

  /** Pause; a web radio is stopped instead (Volumio cannot pause a stream). */
  pause(record) {
    return isStream(record.state) ? this.command(record, 'stop') : this.command(record, 'pause');
  }

  toggle(record) {
    return record.state?.status === 'play' ? this.pause(record) : this.play(record);
  }

  async setPlayMode(record, { shuffle, repeat }) {
    if (shuffle === 'on' || shuffle === 'off') {
      await this.command(record, 'random', { value: shuffle === 'on' }, `shuffle ${shuffle}`);
    }
    if (repeat === 'on' || repeat === 'off') {
      await this.command(record, 'repeat', { value: repeat === 'on' }, `repeat ${repeat}`);
    }
  }

  clearQueue(record) {
    return this.command(record, 'clearQueue', {}, 'queue cleared');
  }

  /** Playlists and favourite radios of a player, cached a few minutes. */
  async media(record, { fresh = false } = {}) {
    if (!fresh && record.media && this.now() - record.media.at < this.timings.mediaCacheMs) {
      return record.media;
    }
    const playlists = await record.client.listPlaylists().catch((err) => {
      // "No Playlists" comes back as an error.
      if (err.kind === 'refused') {
        return [];
      }
      throw err;
    });
    const radios = [];
    for (const uri of FAVOURITE_URIS) {
      try {
        for (const item of browseItems(await record.client.browse(uri))) {
          if (!radios.some((radio) => radio.uri === item.uri)) {
            radios.push(item);
          }
        }
      } catch (err) {
        if (err.kind !== 'refused') {
          throw err;
        }
      }
    }
    record.media = {
      at: this.now(),
      playlists: [...new Set(playlists)].sort((a, b) => a.localeCompare(b)),
      radios,
    };
    return record.media;
  }

  async playPlaylist(record, name) {
    const wanted = String(name ?? '').trim();
    if (!wanted) {
      throw new Error(pick(ACTION_TEXT.emptyName, this.language));
    }
    const { playlists } = await this.mediaOrFail(record, { fresh: true });
    const playlist = playlists.find((candidate) => sameName(candidate, wanted));
    if (!playlist) {
      throw new Error(pick(ACTION_TEXT.playlistNotFound, this.language)(wanted, record.name));
    }
    await this.command(record, 'playplaylist', { name: playlist }, `playlist ${playlist}`);
    return playlist;
  }

  async playFavouriteRadio(record, name) {
    const wanted = String(name ?? '').trim();
    if (!wanted) {
      throw new Error(pick(ACTION_TEXT.emptyName, this.language));
    }
    const { radios } = await this.mediaOrFail(record, { fresh: true });
    const radio = radios.find((candidate) => sameName(candidate.title, wanted));
    if (!radio) {
      throw new Error(pick(ACTION_TEXT.radioNotFound, this.language)(wanted, record.name));
    }
    await this.replaceAndPlay(record, radio, `web radio ${radio.title}`);
    return radio.title;
  }

  async mediaOrFail(record, options) {
    try {
      return await this.media(record, options);
    } catch (err) {
      throw await this.commandError(record, err);
    }
  }

  async replaceAndPlay(record, item, what) {
    try {
      await record.client.replaceAndPlay(item);
    } catch (err) {
      throw await this.commandError(record, err);
    }
    logger.info(`${this.label(record)}: ${what}`);
    this.afterCommand(record);
  }

  /** Play an address (a stream, a sound): `resume` plays it as a notification. */
  async playUrl(record, url, { title, volume = null, resume = false } = {}) {
    const address = checkUrl(url, this.language);
    if (resume) {
      return this.notify(record, address, { title, volume });
    }
    if (volume !== null) {
      await this.setVolume(record, volume);
    }
    return this.replaceAndPlay(record, streamItem(address, title), 'playing an address');
  }

  // --- Notifications ---------------------------------------------------------------------

  /**
   * Play `url` as a notification: remember what played, play the sound at
   * the notification volume, wait for its end (or the configured maximum),
   * then put the queue, the position and the volume back. Notifications on
   * one player run one after the other.
   * @returns {Promise<void>} resolved once the sound started
   */
  notify(record, url, { title, volume = null, resume = true } = {}) {
    let started;
    const startedPromise = new Promise((resolve, reject) => {
      started = { resolve, reject };
    });
    const previous = record.notifying ?? Promise.resolve();
    const run = previous
      .catch(() => {})
      .then(() => this.runNotification(record, url, { title, volume, resume }, started));
    record.notifying = run;
    run
      .catch((err) => {
        started.reject(err);
        logger.warn(`${this.label(record)}: notification failed: ${err.message}`);
      })
      .finally(() => {
        if (record.notifying === run) {
          record.notifying = null;
        }
      });
    return startedPromise;
  }

  async runNotification(record, url, { title, volume, resume }, started) {
    const address = checkUrl(url, this.language);
    const { client } = record;
    record.notification = { url: address };
    try {
      const before = resume
        ? { state: parseState(await client.getState()), queue: await client.getQueue() }
        : null;
      const changeVolume = volume !== null && volume !== undefined;
      if (changeVolume) {
        if (before?.state.mute) {
          await client.command('volume', { volume: 'unmute' });
        }
        await client.command('volume', { volume: Math.min(100, Math.max(0, Math.round(volume))) });
      }
      // A one-sound queue on repeat would loop until the length limit.
      if (before?.state.repeat) {
        await client.command('repeat', { value: false });
      }
      await client.replaceAndPlay(streamItem(address, title));
      logger.info(`${this.label(record)}: notification played`);
      started.resolve();
      if (!resume) {
        return;
      }
      await this.waitForEnd(record);
      await this.restore(record, before, changeVolume);
    } finally {
      record.notification = null;
      this.afterCommand(record);
    }
  }

  /** Wait while the notification plays: until it stops, or the maximum. */
  async waitForEnd(record) {
    const t = this.timings;
    const begin = this.now();
    let playingUri = null;
    let failures = 0;
    while (!this.stopped) {
      await sleep(t.notificationCheckMs);
      let state;
      try {
        state = parseState(await record.client.getState());
        failures = 0;
      } catch (err) {
        failures += 1;
        if (failures >= 3) {
          throw err;
        }
        continue;
      }
      const elapsed = this.now() - begin;
      if (playingUri === null) {
        if (state.status === 'play') {
          playingUri = state.uri;
        } else if (elapsed >= t.notificationStartMs) {
          logger.debug(`${this.label(record)}: the notification did not start`);
          return;
        }
      } else if (state.status !== 'play' || state.uri !== playingUri) {
        return;
      }
      if (elapsed >= this.config.notificationMaxMs) {
        // A stream never ends on its own.
        await record.client.command('stop');
        return;
      }
    }
  }

  /** Put back what played before the notification. */
  async restore(record, before, volumeChanged) {
    const { client } = record;
    const { state, queue } = before;
    const list = queueToList(queue);
    if (state.status === 'play' && list.length) {
      const index = Math.min(Math.max(0, state.position ?? 0), list.length - 1);
      await client.replaceAndPlay({ list, index });
      if (!isStream(state) && state.seekMs >= 1000) {
        await client.command('seek', { position: Math.floor(state.seekMs / 1000) });
      }
    } else {
      // Nothing played: put the queue back without playing it.
      await client.command('stop');
      await client.command('clearQueue');
      if (list.length) {
        await client.addToQueue(list);
      }
    }
    if (state.repeat && state.repeatSingle) {
      // "Repeat one" only exists over socket.io; without it, repeat all.
      await this.withSocket(record, (socket) =>
        socket.emit('setRepeat', { value: true, repeatSingle: true }),
      ).catch(() => client.command('repeat', { value: true }));
    } else if (state.repeat) {
      await client.command('repeat', { value: true });
    }
    if (volumeChanged && state.volume !== null) {
      await client.command('volume', { volume: state.volume });
    }
    if (volumeChanged && state.mute) {
      await client.command('volume', { volume: 'mute' });
    }
    logger.debug(`${this.label(record)}: music restored after the notification`);
  }

  /** What the widget shows: the chosen player, else the first one added. */
  view(deviceExternalId) {
    if (deviceExternalId) {
      return this.recordOf(deviceExternalId);
    }
    const active = [...this.records.values()].filter((record) => record.active);
    active.sort((a, b) => a.name.localeCompare(b.name));
    return active[0] ?? null;
  }
}

/** The queue item of an address: Volumio plays it through its web radio service. */
export function streamItem(uri, title) {
  return {
    service: 'webradio',
    type: 'webradio',
    title: String(title ?? '').trim() || 'Gladys',
    uri,
  };
}

/** An http(s) address, or a user-facing error. */
export function checkUrl(raw, language) {
  const text = String(raw ?? '').trim();
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new Error(pick(ACTION_TEXT.invalidUrl, language));
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(pick(ACTION_TEXT.invalidUrl, language));
  }
  return url.href;
}
