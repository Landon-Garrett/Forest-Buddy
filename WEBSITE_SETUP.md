# Forest Buddy – Data Analysis Website

A static web page (no server of our own) that reads robot data from Supabase and shows:

- a heat map with 5 labeled attenuation levels and a legend
- a graph of attenuation (dB-Hz) vs. time with labeled axes
- a points-shown count checked against the database count, with click-for-values on every point
- live data rate (Hz), a link-lost warning after 30 s, and a CSV export button

## Files

| File | What it does |
|---|---|
| `index.html` | The page layout: header, stats bar, map box, graph box. Loads the libraries. |
| `style.css` | How it looks. |
| `app.js` | All the logic: talks to Supabase, draws the map and graph, live updates. |
| `setup.sql` | One-time database settings (read permission + live updates). |

## How the pieces fit

```
Robot ──inserts rows──▶ Supabase (runs, records)
                              │
                ┌─────────────┴──────────────┐
          normal query                 Realtime channel
     (download existing rows)       (pushes each new row)
                └─────────────┬──────────────┘
                              ▼
          Browser running app.js (GitHub Pages)
            ├─ Leaflet  → map
            └─ Plotly   → graph
```

GitHub Pages only hosts the files. All the work happens in the visitor's browser, which talks
directly to Supabase using the public "anon" key.

---

## Step 1 – Set up the database (5 min)

1. Open your Supabase project → **SQL Editor** → **New query**.
2. Paste in `setup.sql` and click **Run**.
   - This lets the website *read* (not change) your tables, and turns on live updates.
   - If something says "already exists", that part was already done. That's fine.
3. Read the note at the bottom of `setup.sql` about how the robot uploads. If the robot uses the
   anon key, turning on RLS will block its inserts until you handle that.

**Check:** Database → Publications → `supabase_realtime` should list `records` and `runs`.

## Step 2 – Put your keys in `app.js`

1. Supabase → **Project Settings → API** (or **API Keys**).
2. Copy the **Project URL** into `SUPABASE_URL`.
3. Copy the **anon** (or **publishable**) key into `SUPABASE_KEY`.

Never paste the `service_role`/secret key here. Your GitHub repo is public, and that key
bypasses all security. The anon key is meant to be public; the read-only policies are what
protect your data.

## Step 3 – Set your 5 attenuation levels

At the top of `app.js`, edit `LEVELS`. Each level covers values below its `max`:

```js
{ max: 3, label: 'Very low', color: '#1a9850' },   // < 3 dB-Hz
{ max: 6, label: 'Low',      color: '#91cf60' },   // 3 – 6
...
{ max: Infinity, label: 'Very high', ... },        // ≥ 12
```

The numbers there now are placeholders. Pick them from your test data (for example, open-sky
vs. under-canopy runs). The legend and point colors update automatically.

## Step 4 – Test on your own computer

Easiest: install VS Code → install the **Live Server** extension → right-click `index.html`
→ **Open with Live Server**.

Or, from the folder in a terminal: `python -m http.server 8000`, then open
`http://localhost:8000`.

Press **F12 → Console** to see errors. Most first-time problems show up there:

| Error | Usual cause |
|---|---|
| `Invalid API key` | Wrong key or URL in `app.js` |
| "No runs found" / empty data | Read policy missing (Step 1) |
| Live connection never says "connected" | Table not added to `supabase_realtime` (Step 1) |

## Step 5 – Publish on GitHub Pages

1. On GitHub, the account or organization must be named `forestbuddy`, and the repository must
   be named exactly `forestbuddy.github.io`.
2. Upload the 4 files to the repository's main branch (Add file → Upload files works).
3. Repository → **Settings → Pages** → Source: **Deploy from a branch** → `main` / `(root)` → Save.
4. Wait about a minute, then open `https://forestbuddy.github.io`.

Every time you push changes, the site updates within a minute or two. Hard-refresh
(Ctrl+Shift+R) if you still see the old version.

## Step 6 – Verify each requirement

**Live updates + data rate:** with the page open, run this in the SQL Editor (use a real
`run_id` from your runs table, and a timestamp that doesn't already exist):

```sql
insert into records (run_id, timestamp_ms, lat, lon, atten_dbhz, fix_type)
values (1, 999999, 33.4555, -88.7944, 7.5, 4);
```

A new point should appear on the map and graph within about a second.

**(1) Heat map:** 5 colors, legend in the bottom-right corner.

**(2) Graph:** x-axis "Time since run start (s)", y-axis "Attenuation (dB-Hz)".

**(3) Point count:** "Points shown (graph)" turns green with ✓ when it equals "Records in database".
Click any map circle or graph point, and its stored values appear in a popup and in the
"Selected point" box. "Points on map" can be lower than the graph count if some records have
no lat/lon (no GPS fix), since those can't be placed on a map.

**Link lost:** stop sending data, and the red banner appears after 30 s.

**CSV:** click Export CSV and open the file in Excel. Row count should match the database count.

---

## How `app.js` works, section by section

1. **Settings** – keys, thresholds, timing. The only part you normally edit.
2. **Connect** – `supabase.createClient(...)` makes the `db` object used for every request.
3. **State** – `records` is a Map keyed by `timestamp_ms`. Since `(run_id, timestamp_ms)` is your
   primary key, this guarantees each record is counted once, even if it arrives twice
   (once from the download, once from the live feed).
4. **Helpers** – picks a level/color for a value, builds the values table for popups.
5. **Map** – Leaflet map with Streets/Satellite toggle. Each record is a colored circle
   (`circleMarker`). This is a "binned" heat map instead of a blurred heat layer, because a
   blurred layer can't be clicked point by point or counted, which requirement 3 needs.
6. **Graph** – Plotly line+markers chart. Time is converted to seconds since the first record.
   Each point carries its `timestamp_ms`, so a click can look up the exact record and also open
   that point's popup on the map. Redraws at most once per second.
7. **Loading data** –
   - Fills the run dropdown from `runs` (newest first).
   - When a run is picked, it first subscribes to live inserts for that run, then downloads
     existing rows **1000 at a time**. Supabase returns at most 1000 rows per request by
     default, so without this loop a long run would silently show only the first 1000 points.
8. **Count check** – asks Supabase for just the row count (`count: 'exact', head: true`) every
   10 s and compares it to what's on screen.
9. **Rate + link lost** – every second:
   - Data rate = live records received in the last 5 s ÷ 5. With no live data (an old run),
     it shows the run's average recorded rate from its timestamps instead.
   - If 30 s pass since the last record arrived, the banner shows.
10. **CSV export** – builds the file in the browser and downloads it. No server needed.
11. **Start** – loads the run list and the newest run.

## Things to know

- **Free plan limits:** Supabase free projects pause after a week with no activity. If the site
  suddenly can't load anything, log into Supabase and restore the project.
- **Old runs show the link-lost banner** after 30 s, because no new data is arriving. That's
  expected; it means "nothing live right now."
- **Very long runs (tens of thousands of points)** will take a few seconds to download. That's fine
  for a capstone demo. If it becomes slow, the next step would be switching the graph to
  `scattergl` (GPU drawing).
- **If your `runs` table** uses a column other than `run_id` or `id` for its key, update
  `idOf` in `loadRuns()`. If it has a `name` column, the dropdown shows it.
