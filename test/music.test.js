// -----------------------------------------------------------------------------
// The Gladys 5.3 music player: the now-playing features published by
// publishNowPlaying, their commands, and the catalog of the music panel
// (browse, search, play, queue, artwork), against the SDK's fake Gladys and
// the fake Volumio (answers read on a real Volumio 2, see
// test/fixtures/volumio/README.md).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import jpeg from 'jpeg-js';
import {
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
  validateMediaItems,
} from '@gladysassistant/integration-sdk';
import { imageInfo } from '../src/artwork-resize.js';
import { kindOf, mediaId, parseId } from '../src/catalog.js';
import { LIBRARY, explode } from './helpers/fakeVolumio.js';
import { FakeVolumio, createAll, createWorld, ids, settle } from './helpers/world.js';

const ALBUM = 'albums://Alpha%20Band/First%20Light';
const PLAYLIST = 'playlists/Apéro du soir';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

/** The player as Volumio 2 answered on the bench: the album playing, its queue. */
function benchPlayer(options = {}) {
  const player = new FakeVolumio({ state: LIBRARY.state.playing, ...options });
  player.queue = structuredClone(LIBRARY.queue.queue);
  player.playlists = { 'Apéro du soir': explode({ uri: 'albums://Alpha%20Band/First%20Light' }) };
  return player;
}

const fid = (w, key) => ids(w.gladys, w.players[0]).feature(key);
const state = (w, key) => w.fake.lastState(fid(w, key));
const published = (w, key) =>
  w.fake.states.filter((s) => s.device_feature_external_id === fid(w, key)).length;
const device = (w) => ({ external_id: ids(w.gladys, w.players[0]).device, selector: 'salon' });
const set = async (w, key, value) => {
  const ack = await w.fake.setValue(device(w), { external_id: fid(w, key) }, value);
  await settle();
  return ack;
};
const valid = (ack) => {
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(validateMediaItems(ack.data.items), []);
  return ack.data.items;
};
const titles = (items) => items.map((item) => item.title);
const queueNames = (player) => player.queue.map((entry) => entry.name ?? entry.title);

test('the device carries the music features of Gladys 5.3, writable ones confirmed by Volumio', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const [player] = w.fake.discoveredDevices;
  const byType = (type) => player.features.find((f) => f.type === type);
  // The SDK convention `${device}:${type}`: the keys of 1.0 were the types already.
  for (const f of player.features) {
    assert.equal(f.external_id, `${device(w).external_id}:${f.type}`);
  }
  for (const type of ['title', 'artist', 'album', 'artwork']) {
    assert.deepEqual([byType(type).read_only, byType(type).min, byType(type).max], [true, 0, 0]);
  }
  assert.deepEqual(
    [byType('playback_state').read_only, byType('playback_state').max],
    [false, MUSIC_PLAYBACK_STATE.IDLE],
  );
  assert.equal(byType('repeat').max, MUSIC_REPEAT_MODE.ONE);
  assert.equal(byType('position').unit, 'seconds');
  for (const feature of player.features.filter((f) => !f.read_only)) {
    const legacy = ['play', 'pause', 'previous', 'next', 'play_notification'];
    assert.equal(feature.has_feedback, !legacy.includes(feature.type), feature.type);
  }
  for (const feature of player.features) {
    assert.equal(feature.keep_history, false, feature.type);
  }
});

test('what plays is published once per change; stopped keeps the track, an empty queue clears it', async (t) => {
  const w = await world(t, { players: [benchPlayer({ push: 'none' })] });
  const [living] = w.players;
  assert.equal(state(w, 'playback_state'), MUSIC_PLAYBACK_STATE.PLAYING);
  assert.equal(state(w, 'title'), 'Dawn 1');
  assert.equal(state(w, 'artist'), 'Alpha Band');
  assert.equal(state(w, 'album'), 'First Light');
  assert.equal(state(w, 'duration'), 25);
  assert.equal(state(w, 'position'), 2); // seek 1543 ms
  assert.equal(state(w, 'shuffle'), 1);
  assert.equal(state(w, 'repeat'), MUSIC_REPEAT_MODE.OFF);
  assert.equal(state(w, 'mute'), 1);
  // No mixer on the bench: Volumio says "", no volume is published.
  assert.equal(published(w, 'volume'), 0);
  const key = state(w, 'artwork');
  assert.match(key, /^art-[0-9a-f]{12}$/);
  assert.match(w.gladys.artworkUrls.get(key), /^http:\/\/192\.0\.2\.40:3000\/albumart\?cacheid=/);

  // The same state read again: nothing sent (the position is extrapolated).
  const before = w.fake.states.length;
  living.state.seek += 1000;
  await w.hub.read(w.hub.records.get(living.id));
  assert.equal(w.fake.states.length, before);

  // Stopped: Volumio keeps the track (bench), IDLE and position 0.
  Object.assign(living.state, LIBRARY.state.stopped);
  await w.hub.read(w.hub.records.get(living.id));
  assert.equal(state(w, 'playback_state'), MUSIC_PLAYBACK_STATE.IDLE);
  assert.equal(state(w, 'title'), 'Dawn 1');
  assert.equal(state(w, 'position'), 0);

  // Empty queue: Volumio names its logo (`/albumart`), Gladys gets nothing.
  living.state = structuredClone(LIBRARY.state.empty);
  await w.hub.read(w.hub.records.get(living.id));
  for (const type of ['title', 'artist', 'album', 'artwork']) {
    assert.equal(state(w, type), '', type);
  }
  assert.equal(state(w, 'duration'), 0);
});

test('a web radio is live: duration 0, no seek, pause stops it', async (t) => {
  const kitchen = new FakeVolumio({ preset: 'kitchen', host: '192.0.2.40:3000' });
  const w = await world(t, { players: [kitchen] });
  assert.equal(state(w, 'duration'), 0);
  const ack = await set(w, 'position', 30);
  assert.equal(ack.success, false);
  assert.match(ack.error, /web radio/);
  await set(w, 'playback_state', MUSIC_PLAYBACK_STATE.PAUSED);
  assert.deepEqual(kitchen.commands, ['stop']);
  assert.equal(state(w, 'playback_state'), MUSIC_PLAYBACK_STATE.IDLE);
});

test('the writable features drive the player and come back from it', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const [living] = w.players;
  await set(w, 'playback_state', MUSIC_PLAYBACK_STATE.PAUSED);
  assert.equal(state(w, 'playback_state'), MUSIC_PLAYBACK_STATE.PAUSED);
  await set(w, 'playback_state', MUSIC_PLAYBACK_STATE.PLAYING);
  assert.equal(state(w, 'playback_state'), MUSIC_PLAYBACK_STATE.PLAYING);
  await set(w, 'position', 12.4);
  assert.equal(living.state.seek, 12_000);
  assert.equal(state(w, 'position'), 12);
  await set(w, 'shuffle', 0);
  assert.equal(state(w, 'shuffle'), 0);
  await set(w, 'repeat', MUSIC_REPEAT_MODE.ALL);
  assert.equal(state(w, 'repeat'), MUSIC_REPEAT_MODE.ALL);
  // Repeat one is a socket.io event (setRepeat), not a REST command.
  await set(w, 'repeat', MUSIC_REPEAT_MODE.ONE);
  assert.deepEqual(living.socketEvents.at(-1), ['setRepeat', { value: true, repeatSingle: true }]);
  assert.equal(state(w, 'repeat'), MUSIC_REPEAT_MODE.ONE);
  await set(w, 'repeat', MUSIC_REPEAT_MODE.OFF);
  assert.equal(state(w, 'repeat'), MUSIC_REPEAT_MODE.OFF);
  await set(w, 'mute', 0);
  assert.equal(state(w, 'mute'), 0);
  await set(w, 'playback_state', MUSIC_PLAYBACK_STATE.IDLE);
  assert.equal(state(w, 'playback_state'), MUSIC_PLAYBACK_STATE.IDLE);
  // Stopped: a seek has nothing to move, ignored.
  const seeks = living.commands.filter((c) => c.startsWith('seek')).length;
  assert.equal((await set(w, 'position', 5)).success, true);
  assert.equal(living.commands.filter((c) => c.startsWith('seek')).length, seeks);
  assert.deepEqual(
    living.commands.filter((c) => !c.startsWith('seek')),
    ['pause', 'play', 'random false', 'repeat true', 'repeat false', 'volume unmute', 'stop'],
  );
});

test('repeat one without the push channel opens socket.io for the command', async (t) => {
  const w = await world(t, {
    players: [benchPlayer()],
    config: { hosts: '192.0.2.40:3000', realtime: false, language: 'en' },
  });
  const [living] = w.players;
  assert.equal(w.network.sockets.length, 0);
  await set(w, 'repeat', MUSIC_REPEAT_MODE.ONE);
  assert.equal(w.network.sockets.length, 1);
  assert.deepEqual(living.socketEvents, [['setRepeat', { value: true, repeatSingle: true }]]);
  assert.equal(living.state.repeatSingle, true);

  // No socket.io at all: a clear error, nothing changed.
  living.push = 'none';
  const ack = await set(w, 'repeat', MUSIC_REPEAT_MODE.ONE);
  assert.equal(ack.success, false);
  assert.match(ack.error, /real-time channel/);
});

test('an unreachable player is shown stopped, its track kept', async (t) => {
  const w = await world(t, { players: [benchPlayer({ push: 'none' })] });
  const [living] = w.players;
  living.online = false;
  await w.hub.read(w.hub.records.get(living.id));
  assert.equal(state(w, 'playback_state'), MUSIC_PLAYBACK_STATE.IDLE);
  assert.equal(state(w, 'title'), 'Dawn 1');
});

test('"Update" in Discovery publishes everything again', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const before = published(w, 'title');
  await w.fake.deviceUpdated(w.fake.discoveredDevices[0]);
  await settle();
  assert.equal(published(w, 'title'), before + 1);
});

test('browse: the sources at the root, then each level, paged by the integration', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const root = valid(await w.fake.musicBrowse(device(w)));
  assert.deepEqual(titles(root), [
    'Favorites',
    'Playlists',
    'Music Library',
    'Artists',
    'Albums',
    'Genres',
    'Media Servers',
    'Last 100',
    'Web Radio',
  ]);
  assert.ok(root.every((item) => item.type === 'folder' && item.browsable && !item.playable));

  const albums = root.find((item) => item.title === 'Albums');
  const ack = await w.fake.musicBrowse(device(w), { parentId: albums.id, offset: 1, limit: 2 });
  const page = valid(ack);
  assert.equal(ack.data.total, 5);
  assert.deepEqual(titles(page), ['Heavy Cover', 'Big Folder Cover']);
  assert.deepEqual(
    page.map((item) => [item.type, item.subtitle, item.browsable, item.playable]),
    [
      ['album', 'Beta Quartet', true, true],
      ['album', 'Delta', true, true],
    ],
  );
  assert.match(page[0].artwork_key, /^art-/);
  // The untagged album of Volumio (title "", artist "*") keeps its row.
  const [, , , , loose] = valid(await w.fake.musicBrowse(device(w), { parentId: albums.id }));
  assert.equal(loose.title, '*');

  // An artist: its albums, then its tracks (two lists of one level).
  const artist = valid(
    await w.fake.musicBrowse(device(w), {
      parentId: mediaId({ service: 'mpd', uri: 'artists://Alpha%20Band' }),
    }),
  );
  assert.deepEqual(
    artist.map((item) => item.type),
    ['album', 'track', 'track', 'track'],
  );
  assert.equal(artist[1].subtitle, 'Alpha Band · First Light');
  // Sent encoded twice (Volumio decodes once more): received as listed.
  assert.ok(w.players[0].browsed.includes('artists://Alpha%20Band'));

  const unknown = await w.fake.musicBrowse(device(w), { parentId: 'not-an-id' });
  assert.equal(unknown.success, false);
});

test('search mixes the lists of every source, and filters by type', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const items = valid(await w.fake.musicSearch(device(w), { query: 'Dawn', limit: 4 }));
  // Taken in turn: a track, a radio, a track, a radio.
  assert.deepEqual(
    items.map((item) => item.type),
    ['track', 'radio', 'track', 'radio'],
  );
  const radios = valid(
    await w.fake.musicSearch(device(w), { query: 'dawn', type: 'radio', limit: 10 }),
  );
  assert.ok(radios.length > 0 && radios.every((item) => item.type === 'radio'));
  // A radio keeps its title and logo in its id (what Volumio needs to queue it).
  assert.deepEqual(Object.keys(parseId(radios[0].id)), ['service', 'uri', 'title', 'albumart']);
  assert.equal(parseId(radios[0].id).title, radios[0].title);
  const none = valid(await w.fake.musicSearch(device(w), { query: 'zzz' }));
  assert.deepEqual(none, []);
});

test('play: replace with an album, a playlist (by its name), a radio; a vanished id is reported', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const [living] = w.players;
  const play = (item, mode = 'replace') =>
    w.fake.musicPlay(device(w), { id: mediaId(item, true), type: 'album' }, mode);

  assert.equal((await play({ service: 'mpd', uri: ALBUM })).success, true);
  assert.deepEqual(queueNames(living), ['Dawn 1', 'Dawn 2', 'Dawn 3']);
  assert.equal(living.state.status, 'play');

  assert.equal(
    (await play({ service: 'mpd', uri: PLAYLIST, title: 'Apéro du soir' })).success,
    true,
  );
  assert.ok(living.commands.includes('playplaylist Apéro du soir'));

  const missing = await play({ service: 'mpd', uri: 'playlists/Gone', title: 'Gone' });
  assert.equal(missing.success, false);
  assert.match(missing.error, /Gone/);

  const radio = { service: 'webradio', uri: 'http://radio.example/stream', title: 'Radio X' };
  assert.equal((await play(radio)).success, true);
  const sent = living.requests.filter((r) => r.path === '/api/v1/replaceAndPlay').at(-1);
  assert.deepEqual(sent.body, {
    service: 'webradio',
    uri: 'http://radio.example/stream',
    title: 'Radio X',
    type: 'webradio',
  });

  const gone = await play({ service: 'mpd', uri: 'albums://Nobody/Nothing' });
  assert.equal(gone.success, false);
  assert.match(gone.error, /nothing to play/);
});

test('play next: added at the end, then moved after the current track', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const [living] = w.players;
  living.queue = explode({ uri: ALBUM }); // Dawn 1, 2, 3; Dawn 1 playing
  const song = { service: 'mpd', uri: 'music-library/Loose/cafe.mp3', title: 'Café' };
  const ack = await w.fake.musicPlay(device(w), { id: mediaId(song), type: 'track' }, 'next');
  assert.equal(ack.success, true, ack.error);
  // (Volumio reads the tags of a file; the fake keeps the title it is sent.)
  assert.deepEqual(queueNames(living), ['Dawn 1', 'cafe.mp3', 'Dawn 2', 'Dawn 3']);
  assert.ok(living.socketEvents.some(([name]) => name === 'moveQueue'));

  // An album longer than the rest of the queue: the rest moves to the end.
  living.load(2); // Dawn 2 playing, Dawn 3 after
  await w.fake.musicPlay(
    device(w),
    { id: mediaId({ service: 'mpd', uri: ALBUM }), type: 'album' },
    'next',
  );
  assert.deepEqual(queueNames(living), [
    'Dawn 1',
    'cafe.mp3',
    'Dawn 2',
    'Dawn 1',
    'Dawn 2',
    'Dawn 3',
    'Dawn 3',
  ]);
  assert.equal(living.state.position, 2);

  // A playlist is added track by track (addToQueue ignores its URI).
  living.queue = [];
  const append = await w.fake.musicPlay(
    device(w),
    {
      id: mediaId({ service: 'mpd', uri: PLAYLIST, title: 'Apéro du soir' }, true),
      type: 'playlist',
    },
    'append',
  );
  assert.equal(append.success, true, append.error);
  assert.deepEqual(queueNames(living), ['Dawn 1', 'Dawn 2', 'Dawn 3']);

  // A player that does not move the items: said, the items stay at the end.
  living.queue = explode({ uri: ALBUM });
  living.load(0);
  living.moveQueue = false;
  const stuck = await w.fake.musicPlay(device(w), { id: mediaId(song), type: 'track' }, 'next');
  assert.equal(stuck.success, false);
  assert.match(stuck.error, /end of the queue/);
});

test('the queue: a page, the current index on the whole queue, a jump', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const [living] = w.players;
  living.queue.push({
    service: 'webradio',
    uri: 'http://radio.example/stream',
    name: 'Radio X',
    type: 'track',
  });
  living.queue.push({ service: 'mpd', name: 'no uri', type: 'track' });
  living.load(1);
  const ack = await w.fake.musicQueueGet(device(w), { offset: 1, limit: 10 });
  const items = valid(ack);
  assert.equal(ack.data.total, 5);
  assert.equal(ack.data.current_index, 1);
  assert.deepEqual(titles(items), ['Dawn 2', 'Dawn 3', 'Radio X', 'no uri']);
  assert.deepEqual(
    items.map((item) => item.type),
    ['track', 'track', 'radio', 'folder'],
  );
  assert.equal(items[0].duration, 25);
  assert.equal(items[2].duration, null);
  assert.equal(items[3].id, 'queue:4');

  assert.equal((await w.fake.musicQueuePlay(device(w), 2)).success, true);
  assert.equal(living.state.title, 'Dawn 3');
  assert.ok(living.commands.includes('play 2'));
  assert.equal((await w.fake.musicQueuePlay(device(w), 9)).success, false);
});

test('artwork: a cover over 300 KB is made smaller, an SVG icon is refused', async (t) => {
  const w = await world(t, { players: [benchPlayer()] });
  const [living] = w.players;
  const width = 1200;
  const data = Buffer.alloc(width * width * 4);
  let seed = 3;
  for (let i = 0; i < data.length; i += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = seed % 256;
  }
  living.art = jpeg.encode({ data, width, height: width }, 95).data;
  assert.ok(living.art.length > 300 * 1024);
  const ack = await w.fake.musicGetArtwork(state(w, 'artwork'));
  assert.equal(ack.success, true, ack.error);
  const image = Buffer.from(ack.data.image, 'base64');
  assert.ok(image.length <= 300 * 1024);
  assert.deepEqual(imageInfo(image).width <= 400, true);

  living.art = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
  const icon = w.gladys.artworkKey('http://192.0.2.40:3000/albumart?icon=music');
  const refused = await w.fake.musicGetArtwork(icon);
  assert.equal(refused.success, false);
});

test('ids: Volumio items, long ones hashed; kinds from types and URIs', () => {
  assert.deepEqual(parseId(mediaId({ service: 'mpd', uri: ALBUM })), {
    service: 'mpd',
    uri: ALBUM,
    title: '',
    albumart: '',
  });
  const long = { service: 'mpd', uri: `music-library/${'a'.repeat(600)}.flac` };
  const id = mediaId(long);
  assert.match(id, /^h:[0-9a-f]{40}$/);
  assert.equal(parseId(id).uri, long.uri);
  assert.equal(parseId('{"x":1}'), null);
  assert.equal(kindOf({ type: 'folder', uri: 'artists://Alpha%20Band' }).type, 'artist');
  assert.equal(
    kindOf({ type: 'folder', uri: 'artists://Alpha%20Band/First%20Light' }).type,
    'album',
  );
  assert.equal(kindOf({ type: 'folder', uri: 'genres://Jazz' }).type, 'folder');
  assert.equal(kindOf({ type: 'folder', uri: 'music-library/USB' }).playable, false);
  assert.equal(kindOf({ type: 'radio-category', uri: 'radio/selection' }).type, 'folder');
  assert.equal(kindOf({ type: 'folder', uri: 'spotify:album:123' }).type, 'album');
  assert.equal(kindOf({ type: 'streaming-category', uri: 'spotify/playlists' }).type, 'folder');
  assert.equal(kindOf({ type: 'folder', uri: 'spotify:playlist:9' }).type, 'playlist');
});
