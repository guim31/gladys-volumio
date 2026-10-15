// -----------------------------------------------------------------------------
// The socket.io channel, packet by packet: Engine.IO 3 (Volumio 3, socket.io
// 2) and 4 (socket.io 3+), the pushState events, the pings, and every way it
// ends.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VolumioSocket } from '../src/volumio/socket.js';
import { FakeVolumio, createNetwork } from './helpers/fakeVolumio.js';
import { settle } from './helpers/world.js';

function open(player, { eio = 3, timings } = {}) {
  const network = createNetwork([player]);
  const events = { states: [], live: 0, closes: [] };
  const socket = new VolumioSocket({
    host: player.host,
    eio,
    createSocket: network.createSocket,
    timings,
    onState: (state) => events.states.push(state),
    onLive: () => {
      events.live += 1;
    },
    onClose: (info) => events.closes.push(info),
  }).start();
  return { socket, events, network };
}

test('Engine.IO 3: joins, asks the state, receives every change', async () => {
  const player = new FakeVolumio({ push: 'eio3' });
  const { socket, events, network } = open(player);
  await settle();
  assert.equal(events.live, 1);
  assert.equal(events.states.at(-1).title, 'Feeling Good');
  assert.ok(network.sockets[0].url.endsWith('/socket.io/?EIO=3&transport=websocket'));
  assert.ok(network.sockets[0].sent.includes('42["getState"]'));

  player.command({ cmd: 'volume', volume: '12' });
  await settle();
  assert.equal(events.states.at(-1).volume, 12);
  socket.close();
  assert.deepEqual(events.closes, [], 'a close asked by the hub is not reported');
});

test('Engine.IO 3: the client pings', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const player = new FakeVolumio({ push: 'eio3' });
  const { socket, network } = open(player);
  await settle();
  t.mock.timers.tick(25_000);
  assert.ok(network.sockets[0].sent.includes('2'));
  socket.close();
});

test('Engine.IO 4: joins the namespace itself and answers the server pings', async () => {
  const player = new FakeVolumio({ push: 'eio4' });
  const { socket, events, network } = open(player, { eio: 4 });
  await settle();
  const fake = network.sockets[0];
  assert.equal(fake.sent[0], '40');
  assert.equal(events.live, 1);
  fake.deliver('2');
  assert.ok(fake.sent.includes('3'));
  socket.close();
});

test('the wrong protocol version is refused before it opens', async () => {
  const player = new FakeVolumio({ push: 'eio4' });
  const { events } = open(player, { eio: 3 });
  await settle();
  assert.equal(events.live, 0);
  assert.equal(events.closes.length, 1);
  assert.equal(events.closes[0].opened, false);
});

test('a dropped channel is reported as having been live', async () => {
  const player = new FakeVolumio({ push: 'eio3' });
  const { events } = open(player);
  await settle();
  player.dropSockets();
  assert.equal(events.closes.length, 1);
  assert.equal(events.closes[0].live, true);
});

test('silence past the ping interval and timeout closes it', async (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const player = new FakeVolumio({ push: 'eio3' });
  const { events, network } = open(player);
  await settle();
  // The player stops answering pings.
  network.sockets[0].open = false;
  t.mock.timers.tick(25_000 + 5_000 + 5_000);
  assert.equal(events.closes.length, 1);
  assert.equal(events.closes[0].reason, 'no answer');
});

test('a garbled packet or a socket.io error ends the channel cleanly', async () => {
  const player = new FakeVolumio({ push: 'eio3' });
  const { events, network } = open(player);
  await settle();
  network.sockets[0].deliver('42["pushState",{broken');
  assert.equal(events.closes.length, 1);
  assert.match(events.closes[0].reason, /bad message/);

  const second = open(new FakeVolumio({ push: 'eio3' }));
  await settle();
  second.network.sockets[0].deliver('44{"message":"Not authorized"}');
  assert.equal(second.events.closes[0].reason, 'refused by the player');
});
