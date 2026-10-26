// -----------------------------------------------------------------------------
// The reading timer of the container. The core cannot be trusted to poll an
// external device (GladysAssistant/Gladys#3198): the players are read by the
// hub's own timer, with no onPoll at all, and an unchanged value is still
// sent again every 6 hours (Gladys says "no recent value" past 48 h).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeVolumio, createAll, createWorld, ids, settle } from './helpers/world.js';

const clock = { now: () => Date.now() };

async function polledWorld(t, player) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.UTC(2026, 9, 15) });
  const w = await createWorld({ players: [player], timers: true, clock });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

test('the internal timer reads the players without any onPoll from Gladys', async (t) => {
  const living = new FakeVolumio({ push: 'none' });
  const w = await polledWorld(t, living);
  const polled = t.mock.method(w.hub, 'pollDevice');
  const volume = ids(w.gladys, living).feature('volume');

  for (const level of [21, 22, 23]) {
    living.state.volume = level; // changed on the player, no push
    t.mock.timers.tick(10_000); // playing: every 10 s
    await settle();
    assert.equal(w.fake.lastState(volume), level);
  }
  assert.equal(polled.mock.callCount(), 0, 'no onPoll involved');
});

test('idle players are read every minute', async (t) => {
  const living = new FakeVolumio({ push: 'none', state: { status: 'stop' } });
  const w = await polledWorld(t, living);
  const reads = () => living.requests.filter((r) => r.path === '/api/v1/getState').length;
  const before = reads();
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(reads(), before);
  t.mock.timers.tick(30_000);
  await settle();
  assert.equal(reads(), before + 1);
  assert.ok(w);
});

test('an unchanged value is never sent again (music features have no "no recent value")', async (t) => {
  const living = new FakeVolumio({ push: 'none', state: { status: 'stop' } });
  const w = await polledWorld(t, living);
  const volume = ids(w.gladys, living).feature('volume');
  const sent = () => w.fake.states.filter((s) => s.device_feature_external_id === volume).length;
  const first = sent();
  for (let minute = 0; minute < 7 * 60; minute += 1) {
    t.mock.timers.tick(60_000);
    await settle();
  }
  assert.equal(sent(), first, 'nothing changed: nothing sent');
});

test('a dropped push channel hands over to the timer, and comes back', async (t) => {
  const living = new FakeVolumio({ push: 'eio3' });
  const w = await polledWorld(t, living);
  const record = w.hub.records.get(living.id);
  assert.equal(record.live, true);
  living.dropSockets();
  await settle();
  assert.equal(record.live, false);
  living.state.volume = 44;
  t.mock.timers.tick(10_000);
  await settle();
  assert.equal(w.fake.lastState(ids(w.gladys, living).feature('volume')), 44);
  t.mock.timers.tick(30_000); // quick retry of the channel
  await settle();
  assert.equal(record.live, true);
});

test('the timers stop with the integration', async (t) => {
  const living = new FakeVolumio({ push: 'none' });
  const w = await polledWorld(t, living);
  await w.app.stop();
  const before = living.requests.length;
  t.mock.timers.tick(60 * 60_000);
  await settle();
  assert.equal(living.requests.length, before);
});
