// -----------------------------------------------------------------------------
// A complete test world: the SDK's fake Gladys, fake Volumio players on a fake
// network, a manual clock, and the integration wired on top through
// registerHandlers. No timer runs unless `timers: true` (with node:test mock
// timers): the tests drive the reads themselves (`hub.read(record)`).
// -----------------------------------------------------------------------------

import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { registerHandlers } from '../../src/app.js';
import { FakeVolumio, createNetwork, readFixture } from './fakeVolumio.js';

// The integration logs its lifecycle; keep the test output readable.
// LOG_LEVEL=debug npm test shows everything.
process.env.LOG_LEVEL ??= 'silent';

export const LIVING = '192.0.2.40:3000';
export const OFFICE = '192.0.2.41:3000';
export const KITCHEN = '192.0.2.42:3000';

/** A manual clock, shared by the hub and the art cache. */
export function createClock(start = Date.UTC(2026, 9, 15, 18, 0, 0)) {
  const clock = {
    time: start,
    now: () => clock.time,
    advance(ms) {
      clock.time += ms;
    },
  };
  return clock;
}

/** Let the microtasks, the fake sockets and the fake network settle. */
export async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

/**
 * @param {object} [options]
 * @param {FakeVolumio[]} [options.players]
 * @param {object} [options.config] raw integration config
 * @param {Array} [options.devices] devices already created in Gladys
 * @param {Array|null} [options.mdns] raw mDNS results relayed by the core (null: scan refused)
 * @param {boolean} [options.connect]
 * @param {boolean} [options.timers]
 * @param {object} [options.timings] hub timing overrides
 */
export async function createWorld({
  clock = createClock(),
  players = [new FakeVolumio({ preset: 'living' })],
  config = { hosts: LIVING, language: 'en' },
  devices = [],
  mdns = [],
  connect = true,
  timers = false,
  timings = {},
} = {}) {
  const network = createNetwork(players);
  const gladys = createFakeGladys({ config, devices, scanResults: mdns ? { mdns } : {} });
  if (mdns === null) {
    gladys.scanNetwork = async () => {
      throw new Error('403 FORBIDDEN');
    };
  }
  const app = registerHandlers(gladys, {
    fetch: network.fetch,
    createSocket: network.createSocket,
    timers,
    timings: { notificationCheckMs: 0, commandSettleMs: 0, ...timings },
    now: clock.now,
  });
  if (connect) {
    await gladys.connect();
    await app.ready;
    await settle();
  }
  return { gladys, fake: gladys.fake, network, app, hub: app.hub, clock, players };
}

/** External ids of a player. */
export const ids = (gladys, player) => gladys.externalIds('player', player.id);

/** Add every discovered device in Gladys, as the user would. */
export async function createAll(world) {
  for (const device of world.fake.discoveredDevices) {
    await world.fake.deviceCreated(device);
  }
  await settle();
}

export { FakeVolumio, readFixture };
