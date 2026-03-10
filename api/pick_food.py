"""Vercel serverless function: POST /api/pick-food"""

import json
import os
import re
from http.server import BaseHTTPRequestHandler


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else b""
        try:
            data = json.loads(body) if body else {}
        except json.JSONDecodeError:
            data = {}

        user_phrase = (data.get("userPhrase") or "").strip()
        candidates = data.get("candidates") or []
        if not isinstance(candidates, list):
            candidates = []
        candidates = [str(c).strip() for c in candidates if c]

        if not user_phrase or not candidates:
            self._json_response({"ranked": []})
            return

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            self._json_response({"error": "OPENAI_API_KEY not set"}, 503)
            return

        import openai

        client = openai.OpenAI(api_key=api_key)
        list_text = "\n".join("- " + c for c in candidates[:25])
        prompt = (
            'The user described a meal and said: "' + user_phrase + '".\n\n'
            "For each food in the list below, rate how likely it is to be what the user meant (0.0 to 1.0). "
            "Only include foods that are a reasonable match; give 0 or omit foods that are not a good match "
            '(e.g. for "eggs" do not include eggplant).\n\n'
            'Reply with ONLY a JSON array of objects, each with "name" (exact food name from the list) and "confidence" (number 0-1). '
            "Order by confidence descending. No explanation, no markdown.\n\n"
            "Food list:\n" + list_text
        )

        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": prompt}],
                temperature=0.2,
            )
            text = (response.choices[0].message.content or "").strip()
        except Exception as e:
            err_str = str(e)
            if "401" in err_str or "api_key" in err_str.lower() or "auth" in err_str.lower():
                self._json_response({"error": "AI food matching is temporarily unavailable (API configuration issue)."}, 502)
            else:
                self._json_response({"error": "OpenAI request failed: " + err_str}, 502)
            return

        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
        text = text.strip()
        ranked = []
        try:
            raw = json.loads(text)
            if isinstance(raw, list):
                for item in raw:
                    if not isinstance(item, dict):
                        continue
                    name = (item.get("name") or item.get("food") or "").strip()
                    conf = item.get("confidence")
                    if name and conf is not None:
                        try:
                            ranked.append({"name": name, "confidence": float(conf)})
                        except (TypeError, ValueError):
                            ranked.append({"name": name, "confidence": 0.5})
            ranked.sort(key=lambda x: -x["confidence"])
        except json.JSONDecodeError:
            pass

        self._json_response({"ranked": ranked})

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
