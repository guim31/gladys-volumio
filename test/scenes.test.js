// -----------------------------------------------------------------------------
// The scene actions, run through the fake Gladys as a scene would.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { optionalNumber } from '../src/scenes.js';
import { FakeVolumio, createAll, createWorld, ids, settle } from './helpers/world.js';

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  const [player] = w.players;
  const run = async (key, fields) => {
    const ack = await w.fake.sceneAction(key, { device: ids(w.gladys, player).device, ...fields });
    await settle();
    return ack;
  };
  return { ...w, player, run };
}

const lastPost = (player) =>
  player.requests.filter((request) => request.path === '/api/v1/replaceAndPlay').at(-1)?.body;

test('play a playlist by its name, whatever the case and the accents', async (t) => {
  const { player, run } = await world(t);
  const ack = await run('play_playlist', { playlist: ' diner ' });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(player.commands.at(-1), 'playplaylist Dîner');
});

test('an unknown playlist fails with its name, in the configured language', async (t) => {
  const { player, run } = await world(t, {
    config: { hosts: '192.0.2.40', language: 'fr' },
  });
  const ack = await run('play_playlist', { playlist: 'Jazz' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'Playlist « Jazz » introuvable sur Salon.');
  assert.equal(player.commands.length, 0, 'Volumio would say "Success" anyway');
});

test('play a favourite web radio, from Favourites or My web radios', async (t) => {
  const { player, run } = await world(t);
  let ack = await run('play_favorite_radio', { radio: 'radio exemple info' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(lastPost(player).uri, 'http://stream.example.org/info.aac');
  ack = await run('play_favorite_radio', { radio: 'Radio du quartier' });
  assert.equal(ack.success, true, ack.error);
  assert.equal(lastPost(player).type, 'mywebradio');
  ack = await run('play_favorite_radio', { radio: 'Nope FM' });
  assert.equal(ack.success, false);
  assert.match(ack.error, /Nope FM/);
});

test('play an address, at a volume, without resuming', async (t) => {
  const { player, run } = await world(t);
  const ack = await run('play_url', {
    url: 'https://stream.example.org/live.mp3',
    title: 'Radio Browser',
    volume: '25',
    resume: false,
  });
  assert.equal(ack.success, true, ack.error);
  assert.deepEqual(lastPost(player), {
    service: 'webradio',
    type: 'webradio',
    title: 'Radio Browser',
    uri: 'https://stream.example.org/live.mp3',
  });
  assert.equal(player.state.volume, 25);
  assert.equal(player.queue.length, 1);
});

test('play an address as a notification: resolved once it plays, the music comes back', async (t) => {
  const { player, hub, run } = await world(t);
  const ack = await run('play_url', { url: 'http://192.0.2.9/ding.mp3', resume: true });
  assert.equal(ack.success, true, ack.error);
  const record = hub.records.get(player.id);
  while (record.notifying) {
    await record.notifying.catch(() => {});
  }
  assert.equal(player.state.title, 'Feeling Good');
});

test('a wrong address is refused before anything plays', async (t) => {
  const { player, run } = await world(t);
  const ack = await run('play_url', { url: 'stream.example.org/live.mp3' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'The address must start with http:// or https://.');
  assert.equal(lastPost(player), undefined);
});

test('shuffle and repeat: on, off or unchanged', async (t) => {
  const { player, run } = await world(t);
  await run('set_play_mode', { shuffle: 'on', repeat: 'unchanged' });
  assert.deepEqual(player.commands, ['random true']);
  await run('set_play_mode', { shuffle: 'off', repeat: 'on' });
  assert.deepEqual(player.commands, ['random true', 'random false', 'repeat true']);
});

test('clear the queue', async (t) => {
  const { player, run } = await world(t);
  const ack = await run('clear_queue', {});
  assert.equal(ack.success, true, ack.error);
  assert.equal(player.queue.length, 0);
});

test('a device that is not a Volumio player is refused', async (t) => {
  const w = await createWorld({ players: [new FakeVolumio()] });
  t.after(() => w.app.stop());
  const ack = await w.fake.sceneAction('clear_queue', { device: 'ext:test-integration:other:1' });
  assert.equal(ack.success, false);
  assert.equal(ack.error, 'This device is not a known Volumio player.');
});

test('a volume typed in a scene', () => {
  assert.equal(optionalNumber(''), null);
  assert.equal(optionalNumber(undefined), null);
  assert.equal(optionalNumber('33,6'), 34);
  assert.equal(optionalNumber(250), 100);
  assert.equal(optionalNumber('loud'), null);
});
