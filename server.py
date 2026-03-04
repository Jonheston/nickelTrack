"""
Minimal Flask server for NickelTrack: serves the static app and provides
POST /api/parse-meal to extract food items from a meal description via OpenAI.

Run: OPENAI_API_KEY=your_key python server.py
Then open http://localhost:5000
"""

import json
import os
import re

from flask import Flask, request, send_from_directory

app = Flask(__name__, static_folder=".", static_url_path="")


@app.after_request
def cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response

ROOT = os.path.dirname(os.path.abspath(__file__))


@app.route("/")
def index():
    return send_from_directory(ROOT, "index.html")


@app.route("/api/parse-meal", methods=["POST", "OPTIONS"])
def parse_meal():
    """Expects JSON body { \"description\": \"...\" }. Returns { \"items\": [\"food1\", ...] }."""
    if request.method == "OPTIONS":
        return "", 204
    try:
        data = request.get_json(force=True, silent=True) or {}
        description = (data.get("description") or "").strip()
        if not description:
            return {"error": "Missing or empty description"}, 400
    except Exception as e:
        return {"error": str(e)}, 400

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not set"}, 503

    try:
        import openai
    except ImportError:
        return {"error": "openai package not installed (pip install openai)"}, 503

    client = openai.OpenAI(api_key=api_key)
    prompt = (
        "You are helping parse a meal description into a list of individual food items. "
        "Given the following meal description, return ONLY a JSON array of strings, "
        "each string being one food or ingredient (e.g. [\"scrambled eggs\", \"whole wheat toast\", \"orange juice\"]). "
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
        return {"error": "OpenAI request failed: " + str(e)}, 502

    # Extract JSON array (allow markdown code block)
    text = re.sub(r"^```\w*\n?", "", text)
    text = re.sub(r"\n?```\s*$", "", text)
    text = text.strip()
    try:
        items = json.loads(text)
        if not isinstance(items, list):
            items = [items] if isinstance(items, str) else []
        items = [str(x).strip() for x in items if x]
    except json.JSONDecodeError:
        return {"error": "Could not parse AI response as JSON"}, 502

    return {"items": items}


@app.route("/api/pick-food", methods=["POST", "OPTIONS"])
def pick_food():
    """
    AI-assisted mapping when the app has no direct match.
    Body: { "userPhrase": "eggs", "candidates": ["Eggs, whole, ...", ...] }.
    Returns: { "ranked": [ {"name": "Eggs, whole, ...", "confidence": 0.95}, ... ] } ordered by confidence desc.
    """
    if request.method == "OPTIONS":
        return "", 204
    try:
        data = request.get_json(force=True, silent=True) or {}
        user_phrase = (data.get("userPhrase") or "").strip()
        candidates = data.get("candidates") or []
        if not isinstance(candidates, list):
            candidates = []
        candidates = [str(c).strip() for c in candidates if c]
    except Exception as e:
        return {"error": str(e)}, 400

    if not user_phrase or not candidates:
        return {"ranked": []}

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        return {"error": "OPENAI_API_KEY not set"}, 503

    try:
        import openai
    except ImportError:
        return {"error": "openai package not installed"}, 503

    client = openai.OpenAI(api_key=api_key)
    list_text = "\n".join("- " + c for c in candidates[:25])
    prompt = (
        "The user described a meal and said: \"" + user_phrase + "\".\n\n"
        "For each food in the list below, rate how likely it is to be what the user meant (0.0 to 1.0). "
        "Only include foods that are a reasonable match; give 0 or omit foods that are not a good match "
        "(e.g. for \"eggs\" do not include eggplant).\n\n"
        "Reply with ONLY a JSON array of objects, each with \"name\" (exact food name from the list) and \"confidence\" (number 0–1). "
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
        return {"error": "OpenAI request failed: " + str(e)}, 502

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
    return {"ranked": ranked}


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=False)
