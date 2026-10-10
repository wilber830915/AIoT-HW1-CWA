"""
server.py
台灣即時氣象地圖 - Flask Web 後端
提供 RESTful API，供 Vercel Serverless 部署使用
"""

import os
import json
from flask import Flask, jsonify, request, send_from_directory
import cwa_service

# ==============================
# Flask App 初始化 (Vercel 必需暴露 app 變數)
# ==============================
app = Flask(__name__, static_folder="public", static_url_path="")

# ==============================
# 靜態資源 (前端 HTML/JS/CSS)
# ==============================
@app.route("/")
def index():
    return send_from_directory("public", "index.html")

@app.route("/<path:filename>")
def static_files(filename):
    return send_from_directory("public", filename)

# ==============================
# API 路由
# ==============================

@app.route("/api/weather/current")
def api_weather_current():
    """即時測站觀測 API"""
    try:
        data = cwa_service.fetch_realtime_observations()
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500


@app.route("/api/weather/forecast")
def api_weather_forecast():
    """一週天氣預報 API (支援 ?region=臺中市)"""
    try:
        region = request.args.get("region")
        fc = cwa_service.fetch_week_forecasts()

        if region:
            locs = fc.get("locations", {})
            records = locs.get(region, [])
            return jsonify({"success": True, "region": region, "forecasts": records})
        else:
            return jsonify(fc)
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500


@app.route("/api/weather/regions")
def api_weather_regions():
    """預報地區清單 API"""
    try:
        fc = cwa_service.fetch_week_forecasts()
        regions = list(fc.get("locations", {}).keys())
        return jsonify({"success": True, "regions": regions})
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500


@app.route("/api/warnings")
def api_warnings():
    """天氣警報特報 API"""
    try:
        data = cwa_service.fetch_warnings()
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500


@app.route("/api/typhoon")
def api_typhoon():
    """颱風資訊 API"""
    try:
        data = cwa_service.fetch_typhoon_info()
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e), "success": False}), 500


# ==============================
# 本機開發啟動入口
# ==============================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    print("=" * 60)
    print("🌦️  Taiwan Weather Dashboard (台灣即時氣象地圖)")
    print(f"🚀 伺服器正在運行: http://localhost:{port}")
    print("=" * 60)
    app.run(host="0.0.0.0", port=port, debug=True)
