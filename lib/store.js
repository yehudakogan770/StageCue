const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'db.json');
const DEFAULT_DB = { users: [], events: [], songs: [], playlists: [], presets: [] };

function newId(prefix) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Without DATABASE_URL, data lives in a git-tracked JSON file - fine for
// local dev, but it means every deploy/restart on a host with no persistent
// disk (like Render's free tier) wipes every account. Setting DATABASE_URL
// switches to Postgres, where the same load()/save() shape is kept exactly
// as-is (the whole db is still one JSON document) so nothing else in the
// app has to change - only this file knows where the data actually lives.
let impl;

if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const ready = pool.query(`
    CREATE TABLE IF NOT EXISTS store_blob (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `).then(() => pool.query('SELECT 1 FROM store_blob WHERE id = 1')).then((res) => {
    if (res.rows.length === 0) {
      return pool.query('INSERT INTO store_blob (id, data) VALUES (1, $1)', [DEFAULT_DB]);
    }
  });

  impl = {
    async load() {
      await ready;
      const res = await pool.query('SELECT data FROM store_blob WHERE id = 1');
      return res.rows[0].data;
    },
    async save(db) {
      await ready;
      await pool.query('UPDATE store_blob SET data = $1 WHERE id = 1', [db]);
    },
  };
} else {
  impl = {
    async load() {
      const raw = fs.readFileSync(DB_PATH, 'utf8');
      return JSON.parse(raw);
    },
    async save(db) {
      fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
    },
  };
}

module.exports = {
  load: () => impl.load(),
  save: (db) => impl.save(db),
  newId,
};
