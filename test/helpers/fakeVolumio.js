// -----------------------------------------------------------------------------
// Simulated Volumio players, built from the fixtures (test/fixtures/volumio):
// the REST API (a `fetch` double for the network of the tests, or a real
// HTTP server with `serve()`), and the socket.io push channel (a WebSocket
// factory speaking Engine.IO 3 or 4, or refusing it).
//
// Each player keeps a state and a queue and applies the commands the way
// Volumio does for what the integration sends, then pushes `pushState` to
// its open sockets.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

export const readFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/volumio/${name}`, import.meta.url), 'utf8'));

const clone = (value) => structuredClone(value);

// Real answers of a Volumio 2 (browse, search, getState, getQueue), read on
// a test bench: see test/fixtures/volumio/README.md.
export const LIBRARY = readFixture('library-v2.json');

/** Volumio decodes `uri` and `query` once more than the HTTP layer. */
const decodeTwice = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The tracks Volumio queues for an item: a container is exploded, a playlist URI adds nothing. */
export function explode(item) {
  const uri = item?.uri ?? '';
  if (uri.startsWith('playlists/') && !uri.includes('://')) {
    return [];
  }
  if (/^(albums|artists|genres):\/\//.test(uri)) {
    const level = LIBRARY.browse[uri];
    if (!level) {
      return [];
    }
    return level.navigation.lists
      .flatMap((list) => list.items)
      .filter((row) => row.type === 'song')
      .map((row) => queueEntry(row));
  }
  return [queueEntry(item)];
}

/** A queue entry as getQueue lists it: the title is `name`. */
const queueEntry = (item) => {
  const { title, ...rest } = clone(item);
  return { ...rest, name: item.name ?? title ?? '', type: 'track' };
};

// The smallest valid PNG (1 × 1), served as album art.
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const PLAYERS = {
  living: { info: 'system-info-living.json', state: 'state-library.json', host: '192.0.2.40:3000' },
  office: { info: 'system-info-office.json', state: 'state-empty.json', host: '192.0.2.41:3000' },
  kitchen: {
    info: 'system-info-kitchen.json',
    state: 'state-webradio.json',
    host: '192.0.2.42:3000',
  },
};

export class FakeVolumio {
  /**
   * @param {object} [options]
   * @param {'living'|'office'|'kitchen'} [options.preset]
   * @param {string} [options.host] `ip:port` it answers on
   * @param {object} [options.state] getState overrides
   * @param {'eio3'|'eio4'|'none'} [options.push] what the socket.io endpoint does
   * @param {number} [options.soundReads] reads before a played sound file ends
   */
  constructor({ preset = 'living', host, state, push = 'eio3', soundReads = 2 } = {}) {
    const base = PLAYERS[preset];
    this.info = readFixture(base.info);
    this.host = host ?? base.host;
    this.state = { ...readFixture(base.state), ...state };
    this.queue =
      preset === 'living'
        ? readFixture('queue-library.json').queue
        : preset === 'kitchen'
          ? [
              {
                uri: this.state.uri,
                service: 'webradio',
                name: this.state.title,
                type: 'webradio',
                albumart: this.state.albumart,
                trackType: 'webradio',
              },
            ]
          : [];
    // The names of listplaylists, each with a part of the library queue.
    const tracks = readFixture('queue-library.json').queue;
    this.playlists = Object.fromEntries(
      readFixture('playlists.json').map((name, index) => [name, tracks.slice(index)]),
    );
    this.favourites = readFixture('browse-favourites.json');
    this.myWebRadios = readFixture('browse-mywebradio.json');
    this.zones = readFixture('zones.json');
    this.art = PNG_1PX;
    this.online = true;
    this.push = push;
    this.soundReads = soundReads;
    this.soundLeft = null;
    this.requests = [];
    this.browsed = [];
    this.socketEvents = [];
    this.commands = [];
    this.sockets = new Set();
  }

  get id() {
    return this.info.id;
  }

  // --- REST ------------------------------------------------------------------

  /** Answer one request: `{ status, body, type }` (body: string or Buffer). */
  handle(method, url, body) {
    const { pathname, searchParams } = new URL(url);
    const query = Object.fromEntries(searchParams);
    this.requests.push({ method, path: pathname, query, body });
    const json = (data, status = 200) => ({
      status,
      body: JSON.stringify(data),
      type: 'application/json',
    });
    const route = `${method} ${pathname.replace(/\/$/, '')}`;
    switch (route) {
      case 'GET /api/v1/getSystemInfo':
        return json(this.info);
      case 'GET /api/v1/getState':
        this.tickSound();
        return json(this.state);
      case 'GET /api/v1/getQueue':
        return json({ queue: this.queue });
      case 'GET /api/v1/listplaylists':
        return json(Object.keys(this.playlists));
      case 'GET /api/v1/getzones':
        return json(this.zones);
      case 'GET /api/v1/browse': {
        const uri = query.uri === undefined ? '' : decodeTwice(query.uri);
        this.browsed.push(uri);
        if (uri === 'radio/favourites') {
          return json(this.favourites);
        }
        if (uri === 'radio/myWebRadio') {
          return json(this.myWebRadios);
        }
        if (uri.startsWith('playlists/') && this.playlists[uri.slice(10)]) {
          return json({
            navigation: {
              lists: [
                {
                  items: this.playlists[uri.slice(10)].map((entry) => ({
                    ...entry,
                    title: entry.name ?? entry.title,
                    type: 'song',
                  })),
                },
              ],
            },
          });
        }
        if (LIBRARY.browse[uri]) {
          return json(LIBRARY.browse[uri]);
        }
        return json({ error: 'No Result' });
      }
      case 'GET /api/v1/search': {
        const found = LIBRARY.search[decodeTwice(query.query ?? '').toLowerCase()];
        return json(
          found ?? {
            navigation: {
              isSearchResult: true,
              lists: [{ type: 'title', title: 'No Results', items: [] }],
            },
          },
        );
      }
      case 'GET /api/v1/commands':
        return json(this.command(query));
      case 'POST /api/v1/replaceAndPlay':
        return json(this.replaceAndPlay(body));
      case 'POST /api/v1/addToQueue': {
        const added = (Array.isArray(body) ? body : [body]).flatMap((item) => explode(item));
        // CorePlayQueue.addQueueItems: items equal to the end of the queue are not added again.
        const tail = this.queue.slice(-added.length).map((entry) => entry.uri);
        const same =
          this.queue.length >= added.length &&
          tail.join('\n') === added.map((entry) => entry.uri).join('\n');
        if (!same) {
          this.queue.push(...added);
        }
        this.changed();
        return json({ response: 'success' });
      }
      case 'GET /albumart':
        return { status: 200, body: this.art, type: 'image/png' };
      default:
        return { status: 404, body: 'Not found', type: 'text/plain' };
    }
  }

  /** A sound file played as a notification ends after a few reads. */
  tickSound() {
    if (this.soundLeft === null || this.state.status !== 'play') {
      return;
    }
    this.soundLeft -= 1;
    if (this.soundLeft <= 0) {
      this.soundLeft = null;
      this.state.status = 'stop';
      this.state.seek = 0;
      this.changed();
    }
  }

  command(query) {
    this.commands.push(
      query.value === undefined &&
        query.volume === undefined &&
        query.name === undefined &&
        query.position === undefined &&
        query.N === undefined
        ? query.cmd
        : `${query.cmd} ${query.volume ?? query.value ?? query.name ?? query.position ?? query.N}`,
    );
    const state = this.state;
    switch (query.cmd) {
      case 'play':
        if (query.N !== undefined) {
          this.load(Number(query.N));
        }
        if (this.queue.length) {
          state.status = 'play';
        }
        break;
      case 'pause':
        state.status = 'pause';
        break;
      case 'stop':
        state.status = 'stop';
        state.seek = 0;
        this.soundLeft = null;
        break;
      case 'toggle':
        state.status = state.status === 'play' ? 'pause' : 'play';
        break;
      case 'next':
        this.load(Math.min(this.queue.length - 1, (state.position ?? 0) + 1));
        break;
      case 'prev':
        this.load(Math.max(0, (state.position ?? 0) - 1));
        break;
      case 'volume':
        if (query.volume === 'mute') {
          state.mute = true;
        } else if (query.volume === 'unmute') {
          state.mute = false;
        } else {
          state.volume = Number(query.volume);
          state.mute = false;
        }
        break;
      case 'random':
        state.random = query.value === undefined ? !state.random : query.value === 'true';
        break;
      case 'repeat':
        state.repeat = query.value === undefined ? !state.repeat : query.value === 'true';
        break;
      case 'seek':
        state.seek = Number(query.position) * 1000;
        break;
      case 'clearQueue':
        this.queue = [];
        Object.assign(state, readFixture('state-empty.json'), {
          volume: state.volume,
          mute: state.mute,
          random: state.random,
          repeat: state.repeat,
        });
        break;
      case 'playplaylist': {
        // Volumio answers "Success" even for a playlist it does not have.
        const items = this.playlists[query.name];
        if (items) {
          this.queue = clone(items);
          this.load(0);
          state.status = 'play';
        }
        break;
      }
      default:
        return { Error: 'command not recognized' };
    }
    this.changed();
    return { time: Date.now(), response: `${query.cmd} Success` };
  }

  replaceAndPlay(body) {
    if (body?.uri?.startsWith('playlists/') && !body.uri.includes('://')) {
      // Played by its title, like Volumio (playPlaylist).
      this.queue = [];
      this.command({ cmd: 'playplaylist', name: body.title });
      return { response: 'success' };
    }
    if (body?.uri) {
      this.queue = explode(body);
      if (this.queue.length === 0) {
        // An URI that no longer exists: emptied, and "success" all the same.
        Object.assign(this.state, readFixture('state-empty.json'), {
          volume: this.state.volume,
          mute: this.state.mute,
        });
        this.changed();
        return { response: 'success' };
      }
      this.load(0);
    } else if (Array.isArray(body?.list) && body.index !== undefined) {
      this.queue = clone(body.list);
      this.load(body.index);
    } else if (body?.item?.uri) {
      this.queue = [clone(body.item)];
      this.load(0);
    } else {
      return { error: 'Could not Replace and Play Item' };
    }
    this.state.status = 'play';
    // A sound file (not a stream) ends on its own.
    this.soundLeft = /\.(mp3|wav|ogg)$/.test(this.state.uri) && body?.uri ? this.soundReads : null;
    this.changed();
    return { response: 'success' };
  }

  /** A socket.io event of the web interface (what the REST API lacks). */
  socketEvent(name, payload) {
    this.socketEvents.push([name, payload]);
    if (name === 'setRepeat') {
      this.state.repeat = payload.value === true;
      this.state.repeatSingle = payload.value === true && payload.repeatSingle === true;
      this.changed();
    } else if (name === 'moveQueue' && this.moveQueue !== false) {
      // CoreStateMachine.moveQueueItem: the current position follows.
      const { from, to } = payload;
      const current = this.state.position;
      if (from < current && to > current) {
        this.state.position -= 1;
      } else if (from > current && to <= current) {
        this.state.position += 1;
      } else if (from === current) {
        this.state.position = to;
      }
      if (this.queue.length > to) {
        this.queue.splice(to, 0, this.queue.splice(from, 1)[0]);
      }
    }
    // playNext: Volumio 2 has none, the event is ignored.
  }

  /** Make queue entry `position` the current track. */
  load(position) {
    const item = this.queue[position];
    if (!item) {
      return;
    }
    const radio = item.service === 'webradio';
    Object.assign(this.state, {
      position,
      title: item.title ?? item.name ?? '',
      artist: item.artist ?? '',
      album: item.album ?? '',
      albumart: item.albumart ?? '/albumart',
      uri: item.uri,
      trackType: radio ? 'webradio' : (item.trackType ?? ''),
      stream: radio ? 'webradio' : (item.trackType ?? ''),
      service: item.service,
      duration: radio ? 0 : (item.duration ?? 0),
      seek: 0,
    });
  }

  // --- Push ------------------------------------------------------------------

  /** Push the state to every open socket, like Volumio after any change. */
  changed() {
    for (const socket of this.sockets) {
      socket.pushState(this.state);
    }
  }

  /** Close every socket, as when the player restarts. */
  dropSockets() {
    for (const socket of [...this.sockets]) {
      socket.serverClose();
    }
  }
}

/**
 * A WebSocket double for one connection to a player's socket.io endpoint.
 * It implements what src/volumio/socket.js uses: addEventListener, send, close.
 */
class FakeSocket {
  constructor(player, url) {
    this.player = player;
    this.url = url;
    this.listeners = { message: [], close: [], error: [] };
    this.sent = [];
    this.open = true;
    this.eio = Number(new URL(url).searchParams.get('EIO'));
    queueMicrotask(() => this.connect());
  }

  addEventListener(type, listener) {
    this.listeners[type]?.push(listener);
  }

  emit(type, event = {}) {
    for (const listener of this.listeners[type] ?? []) {
      listener(event);
    }
  }

  deliver(data) {
    if (this.open) {
      this.emit('message', { data });
    }
  }

  connect() {
    const { player } = this;
    // A real socket.io 2 server also opens an Engine.IO 4 request, then
    // behaves as Engine.IO 3 (it waits for the client pings).
    const lenient = player.push === 'eio3' && player.acceptsAnyEio;
    const speaks = player.push === 'eio3' ? 3 : player.push === 'eio4' ? 4 : null;
    if (!player.online || speaks === null || (speaks !== this.eio && !lenient)) {
      // Refused: wrong protocol version, or no socket.io at all.
      this.serverClose();
      return;
    }
    player.sockets.add(this);
    this.deliver(
      `0${JSON.stringify({ sid: 'fake', upgrades: [], pingInterval: 25000, pingTimeout: 5000 })}`,
    );
    if (speaks === 3) {
      this.deliver('40');
    }
  }

  send(packet) {
    this.sent.push(packet);
    if (!this.open) {
      return;
    }
    if (packet === '2') {
      this.deliver('3');
    } else if (packet === '40') {
      this.deliver('40{"sid":"fake-ns"}');
    } else if (packet.startsWith('42')) {
      const [name, payload] = JSON.parse(packet.slice(2));
      if (name === 'getState') {
        this.pushState(this.player.state);
      } else {
        this.player.socketEvent(name, payload);
      }
    }
  }

  pushState(state) {
    queueMicrotask(() => this.deliver(`42${JSON.stringify(['pushState', state])}`));
  }

  /** The player ends the connection. */
  serverClose() {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.player.sockets.delete(this);
    this.emit('close');
  }

  /** The integration ends the connection. */
  close() {
    this.open = false;
    this.player.sockets.delete(this);
  }
}

/**
 * The network of the tests: a `fetch` double and a WebSocket factory that
 * reach the players by their `ip:port`; anything else does not answer.
 * @param {FakeVolumio[]} players
 */
export function createNetwork(players) {
  const byHost = () => new Map(players.map((player) => [player.host, player]));
  const sockets = [];
  return {
    players,
    sockets,
    add(player) {
      players.push(player);
    },
    async fetch(url, init = {}) {
      const { host } = new URL(url);
      const player = byHost().get(host);
      if (!player || !player.online) {
        throw new TypeError('fetch failed', { cause: { code: 'EHOSTUNREACH' } });
      }
      if (player.stall?.has(new URL(url).pathname)) {
        // An answer that never comes in time (AbortSignal.timeout).
        throw new DOMException('The operation timed out.', 'TimeoutError');
      }
      const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
      const answer = player.handle(init.method ?? 'GET', url, body);
      return new Response(answer.body, {
        status: answer.status,
        headers: { 'content-type': answer.type },
      });
    },
    createSocket(url) {
      const host = new URL(url).host;
      const player = byHost().get(host) ?? new FakeVolumio({ host, push: 'none' });
      const socket = new FakeSocket(player, url);
      sockets.push(socket);
      return socket;
    },
  };
}

/**
 * Serve a player over real HTTP on 127.0.0.1 (client and probe tests).
 * @returns {Promise<{ host: string, close: () => Promise<void> }>}
 */
export async function serve(player) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const body = raw ? JSON.parse(raw) : undefined;
      if (!player.online) {
        req.socket.destroy();
        return;
      }
      const answer = player.handle(req.method, `http://${req.headers.host}${req.url}`, body);
      res.writeHead(answer.status, { 'content-type': answer.type });
      res.end(answer.body);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const host = `127.0.0.1:${server.address().port}`;
  return {
    host,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}
