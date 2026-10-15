// -----------------------------------------------------------------------------
// "Broadcast a notification" (the core's play_notification, e.g. its text to
// speech scene action) and "Play an address" as a notification: the sound
// plays, then the queue, the track, the position and the volume come back.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeVolumio, KITCHEN, createAll, createWorld, ids, settle } from './helpers/world.js';

const SOUND = 'http://192.0.2.9/doorbell.mp3';

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

/** Ask for a notification through the device feature, as the core does. */
async function notify(w, player, url = SOUND) {
  const deviceId = ids(w.gladys, player).device;
  const device = w.fake.devices.find((d) => d.external_id === deviceId);
  const ack = await w.fake.setValue(
    device,
    { external_id: ids(w.gladys, player).feature('play_notification') },
    url,
  );
  assert.equal(ack.success, true, ack.error);
  const record = w.hub.records.get(player.id);
  while (record.notifying) {
    await record.notifying.catch(() => {});
  }
  await settle();
}

const posts = (player, path) =>
  player.requests.filter((r) => r.path === `/api/v1/${path}`).map((r) => r.body);

test('the sound plays, then the track resumes where it was', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  await notify(w, living);

  const [sound, restore] = posts(living, 'replaceAndPlay');
  assert.deepEqual(sound, { service: 'webradio', type: 'webradio', title: 'Gladys', uri: SOUND });
  assert.equal(restore.index, 1);
  assert.equal(restore.list.length, 3);
  assert.equal(restore.list[1].title, 'Feeling Good');
  assert.equal(living.state.status, 'play');
  assert.equal(living.state.title, 'Feeling Good');
  assert.equal(living.state.seek, 61_000, 'the position, to the second');
  assert.equal(living.queue.length, 3);
  assert.deepEqual(w.fake.sceneEvents, [], 'neither the sound nor the resume is a new track');
});

test('the configured notification volume, then the volume and the mute back', async (t) => {
  const living = new FakeVolumio({ state: { mute: true } });
  const w = await world(t, {
    players: [living],
    config: { hosts: '192.0.2.40', notification_volume: 70 },
  });
  await notify(w, living);
  assert.deepEqual(living.commands, [
    'volume unmute',
    'volume 70',
    'seek 61',
    'volume 35',
    'volume mute',
  ]);
  assert.equal(living.state.volume, 35);
  assert.equal(living.state.mute, true);
});

test('a paused queue comes back without playing', async (t) => {
  const living = new FakeVolumio({ state: { status: 'pause' } });
  const w = await world(t, { players: [living] });
  await notify(w, living);
  assert.deepEqual(living.commands, ['stop', 'clearQueue']);
  assert.equal(posts(living, 'addToQueue')[0].length, 3);
  assert.equal(living.queue.length, 3);
  assert.notEqual(living.state.status, 'play');
});

test('an empty player is left empty, not playing the sound again', async (t) => {
  const office = new FakeVolumio({ preset: 'office' });
  const w = await world(t, { players: [office], config: { hosts: '192.0.2.41' } });
  await notify(w, office);
  assert.equal(office.queue.length, 0);
  assert.equal(office.state.status, 'stop');
});

test('a web radio comes back, without seeking a stream', async (t) => {
  const kitchen = new FakeVolumio({ preset: 'kitchen' });
  const w = await world(t, { players: [kitchen], config: { hosts: KITCHEN } });
  await notify(w, kitchen);
  const restore = posts(kitchen, 'replaceAndPlay')[1];
  assert.equal(restore.list[0].uri, 'https://stream.example.org/jazz.mp3');
  assert.ok(!kitchen.commands.some((command) => command.startsWith('seek')));
  assert.equal(kitchen.state.status, 'play');
});

test('a stream played as a notification is stopped at the configured limit', async (t) => {
  const living = new FakeVolumio({ soundReads: Infinity });
  const w = await world(t, {
    players: [living],
    config: { hosts: '192.0.2.40', notification_max_seconds: 10 },
  });
  // Every state read takes 2 s of the manual clock.
  const handle = living.handle.bind(living);
  living.handle = (method, url, body) => {
    if (url.endsWith('/getState')) {
      w.clock.advance(2_000);
    }
    return handle(method, url, body);
  };
  await notify(w, living, 'http://192.0.2.9/live/stream');
  assert.ok(living.commands.includes('stop'), living.commands.join());
  assert.equal(living.state.title, 'Feeling Good');
});

test('two notifications in a row play one after the other', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  const deviceId = ids(w.gladys, living).device;
  const device = w.fake.devices.find((d) => d.external_id === deviceId);
  const target = { external_id: ids(w.gladys, living).feature('play_notification') };
  await Promise.all([
    w.fake.setValue(device, target, 'http://192.0.2.9/one.mp3'),
    w.fake.setValue(device, target, 'http://192.0.2.9/two.mp3'),
  ]);
  const record = w.hub.records.get(living.id);
  while (record.notifying) {
    await record.notifying.catch(() => {});
  }
  const uris = posts(living, 'replaceAndPlay').map((body) => body.uri ?? 'restore');
  assert.deepEqual(uris, [
    'http://192.0.2.9/one.mp3',
    'restore',
    'http://192.0.2.9/two.mp3',
    'restore',
  ]);
  assert.equal(living.state.title, 'Feeling Good');
});

test('repeat is turned off for the sound, and back on after', async (t) => {
  const living = new FakeVolumio({ state: { repeat: true } });
  const w = await world(t, { players: [living] });
  await notify(w, living);
  assert.deepEqual(living.commands, ['repeat false', 'seek 61', 'repeat true']);
  assert.equal(living.state.repeat, true);
});

test('an address that is not http(s) plays nothing', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  await notify(w, living, 'file:///etc/passwd');
  assert.deepEqual(posts(living, 'replaceAndPlay'), []);
  assert.equal(living.state.status, 'play');
});
