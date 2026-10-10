/**
 * app.js - Taiwan Weather Map & Dashboard
 * 結合類 Windy 即時全台氣象地圖與微課程未來一週預報折線圖/表格分析
 */

// 全域狀態
const state = {
  activeLayer: 'temp',        // temp | rain | radar | wind | humidity | weather | typhoon | stations
  activeBasemap: 'dark',      // dark | streets
  showCounties: true,
  showTempLabels: true,
  currentRegion: '臺中市',
  selectedStation: null,
  realtimeData: null,
  forecastData: {},
  typhoonData: [],
  warnings: [],
  radarLayer: null,
  countyLayer: null,
  stationsLayerGroup: null,
  chartInstance: null
};

// 顏色對應配置
const COLOR_SCALES = {
  temp: [
    { threshold: 10, color: '#2c7bb6' },
    { threshold: 15, color: '#5aa2cf' },
    { threshold: 18, color: '#abd9e9' },
    { threshold: 22, color: '#7fcdbb' },
    { threshold: 25, color: '#d9ef8b' },
    { threshold: 28, color: '#fee08b' },
    { threshold: 31, color: '#fdae61' },
    { threshold: 34, color: '#f46d43' },
    { threshold: 99, color: '#d73027' }
  ],
  rain: [
    { threshold: 0.5, color: '#475569' },
    { threshold: 2, color: '#38bdf8' },
    { threshold: 5, color: '#0284c7' },
    { threshold: 10, color: '#22c55e' },
    { threshold: 20, color: '#eab308' },
    { threshold: 40, color: '#f97316' },
    { threshold: 999, color: '#ef4444' }
  ]
};

function getTempColor(t) {
  if (t === null || t === undefined || isNaN(t)) return '#64748b';
  for (const item of COLOR_SCALES.temp) {
    if (t < item.threshold) return item.color;
  }
  return '#d73027';
}

function getRainColor(r) {
  if (!r || r <= 0) return '#334155';
  for (const item of COLOR_SCALES.rain) {
    if (r < item.threshold) return item.color;
  }
  return '#ef4444';
}

// 縣市中心經緯度對照表 (點擊選單時平滑定位)
const COUNTY_CENTROIDS = {
  '臺北市': [25.04, 121.55], '新北市': [25.01, 121.46], '基隆市': [25.13, 121.74],
  '桃園市': [24.99, 121.30], '新竹市': [24.80, 120.97], '新竹縣': [24.83, 121.01],
  '苗栗縣': [24.56, 120.82], '臺中市': [24.16, 120.67], '彰化縣': [24.07, 120.54],
  '南投縣': [23.91, 120.68], '雲林縣': [23.70, 120.43], '嘉義市': [23.48, 120.45],
  '嘉義縣': [23.45, 120.25], '臺南市': [22.99, 120.21], '高雄市': [22.62, 120.30],
  '屏東縣': [22.67, 120.48], '宜蘭縣': [24.75, 121.75], '花蓮縣': [23.99, 121.60],
  '臺東縣': [22.75, 121.14], '澎湖縣': [23.57, 119.58], '金門縣': [24.44, 118.32],
  '連江縣': [26.15, 119.93]
};

// ==========================================================================
// 地圖初始化 (Leaflet Setup)
// ==========================================================================
let map;
let basemapLayers = {};

function initMap() {
  // 設定地圖初始視角置中台灣
  map = L.map('map', {
    center: [23.75, 120.95],
    zoom: 8,
    zoomControl: false,
    attributionControl: false
  });

  // CartoDB 深色底圖 (Dark Matter)
  basemapLayers.dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png?key=cb1_3wd4_1_7d9a30d1a0e5e73520629bb0', {
    maxZoom: 19,
    subdomains: 'abcd'
  }).addTo(map);

  // CartoDB 街道底圖 (Voyager)
  basemapLayers.streets = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=cb1_3wd4_1_7d9a30d1a0e5e73520629bb0', {
    maxZoom: 19,
    subdomains: 'abcd'
  });

  state.stationsLayerGroup = L.layerGroup().addTo(map);

  // 載入縣市邊界 GeoJSON
  loadCountyBoundaries();
}

// 載入台灣 22 縣市邊界多邊形
async function loadCountyBoundaries() {
  try {
    const res = await fetch('counties.geojson');
    if (!res.ok) return;
    const geojson = await res.json();

    state.countyLayer = L.geoJSON(geojson, {
      style: (feature) => ({
        color: '#38bdf8',
        weight: 1.2,
        opacity: 0.6,
        fillColor: '#0ea5e9',
        fillOpacity: 0.05,
        dashArray: '3, 4'
      }),
      onEachFeature: (feature, layer) => {
        const countyName = feature.properties.name || feature.properties.name_zh || '縣市';
        layer.bindTooltip(countyName, {
          sticky: true,
          direction: 'top',
          className: 'county-tooltip'
        });

        layer.on({
          mouseover: (e) => {
            const l = e.target;
            l.setStyle({
              weight: 2.2,
              opacity: 0.9,
              fillOpacity: 0.18,
              dashArray: ''
            });
          },
          mouseout: (e) => {
            state.countyLayer.resetStyle(e.target);
          },
          click: () => {
            selectCounty(countyName);
          }
        });
      }
    });

    if (state.showCounties) {
      state.countyLayer.addTo(map);
    }
  } catch (err) {
    console.warn('載入縣市圖資警告:', err);
  }
}

// ==========================================================================
// 資料抓取與更新流程 (Fetch & Sync Data)
// ==========================================================================
async function refreshAllData() {
  const refreshIcon = document.getElementById('refresh-icon');
  if (refreshIcon) refreshIcon.style.animation = 'spin 1s linear infinite';

  try {
    // 1. 抓取即時測站觀測資料
    const resCurr = await fetch('/api/weather/current');
    if (resCurr.ok) {
      state.realtimeData = await resCurr.json();
      updateSummaryHeader(state.realtimeData.summary);
      renderActiveLayer();
    }

    // 2. 抓取一週預報資料 (預設選中縣市)
    await loadForecastForRegion(state.currentRegion);

    // 3. 抓取特報警報
    loadWarnings();

    // 4. 更新最後時間標籤
    document.getElementById('last-updated-text').textContent =
      `即時觀測更新於 ${new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;

  } catch (err) {
    console.error('抓取氣象資料失敗:', err);
    document.getElementById('last-updated-text').textContent = '資料連線異常，正在使用本地資料庫快取';
  } finally {
    if (refreshIcon) refreshIcon.style.animation = 'none';
  }
}

// 更新頂部極端氣候摘要 (若元素存在則更新)
function updateSummaryHeader(summary) {
  if (!summary) return;
  const maxT = document.getElementById('val-max-temp');
  if (maxT && summary.maxTemperature) maxT.textContent = `${summary.maxTemperature}°C`;
  const minT = document.getElementById('val-min-temp');
  if (minT && summary.minTemperature) minT.textContent = `${summary.minTemperature}°C`;
  const maxR = document.getElementById('val-max-rain');
  if (maxR && summary.maxPrecipitation !== undefined) maxR.textContent = `${summary.maxPrecipitation} mm`;
  const maxW = document.getElementById('val-max-wind');
  if (maxW && summary.maxWindSpeed) maxW.textContent = `${summary.maxWindSpeed} m/s`;
}

// ==========================================================================
// 圖層渲染 (Render Layers on Map)
// ==========================================================================
function renderActiveLayer() {
  state.stationsLayerGroup.clearLayers();

  // 若為雷達圖層
  if (state.activeLayer === 'radar') {
    enableRadarLayer();
    updateLegend('radar');
    return;
  } else {
    disableRadarLayer();
  }

  // 若為颱風圖層
  if (state.activeLayer === 'typhoon') {
    renderTyphoonLayer();
    updateLegend('typhoon');
    return;
  }

  updateLegend(state.activeLayer);

  const features = state.realtimeData?.data?.features || [];
  if (features.length === 0) return;

  features.forEach(f => {
    const coords = f.geometry?.coordinates;
    if (!coords || coords.length < 2) return;
    const [lng, lat] = coords;
    const props = f.properties || {};

    let marker;

    switch (state.activeLayer) {
      case 'temp': {
        const t = props.temperature;
        const color = getTempColor(t);
        const label = (t !== null && t !== undefined) ? `${Math.round(t)}°` : '--';

        const html = state.showTempLabels
          ? `<div class="temp-marker" style="background:${color}; width:28px; height:28px;">${label}</div>`
          : `<div class="temp-marker" style="background:${color}; width:14px; height:14px; border-width:1px;"></div>`;

        const icon = L.divIcon({
          html: html,
          className: 'custom-leaflet-icon',
          iconSize: state.showTempLabels ? [28, 28] : [14, 14],
          iconAnchor: state.showTempLabels ? [14, 14] : [7, 7]
        });

        marker = L.marker([lat, lng], { icon: icon });
        break;
      }

      case 'rain': {
        const r = props.precipitation || 0;
        const color = getRainColor(r);
        const size = Math.min(34, Math.max(16, 16 + r * 1.5));

        const icon = L.divIcon({
          html: `<div class="rain-marker" style="background:${color}; width:${size}px; height:${size}px;">${r > 0 ? r : ''}</div>`,
          className: 'custom-leaflet-icon',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2]
        });
        marker = L.marker([lat, lng], { icon: icon });
        break;
      }

      case 'wind': {
        const ws = props.windSpeed || 0;
        const wd = props.windDirection || 0;
        const icon = L.divIcon({
          html: `<div class="temp-marker" style="background:#0284c7; width:26px; height:26px;">
                  <span class="wind-arrow" style="transform: rotate(${wd}deg);">↑</span>
                 </div>`,
          className: 'custom-leaflet-icon',
          iconSize: [26, 26],
          iconAnchor: [13, 13]
        });
        marker = L.marker([lat, lng], { icon: icon });
        break;
      }

      case 'humidity': {
        const h = props.humidity !== null ? `${props.humidity}%` : '--';
        const icon = L.divIcon({
          html: `<div class="temp-marker" style="background:#0284c7; width:28px; height:28px; font-size:10px;">${h}</div>`,
          className: 'custom-leaflet-icon',
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        marker = L.marker([lat, lng], { icon: icon });
        break;
      }

      case 'weather': {
        const wx = props.weather || '多雲';
        let emoji = '⛅';
        if (wx.includes('晴')) emoji = '☀️';
        else if (wx.includes('雨')) emoji = '🌧️';
        else if (wx.includes('雷')) emoji = '⛈️';
        else if (wx.includes('陰')) emoji = '☁️';

        const icon = L.divIcon({
          html: `<div style="font-size:20px; filter:drop-shadow(0 2px 4px rgba(0,0,0,0.8)); cursor:pointer;">${emoji}</div>`,
          className: 'custom-leaflet-icon',
          iconSize: [24, 24],
          iconAnchor: [12, 12]
        });
        marker = L.marker([lat, lng], { icon: icon });
        break;
      }

      case 'stations':
      default: {
        marker = L.circleMarker([lat, lng], {
          radius: 5,
          color: '#38bdf8',
          fillColor: '#0284c7',
          fillOpacity: 0.9,
          weight: 1.5
        });
        break;
      }
    }

    if (marker) {
      marker.on('click', () => openStationModal(props, [lat, lng]));
      state.stationsLayerGroup.addLayer(marker);
    }
  });
}

// ==========================================================================
// 雷達回波圖層 (RainViewer Realtime Radar Mosaic)
// ==========================================================================
async function enableRadarLayer() {
  if (state.radarLayer) {
    map.removeLayer(state.radarLayer);
  }

  try {
    // 呼叫 RainViewer 免費即時氣象雷達 API
    const res = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    if (res.ok) {
      const data = await res.json();
      const pastFrames = data.radar?.past || [];
      if (pastFrames.length > 0) {
        const latestFrame = pastFrames[pastFrames.length - 1];
        const tilePath = latestFrame.path;

        state.radarLayer = L.tileLayer(`https://tilecache.rainviewer.com${tilePath}/256/{z}/{x}/{y}/2/1_1.png`, {
          opacity: 0.72,
          zIndex: 400
        }).addTo(map);
        return;
      }
    }
  } catch (e) {
    console.warn('RainViewer 連線失敗，嘗試氣象署官方雷達疊圖:', e);
  }

  // 氣象署官方備援雷達疊圖
  const bounds = [[20.2, 117.8], [26.8, 124.2]];
  state.radarLayer = L.imageOverlay('https://www.cwa.gov.tw/Data/radar/CV1_3600.png', bounds, {
    opacity: 0.75,
    zIndex: 400
  }).addTo(map);
}

function disableRadarLayer() {
  if (state.radarLayer) {
    map.removeLayer(state.radarLayer);
    state.radarLayer = null;
  }
}

// ==========================================================================
// 颱風路徑圖層 (Typhoon Track Layer)
// ==========================================================================
async function renderTyphoonLayer() {
  try {
    const res = await fetch('/api/typhoon');
    if (!res.ok) return;
    const json = await res.json();
    const typhoons = json.typhoons || [];

    if (typhoons.length === 0) {
      alert('目前台灣鄰近海域無活動中之颱風警報。');
      return;
    }

    typhoons.forEach(ty => {
      const past = ty.past || [];
      const latlngs = past.map(p => [p.lat, p.lng]);
      if (latlngs.length > 1) {
        L.polyline(latlngs, { color: '#f43f5e', weight: 3, dashArray: '4, 4' }).addTo(state.stationsLayerGroup);
      }
      if (past.length > 0) {
        const curr = past[past.length - 1];
        const typhoonMarker = L.marker([curr.lat, curr.lng], {
          icon: L.divIcon({
            html: `<div style="font-size:28px; animation:spin 4s linear infinite;">🌀</div>`,
            className: 'typhoon-icon',
            iconSize: [30, 30],
            iconAnchor: [15, 15]
          })
        }).bindPopup(`<b>${ty.name} (${ty.enName})</b><br>${ty.category}<br>中心氣壓: ${curr.pressure} hPa<br>最大風速: ${curr.maxWind} m/s`);

        state.stationsLayerGroup.addLayer(typhoonMarker);
      }
    });
  } catch (err) {
    console.error('颱風資訊載入失敗:', err);
  }
}

// ==========================================================================
// 圖例動態切換 (Legend Dynamic Update)
// ==========================================================================
function updateLegend(layerType) {
  const legendUnit = document.getElementById('legend-unit');
  const legendTitle = document.getElementById('legend-title');
  const legendBar = document.getElementById('legend-bar');
  const legendLabels = document.getElementById('legend-labels');

  switch (layerType) {
    case 'temp':
      legendUnit.textContent = '°C';
      legendTitle.textContent = '氣溫色階';
      legendBar.style.background = 'linear-gradient(to right, #2c7bb6, #5aa2cf, #abd9e9, #7fcdbb, #d9ef8b, #fee08b, #fdae61, #f46d43, #d73027)';
      legendLabels.innerHTML = '<span>5</span><span>10</span><span>15</span><span>20</span><span>24</span><span>28</span><span>32</span><span>36</span>';
      break;
    case 'rain':
      legendUnit.textContent = 'mm';
      legendTitle.textContent = '降雨量階級';
      legendBar.style.background = 'linear-gradient(to right, #475569, #38bdf8, #0284c7, #22c55e, #eab308, #f97316, #ef4444)';
      legendLabels.innerHTML = '<span>0</span><span>2</span><span>5</span><span>10</span><span>20</span><span>40</span><span>80+</span>';
      break;
    case 'radar':
      legendUnit.textContent = 'dBZ';
      legendTitle.textContent = '雷達回波強度';
      legendBar.style.background = 'linear-gradient(to right, #00ffff, #0000ff, #00ff00, #ffff00, #ff0000, #ff00ff)';
      legendLabels.innerHTML = '<span>10</span><span>20</span><span>30</span><span>40</span><span>50</span><span>60+</span>';
      break;
    case 'wind':
      legendUnit.textContent = 'm/s';
      legendTitle.textContent = '風速級數';
      legendBar.style.background = 'linear-gradient(to right, #0284c7, #06b6d4, #10b981, #f59e0b, #ef4444)';
      legendLabels.innerHTML = '<span>0</span><span>3</span><span>6</span><span>10</span><span>15</span><span>20+</span>';
      break;
    default:
      legendUnit.textContent = '--';
      legendTitle.textContent = '觀測指標';
      legendBar.style.background = 'linear-gradient(to right, #38bdf8, #0284c7)';
      legendLabels.innerHTML = '<span>低</span><span>中</span><span>高</span>';
      break;
  }
}

// ==========================================================================
// 測站彈出視窗 (Station Modal)
// ==========================================================================
function openStationModal(props, latlng) {
  state.selectedStation = props;

  document.getElementById('modal-station-name').textContent = props.stationName || '觀測站';
  document.getElementById('modal-station-sub').textContent = `${props.county || ''} ${props.town || ''} (${props.stationId || ''})`;

  document.getElementById('modal-temp').textContent = props.temperature !== null ? `${props.temperature}°C` : '--';
  document.getElementById('modal-humidity').textContent = props.humidity !== null ? `${props.humidity}%` : '--';
  document.getElementById('modal-rain').textContent = props.precipitation !== null ? `${props.precipitation} mm` : '0 mm';
  document.getElementById('modal-wind').textContent = props.windSpeed !== null ? `${props.windSpeed} m/s` : '--';
  document.getElementById('modal-pressure').textContent = props.pressure !== null ? `${props.pressure} hPa` : '--';
  document.getElementById('modal-weather').textContent = props.weather || '觀測中';

  document.getElementById('station-modal').classList.add('active');

  // 將底層地圖平滑移動至該測站
  map.panTo(latlng, { animate: true, duration: 0.5 });
}

function closeStationModal() {
  document.getElementById('station-modal').classList.remove('active');
}

// ==========================================================================
// 一週預報折線圖與表格分析 (微課程海報 Step 11~16)
// ==========================================================================
async function loadForecastForRegion(regionName) {
  state.currentRegion = regionName;
  document.getElementById('select-region').value = regionName;

  try {
    const res = await fetch(`/api/weather/forecast?region=${encodeURIComponent(regionName)}`);
    if (!res.ok) return;
    const json = await res.json();
    const records = json.forecasts || [];

    // 1. 繪製折線圖 (海報 Step 14)
    renderChart(records);

    // 2. 呈現預報表格 (海報 Step 15)
    renderTable(records);
  } catch (err) {
    console.error('載入縣市一週預報失敗:', err);
  }
}

// 海報 Step 14: 繪製一週最高溫與最低溫折線圖
function renderChart(records) {
  const ctx = document.getElementById('tempChart');
  if (!ctx) return;

  const labels = records.map(r => r.date ? r.date.slice(5) : '');
  const minTemps = records.map(r => r.minT !== undefined ? r.minT : r.mint);
  const maxTemps = records.map(r => r.maxT !== undefined ? r.maxT : r.maxt);

  if (state.chartInstance) {
    state.chartInstance.destroy();
  }

  const chartCtx = ctx.getContext('2d');

  // 建立最高溫漸層背景
  const maxGradient = chartCtx.createLinearGradient(0, 0, 0, 240);
  maxGradient.addColorStop(0, 'rgba(244, 63, 94, 0.35)');
  maxGradient.addColorStop(1, 'rgba(244, 63, 94, 0.0)');

  // 建立最低溫漸層背景
  const minGradient = chartCtx.createLinearGradient(0, 0, 0, 240);
  minGradient.addColorStop(0, 'rgba(56, 189, 248, 0.35)');
  minGradient.addColorStop(1, 'rgba(56, 189, 248, 0.0)');

  state.chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [
        {
          label: '最高溫 (MaxT)',
          data: maxTemps,
          borderColor: '#f43f5e',
          backgroundColor: maxGradient,
          borderWidth: 3,
          pointBackgroundColor: '#f43f5e',
          pointBorderColor: '#fff',
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35
        },
        {
          label: '最低溫 (MinT)',
          data: minTemps,
          borderColor: '#38bdf8',
          backgroundColor: minGradient,
          borderWidth: 3,
          pointBackgroundColor: '#38bdf8',
          pointBorderColor: '#fff',
          pointRadius: 4,
          pointHoverRadius: 6,
          fill: true,
          tension: 0.35
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(15, 23, 42, 0.95)',
          titleColor: '#f8fafc',
          bodyColor: '#e2e8f0',
          borderColor: 'rgba(255, 255, 255, 0.1)',
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y}°C`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#94a3b8', font: { size: 11 } }
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#94a3b8',
            font: { size: 11 },
            callback: (v) => `${v}°C`
          }
        }
      }
    }
  });
}

// 海報 Step 15: 顯示資料表格
function renderTable(records) {
  const tbody = document.getElementById('forecast-tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  records.forEach(r => {
    const min = r.minT !== undefined ? r.minT : r.mint;
    const max = r.maxT !== undefined ? r.maxT : r.maxt;
    const diff = (max !== undefined && min !== undefined) ? (max - min).toFixed(1) : '--';
    const pop = r.pop !== undefined ? `${r.pop}%` : '0%';
    const wx = r.weather || '多雲';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${r.date || '--'}</strong></td>
      <td>${wx}</td>
      <td class="temp-tag-min">${min !== undefined ? `${min}°C` : '--'}</td>
      <td class="temp-tag-max">${max !== undefined ? `${max}°C` : '--'}</td>
      <td>+${diff}°C</td>
      <td>🌧️ ${pop}</td>
    `;
    tbody.appendChild(tr);
  });
}

// 點選縣市事件連動
function selectCounty(countyName) {
  const target = COUNTY_CENTROIDS[countyName];
  if (target) {
    map.flyTo(target, 10, { duration: 0.8 });
  }
  loadForecastForRegion(countyName);
  document.getElementById('forecast-drawer').classList.add('open');
}

// ==========================================================================
// 警報資訊載入 (Load Weather Warnings)
// ==========================================================================
async function loadWarnings() {
  try {
    const res = await fetch('/api/warnings');
    if (!res.ok) return;
    const json = await res.json();
    const warnings = json.warnings || [];
    const banner = document.getElementById('warning-banner');
    const warningText = document.getElementById('warning-text');

    if (warnings.length > 0) {
      const topWarning = warnings[0];
      warningText.textContent = `【${topWarning.event || '特報'}】${topWarning.headline || ''}`;
      banner.style.display = 'flex';
    } else {
      banner.style.display = 'none';
    }
  } catch (e) {
    console.warn('警告載入略過:', e);
  }
}

// ==========================================================================
// 事件監聽與使用者操作綁定 (Event Listeners)
// ==========================================================================
function setupEventListeners() {
  // 1. 圖層切換按鈕
  document.querySelectorAll('.layer-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.layer-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      state.activeLayer = target.dataset.layer;
      renderActiveLayer();
    });
  });

  // 2. 底圖切換按鈕
  document.querySelectorAll('.basemap-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.basemap-btn').forEach(b => b.classList.remove('active'));
      const target = e.currentTarget;
      target.classList.add('active');
      const bm = target.dataset.basemap;
      state.activeBasemap = bm;

      if (bm === 'dark') {
        map.removeLayer(basemapLayers.streets);
        map.addLayer(basemapLayers.dark);
      } else {
        map.removeLayer(basemapLayers.dark);
        map.addLayer(basemapLayers.streets);
      }
    });
  });

  // 3. 縣市邊界勾選開關
  document.getElementById('chk-counties')?.addEventListener('change', (e) => {
    state.showCounties = e.target.checked;
    if (state.countyLayer) {
      if (state.showCounties) map.addLayer(state.countyLayer);
      else map.removeLayer(state.countyLayer);
    }
  });

  // 4. 氣溫標籤勾選開關
  document.getElementById('chk-temp-labels')?.addEventListener('change', (e) => {
    state.showTempLabels = e.target.checked;
    if (state.activeLayer === 'temp') renderActiveLayer();
  });

  // 5. 定位我的位置按鈕
  document.getElementById('btn-locate')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      alert('您的瀏覽器不支援定位功能。');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        map.flyTo([lat, lng], 12, { duration: 1.2 });

        const userMarker = L.marker([lat, lng], {
          icon: L.divIcon({
            html: '<div style="background:#10b981; width:18px; height:18px; border-radius:50%; border:3px solid #fff; box-shadow:0 0 12px #10b981;"></div>',
            className: 'user-pos-marker',
            iconSize: [18, 18],
            iconAnchor: [9, 9]
          })
        }).bindPopup('<b>📍 您的目前位置</b>').addTo(map);
        userMarker.openPopup();
      },
      (err) => {
        alert('無法取得您的位置：' + err.message);
      }
    );
  });

  // 6. 重新整理資料按鈕
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    refreshAllData();
  });

  // 7. 預報抽屜開啟與關閉按鈕
  const drawer = document.getElementById('forecast-drawer');
  document.getElementById('btn-toggle-forecast')?.addEventListener('click', () => {
    drawer.classList.toggle('open');
  });
  document.getElementById('btn-close-drawer')?.addEventListener('click', () => {
    drawer.classList.remove('open');
  });

  // 8. 測站彈窗關閉按鈕與一週預報連動
  document.getElementById('btn-close-modal')?.addEventListener('click', closeStationModal);
  document.getElementById('modal-btn-view-week')?.addEventListener('click', () => {
    closeStationModal();
    if (state.selectedStation?.county) {
      selectCounty(state.selectedStation.county);
    } else {
      drawer.classList.add('open');
    }
  });

  // 9. 關閉警報廣播橫幅
  document.getElementById('btn-dismiss-warning')?.addEventListener('click', () => {
    document.getElementById('warning-banner').style.display = 'none';
  });

  // 10. 地區下拉選單變更事件 (海報 Step 13)
  document.getElementById('select-region')?.addEventListener('change', (e) => {
    selectCounty(e.target.value);
  });
}

// 頁面載入完成啟動
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  setupEventListeners();
  refreshAllData();

  // 自動每 5 分鐘輪詢一次最新天氣
  setInterval(refreshAllData, 300000);
});
