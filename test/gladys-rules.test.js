// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: a library player, an idle Primo, a Volumio 2 on a web radio,
// found by address, by mDNS and through the zones, in every feature-name
// language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// (Adapted from guim31/gladys-wled.)
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { FakeVolumio, KITCHEN, LIVING, createWorld, readFixture } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const threePlayers = () => [
  new FakeVolumio({ preset: 'living' }),
  new FakeVolumio({ preset: 'office' }),
  new FakeVolumio({ preset: 'kitchen' }),
];

const scenarios = [
  { label: 'one player', players: () => [new FakeVolumio()], config: { hosts: LIVING } },
  {
    label: 'three players, French names (default)',
    players: threePlayers,
    config: { hosts: KITCHEN },
    mdns: readFixture('mdns.json'),
    expected: 3,
  },
  {
    label: 'English names',
    players: threePlayers,
    config: { hosts: `${LIVING},${KITCHEN}`, language: 'en' },
    expected: 3,
  },
  {
    label: 'German names',
    players: threePlayers,
    config: { hosts: `${LIVING},${KITCHEN}`, language: 'de' },
    expected: 3,
  },
  {
    label: 'Spanish names',
    players: threePlayers,
    config: { hosts: `${LIVING},${KITCHEN}`, language: 'es' },
    expected: 3,
  },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({
      players: scenario.players(),
      config: scenario.config,
      mdns: scenario.mdns ?? [],
    });
    try {
      const devices = world.fake.discoveredDevices;
      assert.equal(devices.length, scenario.expected ?? 1);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }
      const deviceIds = devices.map((device) => device.external_id);
      assert.equal(new Set(deviceIds).size, deviceIds.length, 'duplicate device external_id');
    } finally {
      await world.app.stop();
    }
  });
}

test('a player is a music player for the core: the couples its music box reads', async () => {
  const world = await createWorld();
  try {
    const [device] = world.fake.discoveredDevices;
    const types = device.features.map((feature) => `${feature.category}/${feature.type}`);
    // The dashboard music box needs play and reads playback_state; the
    // "play a notification" scene action needs play_notification.
    for (const type of [
      'music/play',
      'music/pause',
      'music/previous',
      'music/next',
      'music/volume',
      'music/playback_state',
      'music/play_notification',
    ]) {
      assert.ok(types.includes(type), type);
    }
    const state = device.features.find((feature) => feature.type === 'playback_state');
    assert.equal(state.read_only, true);
    assert.deepEqual([state.min, state.max], [0, 1]);
  } finally {
    await world.app.stop();
  }
});
