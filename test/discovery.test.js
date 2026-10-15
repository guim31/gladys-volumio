// -----------------------------------------------------------------------------
// Finding the players: typed addresses, mDNS relayed by the core, the zones a
// player knows, the devices already created; one device per UUID whatever
// the address.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MDNS_SERVICE, mdnsCandidates, zoneCandidates } from '../src/discovery.js';
import { HOST_PARAM } from '../src/devices.js';
import {
  FakeVolumio,
  KITCHEN,
  LIVING,
  OFFICE,
  createAll,
  createWorld,
  ids,
  readFixture,
  settle,
} from './helpers/world.js';

test('the manifest mDNS service is the lowercase form the core accepts', () => {
  assert.equal(MDNS_SERVICE, '_volumio._tcp');
});

test('mDNS: the IPv4 address, the port and the UUID of the TXT record', () => {
  assert.deepEqual(mdnsCandidates(readFixture('mdns.json')), [
    { host: LIVING, id: '5b0e1c6a-3f2d-4e8b-9a71-2c4d6e8f0a13', name: 'Salon' },
  ]);
  assert.deepEqual(mdnsCandidates([{ addresses: ['fe80::1'], port: 3000, txt: [] }]), []);
  assert.deepEqual(mdnsCandidates('garbage'), []);
});

test('zones: every other player, on the API port; never 127.0.0.1', () => {
  const zones = readFixture('zones.json').zones;
  zones.push({ id: 'x', host: 'http://127.0.0.1', name: 'Hotspot' });
  assert.deepEqual(
    zoneCandidates(zones).map((zone) => zone.host),
    [LIVING, OFFICE],
  );
});

test('one typed address finds the other players through its zones', async (t) => {
  const w = await createWorld({
    players: [new FakeVolumio({ preset: 'living' }), new FakeVolumio({ preset: 'office' })],
  });
  t.after(() => w.app.stop());
  const devices = w.fake.discoveredDevices;
  assert.deepEqual(
    devices.map((device) => device.name),
    ['Salon', 'Bureau'],
  );
  assert.deepEqual(
    devices.map((device) => device.params),
    [[{ name: HOST_PARAM, value: LIVING }], [{ name: HOST_PARAM, value: OFFICE }]],
  );
  assert.equal(devices[0].external_id, ids(w.gladys, w.players[0]).device);
  assert.deepEqual(w.fake.connectionStatus, { connected: true });
});

test('mDNS relayed by the core finds a player without any typed address', async (t) => {
  const w = await createWorld({ config: { language: 'en' }, mdns: readFixture('mdns.json') });
  t.after(() => w.app.stop());
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Salon'],
  );
  assert.deepEqual(w.fake.scans, [{ type: 'mdns', timeout_seconds: 5 }]);
});

test('nothing found: the status says to type an address, the search report too', async (t) => {
  const w = await createWorld({ config: { language: 'en' }, mdns: null });
  t.after(() => w.app.stop());
  assert.deepEqual(w.fake.discoveredDevices, []);
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.fr, /saisissez son adresse IP/);
  const ack = await w.fake.action('search', {});
  assert.match(
    ack.data.message.en,
    /No Volumio player found\. Automatic discovery \(mDNS\) found nothing/,
  );
});

test('the same player at a new address keeps its device (DHCP)', async (t) => {
  const living = new FakeVolumio({ preset: 'living' });
  const w = await createWorld({ players: [living] });
  t.after(() => w.app.stop());
  await createAll(w);
  living.host = '192.0.2.50:3000';
  await w.gladys.fake.configUpdated({ hosts: '192.0.2.50', language: 'en' });
  await settle();
  const [device] = w.fake.discoveredDevices;
  assert.equal(device.external_id, ids(w.gladys, living).device);
  assert.deepEqual(device.params, [{ name: HOST_PARAM, value: '192.0.2.50:3000' }]);
  living.command({ cmd: 'volume', volume: '9' });
  await w.hub.read(w.hub.records.get(living.id));
  assert.equal(w.fake.lastState(ids(w.gladys, living).feature('volume')), 9);
});

test('a created device whose player is off stays published, unreachable', async (t) => {
  const kitchen = new FakeVolumio({ preset: 'kitchen' });
  const first = await createWorld({ players: [kitchen], config: { hosts: KITCHEN } });
  await createAll(first);
  const created = first.fake.devices;
  await first.app.stop();

  kitchen.online = false;
  const w = await createWorld({ players: [kitchen], config: { language: 'en' }, devices: created });
  t.after(() => w.app.stop());
  assert.deepEqual(
    w.fake.discoveredDevices.map((device) => device.name),
    ['Cuisine'],
  );
  assert.deepEqual(w.fake.transports.at(-1), {
    device_external_id: ids(w.gladys, kitchen).device,
    transport: 'unreachable',
  });
  assert.equal(w.fake.connectionStatus.connected, false);
  assert.match(w.fake.connectionStatus.message.en, /Cuisine: does not answer/);
});

test('the search action reports every player and how it is followed', async (t) => {
  const w = await createWorld({
    players: [
      new FakeVolumio({ preset: 'living' }),
      new FakeVolumio({ preset: 'office', push: 'none' }),
    ],
    config: { hosts: `${LIVING}, http://u:secret@192.0.2.99`, language: 'en' },
  });
  t.after(() => w.app.stop());
  await createAll(w);
  const ack = await w.fake.action('search', {});
  assert.equal(ack.success, true, ack.error);
  assert.match(
    ack.data.message.en,
    /^2 player\(s\), 2 answering: Salon \(192\.0\.2\.40:3000, 3\.779, real time\), Bureau \(192\.0\.2\.41:3000, 3\.661, polled\)\./,
  );
  assert.match(ack.data.message.fr, /Adresses ignorées : http:\/\/\*\*\*@192\.0\.2\.99\./);
  assert.ok(!JSON.stringify(ack.data.message).includes('secret'));
});
