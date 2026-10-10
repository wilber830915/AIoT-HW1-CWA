"""
streamlit_app.py
AI 創新微課程 Taiwan Weather Forecast 從氣象資料到互動式天氣預報應用
嚴格依循海報 24 步驟設計 (CWA API x JSON x Python x SQLite x Streamlit x Folium)
"""

import os
import sqlite3
import pandas as pd
import streamlit as st
import database
import cwa_service

# 網頁基本設定
st.set_page_config(
    page_title="Taiwan Weather Forecast - 煥哥 AI 微課程",
    page_icon="🌤️",
    layout="wide"
)

# 海報 Step 8, 9: 確保 SQLite 資料庫與資料表就緒
database.init_db()

# 自訂 CSS 樣式美化
st.markdown("""
<style>
    .main-header {
        font-size: 2.2rem;
        font-weight: 700;
        color: #0284c7;
        margin-bottom: 0.2rem;
    }
    .sub-header {
        color: #64748b;
        font-size: 1rem;
        margin-bottom: 1.5rem;
    }
    .metric-card {
        background-color: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 12px;
        text-align: center;
    }
</style>
""", unsafe_allow_html=True)

# 標題與課程橫幅
st.markdown('<div class="main-header">🌤️ Taiwan Weather Forecast 互動式天氣預報</div>', unsafe_allow_html=True)
st.markdown('<div class="sub-header">CWA API × JSON × Python × SQLite × Streamlit | 實作成果展示</div>', unsafe_allow_html=True)

# 側邊欄控制項 (海報 Step 13, 18)
with st.sidebar:
    st.header("⚙️ 控制面板 (Step 13 & 18)")
    
    # 手動同步按鈕
    if st.button("🔄 同步 CWA 中央氣象署最新資料", use_container_width=True):
        with st.spinner("正在連線 CWA API 並寫入 SQLite data.db..."):
            fc = cwa_service.fetch_week_forecasts()
            locs = fc.get("locations", {})
            for loc_name, items in locs.items():
                database.save_forecasts(loc_name, items)
            st.success(f"已同步 {len(locs)} 個縣市資料！")

    # 海報 Step 10: 取得地區清單
    regions = database.get_distinct_regions()
    if not regions:
        # 若資料庫無資料，先自動抓取一次
        fc = cwa_service.fetch_week_forecasts()
        for loc_name, items in fc.get("locations", {}).items():
            database.save_forecasts(loc_name, items)
        regions = database.get_distinct_regions()

    # 海報 Step 13: 下拉選單選擇地區
    selected_region = st.selectbox(
        "選擇地區 / 縣市 (Select Region):",
        options=regions if regions else ["臺中市", "臺北市", "高雄市"],
        index=0
    )

    st.divider()
    st.info("💡 本儀表板資料儲存於 SQLite `data.db`，可支援離線快取與歷史驗證。")

# 主要版面佈局 (分欄顯示)
col1, col2 = st.columns([1, 1])

# 海報 Step 12: 從 SQLite 讀取資料
conn = database.get_connection()
query = """
SELECT dataDate as Date, mint as MinT, maxt as MaxT, pop as PoP, weatherDescription as Weather
FROM TemperatureForecasts
WHERE regionName = ?
ORDER BY dataDate ASC;
"""
df = pd.read_sql_query(query, conn, params=(selected_region,))
conn.close()

with col1:
    st.subheader(f"📈 {selected_region} 一週最高與最低氣溫走勢 (Step 14)")
    if not df.empty:
        # 海報 Step 14: 繪製折線圖
        chart_data = df.set_index("Date")[["MaxT", "MinT"]]
        st.line_chart(chart_data, color=["#f43f5e", "#0284c7"])
        
        # 今日溫度摘要指標
        sub_c1, sub_c2, sub_c3 = st.columns(3)
        with sub_c1:
            st.metric("最低氣溫 (MinT)", f"{df.iloc[0]['MinT']} °C")
        with sub_c2:
            st.metric("最高氣溫 (MaxT)", f"{df.iloc[0]['MaxT']} °C")
        with sub_c3:
            st.metric("降雨機率 (PoP)", f"{df.iloc[0]['PoP']} %")
    else:
        st.warning(f"目前無 {selected_region} 的預報資料，請點擊側邊欄同步按鈕。")

with col2:
    st.subheader(f"📋 一週資料表格 (Step 15)")
    if not df.empty:
        # 海報 Step 15: 顯示資料表格
        st.dataframe(
            df.style.format({"MinT": "{:.1f}°C", "MaxT": "{:.1f}°C", "PoP": "{}%"}),
            use_container_width=True,
            height=320
        )
    else:
        st.info("暫無資料表格")

# 海報 Step 17, 18, 19: 台灣地圖視覺化 (Taiwan Weather Dashboard)
st.divider()
st.subheader("🗺️ 進階：台灣地圖視覺化 (Step 17, 18, 19)")
st.caption("平均溫度顏色區間：低於 20°C (藍) | 20-25°C (綠) | 25-30°C (黃) | 高於 30°C (紅)")

# 地圖展示 (若有安裝 folium 與 streamlit_folium 則自動渲染，否則提供地圖嵌入)
try:
    import folium
    from streamlit_folium import st_folium

    m = folium.Map(location=[23.75, 120.95], zoom_start=7, tiles="CartoDB dark_matter")
    
    # 標記全台主要測站
    obs = cwa_service.fetch_realtime_observations()
    features = obs.get("data", {}).get("features", [])
    
    for f in features[:60]: # 取代表性測站渲染
        coords = f["geometry"]["coordinates"]
        props = f["properties"]
        t = props.get("temperature")
        if t is not None:
            # 依照海報 Step 17 規範之四級距顏色
            if t < 20: color = "#3b82f6"
            elif t < 25: color = "#10b981"
            elif t < 30: color = "#f59e0b"
            else: color = "#ef4444"

            folium.CircleMarker(
                location=[coords[1], coords[0]],
                radius=6,
                color=color,
                fill=True,
                fill_color=color,
                fill_opacity=0.8,
                popup=f"{props.get('county')} {props.get('stationName')}: {t}°C"
            ).addTo(m)

    st_folium(m, width="100%", height=450)
except ImportError:
    st.info("💡 提示：若安裝 `folium` 與 `streamlit-folium` 可於此直接操作內嵌地圖。您也可以直接使用專案內建的高效能 Web 伺服器 (`python server.py`) 享受全功能類 Windy 視覺化地圖！")
