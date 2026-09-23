/* ─────────────────────────────────────────────────────────────
   台灣即時氣象地圖 — app.js
   CWA API: O-A0003-001 (自動氣象站)
   ───────────────────────────────────────────────────────────── */

'use strict';

// ═══════════════════════════════════════════════════════════════
//  CONFIG
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  API_KEY: 'CWA-0E80745D-ADF3-46B8-955D-98BA07EF71B2',
  API_URL: 'https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0003-001',
  REFRESH_INTERVAL: 5 * 60 * 1000, // 5 minutes
  MAP_CENTER: [23.97, 120.97],
  MAP_ZOOM: 7,
};

// ═══════════════════════════════════════════════════════════════
//  TILE LAYERS
// ═══════════════════════════════════════════════════════════════
const TILE_LAYERS = {
  dark: {
    url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  },
  street: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: 'Tiles &copy; Esri',
  },
};

// ═══════════════════════════════════════════════════════════════
//  COLOUR SCALES
// ═══════════════════════════════════════════════════════════════
/**
 * 線性插值色彩陣列，輸入 0~1，輸出 CSS rgb()
 */
function interpolateColor(stops, t) {
  t = Math.max(0, Math.min(1, t));
  const n = stops.length - 1;
  const idx = Math.floor(t * n);
  if (idx >= n) return `rgb(${stops[n].join(',')})`;
  const lo = stops[idx];
  const hi = stops[idx + 1];
  const f  = t * n - idx;
  return `rgb(${Math.round(lo[0] + (hi[0]-lo[0])*f)},${Math.round(lo[1] + (hi[1]-lo[1])*f)},${Math.round(lo[2] + (hi[2]-lo[2])*f)})`;
}

const SCALES = {
  temperature: {
    stops: [[44,123,182],[93,173,213],[171,217,233],[224,243,248],[127,205,187],[217,239,139],[254,224,139],[253,174,97],[244,109,67],[215,48,39],[165,0,38]],
    min: 5, max: 38,
    label: '°C 氣溫',
    ticks: [5,10,15,20,24,28,32,36],
    gradient: 'linear-gradient(to right, #2c7bb6, #5aa2cf, #abd9e9, #7fcdbb, #d9ef8b, #fee08b, #fdae61, #f46d43, #d73027)',
  },
  humidity: {
    stops: [[255,255,204],[161,218,180],[65,182,196],[34,94,168],[8,37,103]],
    min: 20, max: 100,
    label: '% 相對濕度',
    ticks: [20,40,60,80,100],
    gradient: 'linear-gradient(to right, #ffffcc, #a1dab4, #41b6c4, #2271b2, #083167)',
  },
  precipitation: {
    stops: [[240,249,232],[186,228,188],[123,204,196],[67,162,202],[8,104,172],[8,64,129]],
    min: 0, max: 50,
    label: 'mm 雨量',
    ticks: [0,10,20,30,40,50],
    gradient: 'linear-gradient(to right, #f0f9e8, #bae4bc, #7bccc4, #43a2ca, #0868ac, #084081)',
  },
  pressure: {
    stops: [[103,0,31],[178,24,43],[214,96,77],[253,174,97],[254,224,144],[255,255,191],[224,243,248],[171,217,233],[116,173,209],[69,117,180],[49,54,149]],
    min: 960, max: 1030,
    label: 'hPa 氣壓',
    ticks: [960,970,980,990,1000,1010,1020,1030],
    gradient: 'linear-gradient(to right, #67001f, #b2182b, #d6604d, #fdae61, #fee08b, #ffffbf, #e0f3f8, #abd9e9, #74add1, #4575b4, #313695)',
  },
  uv: {
    stops: [[0,128,0],[255,255,0],[255,165,0],[255,0,0],[128,0,128]],
    min: 0, max: 11,
    label: 'UV指數',
    ticks: [0,3,6,8,11],
    gradient: 'linear-gradient(to right, #008000, #ffff00, #ffa500, #ff0000, #800080)',
  },
  wind: {
    stops: [[161,218,180],[65,182,196],[34,94,168],[29,145,192],[12,44,132]],
    min: 0, max: 20,
    label: 'm/s 風速',
    ticks: [0,5,10,15,20],
    gradient: 'linear-gradient(to right, #a1dab4, #41b6c4, #2259a8, #1d91c0, #0c2c84)',
  },
};

// ═══════════════════════════════════════════════════════════════
//  WEATHER → EMOJI MAP
// ═══════════════════════════════════════════════════════════════
function weatherToEmoji(weather) {
  if (!weather) return '❓';
  if (weather.includes('雷')) return '⛈️';
  if (weather.includes('大雨') || weather.includes('豪雨')) return '🌧️';
  if (weather.includes('雨')) return '🌦️';
  if (weather.includes('陰')) return '☁️';
  if (weather.includes('多雲') || weather.includes('雲')) return '⛅';
  if (weather.includes('晴')) return '☀️';
  if (weather.includes('霧') || weather.includes('霾')) return '🌫️';
  return '🌈';
}

// ═══════════════════════════════════════════════════════════════
//  WIND DIRECTION
// ═══════════════════════════════════════════════════════════════
function degToCardinal(deg) {
  const dirs = ['北','東北','東','東南','南','西南','西','西北'];
  const idx  = Math.round(((deg % 360) + 360) % 360 / 45) % 8;
  return dirs[idx];
}

// Arrow character by wind direction (points "from" direction → adjust)
function degToArrow(deg) {
  const arrows = ['↓','↙','←','↖','↑','↗','→','↘'];
  const idx = Math.round(((deg + 22.5) % 360) / 45) % 8;
  return arrows[idx];
}

// ═══════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════
function safeNum(val) {
  const n = parseFloat(val);
  return isNaN(n) || n <= -98 ? null : n;
}

function formatTime(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function pad(n) { return String(n).padStart(2,'0'); }

function getWGS84Coords(station) {
  const coords = station?.GeoInfo?.Coordinates;
  if (!coords) return null;
  const wgs = coords.find(c => c.CoordinateName === 'WGS84');
  if (wgs) {
    const lat = parseFloat(wgs.StationLatitude);
    const lon = parseFloat(wgs.StationLongitude);
    if (!isNaN(lat) && !isNaN(lon)) return [lat, lon];
  }
  return null;
}

// ═══════════════════════════════════════════════════════════════
//  APP STATE
// ═══════════════════════════════════════════════════════════════
let map;
let currentBasemap = 'dark';
let currentLayer   = 'temperature';
let showLabels     = true;
let showCounty     = true;
let stations       = [];
let markerGroup    = L.layerGroup();
let countyGroup    = L.layerGroup();
let baseTileLayer;
let refreshTimer;
let userLocationMarker;

// ═══════════════════════════════════════════════════════════════
//  MAP INIT
// ═══════════════════════════════════════════════════════════════
function initMap() {
  map = L.map('map', {
    center: CONFIG.MAP_CENTER,
    zoom:   CONFIG.MAP_ZOOM,
    zoomControl: true,
    attributionControl: true,
  });

  map.zoomControl.setPosition('bottomright');

  // Set basemap
  baseTileLayer = L.tileLayer(TILE_LAYERS.dark.url, {
    attribution: TILE_LAYERS.dark.attr,
    maxZoom: 18,
    subdomains: 'abcd',
  }).addTo(map);

  markerGroup.addTo(map);
  countyGroup.addTo(map);
}

// ═══════════════════════════════════════════════════════════════
//  FETCH DATA
// ═══════════════════════════════════════════════════════════════
async function fetchStations() {
  const url = `${CONFIG.API_URL}?Authorization=${CONFIG.API_KEY}&format=JSON&limit=500`;
  const res  = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.success !== 'true') throw new Error('API returned success:false');
  return json.records?.Station ?? [];
}

// ═══════════════════════════════════════════════════════════════
//  RENDER MARKERS
// ═══════════════════════════════════════════════════════════════
function renderMarkers() {
  markerGroup.clearLayers();

  const scale = SCALES[currentLayer] || SCALES.temperature;

  stations.forEach(s => {
    const coords = getWGS84Coords(s);
    if (!coords) return;

    const we = s.WeatherElement ?? {};

    switch (currentLayer) {
      case 'temperature': renderTempMarker(s, coords, we, scale); break;
      case 'precipitation': renderPrecipMarker(s, coords, we, scale); break;
      case 'wind': renderWindMarker(s, coords, we); break;
      case 'humidity': renderHumidityMarker(s, coords, we, scale); break;
      case 'weather': renderWeatherMarker(s, coords, we); break;
      case 'pressure': renderPressureMarker(s, coords, we, scale); break;
      case 'uv': renderUVMarker(s, coords, we, scale); break;
      case 'stations': renderStationDot(s, coords); break;
    }
  });
}

// ── Temperature marker ──────────────────────────────────────
function renderTempMarker(s, coords, we, scale) {
  const temp = safeNum(we.AirTemperature);
  if (temp === null) return;

  const t     = (temp - scale.min) / (scale.max - scale.min);
  const color = interpolateColor(scale.stops, t);
  const size  = map.getZoom() >= 9 ? 'lg' : map.getZoom() >= 8 ? 'md' : 'sm';
  const label = showLabels ? `${temp.toFixed(1)}` : '';

  const icon = L.divIcon({
    className: '',
    html: `<div class="weather-marker size-${size}" style="background:${color};">${label}</div>`,
    iconSize: [size==='lg'?44:size==='md'?36:28, size==='lg'?44:size==='md'?36:28],
    iconAnchor: [size==='lg'?22:size==='md'?18:14, size==='lg'?22:size==='md'?18:14],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ── Precipitation marker ────────────────────────────────────
function renderPrecipMarker(s, coords, we, scale) {
  const rain = safeNum(we.Now?.Precipitation) ?? safeNum(we.Precipitation) ?? 0;
  const t     = Math.min(rain / scale.max, 1);
  const color = rain === 0 ? 'rgba(56,189,248,0.35)' : interpolateColor(scale.stops, t);
  const r     = rain === 0 ? 6 : Math.max(8, Math.min(28, 8 + rain * 1.5));

  const icon = L.divIcon({
    className: '',
    html: `<div class="weather-marker" style="background:${color};width:${r*2}px;height:${r*2}px;font-size:${Math.max(9,r*0.7)}px;">${showLabels ? rain.toFixed(1) : ''}</div>`,
    iconSize: [r*2, r*2],
    iconAnchor: [r, r],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ── Wind marker ─────────────────────────────────────────────
function renderWindMarker(s, coords, we) {
  const spd = safeNum(we.WindSpeed);
  const dir = safeNum(we.WindDirection);
  if (spd === null) return;

  const arrow = dir !== null ? degToArrow(dir) : '•';
  const t     = Math.min(spd / 20, 1);
  const hue   = Math.round(240 - t * 240); // blue→red
  const color = `hsl(${hue},80%,60%)`;

  const icon = L.divIcon({
    className: '',
    html: `<div class="wind-marker">
      <div class="wind-arrow" style="color:${color};transform:rotate(${dir??0}deg)">${arrow}</div>
      ${showLabels ? `<div class="wind-speed-label">${spd.toFixed(1)}</div>` : ''}
    </div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ── Humidity marker ─────────────────────────────────────────
function renderHumidityMarker(s, coords, we, scale) {
  const hum = safeNum(we.RelativeHumidity);
  if (hum === null) return;

  const t     = (hum - scale.min) / (scale.max - scale.min);
  const color = interpolateColor(scale.stops, t);
  const size  = 'md';

  const icon = L.divIcon({
    className: '',
    html: `<div class="weather-marker size-${size}" style="background:${color};">${showLabels ? Math.round(hum)+'%' : ''}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ── Weather emoji marker ────────────────────────────────────
function renderWeatherMarker(s, coords, we) {
  const emoji = weatherToEmoji(we.Weather);

  const icon = L.divIcon({
    className: '',
    html: `<div class="weather-emoji-marker" title="${we.Weather||''}">${emoji}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ── Pressure marker ─────────────────────────────────────────
function renderPressureMarker(s, coords, we, scale) {
  const pres = safeNum(we.AirPressure);
  if (pres === null) return;

  const t     = (pres - scale.min) / (scale.max - scale.min);
  const color = interpolateColor(scale.stops, t);

  const icon = L.divIcon({
    className: '',
    html: `<div class="weather-marker size-md" style="background:${color};font-size:9px;">${showLabels ? pres.toFixed(0) : ''}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ── UV marker ───────────────────────────────────────────────
function renderUVMarker(s, coords, we, scale) {
  const uv = safeNum(we.UVIndex);
  if (uv === null) return;

  const t     = Math.min(uv / scale.max, 1);
  const color = interpolateColor(scale.stops, t);

  const icon = L.divIcon({
    className: '',
    html: `<div class="weather-marker size-md" style="background:${color};">${showLabels ? uv : ''}</div>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ── Station dot ─────────────────────────────────────────────
function renderStationDot(s, coords) {
  const icon = L.divIcon({
    className: '',
    html: `<div class="station-dot" title="${s.StationName}"></div>`,
    iconSize: [8, 8],
    iconAnchor: [4, 4],
  });

  const marker = L.marker(coords, { icon }).addTo(markerGroup);
  marker.on('click', () => showDetail(s));
}

// ═══════════════════════════════════════════════════════════════
//  LEGEND
// ═══════════════════════════════════════════════════════════════
function updateLegend() {
  if (currentLayer === 'weather' || currentLayer === 'stations') {
    document.getElementById('legend-panel').style.display = 'none';
    return;
  }

  document.getElementById('legend-panel').style.display = 'block';
  const scale = SCALES[currentLayer] || SCALES.temperature;

  document.getElementById('legend-title').textContent = scale.label;
  document.getElementById('legend-bar').style.background = scale.gradient;

  const labels = document.getElementById('legend-labels');
  labels.innerHTML = scale.ticks.map(v => `<span>${v}</span>`).join('');
}

// ═══════════════════════════════════════════════════════════════
//  STATION DETAIL CARD
// ═══════════════════════════════════════════════════════════════
function showDetail(s) {
  const we = s.WeatherElement ?? {};
  const geo = s.GeoInfo ?? {};

  document.getElementById('detail-weather-icon').textContent = weatherToEmoji(we.Weather);
  document.getElementById('detail-station-name').textContent = s.StationName ?? '—';
  document.getElementById('detail-location').textContent =
    `${geo.CountyName ?? ''} ${geo.TownName ?? ''}`.trim() || '—';
  document.getElementById('detail-time').textContent =
    `觀測時間：${formatTime(s.ObsTime?.DateTime)}`;

  const temp = safeNum(we.AirTemperature);
  const hum  = safeNum(we.RelativeHumidity);
  const spd  = safeNum(we.WindSpeed);
  const dir  = safeNum(we.WindDirection);
  const rain = safeNum(we.Now?.Precipitation) ?? safeNum(we.Precipitation);
  const pres = safeNum(we.AirPressure);
  const uv   = safeNum(we.UVIndex);
  const alt  = safeNum(geo.StationAltitude);

  document.getElementById('detail-temp').textContent     = temp !== null ? `${temp.toFixed(1)} °C` : '—';
  document.getElementById('detail-humidity').textContent = hum  !== null ? `${Math.round(hum)} %` : '—';
  document.getElementById('detail-wind').textContent     = spd  !== null ? `${spd.toFixed(1)} m/s` : '—';
  document.getElementById('detail-windir').textContent   = dir  !== null ? `${degToCardinal(dir)} (${Math.round(dir)}°)` : '—';
  document.getElementById('detail-rain').textContent     = rain !== null ? `${rain.toFixed(1)} mm` : '—';
  document.getElementById('detail-pressure').textContent = pres !== null ? `${pres.toFixed(1)} hPa` : '—';
  document.getElementById('detail-uv').textContent       = uv   !== null ? `${uv}` : '—';
  document.getElementById('detail-alt').textContent      = alt  !== null ? `${alt.toFixed(0)} m` : '—';

  const hi = safeNum(we.DailyExtreme?.DailyHigh?.TemperatureInfo?.AirTemperature);
  const lo = safeNum(we.DailyExtreme?.DailyLow?.TemperatureInfo?.AirTemperature);
  document.getElementById('detail-high').textContent = hi !== null ? `🔺 今日最高 ${hi.toFixed(1)} °C` : '—';
  document.getElementById('detail-low').textContent  = lo !== null ? `🔻 今日最低 ${lo.toFixed(1)} °C` : '—';

  const card = document.getElementById('station-detail');
  card.classList.add('visible');

  // Pan map toward card
  const coords = getWGS84Coords(s);
  if (coords) {
    map.panTo(coords, { animate: true, duration: 0.5 });
  }
}

function hideDetail() {
  document.getElementById('station-detail').classList.remove('visible');
}

// ═══════════════════════════════════════════════════════════════
//  BASEMAP SWITCH
// ═══════════════════════════════════════════════════════════════
function setBasemap(name) {
  if (!TILE_LAYERS[name]) return;
  currentBasemap = name;
  map.removeLayer(baseTileLayer);
  baseTileLayer = L.tileLayer(TILE_LAYERS[name].url, {
    attribution: TILE_LAYERS[name].attr,
    maxZoom: 18,
    subdomains: 'abcd',
  });
  baseTileLayer.addTo(map);
  baseTileLayer.bringToBack();
}

// ═══════════════════════════════════════════════════════════════
//  COUNTY LAYER (simple GeoJSON placenames via Nominatim polygon)
//  We skip complex GeoJSON; instead draw text labels on the map
// ═══════════════════════════════════════════════════════════════
const COUNTY_CENTERS = [
  { name:'臺北市', lat:25.0478, lon:121.5319 },
  { name:'新北市', lat:25.0013, lon:121.4657 },
  { name:'桃園市', lat:24.9899, lon:121.3189 },
  { name:'臺中市', lat:24.1477, lon:120.6736 },
  { name:'臺南市', lat:23.1417, lon:120.2513 },
  { name:'高雄市', lat:22.6273, lon:120.3014 },
  { name:'基隆市', lat:25.1277, lon:121.7390 },
  { name:'新竹市', lat:24.8036, lon:120.9675 },
  { name:'新竹縣', lat:24.6869, lon:121.1566 },
  { name:'苗栗縣', lat:24.5602, lon:120.8214 },
  { name:'彰化縣', lat:24.0518, lon:120.5161 },
  { name:'南投縣', lat:23.9610, lon:120.9718 },
  { name:'雲林縣', lat:23.7092, lon:120.4313 },
  { name:'嘉義市', lat:23.4800, lon:120.4491 },
  { name:'嘉義縣', lat:23.4518, lon:120.2554 },
  { name:'屏東縣', lat:22.5519, lon:120.5487 },
  { name:'宜蘭縣', lat:24.6917, lon:121.7603 },
  { name:'花蓮縣', lat:23.9871, lon:121.6015 },
  { name:'臺東縣', lat:22.7972, lon:121.0713 },
  { name:'澎湖縣', lat:23.5710, lon:119.5793 },
  { name:'金門縣', lat:24.4493, lon:118.3767 },
  { name:'連江縣', lat:26.1508, lon:119.9497 },
];

function renderCountyLabels() {
  countyGroup.clearLayers();
  if (!showCounty) return;

  COUNTY_CENTERS.forEach(c => {
    const icon = L.divIcon({
      className: '',
      html: `<div style="color:rgba(200,220,255,0.55);font-size:11px;font-weight:600;font-family:'Noto Sans TC',sans-serif;white-space:nowrap;pointer-events:none;text-shadow:0 1px 3px rgba(0,0,0,0.9);">${c.name}</div>`,
      iconSize: [80, 20],
      iconAnchor: [40, 10],
    });
    L.marker([c.lat, c.lon], { icon, interactive: false, zIndexOffset: -100 }).addTo(countyGroup);
  });
}

// ═══════════════════════════════════════════════════════════════
//  MAIN LOAD & REFRESH
// ═══════════════════════════════════════════════════════════════
async function loadData() {
  const refreshBtn = document.getElementById('refresh-btn');
  refreshBtn.classList.add('spinning');

  try {
    stations = await fetchStations();
    renderMarkers();
    renderCountyLabels();
    updateLegend();

    // Update UI
    const now = new Date();
    const updateTimeEl = document.getElementById('update-time');
    if (updateTimeEl) {
      updateTimeEl.textContent = `更新於 ${now.getFullYear()}/${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    }

    const obsTimeEl = document.getElementById('obs-time');
    if (obsTimeEl) {
      const sampleObs = stations.find(s => s?.ObsTime?.DateTime)?.ObsTime?.DateTime;
      if (sampleObs) {
        const d = new Date(sampleObs);
        obsTimeEl.textContent = `${pad(d.getMonth()+1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
      } else {
        obsTimeEl.textContent = `${pad(now.getMonth()+1)}/${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      }
    }

    const stationCountInfo = document.getElementById('station-count-info');
    if (stationCountInfo) {
      stationCountInfo.textContent = `${stations.length}`;
    }

    const stationCount = document.getElementById('station-count');
    if (stationCount) {
      stationCount.textContent = `共 ${stations.length} 個測站`;
    }

  } catch (err) {
    console.error('資料載入失敗', err);
    const updateTimeEl = document.getElementById('update-time');
    if (updateTimeEl) {
      updateTimeEl.textContent = '資料載入失敗，請重試';
    }
  } finally {
    document.getElementById('loading').classList.add('hidden');
    refreshBtn.classList.remove('spinning');
  }
}

function scheduleRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadData, CONFIG.REFRESH_INTERVAL);
}

// ═══════════════════════════════════════════════════════════════
//  GEOLOCATION
// ═══════════════════════════════════════════════════════════════
function locateUser() {
  if (!navigator.geolocation) {
    alert('您的瀏覽器不支援定位功能');
    return;
  }

  navigator.geolocation.getCurrentPosition(pos => {
    const lat = pos.coords.latitude;
    const lon = pos.coords.longitude;
    map.setView([lat, lon], 13, { animate: true });

    if (userLocationMarker) map.removeLayer(userLocationMarker);
    userLocationMarker = L.marker([lat, lon], {
      icon: L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;background:#38bdf8;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 4px rgba(56,189,248,0.35)"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      }),
    }).addTo(map);
  }, () => {
    alert('無法取得您的位置');
  });
}

// ═══════════════════════════════════════════════════════════════
//  EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════
function bindEvents() {
  // Layer buttons
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentLayer = btn.dataset.layer;
      renderMarkers();
      updateLegend();
      hideDetail();
    });
  });

  // Base map buttons
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setBasemap(btn.dataset.basemap);
    });
  });

  // Toggle labels
  document.getElementById('show-labels').addEventListener('change', e => {
    showLabels = e.target.checked;
    renderMarkers();
  });

  // Toggle county labels
  document.getElementById('show-county').addEventListener('change', e => {
    showCounty = e.target.checked;
    renderCountyLabels();
  });

  // Locate
  document.getElementById('locate-btn').addEventListener('click', locateUser);

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', () => {
    loadData();
    scheduleRefresh();
  });

  // Close detail card
  document.getElementById('detail-close').addEventListener('click', hideDetail);

  // Re-render markers on zoom change (size adapts)
  map.on('zoomend', () => {
    if (currentLayer === 'temperature') renderMarkers();
  });
}

// ═══════════════════════════════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════════════════════════════
window.addEventListener('DOMContentLoaded', () => {
  initMap();
  bindEvents();
  loadData();
  scheduleRefresh();
});
