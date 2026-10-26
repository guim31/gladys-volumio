# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gladys 5.3 music player: title, artist, album, artwork, duration, position
  (writable: seek), shuffle, repeat (off, all, one) and mute on each player,
  published together when they change. The dashboard Music box becomes a full
  player.
- Music panel of Gladys 5.3: the queue (a tap jumps), browsing the Volumio
  sources (music library, artists, albums, genres, playlists, web radios,
  plugins), search, and playing an item now, next or at the end of the queue;
  the "Play music on a speaker" scene action of Gladys picks from it.
- Covers larger than the 300 KB Gladys accepts are made smaller (plain
  JavaScript, no image library), for the Music box and the widget.

### Changed

- Requires Gladys 5.3.0 (SDK 0.16).
- Playback state is writable (0 pause, 1 play, 2 stop) and reads **2 when
  stopped** instead of 0: a scene waiting for 0 no longer fires on a stop. It
  is no longer kept in the history. Devices added before 1.1.0: click
  **Update** on the player in the Discover tab to get the new features (the
  existing ones keep their scenes and dashboards).
- An unchanged value is no longer sent again every 6 hours (music features
  never show "no recent value").
- A player that stops answering is shown stopped.

## [1.0.1] - 2026-10-15

### Added

- Volumio players on the local network, one Gladys music device each: volume,
  play, pause, previous and next track, playback state, and "Broadcast a
  notification" for the text to speech and the sounds of the scenes.
- Notifications resume the music: the queue, the track, the position, the
  volume and the repeat mode come back after the sound, played at the
  notification volume of the configuration (60 s at most by default).
- Discovery by mDNS through Gladys, by the addresses typed in the
  configuration, and through the other players each Volumio knows; a player
  keeps its device when its address changes.
- Real-time updates over the Volumio socket.io channel (socket.io 2 and
  later), with a fallback to reading the players every 10 s while playing and
  every minute otherwise.
- Dashboard widget "Volumio now playing": title, artist, album, cover,
  source, volume, shuffle and repeat, with play/pause, next, volume and
  playlist buttons (Gladys 5.2.0 or later).
- Scene trigger "A new track is playing", with title, artist, album and
  source as variables.
- Scene actions: play a Volumio playlist, play a favourite web radio, play an
  address (optionally as a notification), set shuffle and repeat, clear the
  queue.
- Configuration buttons "Search for players" and "List playlists and
  favourite radios".
- English, French, German and Spanish everywhere: configuration, feature
  names, widget, messages and documentation.
- `scripts/probe.mjs`, a read-only check of a real player.

[Unreleased]: https://github.com/guim31/gladys-volumio/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-volumio/releases/tag/v1.0.1
