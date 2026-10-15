// -----------------------------------------------------------------------------
// The `now_playing` widget: every content fits the core's vocabulary and
// budget exactly (validateWidgetContent), the cover is served under its key,
// the buttons and their forms drive the player.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { parseState } from '../src/volumio/model.js';
import { ACTIONS, buildContent } from '../src/widgets.js';
import {
  FakeVolumio,
  KITCHEN,
  OFFICE,
  createAll,
  createWorld,
  ids,
  readFixture,
  settle,
} from './helpers/world.js';

const LANGS = ['en', 'fr', 'de', 'es'];

async function world(t, options) {
  const w = await createWorld(options);
  t.after(() => w.app.stop());
  await createAll(w);
  return w;
}

const content = async (w, settings = {}, language = 'en') => {
  const ack = await w.fake.widgetGet('now_playing', { settings, language });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
};

const buttons = (c) => c.components.filter((component) => component.type === 'button');

test('every content fits the core vocabulary and budget, in every language', () => {
  const states = [
    'state-library.json',
    'state-webradio.json',
    'state-spotify.json',
    'state-empty.json',
  ];
  const playlists = Array.from(
    { length: 80 },
    (_, i) => `Playlist number ${i} with a long long name`,
  );
  const views = [
    null,
    { name: 'Salon', reachable: false, error: 'unreachable', state: null },
    ...states.flatMap((file) => [
      {
        name: 'Salon',
        reachable: true,
        state: parseState(readFixture(file)),
        artKey: 'art-1',
        playlists,
      },
      {
        name: 'Bureau',
        reachable: true,
        state: parseState({ ...readFixture(file), disableVolumeControl: true }),
        playlists: [],
      },
    ]),
  ];
  for (const view of views) {
    for (const language of LANGS) {
      const built = buildContent(view, language);
      assert.deepEqual(validateWidgetContent(built), [], `${view?.name} ${language}`);
      assert.ok(built.components.length <= 8);
      const keys = buttons(built).map((button) => button.action.key);
      assert.equal(new Set(keys).size, keys.length, 'action keys are unique');
    }
  }
});

test('a playing track: title, artist and album, cover, source, volume, buttons', async (t) => {
  const w = await world(t);
  const c = await content(w, {}, 'fr');
  const [heading, caption] = c.components;
  assert.equal(heading.text, 'Feeling Good');
  assert.equal(caption.text, 'Nina Simone — I Put a Spell on You');
  const image = c.components.find((component) => component.type === 'image');
  assert.match(image.key, /^art-[0-9a-f]{24}$/);
  const status = c.components.find((component) => component.type === 'status');
  assert.deepEqual(
    status.items.map((item) => `${item.label}=${item.value}`),
    [
      'Lecteur=Salon',
      'État=Lecture',
      'Source=Bibliothèque musicale',
      'Volume=35 %',
      'Aléatoire=Désactivé',
      'Répétition=Désactivé',
    ],
  );
  assert.deepEqual(
    buttons(c).map((button) => button.action.key),
    [ACTIONS.TOGGLE, ACTIONS.NEXT, ACTIONS.VOLUME, ACTIONS.PLAYLIST],
  );
  assert.equal(buttons(c)[0].label, 'Pause');
  const playlist = buttons(c)[3].action.fields[0];
  assert.deepEqual(
    playlist.options.map((option) => option.value),
    ['Dîner', 'Réveil', 'Rock'],
  );
  assert.equal(c.ttl_seconds, 30);

  // The cover is served under its key, as the core will ask for it.
  const ack = await w.fake.widgetGetImage(image.key);
  assert.equal(ack.success, true, ack.error);
  assert.equal(Buffer.from(ack.data.image, 'base64')[1], 0x50); // PNG
});

test('a cover the core would refuse is not shown', async (t) => {
  const living = new FakeVolumio();
  living.art = Buffer.alloc(400 * 1024, 0xff);
  const w = await world(t, { players: [living] });
  const c = await content(w);
  assert.ok(!c.components.some((component) => component.type === 'image'));
  const ack = await w.fake.widgetGetImage('art-000000000000000000000000');
  assert.equal(ack.success, false);
});

test('the chosen player, or the first one added', async (t) => {
  const w = await world(t, {
    players: [new FakeVolumio({ preset: 'living' }), new FakeVolumio({ preset: 'office' })],
  });
  const office = w.players[1];
  assert.equal((await content(w)).components[1].text, 'Bureau', 'first by name: Bureau');
  const chosen = await content(w, { device: ids(w.gladys, w.players[0]).device });
  assert.equal(chosen.components[0].text, 'Feeling Good');
  const idle = await content(w, { device: ids(w.gladys, office).device }, 'de');
  assert.equal(idle.components[0].text, 'Keine Wiedergabe');
  assert.equal(OFFICE, office.host);
});

test('no player added: the widget says where to add one', async (t) => {
  const w = await createWorld({ config: { language: 'en' }, mdns: null });
  t.after(() => w.app.stop());
  const c = await content(w, {}, 'es');
  assert.match(c.components[1].text, /pestaña Descubrir/);
});

test('an unreachable player is said so', async (t) => {
  const w = await world(t);
  const [living] = w.players;
  living.online = false;
  await w.hub.read(w.hub.records.get(living.id));
  const c = await content(w, {}, 'fr');
  assert.equal(c.components[1].items[0].value, 'ne répond pas');
});

test('the buttons drive the player', async (t) => {
  const w = await world(t, { players: [new FakeVolumio({ push: 'none' })] });
  const [living] = w.players;
  const settings = { device: ids(w.gladys, living).device };
  const tap = (actionKey, values) =>
    w.fake.widgetAction('now_playing', actionKey, {}, { settings, values });

  let ack = await tap(ACTIONS.TOGGLE);
  assert.equal(ack.success, true, ack.error);
  assert.equal(ack.data.message.en, 'Paused');
  await settle();
  assert.equal(living.state.status, 'pause');

  ack = await tap(ACTIONS.NEXT);
  assert.equal(ack.data.message.fr, 'Piste suivante');

  ack = await tap(ACTIONS.VOLUME, { volume: 22, mute: true });
  assert.equal(ack.data.message.de, 'Lautstärke 22 %');
  assert.equal(living.state.volume, 22);
  assert.equal(living.state.mute, true);

  ack = await tap(ACTIONS.PLAYLIST, { playlist: 'Rock' });
  assert.equal(ack.data.message.es, 'Reproduciendo la lista Rock');
  assert.equal(living.state.status, 'play');

  // A core older than 5.2 sends no form values: refused, not guessed.
  ack = await tap(ACTIONS.VOLUME);
  assert.equal(ack.success, false);
  assert.match(ack.error, /Gladys 5\.2/);
});

test('a web radio widget offers the same buttons, and the radio source', async (t) => {
  const kitchen = new FakeVolumio({ preset: 'kitchen' });
  const w = await world(t, { players: [kitchen], config: { hosts: KITCHEN } });
  const c = await content(w, {}, 'en');
  const status = c.components.find((component) => component.type === 'status');
  assert.ok(status.items.some((item) => item.value === 'Web radio'));
  assert.equal(c.components[1].text, 'Cuisine', 'no artist: the player name');
});
