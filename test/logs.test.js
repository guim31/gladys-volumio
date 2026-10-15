// -----------------------------------------------------------------------------
// What the integration writes at the default level (info): the lifecycle
// only. A normal reading writes nothing, a player that stays down is logged
// once, and once when it is back. Never a password typed in an address.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeVolumio, createAll, createWorld, settle } from './helpers/world.js';

/** Capture the lines of the SDK logger at the given LOG_LEVEL. */
function captureLogs(t, level = 'info') {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = level;
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  const lines = [];
  const record =
    (stream) =>
    (...args) =>
      lines.push({
        stream,
        text: args.map((arg) => (arg instanceof Error ? arg.stack : String(arg))).join(' '),
      });
  t.mock.method(console, 'log', record('out'));
  t.mock.method(console, 'error', record('err'));
  return {
    lines,
    clear: () => lines.splice(0),
    texts: () => lines.map((line) => line.text),
  };
}

async function world(t, options = {}) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

test('a normal cycle writes nothing at info: reads, pushes, track changes', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, {
    players: [
      new FakeVolumio({ preset: 'living' }),
      new FakeVolumio({ preset: 'office', push: 'none' }),
    ],
  });
  assert.ok(logs.texts().some((text) => text.includes('Salon (192.0.2.40:3000): connected')));
  assert.ok(logs.texts().some((text) => text.includes('real-time updates')));
  logs.clear();

  const [living, office] = w.players;
  for (let i = 0; i < 5; i += 1) {
    living.command({ cmd: i % 2 ? 'next' : 'prev' }); // pushed
    living.state.volume = 30 + i;
    office.state.volume = 10 + i;
    w.clock.advance(60_000);
    for (const record of w.hub.records.values()) {
      await w.hub.read(record);
    }
    await w.fake.widgetGet('now_playing', { settings: {}, language: 'en' });
    await settle();
  }
  assert.deepEqual(logs.texts(), []);
});

test('a player that stays down is logged once, and once when it is back', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t, { players: [new FakeVolumio({ push: 'none' })] });
  const [living] = w.players;
  const record = w.hub.records.get(living.id);
  logs.clear();

  living.online = false;
  for (let i = 0; i < 6; i += 1) {
    w.clock.advance(60_000);
    await w.hub.read(record);
    await w.fake.widgetGet('now_playing', { settings: {}, language: 'en' });
  }
  const down = logs.lines.filter((line) => line.stream === 'err');
  assert.equal(down.length, 1, logs.texts().join('\n'));
  assert.equal(logs.lines.length, 1);

  logs.clear();
  living.online = true;
  await w.hub.read(record);
  await w.hub.read(record);
  assert.equal(logs.lines.length, 1, logs.texts().join('\n'));
  assert.match(logs.lines[0].text, /answers again after 5 min/);
});

test('a lost push channel is logged once, its comeback once', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  const [living] = w.players;
  const record = w.hub.records.get(living.id);
  logs.clear();
  living.dropSockets();
  living.push = 'none';
  for (let i = 0; i < 4; i += 1) {
    w.hub.openSocket(record); // refused, again and again
    await settle();
  }
  living.push = 'eio3';
  record.eio = 3;
  w.hub.openSocket(record);
  await settle();
  assert.equal(record.live, true);
  const texts = logs.texts();
  assert.equal(texts.length, 2, texts.join('\n'));
  assert.match(texts[0], /\[WARN\].*real-time updates lost \(closed by the player\)/);
  assert.match(texts[1], /\[INFO\].*real-time updates back/);
});

test('a user action is one info line', async (t) => {
  const logs = captureLogs(t);
  const w = await world(t);
  const [living] = w.players;
  logs.clear();
  await w.fake.sceneAction('play_playlist', {
    device: w.gladys.externalIds('player', living.id).device,
    playlist: 'Rock',
  });
  assert.deepEqual(
    logs.texts().map((text) => text.replace(/^\S+ /, '')),
    ['[INFO] [volumio] Salon (192.0.2.40:3000): playlist Rock'],
  );
});

test('never a password typed in an address, at any level', async (t) => {
  const logs = captureLogs(t, 'debug');
  const w = await world(t, {
    config: { hosts: '192.0.2.40, http://admin:hunter2@192.0.2.44', language: 'en' },
  });
  await w.fake.action('search', {});
  w.players[0].online = false;
  await w.hub.read(w.hub.records.get(w.players[0].id));
  const text = logs.texts().join('\n');
  assert.match(text, /\[DEBUG\]/);
  assert.ok(!text.includes('hunter2'), 'never the password');
  assert.ok(!JSON.stringify(w.fake.connectionStatuses).includes('hunter2'));
});
