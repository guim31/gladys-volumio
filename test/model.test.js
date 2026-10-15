import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sourceLabel } from '../src/texts.js';
import {
  browseItems,
  isStream,
  parseState,
  parseSystemInfo,
  queueToList,
  sameName,
  trackKey,
} from '../src/volumio/model.js';
import { readFixture } from './helpers/fakeVolumio.js';

test('a library track: playing, its seek in ms, not a stream ("stream" is the track type)', () => {
  const state = parseState(readFixture('state-library.json'));
  assert.equal(state.status, 'play');
  assert.equal(state.title, 'Feeling Good');
  assert.equal(state.artist, 'Nina Simone');
  assert.equal(state.seekMs, 61250);
  assert.equal(state.volume, 35);
  assert.equal(state.position, 1);
  assert.equal(isStream(state), false);
  assert.equal(sourceLabel(state, 'fr'), 'Bibliothèque musicale');
});

test('a web radio is a stream; Spotify Connect is not', () => {
  const radio = parseState(readFixture('state-webradio.json'));
  assert.equal(isStream(radio), true);
  assert.equal(sourceLabel(radio, 'de'), 'Webradio');
  const spotify = parseState(readFixture('state-spotify.json'));
  assert.equal(isStream(spotify), false);
  assert.equal(sourceLabel(spotify, 'es'), 'Spotify');
});

test('the empty state of a player without queue', () => {
  const state = parseState(readFixture('state-empty.json'));
  assert.equal(state.status, 'stop');
  assert.equal(state.title, '');
  assert.equal(trackKey(state), null);
});

test('odd values are normalized, never thrown', () => {
  const state = parseState({ status: 'buffering', volume: '140', mute: 'yes' });
  assert.equal(state.status, 'stop');
  assert.equal(state.volume, 100);
  assert.equal(state.mute, false);
  assert.equal(parseState(null).volume, null);
  assert.equal(parseState({ disableVolumeControl: true }).volumeControl, false);
});

test('identity: the UUID, lowercased; no id, no identity', () => {
  assert.deepEqual(parseSystemInfo(readFixture('system-info-office.json')), {
    id: 'c4a8e2f0-7b19-4d3e-8f56-91ab02cd34ef',
    name: 'Bureau',
    hardware: 'primo',
    version: '3.661',
  });
  assert.equal(parseSystemInfo({ name: 'x' }), null);
  assert.equal(parseSystemInfo({ id: '../../etc' }), null);
});

test('favourite radios and my web radios become playable items', () => {
  const items = [
    ...browseItems(readFixture('browse-favourites.json').navigation),
    ...browseItems(readFixture('browse-mywebradio.json').navigation),
  ];
  assert.deepEqual(
    items.map((item) => item.title),
    ['Radio Exemple Jazz', 'Radio Exemple Info', 'Radio du quartier'],
  );
  assert.equal(items[2].type, 'mywebradio');
  assert.deepEqual(browseItems({ lists: 'nope' }), []);
});

test('the queue is played back with a title (getQueue says name)', () => {
  const list = queueToList(readFixture('queue-library.json').queue);
  assert.equal(list.length, 3);
  assert.equal(list[1].title, 'Feeling Good');
  assert.equal(list[1].service, 'mpd');
});

test('names compare without case, accents or extra spaces', () => {
  assert.ok(sameName('  diner ', 'Dîner'));
  assert.ok(!sameName('Rock', 'Rocky'));
});
