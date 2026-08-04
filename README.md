# StageCue

StageCue connects a **Keyboard Player** to a **Singer** on two separate devices,
so the player can send lyrics and cues live without saying a word out loud.

## How it works

1. The keyboard player opens the site, picks **Keyboard Player**, and logs in
   (or creates a free account) — an account keeps your songs, playlists, and
   presets private to you.
2. After logging in, they land on **Your Events**: each event (e.g. "Sunday
   Service", "Youth Night") has its own completely separate songs, playlists,
   and presets, so different services never mix together.
3. Opening (or creating) an event leads to **Start Session** — this gives a
   short code (like `ABCDE`), or they can type their own custom code (e.g.
   `CHURCH1`) instead of a random one.
4. The singer opens the site on their own phone/tablet/laptop, picks
   **Singer**, and types in that code to connect — this can happen right
   away, even while the player is still setting things up.
5. The keyboard player lands on the **Setup** screen: build the song library,
   playlists, presets, and tonight's queue, with the singer already connected
   and waiting.
6. When ready, tap **Go Live** to switch to the **Live** screen — a simple,
   big-button view built for one-handed use on a phone while playing: advance
   lyrics line by line, jump to any queued song, or fire a quick preset
   message, all without digging through menus.
7. Lyrics and messages are independent: sending a message (typed or preset)
   pops up on top of the singer's screen without hiding the lyrics
   underneath, so both can be visible at once.
8. The singer can tap quick reply buttons ("Got it", "Can't hear you", etc.)
   to send a silent response back to the player. An account is optional for
   the singer — only needed if they want to save their own custom quick
   replies across sessions.
9. If either side loses connection briefly (spotty WiFi, phone screen
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

- **Accounts**: the keyboard player must log in (username/password, or
  Google sign-in if configured — see below) so their data is private to
  them. The singer never needs an account, but can optionally create one
  just to save their own quick replies.
- **Events**: each account can create multiple named events, each with its
  own completely separate songs, playlists, presets, and live queue.
- **Two roles, one app**: `/player` for the keyboard player, `/singer` for the
  singer.
- **Setup screen**: song library, playlists, presets, and the live queue all
  live on one screen, used before (or between) songs — no time pressure.
- **Live screen**: a stripped-down, big-button view for actually performing —
  reached via **Go Live** — built for quick one-handed taps, not scrolling
  or precision swiping. It also shows the full playlist so the player can
  tap any song to send it, not just the next one in order.
- **Custom or random session codes**: start a session with a code you choose,
  or let StageCue generate one.
- **Song library**: add songs with title, artist, and lyrics. Each song can
  also have its own quick messages (e.g. "Key change") shown alongside your
  regular presets whenever that song is live.
- **Playlists**: group songs into reusable sets.
- **Live queue**: build tonight's running order from the library or a saved
  playlist, reorder it, and tap **Next Song** (or any song in the list) to
  send it live.
- **Lyrics view**: the singer sees the full lyrics with the current line
  highlighted; the player can click any line (or use Prev/Next Line) to move
  the highlight live. The player can also hide the lyrics on their own
  screen only — the singer is never affected.
- **Messages & presets, independent of lyrics**: send a free-typed message or
  a saved one-click preset (e.g. "Last chorus", "Wrap it up") that pops up in
  its own box on the singer's screen — the lyrics stay visible underneath,
  so both can show at the same time.
- **Reactions**: the singer can tap quick replies that show up in the
  player's "Singer Says" feed.
- **Adjustable text size**: the keyboard player and the singer each control
  their own screen's text size independently — it's a personal, local
  preference, never sent to the other side.
- **Reconnect resilience**: a dropped connection on either side doesn't end
  the session — it reconnects automatically and picks up right where it
  left off.
- **Saved data**: accounts, events, songs, playlists, and presets are stored
  in `data/db.json` on the server, or in Postgres if `DATABASE_URL` is set
  (see below).

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
restart, so everything in `data/db.json` — **including registered
accounts** — can be lost when that happens. That's fine while testing, but
before relying on this for a real event, set up persistent storage (below).

### Recommended: persistent storage with Postgres

Without any setup, StageCue stores its data in a file that gets wiped on
every redeploy/restart (see the note above). To make accounts and data
permanent, point it at a free Postgres database instead:

1. Create a free Postgres database — [Neon](https://neon.tech) and
   [Supabase](https://supabase.com) both have a free tier that works well
   for this. Copy the connection string it gives you (it looks like
   `postgres://user:password@host/dbname`).
2. In Render: your service → **Environment** → add an environment variable
   named `DATABASE_URL` with that connection string, then redeploy.

That's it — the server automatically creates the table it needs on first
boot. If `DATABASE_URL` isn't set, it falls back to the `data/db.json` file
exactly as before, so local development needs no extra setup.

**Heads up:** switching this on starts a fresh, empty database — it does
not import whatever is currently in the live `data/db.json` file on Render.
If there are accounts on the live site you want to keep, let me know before
you flip this on and I can help pull that data over first.

### Optional: enabling "Continue with Google"

Username/password login always works with no setup. If you'd also like a
"Continue with Google" button, set two environment variables on your
deployment (in Render: your service → **Environment**):

1. Go to the [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   and create an **OAuth client ID** (type: **Web application**).
2. Under **Authorized redirect URIs**, add:
   `https://YOUR-RENDER-URL/api/auth/google/callback`
   (use your actual deployed URL, e.g. `https://stagecue.onrender.com/...`).
3. Copy the generated **Client ID** and **Client Secret**.
4. In Render, add environment variables `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` with those values, then redeploy.

If those variables aren't set, the Google button simply stays hidden and
username/password keeps working as normal — nothing else is affected.

## Notes

- The live session (which singer is paired with which player, and what's
  currently on screen) is temporary and resets if the server restarts — only
  accounts, events, songs, playlists, and presets are saved permanently
  (subject to the Render free-tier disk caveat above).
- If the keyboard player deliberately clicks **End Session**, the singer is
  disconnected right away and told the session ended. An accidental drop
  (network blip, tab backgrounded) instead gives the player about 45 seconds
  to reconnect before the session actually ends.
