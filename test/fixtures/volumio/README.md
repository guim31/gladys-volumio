# Volumio fixtures

Answers of the Volumio REST API, in the shapes Volumio 2 and 3 produce: the
examples of the Volumio developer documentation (`docs/02_API/04_REST_API.md`
and `02_WebSocket_APIs.md` of `volumio/docs`) and the code that builds them in
`volumio/volumio3-backend` (`app/statemachine.js` for getState and its empty
state, `app/plugins/music_service/webradio` for the radio favourites,
`app/plugins/system_controller/volumiodiscovery` for the zones and the mDNS
announcement), read to learn the format and not copied.

Every value is invented or anonymized: UUIDs, names, addresses in
192.0.2.0/24 (documentation range), library paths.

| File                       | What                                                        |
| -------------------------- | ----------------------------------------------------------- |
| `system-info-living.json`  | getSystemInfo, Volumio 3 on a Raspberry Pi                  |
| `system-info-office.json`  | getSystemInfo, Volumio 3 on a Primo                         |
| `system-info-kitchen.json` | getSystemInfo, Volumio 2                                    |
| `state-library.json`       | getState, a FLAC of the music library playing (`mpd`)       |
| `state-webradio.json`      | getState, a web radio playing (`stream: "webradio"`)        |
| `state-spotify.json`       | getState, Spotify Connect (consume mode, `volspotconnect2`) |
| `state-empty.json`         | getState of a player with an empty queue                    |
| `queue-library.json`       | getQueue, three tracks of the library                       |
| `playlists.json`           | listplaylists                                               |
| `browse-favourites.json`   | browse `radio/favourites`                                   |
| `browse-mywebradio.json`   | browse `radio/myWebRadio`                                   |
| `zones.json`               | getzones of the living room player                          |
| `mdns.json`                | what the core relays for `_Volumio._tcp` (scanNetwork)      |
