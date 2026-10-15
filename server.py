"""
server.py
輕量高效 Python Web 伺服器
提供 RESTful API 與靜態資源服務 (public/ 目錄)
使用標準庫 http.server，開箱即用無需額外依賴
"""
import os
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
import database
import cwa_service

PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")
app = Flask(__name__, static_folder=PUBLIC_DIR, static_url_path="")
CORS(app) # 允許跨來源請求

# Vercel 執行環境會自動設定 VERCEL=1；本機執行則無此變數
IS_VERCEL = bool(os.environ.get("VERCEL"))

# 本機：初始化 SQLite 資料庫（Vercel 檔案系統唯讀，故不執行）
if not IS_VERCEL:
    try:
        database.init_db()
    except Exception as db_err:
        print(f"[Server] 資料庫初始化略過: {db_err}")

@app.route("/")
def index():
    return send_from_directory(PUBLIC_DIR, "index.html")

@app.route("/api/weather/current", methods=["GET"])
def get_current_weather():
    try:
        data = cwa_service.fetch_realtime_observations()
        features = data.get("data", {}).get("features", [])

        if IS_VERCEL:
            # Vercel：直接回傳中央氣象局即時資料（不寫入資料庫）
            return jsonify(data)

        # 本機：寫入 SQLite 後，改由 data.db 讀取回傳
        if features:
            database.save_station_observations(features)
        db_features = database.get_latest_station_features()
        if db_features:
            return jsonify(cwa_service.build_observation_response(db_features, source="SQLite data.db (CWA O-A0003-001)"))
        return jsonify(data)
    except Exception as e:
        # 本機若 CWA 連線失敗，退回讀取 SQLite 既有資料
        if not IS_VERCEL:
            try:
                db_features = database.get_latest_station_features()
                if db_features:
                    return jsonify(cwa_service.build_observation_response(db_features, source="SQLite data.db (cache)"))
            except Exception:
                pass
        return jsonify({"error": str(e), "success": False}), 500

@app.route("/api/weather/forecast", methods=["GET"])
def get_forecast():
    try:
        region = request.args.get("region")
        if region:
            if IS_VERCEL:
                # Vercel：直接使用中央氣象局預報資料
                fc = cwa_service.fetch_week_forecasts()
                records = fc.get("locations", {}).get(region, [])
                return jsonify({"success": True, "region": region, "forecasts": records})

            # 本機：優先讀取 SQLite，無資料再抓 CWA 並寫入
            try:
                records = database.get_forecasts_by_region(region)
            except Exception:
                records = []
            if not records:
                fc = cwa_service.fetch_week_forecasts()
                records = fc.get("locations", {}).get(region, [])
                if records:
                    database.save_forecasts(region, records)
            return jsonify({"success": True, "region": region, "forecasts": records})
        else:
            fc = cwa_service.fetch_week_forecasts()
            return jsonify(fc)
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500

@app.route("/api/weather/regions", methods=["GET"])
def get_regions():
    try:
        if IS_VERCEL:
            # Vercel：直接由中央氣象局預報資料取得縣市清單
            fc = cwa_service.fetch_week_forecasts()
            regions = list(fc.get("locations", {}).keys())
        else:
            regions = database.get_distinct_regions()
        return jsonify({"success": True, "regions": regions})
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500

@app.route("/api/warnings", methods=["GET"])
def get_warnings():
    try:
        return jsonify(cwa_service.fetch_warnings())
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500

@app.route("/api/typhoon", methods=["GET"])
def get_typhoon():
    try:
        return jsonify(cwa_service.fetch_typhoon_info())
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500

@app.route("/api/sync", methods=["POST"])
def sync_data():
    try:
        obs = cwa_service.fetch_realtime_observations()
        fc = cwa_service.fetch_week_forecasts()
        
        features = obs.get("data", {}).get("features", [])
        if features:
            database.save_station_observations(features)
        
        total_fc = 0
        for rname, ritems in fc.get("locations", {}).items():
            total_fc += database.save_forecasts(rname, ritems)

        return jsonify({
            "success": True,
            "message": "CWA 氣象資料同步成功！",
            "stationCount": len(features),
            "forecastCount": total_fc
        })
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500

# 本地測試用，Vercel 部署時不會執行這段
if __name__ == "__main__":
    app.run(port=8000, debug=True)