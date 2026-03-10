"""Vercel serverless function: POST /api/analyze-image"""

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

        image_b64 = (data.get("image") or "").strip()
        if not image_b64:
            self._json_response({"error": "Missing image data"}, 400)
            return

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            self._json_response({"error": "OPENAI_API_KEY not set"}, 503)
            return

        import openai

        client = openai.OpenAI(api_key=api_key)

        # Determine mime type from base64 header or default to jpeg
        mime = "image/jpeg"
        raw_b64 = image_b64
        if image_b64.startswith("data:"):
            mime = image_b64.split(";")[0].split(":")[1]
            raw_b64 = image_b64.split(",", 1)[1]

        prompt = (
            "Look at this image. Identify all distinct food items visible. "
            "This could be a photo of food, a menu, a nutrition label, or a text description of food. "
            "Return ONLY a JSON array of strings, each string being one food item "
            '(e.g. ["scrambled eggs", "whole wheat toast", "orange juice"]). '
            "No numbering, no explanation, no markdown. Only the JSON array."
        )

        try:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:{mime};base64,{raw_b64}"
                                },
                            },
                        ],
                    }
                ],
                temperature=0.2,
                max_tokens=500,
            )
            text = (response.choices[0].message.content or "").strip()
        except Exception as e:
            self._json_response({"error": "OpenAI request failed: " + str(e)}, 502)
            return

        text = re.sub(r"^```\w*\n?", "", text)
        text = re.sub(r"\n?```\s*$", "", text)
        text = text.strip()
        try:
            items = json.loads(text)
            if not isinstance(items, list):
                items = [items] if isinstance(items, str) else []
            items = [str(x).strip() for x in items if x]
        except json.JSONDecodeError:
            self._json_response({"error": "Could not parse AI response as JSON"}, 502)
            return

        self._json_response({"items": items})

    def _json_response(self, data, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())
