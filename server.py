"""
server.py
輕量高效 Python Web 伺服器
提供 RESTful API 與靜態資源服務 (public/ 目錄)
使用標準庫 http.server，開箱即用無需額外依賴
"""
import os
from flask import Flask, jsonify, request
from flask_cors import CORS
import database
import cwa_service

app = Flask(__name__)
CORS(app) # 允許跨來源請求

# 確保資料庫初始化（注意：在 Vercel 上建議移到雲端，見第二步）
# database.init_db() 

@app.route("/api/weather/current", methods=["GET"])
def get_current_weather():
    try:
        data = cwa_service.fetch_realtime_observations()
        features = data.get("data", {}).get("features", [])
        if features:
            try:
                database.save_station_observations(features) # Vercel 檔案系統唯讀，寫入失敗不影響回傳
            except Exception as db_err:
                print(f"[Server] 測站資料寫入資料庫略過: {db_err}")
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500

@app.route("/api/weather/forecast", methods=["GET"])
def get_forecast():
    try:
        region = request.args.get("region")
        if region:
            try:
                records = database.get_forecasts_by_region(region)
            except Exception:
                records = []
            if not records:
                fc = cwa_service.fetch_week_forecasts()
                locs = fc.get("locations", {})
                records = locs.get(region, [])
                if records:
                    try:
                        database.save_forecasts(region, records)
                    except Exception as db_err:
                        print(f"[Server] 預報資料寫入資料庫略過: {db_err}")
            return jsonify({"success": True, "region": region, "forecasts": records})
        else:
            fc = cwa_service.fetch_week_forecasts()
            return jsonify(fc)
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500

@app.route("/api/weather/regions", methods=["GET"])
def get_regions():
    try:
        try:
            regions = database.get_distinct_regions()
        except Exception:
            regions = []
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