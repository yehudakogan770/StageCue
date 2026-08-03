# StageCue

StageCue connects a **Keyboard Player** to a **Singer** on two separate devices,
so the player can send lyrics and cues live without saying a word out loud.

## How it works

1. The keyboard player opens the site and clicks **Start Session** — this gives
   a short code (like `ABCDE`).
2. The singer opens the site on their own phone/tablet/laptop, picks **Singer**,
   and types in that code to connect.
3. From then on, whatever the keyboard player sends shows up instantly on the
   singer's screen: song lyrics (with the current line highlighted), short
   messages, or quick presets like "One more verse" or "Slow down".
4. The singer can tap quick reply buttons ("Got it", "Can't hear you", etc.)
   to send a silent response back to the player.

## Running it

Requires [Node.js](https://nodejs.org/) (v18 or newer).

```bash
npm install
npm start
```

Then open `http://localhost:3000` in a browser. On the same WiFi network,
other devices can connect using your computer's local IP address instead of
`localhost` (e.g. `http://192.168.1.23:3000`).

## Features

- **Two roles, one app**: `/player` for the keyboard player, `/singer` for the
  singer.
- **Song library**: add songs with title, artist, and lyrics.
- **Playlists**: group songs into reusable sets.
- **Live queue**: build tonight's running order from the library or a saved
  playlist, reorder it, and send any song to the singer with one click.
- **Lyrics view**: the singer sees the full lyrics with the current line
  highlighted; the player can click any line (or use Prev/Next Line) to move
  the highlight live.
- **Messages & presets**: send a free-typed message or a saved one-click
  preset (e.g. "Last chorus", "Wrap it up") that appears big on the singer's
  screen.
- **Reactions**: the singer can tap quick replies that show up in the
  player's "Singer Says" feed.
- **Adjustable text size**: bump the singer's display text bigger or smaller
  for visibility on stage.
- **Saved data**: songs, playlists, and presets are stored in
  `data/db.json` on the server, so they persist between sessions.

## Notes

- The live session (which singer is paired with which player, and what's
  currently on screen) is temporary and resets if the server restarts — only
  the song library, playlists, and presets are saved permanently.
- If the keyboard player ends the session or closes their tab, the singer is
  disconnected and told the session ended.
