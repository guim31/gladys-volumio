// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  DEFAULT_CONFIG,
  LANGUAGES,
  NOTIFICATION_MAX_SECONDS,
  NOTIFICATION_VOLUME,
} from '../src/config.js';
import { MDNS_SERVICE } from '../src/discovery.js';
import { TRIGGERS, WIDGET_KEY } from '../src/hub.js';
import { SCENE_ACTIONS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { FakeVolumio, createAll, createWorld, ids } from './helpers/world.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

async function world(t) {
  const w = await createWorld({ players: [new FakeVolumio()] });
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

test('identity: name, image, cover, local transport, multimedia category, mDNS', () => {
  assert.equal(manifest.name, 'Volumio');
  assert.equal(manifest.type, 'device');
  assert.match(manifest.docker_image, /^ghcr\.io\/guim31\/gladys-volumio:/);
  assert.equal(
    manifest.cover_image,
    'https://raw.githubusercontent.com/guim31/gladys-volumio/main/cover.png',
  );
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.categories, ['multimedia']);
  // The core only accepts a lowercase service type (Volumio announces
  // `_Volumio._tcp`, see src/discovery.js).
  assert.deepEqual(manifest.network_discovery, [{ type: 'mdns', service: MDNS_SERVICE }]);
  assert.match(MDNS_SERVICE, /^_[a-z0-9-]+\._(tcp|udp)$/);
});

test('the widget forms (Gladys#3168) need Gladys >= 5.2.0, which also covers categories, widgets and scenes', () => {
  assert.ok(isAtLeast(minGladysVersion(), [5, 2, 0]));
});

test('every manifest action has a handler', async (t) => {
  const w = await world(t);
  for (const action of manifest.actions) {
    const ack = await w.fake.action(action.key, {});
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
  }
  assert.deepEqual(keysOf(manifest.actions), ['search', 'list_media']);
});

test('the media report lists the playlists and the favourite radios', async (t) => {
  const w = await world(t);
  const ack = await w.fake.action('list_media', {});
  assert.equal(
    ack.data.message.en,
    'Salon: Playlists: Dîner, Réveil, Rock; Favourite web radios: Radio Exemple Jazz, Radio Exemple Info, Radio du quartier',
  );
  assert.match(
    ack.data.message.fr,
    /^Salon : Playlists : Dîner, Réveil, Rock ; Webradios favorites : /,
  );
});

test('every scene_actions key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_actions).sort(), Object.keys(SCENE_ACTIONS).sort());
  const w = await world(t);
  const device = ids(w.gladys, w.players[0]).device;
  const fields = {
    play_playlist: { playlist: 'Rock' },
    play_favorite_radio: { radio: 'Radio Exemple Jazz' },
    play_url: { url: 'https://stream.example.org/live.mp3' },
    set_play_mode: { shuffle: 'on', repeat: 'off' },
    clear_queue: {},
  };
  for (const action of manifest.scene_actions) {
    const ack = await w.fake.sceneAction(action.key, { device, ...fields[action.key] });
    assert.equal(ack.success, true, `${action.key}: ${ack.error}`);
    assert.equal(action.outputs, undefined, 'no outputs declared, none returned');
    // Every action targets one player, picked among the integration devices.
    assert.deepEqual(action.fields[0], {
      key: 'device',
      type: 'select',
      source: 'devices',
      label: action.fields[0].label,
      required: true,
    });
  }
});

test('the scene trigger is the one the hub fires, with its filter and variables', async (t) => {
  assert.deepEqual(keysOf(manifest.scene_triggers), Object.values(TRIGGERS));
  const w = await world(t);
  w.players[0].command({ cmd: 'next' });
  await new Promise((resolve) => setTimeout(resolve, 10));
  const [event] = w.fake.sceneEvents;
  assert.ok(event, 'fired');
  const [trigger] = manifest.scene_triggers;
  assert.deepEqual(
    Object.keys(event.data).sort(),
    [...keysOf(trigger.fields), ...keysOf(trigger.variables)].sort(),
  );
});

test('every widgets key has a handler', async (t) => {
  assert.deepEqual(keysOf(manifest.widgets), [WIDGET_KEY]);
  assert.deepEqual(Object.keys(WIDGETS), [WIDGET_KEY]);
  const w = await world(t);
  const ack = await w.fake.widgetGet(WIDGET_KEY, { settings: {}, language: 'en' });
  assert.equal(ack.success, true, ack.error);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(
        DEFAULT_CONFIG[field.key],
        field.default,
        `DEFAULT_CONFIG.${field.key} must match the manifest default`,
      );
    }
  }
  const field = (key) => manifest.config_schema.find((f) => f.key === key);
  assert.deepEqual(
    field('language').options.map((o) => o.value),
    LANGUAGES,
  );
  assert.deepEqual(
    [field('notification_volume').min, field('notification_volume').max],
    [NOTIFICATION_VOLUME.min, NOTIFICATION_VOLUME.max],
  );
  assert.deepEqual(
    [field('notification_max_seconds').min, field('notification_max_seconds').max],
    [NOTIFICATION_MAX_SECONDS.min, NOTIFICATION_MAX_SECONDS.max],
  );
  assert.deepEqual(
    Object.keys(DEFAULT_CONFIG).sort(),
    manifest.config_schema
      .filter((f) => f.type !== 'section')
      .map((f) => f.key)
      .sort(),
  );
  // Nothing secret: Volumio has no account, no password.
  assert.ok(!allFields.some((f) => ['secret', 'oauth2', 'account_link'].includes(f.type)));
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined);
  }
});

test('number fields have integer bounds and defaults (the form has no step)', () => {
  for (const field of allFields.filter((f) => f.type === 'number')) {
    for (const key of ['min', 'max', 'default']) {
      if (field[key] !== undefined) {
        assert.ok(Number.isInteger(field[key]), `field "${field.key}".${key} must be an integer`);
      }
    }
  }
});

test('actions declare no secret field, no required field (no default is applied)', () => {
  // Gladys#3154/#3155: a secret in an action form cannot be filled, and an
  // action applies no default while enforcing `required`.
  for (const action of manifest.actions ?? []) {
    for (const field of action.fields ?? []) {
      assert.notEqual(field.type, 'secret');
      assert.notEqual(field.required, true);
    }
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.ok(manifest.docker_image.endsWith(`:${manifest.version}`));
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(
      text.length >= 10 && text.length <= 100,
      `description.${lang} has ${text.length} characters (10 to 100 allowed)`,
    );
  }
});

test('the name is short, recognizable and the same everywhere', () => {
  assert.equal(typeof manifest.name, 'string');
  assert.ok(manifest.name.length >= 3 && manifest.name.length <= 30);
});
