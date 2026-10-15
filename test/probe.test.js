// -----------------------------------------------------------------------------
// scripts/probe.mjs against a fake player over real HTTP: it reads, never
// commands, and says what the integration will find.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { probe } from '../scripts/probe.mjs';
import { FakeVolumio, createNetwork, serve } from './helpers/fakeVolumio.js';

test('the probe reads a player and sends no command', async (t) => {
  const player = new FakeVolumio();
  const server = await serve(player);
  t.after(() => server.close());
  player.host = server.host; // for the push double
  const lines = [];
  const ok = await probe(server.host, {
    createSocket: createNetwork([player]).createSocket,
    log: (line) => lines.push(line),
  });
  assert.equal(ok, true);
  const text = lines.join('\n');
  assert.match(text, /getSystemInfo: "Salon", Volumio 3\.779 on pi/);
  assert.match(text, /getState: status play, service mpd, trackType flac, not a stream, volume 35/);
  assert.match(text, /listplaylists: 3 playlist\(s\)/);
  assert.match(text, /browse radio\/favourites: 2 radio\(s\)/);
  assert.match(text, /getzones: 2 other player\(s\)/);
  assert.match(text, /socket\.io \(Engine\.IO 3\): ok, pushState received/);
  assert.deepEqual(player.commands, [], 'read-only');
  assert.ok(!player.requests.some((request) => request.method !== 'GET'));
});

test('the probe says what fails', async () => {
  const lines = [];
  const ok = await probe('127.0.0.1:9', { push: false, log: (line) => lines.push(line) });
  assert.equal(ok, false);
  assert.match(lines[1], /getSystemInfo: FAILED \(unreachable/);
  assert.equal(await probe('http://u:p@192.0.2.1', { log: () => {} }), false);
});
