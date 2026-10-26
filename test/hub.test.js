// -----------------------------------------------------------------------------
// The hub with Gladys and the players: states, commands of every feature,
// push channel and its fallback, unreachable and back, the "track changed"
// trigger, the core's onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PLAYBACK } from '../src/devices.js';
import { FakeVolumio, KITCHEN, createAll, createWorld, ids, settle } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  return w;
}

const feature = (w, player, key) => ({ external_id: ids(w.gladys, player).feature(key) });
const device = (w, player) =>
  w.fake.devices.find((d) => d.external_id === ids(w.gladys, player).device);

test('nothing is read nor published before the user adds the player', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  assert.equal(w.fake.states.length, 0);
  assert.equal(w.network.sockets.length, 0);
  assert.equal(living.requests.filter((r) => r.path === '/api/v1/getState').length, 0);
});

test('an added player publishes its volume and playback state at once', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  await createAll(w);
  assert.equal(w.fake.lastState(feature(w, living, 'volume').external_id), 35);
  assert.equal(
    w.fake.lastState(feature(w, living, 'playback_state').external_id),
    PLAYBACK.PLAYING,
  );
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: ids(w.gladys, living).device,
    transport: 'local',
  });
  assert.ok(w.fake.widgetRefreshes.length >= 1, 'the widget is told');
});

test('each feature drives the player', async (t) => {
  const w = await world(t, { players: [new FakeVolumio({ push: 'none' })] });
  const [living] = w.players;
  await createAll(w);
  const dev = device(w, living);
  const set = async (key, value) => {
    const ack = await w.fake.setValue(dev, feature(w, living, key), value);
    assert.equal(ack.success, true, ack.error);
    await settle();
  };

  await set('pause', 1);
  assert.equal(living.state.status, 'pause');
  assert.equal(w.fake.lastState(feature(w, living, 'playback_state').external_id), PLAYBACK.PAUSED);
  await set('play', 1);
  assert.equal(living.state.status, 'play');
  await set('next', 1);
  assert.equal(living.state.title, 'Ne me quitte pas');
  await set('previous', 1);
  assert.equal(living.state.title, 'Feeling Good');
  await set('volume', 64.4);
  assert.equal(living.state.volume, 64);
  assert.equal(w.fake.lastState(feature(w, living, 'volume').external_id), 64);
  assert.deepEqual(living.commands, ['pause', 'play', 'next', 'prev', 'volume 64']);

  // Gladys 5.3: the playback state is the command too (2 = stop).
  await set('playback_state', 2);
  assert.equal(living.state.status, 'stop');
  assert.equal(w.fake.lastState(feature(w, living, 'playback_state').external_id), PLAYBACK.IDLE);
  const refused = await w.fake.setValue(dev, feature(w, living, 'playback_state'), 3);
  assert.equal(refused.success, false);
});

test('pausing a web radio stops it (Volumio cannot pause a stream)', async (t) => {
  const kitchen = new FakeVolumio({ preset: 'kitchen' });
  const w = await world(t, { players: [kitchen], config: { hosts: KITCHEN } });
  await createAll(w);
  await w.fake.setValue(device(w, kitchen), feature(w, kitchen, 'pause'), 1);
  assert.deepEqual(kitchen.commands, ['stop']);
});

test('push: a change on the player reaches Gladys without any read', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  await createAll(w);
  const record = w.hub.records.get(living.id);
  assert.equal(record.live, true);
  const reads = () => living.requests.filter((r) => r.path === '/api/v1/getState').length;
  const before = reads();
  living.command({ cmd: 'volume', volume: '18' });
  living.command({ cmd: 'pause' });
  await settle();
  assert.equal(w.fake.lastState(feature(w, living, 'volume').external_id), 18);
  assert.equal(w.fake.lastState(feature(w, living, 'playback_state').external_id), PLAYBACK.PAUSED);
  assert.equal(reads(), before);
});

test('push: Engine.IO 4 is tried when 3 is refused, at once', async (t) => {
  const living = new FakeVolumio({ push: 'eio4' });
  const w = await world(t, { players: [living], timers: true });
  await createAll(w);
  await settle();
  const record = w.hub.records.get(living.id);
  assert.equal(record.live, true);
  assert.deepEqual(
    w.network.sockets.map((socket) => socket.eio),
    [3, 4],
  );
});

test('push: a socket.io 2 reached in Engine.IO 4 is spoken to in 3 again', async (t) => {
  const living = new FakeVolumio({ push: 'eio3' });
  living.acceptsAnyEio = true;
  const w = await world(t, { players: [living] });
  const record = w.hub.records.get(living.id);
  record.eio = 4; // left there by a failed opening while the player rebooted
  await createAll(w);
  assert.equal(record.live, true);
  living.dropSockets(); // the server gave up waiting for pings
  assert.equal(record.eio, 3);
  w.hub.openSocket(record);
  await settle();
  assert.equal(record.live, true);
  living.dropSockets();
  living.push = 'none'; // rebooting: refused
  w.hub.openSocket(record);
  await settle();
  assert.equal(record.eio, 3, 'a protocol that worked is kept');
});

test('push: real time off in the configuration opens no channel', async (t) => {
  const w = await world(t, { config: { hosts: '192.0.2.40', realtime: false } });
  await createAll(w);
  assert.equal(w.network.sockets.length, 0);
  assert.equal(w.hub.records.get(w.players[0].id).live, false);
});

test('without push, reads are frequent while playing, rare when idle', async (t) => {
  const w = await world(t, { players: [new FakeVolumio({ push: 'none' })] });
  await createAll(w);
  const record = w.hub.records.get(w.players[0].id);
  assert.equal(w.hub.nextReadDelay(record), 10_000);
  w.players[0].command({ cmd: 'stop' });
  await w.hub.read(record);
  assert.equal(w.hub.nextReadDelay(record), 60_000);
  record.live = true;
  assert.equal(w.hub.nextReadDelay(record), 5 * 60_000);
});

test('a player that goes away is unreachable, then back', async (t) => {
  const w = await world(t, { players: [new FakeVolumio({ push: 'none' })] });
  const [living] = w.players;
  await createAll(w);
  const record = w.hub.records.get(living.id);
  living.online = false;
  await w.hub.read(record);
  assert.equal(w.fake.transports.at(-1).transport, 'unreachable');
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.de, /Salon: antwortet nicht/);
  assert.equal(w.hub.nextReadDelay(record), 15_000, 'a quick second try');
  await w.hub.read(record);
  assert.equal(w.hub.nextReadDelay(record), 60_000);

  // A command on an unreachable player fails with a readable message.
  const ack = await w.fake.setValue(device(w, living), feature(w, living, 'play'), 1);
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'Salon: does not answer');

  living.online = true;
  await w.hub.read(record);
  assert.equal(w.fake.transports.at(-1).transport, 'local');
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('"A new track is playing" fires on a new title, with its variables', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  await createAll(w);
  assert.equal(w.fake.sceneEvents.length, 0, 'not at start');
  living.command({ cmd: 'next' });
  await settle();
  assert.deepEqual(w.fake.sceneEvents, [
    {
      key: 'track_changed',
      data: {
        device: ids(w.gladys, living).device,
        title: 'Ne me quitte pas',
        artist: 'Nina Simone',
        album: 'I Put a Spell on You',
        source: 'Music library',
      },
    },
  ]);
  // Same track again: volume, pause and play do not fire it.
  living.command({ cmd: 'volume', volume: '20' });
  await settle();
  assert.equal(w.fake.sceneEvents.length, 1);
});

test("the core's onPoll reads only a player the hub left alone", async (t) => {
  const w = await world(t);
  const [living] = w.players;
  await createAll(w);
  const reads = () => living.requests.filter((r) => r.path === '/api/v1/getState').length;
  const before = reads();
  assert.deepEqual(await w.fake.poll(device(w, living)), { success: true });
  assert.equal(reads(), before);
  w.clock.advance(55_000);
  await w.fake.poll(device(w, living));
  assert.equal(reads(), before + 1);
});

test('a deleted device is no longer followed', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  await createAll(w);
  const record = w.hub.records.get(living.id);
  await w.fake.deviceDeleted(device(w, living));
  assert.equal(record.active, false);
  assert.equal(record.socket, null);
  assert.equal(living.sockets.size, 0);
});

test('Gladys restarted: every state is sent again', async (t) => {
  const w = await world(t);
  await createAll(w);
  const count = w.fake.states.length;
  await w.gladys.disconnect();
  await w.gladys.connect();
  await settle();
  assert.ok(w.fake.states.length >= count + 2, 'volume and playback state again');
});
