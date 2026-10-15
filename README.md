# Volumio for Gladys Assistant

A [Gladys Assistant](https://gladysassistant.com) external integration for **Volumio** network music players
(a Raspberry Pi running Volumio plugged into an amplifier or a DAC, a Volumio Primo, Rivo or Motivo), on the
local network, through the Volumio REST API and its real-time socket.io channel.

> **Developed without the hardware: feedback welcome.** Written from the Volumio documentation and source
> code, and tested against a simulated player: please report how it behaves with yours in the
> [issues](https://github.com/guim31/gladys-volumio/issues).

## Features

- **One music device per player**, with the music features of the Gladys core: volume, play, pause,
  previous, next, playback state and **broadcast a notification**. The player works with the dashboard
  **Music** box and with the core's "speak a text" scene action (Gladys Plus text to speech).
- **Notifications that resume the music**: the queue, the track, the position, the volume and the repeat
  mode are put back after the sound, at a notification volume of your choice.
- **Dashboard widget** _Volumio now playing_: title, artist, album, cover, source, volume, shuffle, repeat,
  with play/pause, next, a volume form and a playlist form.
- **Scene trigger** _A new track is playing_, with title, artist, album and source as variables.
- **Scene actions**: play a Volumio playlist, play a favourite web radio, play an address (a stream or a
  sound, optionally as a notification), set shuffle and repeat, clear the queue.
- **Discovery**: mDNS relayed by the core, addresses typed by hand, and the other players each Volumio knows
  (its "zones"): one address is enough to find them all. A player keeps its device when its address changes.
- **Real time**: the integration listens to the socket.io channel of the Volumio web interface (Engine.IO 3
  for socket.io 2, Engine.IO 4 for later versions), and falls back to reading the player (every 10 s while
  playing, every minute otherwise).
- Four languages (English, French, German, Spanish) for the configuration, the feature names, the widget,
  the messages and the [documentation](docs/en.md).

## Requirements

- Gladys Assistant **5.2.0** or later (the widget forms need it).
- A Volumio 2 or 3 player on the same network, its port 3000 reachable from Gladys.
- No account, no password: the Volumio API is open on the local network.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the address of this repository:
   `https://github.com/guim31/gladys-volumio` (or install **Volumio** from the catalog once it is listed).
2. Open the **Discovery** tab and add the players. If none is found, enter the IP address of one player in
   **Configuration** → **Player addresses**, then press **Search for players**.

The user guide is in [`docs/en.md`](docs/en.md) (also in [French](docs/fr.md), [German](docs/de.md) and
[Spanish](docs/es.md)); Gladys links it from the Configuration screen.

## How it works

- `GET /api/v1/getSystemInfo` identifies a player by its UUID (the device external id), `getState` gives its
  state, `/api/v1/commands/?cmd=` drives it, `replaceAndPlay` and `addToQueue` play an address and restore a
  queue, `listplaylists` and `browse?uri=radio/favourites` / `radio/myWebRadio` list what the scene actions
  and the widget offer, `getzones` gives the other players.
- Volumio answers `200` even when a command fails, with `{ "error": … }` in the body: the client treats it as
  a refusal. A playlist that does not exist is answered "Success": the name is checked against
  `listplaylists` first.
- The push channel speaks socket.io over the WebSocket built into Node, without the socket.io client
  library. Only the players added to Gladys are read and followed.
- The devices are published with `should_poll: true` every minute, but the core cannot be trusted to poll
  (GladysAssistant/Gladys#3198): the integration reads the players on its own timer, and the core's `onPoll`
  only reads a player left alone for most of a minute.

## Checked, and what was not

- Checked: the whole test suite (`npm test`) against the SDK's fake Gladys and a simulated player built from
  the documented answers of the Volumio API; the push client against real socket.io 2.5 and 4.8 servers; the
  manifest against the store validator.
- Not checked: a real Volumio player, a real Gladys instance. `scripts/probe.mjs <ip>` runs the integration's
  own client against a real player, read-only (no command), and says what it finds:
  `node scripts/probe.mjs 192.168.1.40`.

## Limitations

- mDNS: Volumio announces `_Volumio._tcp`, with a capital letter. Gladys 5.2 only accepts a lowercase service
  type and compares the answers with the case it asked, so its mediated discovery may find nothing: one
  address typed by hand is then enough, the others come from the zones.
- Gladys has no music feature for mute, shuffle, repeat or the title: they are in the widget and the scene
  actions.
- Gladys 5.2 does not forward the volume of its "play a notification" scene action to external integrations:
  the notification volume of the configuration applies.
- After a notification, a paused queue comes back without playing, from its first track; the queue of a
  streaming service (Spotify Connect, AirPlay) cannot be resumed.
- Album covers over 300 KB are not shown (Gladys refuses them, and the container has no image library to
  resize them).

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`) and simulated players
(`test/helpers/fakeVolumio.js`, built from `test/fixtures/volumio/`). See [`CLAUDE.md`](CLAUDE.md) for the
project rules. Versions and releases belong to the Release workflow (Actions → Release).

## Credits

- [Volumio](https://volumio.com): the REST and WebSocket API documentation
  ([volumio/docs](https://github.com/volumio/docs)), and the
  [volumio3-backend](https://github.com/volumio/volumio3-backend) source (GPL-3.0), read to learn the formats
  of getState, the radio favourites, the zones and the mDNS announcement; no code was copied.
- [PyVolumio](https://github.com/OnFreund/PyVolumio) by On Freund (MIT) and Home Assistant's
  [`volumio`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/volumio) integration
  (Apache-2.0): the API calls, the stop-instead-of-pause rule for web radios, the mDNS TXT keys.
- The architecture, the conformity and language tests follow
  [gladys-wled](https://github.com/guim31/gladys-wled) and [gladys-pihole](https://github.com/guim31/gladys-pihole).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Volumio. "Volumio" is a trademark of its owner.

## License

[Apache-2.0](LICENSE)
