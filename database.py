"""
database.py
SQLite 資料庫管理模組 (符合微課程 Step 8, 9, 10, 12, 20 設計規範)
資料庫名稱: data.db
資料表: 
  1. TemperatureForecasts (id, regionName, dataDate, mint, maxt, pop, weather)
  2. StationObservations (stationId, stationName, county, town, lat, lng, temp, humidity, wind, precip, weather)
"""

import sqlite3
import os
from typing import List, Dict, Any, Optional
import pandas as pd

DB_PATH = os.path.join(os.path.dirname(__file__), "data.db")

def get_connection() -> sqlite3.Connection:
    """取得 SQLite 連線，設定 row_factory 以支援字典形式讀取"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """
    海報 Step 8, 9:
    建立 SQLite 資料庫與資料表
    設計 UNIQUE 鍵以避免重複插入 (海報 Step 20)
    """
    conn = get_connection()
    cursor = conn.cursor()
    
    # 建立氣溫預報資料表 (微課程核心設計)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS TemperatureForecasts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        regionName TEXT NOT NULL,
        dataDate TEXT NOT NULL,
        mint REAL,
        maxt REAL,
        pop INTEGER DEFAULT 0,
        weatherDescription TEXT,
        createdAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(regionName, dataDate)
    );
    """)

    # 建立即時測站觀測資料表 (地圖擴充支援)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS StationObservations (
        stationId TEXT PRIMARY KEY,
        stationName TEXT NOT NULL,
        county TEXT NOT NULL,
        town TEXT,
        lat REAL,
        lng REAL,
        temperature REAL,
        humidity REAL,
        pressure REAL,
        windSpeed REAL,
        windDirection REAL,
        precipitation REAL,
        weather TEXT,
        observedAt TEXT,
        updatedAt TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    conn.commit()
    conn.close()
    print("[Database] 資料庫 data.db 與資料表初始化完成！")


def save_forecasts(region_name: str, forecast_list: List[Dict[str, Any]]) -> int:
    """
    海報 Step 8, 20:
    儲存/更新氣溫預報資料
    使用 INSERT OR REPLACE 避免重複插入 (海報 Step 20 良好機制)
    """
    conn = get_connection()
    cursor = conn.cursor()
    inserted = 0

    for item in forecast_list:
        date_str = item.get("date")
        min_t = item.get("minT")
        max_t = item.get("maxT")
        pop_val = item.get("pop", 0)
        wx_desc = item.get("weather", "")

        cursor.execute("""
        INSERT OR REPLACE INTO TemperatureForecasts 
        (regionName, dataDate, mint, maxt, pop, weatherDescription)
        VALUES (?, ?, ?, ?, ?, ?);
        """, (region_name, date_str, min_t, max_t, pop_val, wx_desc))
        inserted += 1

    conn.commit()
    conn.close()
    return inserted


def save_station_observations(features: List[Dict[str, Any]]) -> int:
    """儲存/更新即時測站觀測資料"""
    conn = get_connection()
    cursor = conn.cursor()
    count = 0

    for feat in features:
        props = feat.get("properties", {})
        coords = feat.get("geometry", {}).get("coordinates", [0, 0])
        lng, lat = coords[0], coords[1]
        
        station_id = props.get("stationId")
        if not station_id:
            continue

        cursor.execute("""
        INSERT OR REPLACE INTO StationObservations
        (stationId, stationName, county, town, lat, lng, 
         temperature, humidity, pressure, windSpeed, windDirection, 
         precipitation, weather, observedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            station_id,
            props.get("stationName", ""),
            props.get("county", ""),
            props.get("town", ""),
            lat,
            lng,
            props.get("temperature"),
            props.get("humidity"),
            props.get("pressure"),
            props.get("windSpeed"),
            props.get("windDirection"),
            props.get("precipitation"),
            props.get("weather", ""),
            props.get("observedAt", "")
        ))
        count += 1

    conn.commit()
    conn.close()
    return count


def get_distinct_regions() -> List[str]:
    """
    海報 Step 10:
    SELECT DISTINCT regionName FROM TemperatureForecasts;
    取得所有預報地區/縣市清單
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT DISTINCT regionName FROM TemperatureForecasts ORDER BY id ASC;")
    rows = cursor.fetchall()
    conn.close()
    return [r["regionName"] for r in rows]


def get_forecasts_by_region(region_name: str) -> List[Dict[str, Any]]:
    """
    海報 Step 10, 12:
    SELECT * FROM TemperatureForecasts WHERE regionName=?;
    查詢特定地區之一週氣溫資料
    """
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
    SELECT id, regionName, dataDate, mint, maxt, pop, weatherDescription, createdAt
    FROM TemperatureForecasts 
    WHERE regionName = ?
    ORDER BY dataDate ASC;
    """, (region_name,))
    rows = cursor.fetchall()
    conn.close()
    
    return [{
        "id": r["id"],
        "regionName": r["regionName"],
        "dataDate": r["dataDate"],
        "date": r["dataDate"],
        "mint": r["mint"],
        "minT": r["mint"],
        "maxt": r["maxt"],
        "maxT": r["maxt"],
        "pop": r["pop"],
        "weather": r["weatherDescription"]
    } for r in rows]


def get_forecasts_dataframe(region_name: Optional[str] = None) -> pd.DataFrame:
    """
    海報 Step 7, 12:
    使用 Pandas 讀取 SQL 資料並整理為 DataFrame
    df = pd.read_sql_query("SELECT * FROM TemperatureForecasts ...", conn)
    """
    conn = get_connection()
    if region_name:
        query = "SELECT dataDate as Date, mint as MinT, maxt as MaxT, pop as PoP, weatherDescription as Weather FROM TemperatureForecasts WHERE regionName = ? ORDER BY dataDate ASC;"
        df = pd.read_sql_query(query, conn, params=(region_name,))
    else:
        query = "SELECT regionName, dataDate, mint, maxt, pop, weatherDescription FROM TemperatureForecasts ORDER BY dataDate ASC;"
        df = pd.read_sql_query(query, conn)
    conn.close()
    return df


def get_latest_station_features() -> List[Dict[str, Any]]:
    """從資料庫讀取快取的測站觀測並轉回 GeoJSON Features 格式"""
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM StationObservations;")
    rows = cursor.fetchall()
    conn.close()

    features = []
    for r in rows:
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [r["lng"], r["lat"]]
            },
            "properties": {
                "stationId": r["stationId"],
                "stationName": r["stationName"],
                "county": r["county"],
                "town": r["town"],
                "temperature": r["temperature"],
                "humidity": r["humidity"],
                "pressure": r["pressure"],
                "windSpeed": r["windSpeed"],
                "windDirection": r["windDirection"],
                "precipitation": r["precipitation"],
                "weather": r["weather"],
                "observedAt": r["observedAt"]
            }
        })
    return features


if __name__ == "__main__":
    init_db()
    print("Database initialization script executed successfully.")
