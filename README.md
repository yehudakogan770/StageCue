# StageCue

StageCue connects a **Keyboard Player** to a **Singer** on two separate devices,
so the player can send lyrics and cues live without saying a word out loud.

## How it works

1. The keyboard player opens the site, picks **Keyboard Player**, and clicks
   **Start Session** — this gives a short code (like `ABCDE`), or they can
   type their own custom code (e.g. `CHURCH1`) instead of a random one.
2. The singer opens the site on their own phone/tablet/laptop, picks
   **Singer**, and types in that code to connect — this can happen right
   away, even while the player is still setting things up.
3. The keyboard player lands on the **Setup** screen: build the song library,
   playlists, presets, and tonight's queue, with the singer already connected
   and waiting.
4. When ready, tap **Launch Event** to switch to the **Live** screen — a
   simple, big-button view built for one-handed use on a phone while playing:
   advance lyrics line by line, jump to the next queued song, or fire a quick
   preset message, all without digging through menus.
5. Lyrics and messages are independent: sending a message (typed or preset)
   pops up on top of the singer's screen without hiding the lyrics
   underneath, so both can be visible at once.
6. The singer can tap quick reply buttons ("Got it", "Can't hear you", etc.)
   to send a silent response back to the player.
7. If either side loses connection briefly (spotty WiFi, phone screen
   locking), the session waits for them to reconnect instead of ending
   immediately — it only actually ends after about 45 seconds of the
   keyboard player being gone.

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
- **Setup screen**: song library, playlists, presets, and the live queue all
  live on one screen, used before (or between) songs — no time pressure.
- **Live screen**: a stripped-down, big-button view for actually performing —
  reached via **Launch Event** — built for quick one-handed taps, not
  scrolling or precision swiping.
- **Custom or random session codes**: start a session with a code you choose,
  or let StageCue generate one.
- **Song library**: add songs with title, artist, and lyrics.
- **Playlists**: group songs into reusable sets.
- **Live queue**: build tonight's running order from the library or a saved
  playlist, reorder it, and tap **Next Song** to advance through it live.
- **Lyrics view**: the singer sees the full lyrics with the current line
  highlighted; the player can click any line (or use Prev/Next Line) to move
  the highlight live.
- **Messages & presets, independent of lyrics**: send a free-typed message or
  a saved one-click preset (e.g. "Last chorus", "Wrap it up") that pops up in
  its own box on the singer's screen — the lyrics stay visible underneath,
  so both can show at the same time.
- **Reactions**: the singer can tap quick replies that show up in the
  player's "Singer Says" feed.
- **Adjustable text size**: bump the singer's display text bigger or smaller
  for visibility on stage.
- **Reconnect resilience**: a dropped connection on either side doesn't end
  the session — it reconnects automatically and picks up right where it
  left off.
- **Saved data**: songs, playlists, and presets are stored in
  `data/db.json` on the server, so they persist between sessions.

## Deploying it online (so it works from anywhere)

This repo includes a `render.yaml`, so it can be deployed on
[Render](https://render.com) as a free web service:

1. Sign up / log in at render.com (a free account is enough).
2. Click **New +** → **Blueprint**, and connect this GitHub repository.
3. Render reads `render.yaml` automatically and sets everything up — click
   **Apply** to deploy.
4. Once it's live, Render gives you a public URL like
   `https://stagecue.onrender.com` — share that with your singer instead of
   a local address.

Note: on Render's free plan, the server's disk resets on every redeploy or
restart, so anything saved in `data/db.json` (songs/playlists/presets) can
be lost when that happens. That's fine to start with; if you want that data
to survive long-term, it can be moved to a small persistent database later.

## Notes

- The live session (which singer is paired with which player, and what's
  currently on screen) is temporary and resets if the server restarts — only
  the song library, playlists, and presets are saved permanently.
- If the keyboard player deliberately clicks **End Session**, the singer is
  disconnected right away and told the session ended. An accidental drop
  (network blip, tab backgrounded) instead gives the player about 45 seconds
  to reconnect before the session actually ends.
