"""Vercel serverless function: POST /api/parse-meal"""

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

        description = (data.get("description") or "").strip()
        if not description:
            self._json_response({"error": "Missing or empty description"}, 400)
            return

        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            self._json_response({"error": "OPENAI_API_KEY not set"}, 503)
            return

        import openai

        client = openai.OpenAI(api_key=api_key)
        prompt = (
            "You are helping parse a meal description into a list of individual food items. "
            "Given the following meal description, return ONLY a JSON array of strings, "
            'each string being one food or ingredient (e.g. ["scrambled eggs", "whole wheat toast", "orange juice"]). '
            "No numbering, no explanation, no markdown. Only the JSON array.\n\n"
            "Description: " + description
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
                self._json_response({"error": "AI meal analysis is temporarily unavailable (API configuration issue)."}, 502)
            else:
                self._json_response({"error": "OpenAI request failed: " + err_str}, 502)
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
