/* =====================================================================
   Forest Buddy – Data Analysis website
   Reads GNSS attenuation records from Supabase, draws a map + graph,
   and keeps them updated live.
   ===================================================================== */

/* ---------- 1. SETTINGS (edit these) ---------- */

// Supabase → Project Settings → API (or "API Keys"). Use the anon/publishable
// key ONLY. Never put the service_role / secret key in this file — GitHub
// Pages is public, so anyone can read it.
const SUPABASE_URL = 'https://agvyuyqqcoeejdbklrpu.supabase.co';
const SUPABASE_KEY = 'sb_publishable_PCvsPS6ax6Jo_hl2j6u3XQ_cM-CKOfq';

const LINK_LOST_SECONDS = 30;   // show warning after this long with no data
const RATE_WINDOW_MS = 5000;    // data rate = records received in the last 5 s
const PAGE_SIZE = 1000;         // Supabase returns at most 1000 rows per request

// The 5 attenuation levels. Each level covers values below its "max".
// These thresholds are placeholders — set them from your calibration data.
const LEVELS = [
  { max: 3,        label: 'Very low',  color: '#1a9850' },
  { max: 6,        label: 'Low',       color: '#91cf60' },
  { max: 9,        label: 'Moderate',  color: '#fee08b' },
  { max: 12,       label: 'High',      color: '#fc8d59' },
  { max: Infinity, label: 'Very high', color: '#d73027' },
];
const NO_VALUE_COLOR = '#999999';

// Starting map view (MSU campus) — the map re-centers on the data once loaded.
const START_VIEW = [33.4555, -88.7944];


/* ---------- 2. CONNECT TO SUPABASE ---------- */

const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);


/* ---------- 3. PAGE STATE ---------- */

let currentRun = null;          // run_id being shown
const records = new Map();      // timestamp_ms -> record (Map prevents duplicates)
const markers = new Map();      // timestamp_ms -> Leaflet marker
let channel = null;             // live-update subscription
let lastArrival = Date.now();   // browser time when data last arrived
let arrivalTimes = [];          // browser times of recent live records (for Hz)
let chartNeedsRedraw = false;
let chartClickHooked = false;

const $ = (id) => document.getElementById(id);


/* ---------- 4. HELPERS ---------- */

function levelIndex(atten) {
  if (atten === null || atten === undefined || Number.isNaN(atten)) return -1;
  return LEVELS.findIndex((l) => atten < l.max);
}

function colorFor(atten) {
  const i = levelIndex(atten);
  return i === -1 ? NO_VALUE_COLOR : LEVELS[i].color;
}

function levelLabel(atten) {
  const i = levelIndex(atten);
  return i === -1 ? 'No value' : LEVELS[i].label;
}

// Text like "3 – 6" for the legend
function rangeText(i) {
  const lo = i === 0 ? null : LEVELS[i - 1].max;
  const hi = LEVELS[i].max;
  if (lo === null) return `< ${hi}`;
  if (hi === Infinity) return `≥ ${lo}`;
  return `${lo} – ${hi}`;
}

function sortedRecords() {
  return [...records.values()].sort((a, b) => a.timestamp_ms - b.timestamp_ms);
}

function escapeHtml(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// The stored values for one record, as a small HTML table
function valuesTable(r) {
  const rows = [
    ['Run', r.run_id],
    ['Timestamp (ms)', r.timestamp_ms],
    ['Latitude', r.lat],
    ['Longitude', r.lon],
    ['Attenuation (dB-Hz)', r.atten_dbhz],
    ['Level', levelLabel(r.atten_dbhz)],
    ['Fix type', r.fix_type],
  ];
  return '<table class="values">' +
    rows.map(([k, v]) => `<tr><td>${k}</td><td>${escapeHtml(v)}</td></tr>`).join('') +
    '</table>';
}

function showSelected(r) {
  if (r) $('selectedBody').innerHTML = valuesTable(r);
}

function showError(msg) {
  console.error(msg);
  $('errorBox').textContent = 'Error: ' + msg;
  $('errorBox').classList.remove('hidden');
}


/* ---------- 5. MAP (Leaflet) ---------- */

// preferCanvas draws thousands of circles much faster than SVG
const map = L.map('map', { preferCanvas: true }).setView(START_VIEW, 16);

const streets = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap contributors',
}).addTo(map);

const satellite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { maxZoom: 19, attribution: 'Imagery &copy; Esri' }
);
L.control.layers({ Streets: streets, Satellite: satellite }).addTo(map);

// All data points live in one group so we can clear it or zoom to it
const markerLayer = L.featureGroup().addTo(map);

// Legend: 5 labeled levels
const legend = L.control({ position: 'bottomright' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'legend');
  div.innerHTML = '<strong>Attenuation (dB-Hz)</strong><br>' +
    LEVELS.map((l, i) => `<i style="background:${l.color}"></i>${l.label} (${rangeText(i)})`).join('<br>');
  return div;
};
legend.addTo(map);

function addMarker(r) {
  if (r.lat === null || r.lon === null || r.lat === undefined || r.lon === undefined) return;
  const m = L.circleMarker([r.lat, r.lon], {
    radius: 6,
    color: '#333',
    weight: 1,
    fillColor: colorFor(r.atten_dbhz),
    fillOpacity: 0.85,
  });
  m.bindPopup(() => valuesTable(r));        // click → popup with stored values
  m.on('click', () => showSelected(r));
  m.addTo(markerLayer);
  markers.set(r.timestamp_ms, m);
}

function zoomToData() {
  if (markers.size > 0) {
    map.fitBounds(markerLayer.getBounds(), { padding: [20, 20], maxZoom: 19 });
  }
}


/* ---------- 6. GRAPH (Plotly) ---------- */

function drawChart() {
  const rows = sortedRecords();
  const t0 = rows.length ? rows[0].timestamp_ms : 0;

  const trace = {
    type: 'scatter',
    mode: 'lines+markers',
    x: rows.map((r) => (r.timestamp_ms - t0) / 1000),   // seconds since first record
    y: rows.map((r) => r.atten_dbhz),
    customdata: rows.map((r) => r.timestamp_ms),        // lets a click find the record
    line: { color: '#9aa59c', width: 1 },
    marker: { size: 6, color: rows.map((r) => colorFor(r.atten_dbhz)) },
    hovertemplate: 't = %{x:.2f} s<br>%{y:.2f} dB-Hz<extra></extra>',
  };

  const layout = {
    margin: { t: 10, r: 10, b: 55, l: 65 },
    xaxis: { title: { text: 'Time since run start (s)' } },
    yaxis: { title: { text: 'Attenuation (dB-Hz)' } },
    uirevision: String(currentRun),   // keeps your zoom when new data arrives
  };

  Plotly.react('chart', [trace], layout, { responsive: true, displaylogo: false });

  // Hook up clicks once (the chart div only has .on() after the first draw)
  if (!chartClickHooked) {
    $('chart').on('plotly_click', (ev) => {
      const ts = ev.points[0].customdata;
      const r = records.get(ts);
      showSelected(r);
      const m = markers.get(ts);
      if (m) { map.panTo(m.getLatLng()); m.openPopup(); }
    });
    chartClickHooked = true;
  }

  $('pointCount').textContent = rows.length;
  $('mapCount').textContent = markers.size;
  updateCountMatch();
}

// Redraw at most once per second, so a burst of live data doesn't freeze the page
setInterval(() => {
  if (chartNeedsRedraw) {
    chartNeedsRedraw = false;
    drawChart();
  }
}, 1000);


/* ---------- 7. LOADING DATA ---------- */

function addRecord(r) {
  if (records.has(r.timestamp_ms)) return;   // already have it (no duplicates)
  records.set(r.timestamp_ms, r);
  addMarker(r);
  chartNeedsRedraw = true;
}

// Fill the run dropdown from the runs table
async function loadRuns() {
  const { data, error } = await db.from('runs').select('*');
  if (error) return showError('Could not read runs: ' + error.message);

  const idOf = (row) => row.run_id ?? row.id;   // works with either column name
  data.sort((a, b) => {
    if (a.created_at && b.created_at) return b.created_at.localeCompare(a.created_at);
    return idOf(b) > idOf(a) ? 1 : -1;            // newest first
  });

  const select = $('runSelect');
  select.innerHTML = '';
  for (const row of data) {
    const opt = document.createElement('option');
    opt.value = idOf(row);
    opt.textContent = row.name ? `${row.name} (${idOf(row)})` : `Run ${idOf(row)}`;
    select.appendChild(opt);
  }

  if (data.length === 0) {
    showError('No runs found. Check that the runs table has rows and that the read policy is set (see setup.sql).');
    return;
  }
  loadRun(select.value);
}

// Load every record for one run, then listen for new ones
async function loadRun(runId) {
  currentRun = runId;
  records.clear();
  markers.clear();
  markerLayer.clearLayers();
  arrivalTimes = [];
  lastArrival = Date.now();
  $('selectedBody').textContent = 'Click a point on the map or graph to see its stored values.';

  // Subscribe FIRST, so nothing inserted during the download is missed
  if (channel) await db.removeChannel(channel);
  channel = db
    .channel('records-' + runId)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'records', filter: `run_id=eq.${runId}` },
      (payload) => {
        if (runId !== currentRun) return;
        const now = Date.now();
        lastArrival = now;
        arrivalTimes.push(now);
        addRecord(payload.new);
        if (markers.size === 1) zoomToData();   // first point of a new run
      }
    )
    .subscribe((status) => {
      $('liveStatus').textContent =
        status === 'SUBSCRIBED' ? 'connected' :
        status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' ? 'error – retrying' :
        status.toLowerCase();
    });

  // Download existing rows, 1000 at a time, until there are no more
  let from = 0;
  while (true) {
    const { data, error } = await db
      .from('records')
      .select('*')
      .eq('run_id', runId)
      .order('timestamp_ms', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (runId !== currentRun) return;   // user switched runs mid-download
    if (error) { showError('Could not read records: ' + error.message); break; }

    data.forEach(addRecord);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  zoomToData();
  drawChart();
  refreshDbCount();
}


/* ---------- 8. REQUIREMENT 3: points shown = records in database ---------- */

async function refreshDbCount() {
  if (currentRun === null) return;
  // head:true + count:'exact' asks only for the number of rows, not the rows
  const { count, error } = await db
    .from('records')
    .select('*', { count: 'exact', head: true })
    .eq('run_id', currentRun);
  if (error) return showError('Could not count records: ' + error.message);
  $('dbCount').textContent = count;
  $('dbCount').dataset.count = count;
  updateCountMatch();
}

function updateCountMatch() {
  const dbCount = Number($('dbCount').dataset.count);
  const shown = records.size;
  const el = $('pointCount');
  if (Number.isNaN(dbCount)) return;
  el.className = shown === dbCount ? 'match' : 'mismatch';
  el.textContent = shown === dbCount ? `${shown} ✓` : `${shown} (≠ ${dbCount})`;
}

setInterval(refreshDbCount, 10000);   // re-check every 10 s


/* ---------- 9. DATA RATE + LINK-LOST WARNING ---------- */

setInterval(() => {
  const now = Date.now();

  // Live rate: records that arrived in the last 5 s, divided by 5 s
  arrivalTimes = arrivalTimes.filter((t) => now - t <= RATE_WINDOW_MS);
  if (arrivalTimes.length > 0) {
    const hz = arrivalTimes.length / (RATE_WINDOW_MS / 1000);
    $('dataRate').textContent = `${hz.toFixed(1)} Hz (live)`;
  } else if (records.size > 1) {
    // No live data → show the run's average recorded rate from its timestamps
    const rows = sortedRecords();
    const spanS = (rows[rows.length - 1].timestamp_ms - rows[0].timestamp_ms) / 1000;
    $('dataRate').textContent = spanS > 0
      ? `${((rows.length - 1) / spanS).toFixed(1)} Hz (recorded avg)`
      : '0 Hz';
  } else {
    $('dataRate').textContent = '0 Hz';
  }

  // Link lost after 30 s with no data
  const silentS = (now - lastArrival) / 1000;
  if (silentS >= LINK_LOST_SECONDS) {
    $('lostSecs').textContent = Math.floor(silentS);
    $('linkLost').classList.remove('hidden');
  } else {
    $('linkLost').classList.add('hidden');
  }
}, 1000);


/* ---------- 10. CSV EXPORT ---------- */

function csvCell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

$('exportBtn').addEventListener('click', () => {
  const cols = ['run_id', 'timestamp_ms', 'lat', 'lon', 'atten_dbhz', 'fix_type'];
  const lines = [cols.join(',')];
  for (const r of sortedRecords()) lines.push(cols.map((c) => csvCell(r[c])).join(','));

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `forestbuddy_run_${currentRun}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});


/* ---------- 11. START ---------- */

$('runSelect').addEventListener('change', (e) => loadRun(e.target.value));
loadRuns();
