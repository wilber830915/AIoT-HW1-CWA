"""
server.py
輕量高效 Python Web 伺服器
提供 RESTful API 與靜態資源服務 (public/ 目錄)
使用標準庫 http.server，開箱即用無需額外依賴
"""

import os
import json
import mimetypes
from urllib.parse import urlparse, parse_qs
from http.server import HTTPServer, SimpleHTTPRequestHandler
from typing import Any
import database
import cwa_service

PORT = 8000
PUBLIC_DIR = os.path.join(os.path.dirname(__file__), "public")

class WeatherAppHandler(SimpleHTTPRequestHandler):
    """自訂 HTTP 請求處理器，整合 REST API 與前端靜態資源"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PUBLIC_DIR, **kwargs)

    def end_headers(self):
        # 允許跨來源請求 (CORS) 與關閉快取以便即時更新
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)

        # 1. 即時測站觀測 API
        if path == "/api/weather/current":
            try:
                data = cwa_service.fetch_realtime_observations()
                # 同步儲存至資料庫
                features = data.get("data", {}).get("features", [])
                if features:
                    database.save_station_observations(features)
                self._send_json(data)
            except Exception as e:
                self._send_json({"error": str(e), "success": False}, status=500)
            return

        # 2. 一週天氣預報 API (支援指定地區 ?region=臺中市)
        elif path == "/api/weather/forecast":
            try:
                region = query.get("region", [None])[0]
                if region:
                    # 從 SQLite 查詢特定地區
                    records = database.get_forecasts_by_region(region)
                    if not records:
                        # 若無則嘗試同步後再查
                        fc = cwa_service.fetch_week_forecasts()
                        locs = fc.get("locations", {})
                        if region in locs:
                            database.save_forecasts(region, locs[region])
                            records = database.get_forecasts_by_region(region)
                    self._send_json({"success": True, "region": region, "forecasts": records})
                else:
                    # 回傳全部地區
                    fc = cwa_service.fetch_week_forecasts()
                    self._send_json(fc)
            except Exception as e:
                self._send_json({"error": str(e), "success": False}, status=500)
            return

        # 3. 預報地區清單 API (海報 Step 10: SELECT DISTINCT regionName)
        elif path == "/api/weather/regions":
            try:
                regions = database.get_distinct_regions()
                self._send_json({"success": True, "regions": regions})
            except Exception as e:
                self._send_json({"error": str(e), "success": False}, status=500)
            return

        # 4. 天氣警報特報 API
        elif path == "/api/warnings":
            try:
                warnings_data = cwa_service.fetch_warnings()
                self._send_json(warnings_data)
            except Exception as e:
                self._send_json({"error": str(e), "success": False}, status=500)
            return

        # 5. 颱風資訊 API
        elif path == "/api/typhoon":
            try:
                typhoon_data = cwa_service.fetch_typhoon_info()
                self._send_json(typhoon_data)
            except Exception as e:
                self._send_json({"error": str(e), "success": False}, status=500)
            return

        # 6. 首頁與靜態檔案處理
        if path == "/" or path == "":
            self.path = "/index.html"
        
        return super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        # 手動觸發同步 CWA 資料並寫入 SQLite
        if path == "/api/sync":
            try:
                obs = cwa_service.fetch_realtime_observations()
                fc = cwa_service.fetch_week_forecasts()
                
                # 寫入 SQLite
                features = obs.get("data", {}).get("features", [])
                if features:
                    database.save_station_observations(features)
                
                total_fc = 0
                for rname, ritems in fc.get("locations", {}).items():
                    total_fc += database.save_forecasts(rname, ritems)

                self._send_json({
                    "success": True,
                    "message": "CWA 氣象資料同步與 SQLite 儲存成功！",
                    "stationCount": len(features),
                    "forecastCount": total_fc
                })
            except Exception as e:
                self._send_json({"error": str(e), "success": False}, status=500)
            return

        self.send_error(404, "Endpoint not found")

    def _send_json(self, data: Any, status: int = 200):
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def run_server(port: int = PORT):
    # 先確保資料庫已初始化
    database.init_db()
    
    server_address = ("0.0.0.0", port)
    httpd = HTTPServer(server_address, WeatherAppHandler)
    print(f"=" * 60)
    print(f"🌦️ Taiwan Weather Dashboard (台灣即時氣象地圖)")
    print(f"🚀 伺服器正在運行: http://localhost:{port}")
    print(f"📂 靜態目錄: {PUBLIC_DIR}")
    print(f"💾 資料庫: {database.DB_PATH}")
    print(f"=" * 60)
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n伺服器已安全停止。")
        httpd.server_close()


if __name__ == "__main__":
    run_server()
