"""
Springline — Python (Flask) backend

Replaces the previous PHP backend with the same three endpoints:
  POST /api/generate_plan   -> builds a prompt from the profile and calls Gemini
  POST /api/water_log       -> saves today's water count/log to a JSON file
  GET  /api/get_water_log   -> reads back a day's water log

Also serves the static frontend (index.html, css/, js/) so everything runs
from one process with no CORS setup needed.

Run:
    pip install -r requirements.txt
    export GEMINI_API_KEY="your-key-here"     # (Windows: set GEMINI_API_KEY=...)
    python server.py
Then open http://localhost:5000
"""

import json
import os
import re
from datetime import date, datetime

import requests
from flask import Flask, jsonify, request, send_from_directory

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
APP_ROOT = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(APP_ROOT, "data")
os.makedirs(DATA_DIR, exist_ok=True)

# Get a free key at https://aistudio.google.com/apikey
# Set it as a real environment variable — don't hardcode it in source control.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "AQ.Ab8RN6LfhvT5KJXLyaoAlojRG2HniSSkzJUfBtR3fonBO2Va2A")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.5-flash")
GEMINI_ENDPOINT = (
    f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
)

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CURRENCY_SYMBOLS = {"INR": "₹", "USD": "$", "EUR": "€", "GBP": "£"}

app = Flask(__name__)


# ---------------------------------------------------------------------------
# CORS (tighten Access-Control-Allow-Origin to your real domain in production)
# ---------------------------------------------------------------------------
@app.after_request
def add_cors_headers(resp):
    resp.headers["Access-Control-Allow-Origin"] = "*"
    resp.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    resp.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return resp


# ---------------------------------------------------------------------------
# Static frontend — explicit routes only, so /data/ is never web-accessible
# ---------------------------------------------------------------------------
@app.route("/")
def serve_index():
    return send_from_directory(APP_ROOT, "index.html")


@app.route("/css/<path:filename>")
def serve_css(filename):
    return send_from_directory(os.path.join(APP_ROOT, "css"), filename)


@app.route("/js/<path:filename>")
def serve_js(filename):
    return send_from_directory(os.path.join(APP_ROOT, "js"), filename)


# ---------------------------------------------------------------------------
# POST /api/generate_plan
# ---------------------------------------------------------------------------
@app.route("/api/generate_plan", methods=["POST", "OPTIONS"])
def generate_plan():
    if request.method == "OPTIONS":
        return ("", 204)

    body = request.get_json(silent=True)
    if not body or "profile" not in body:
        return jsonify({"error": "Missing profile data in request body."}), 400

    profile = body["profile"]
    targets = body.get("targets")

    if GEMINI_API_KEY in ("", "PASTE_YOUR_GEMINI_API_KEY_HERE"):
        return jsonify({
            "error": "The server is missing a Gemini API key. "
                     "Set the GEMINI_API_KEY environment variable and restart the server."
        }), 500

    prompt = build_prompt(profile, targets)

    payload = {
        "contents": [{"role": "user", "parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.7, "responseMimeType": "application/json"},
    }

    try:
        r = requests.post(
            GEMINI_ENDPOINT,
            params={"key": GEMINI_API_KEY},
            json=payload,
            timeout=30,
        )
    except requests.RequestException as e:
        return jsonify({"error": f"Could not reach the Gemini API: {e}"}), 502

    if r.status_code != 200:
        try:
            err_msg = r.json().get("error", {}).get("message", r.text)
        except ValueError:
            err_msg = r.text
        return jsonify({"error": f"Gemini API error ({r.status_code}): {err_msg}"}), 502

    try:
        data = r.json()
        text = data["candidates"][0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError, ValueError):
        return jsonify({"error": "Gemini returned an empty or unexpected response."}), 502

    # Strip accidental markdown fences just in case.
    text = text.strip()
    text = re.sub(r"^```(json)?", "", text, flags=re.IGNORECASE).strip()
    text = re.sub(r"```$", "", text).strip()

    try:
        plan = json.loads(text)
    except json.JSONDecodeError:
        return jsonify({"error": "Could not parse a meal plan from the model response."}), 502

    if "meals" not in plan:
        return jsonify({"error": "Could not parse a meal plan from the model response."}), 502

    return jsonify(plan)


def build_prompt(profile, targets):
    currency_symbol = CURRENCY_SYMBOLS.get(profile.get("currency", "INR"), "")
    meals_per_day = int(profile.get("meals_per_day") or 3)

    if targets:
        target_line = (
            "Daily targets to aim for (do not exceed calories by more than ~5%): "
            f"{targets.get('calories', 0)} kcal, {targets.get('proteinG', 0)}g protein, "
            f"{targets.get('carbG', 0)}g carbohydrates, {targets.get('fatG', 0)}g fat."
        )
    else:
        target_line = "No precise macro targets were supplied — estimate sensible ones from the profile below."

    lines = [
        "You are a registered-dietitian-style meal planning assistant. Build ONE day of "
        "meals for a real person, optimized for their health goal, dietary needs, and a "
        "strict daily food budget.",
        target_line,
        "Person profile:",
        f"- Age: {profile.get('age', 'unknown')}",
        f"- Sex: {profile.get('sex', 'unspecified')}",
        f"- Weight: {profile.get('weight', 'unknown')} kg",
        f"- Height: {profile.get('height', 'unknown')} cm",
        f"- Activity level: {profile.get('activity', 'moderate')}",
        f"- Primary health goal: {profile.get('goal', 'maintain')}",
        f"- Diet preference: {profile.get('diet', 'none')}",
        f"- Allergies / foods to avoid: {profile.get('allergies') or 'none stated'}",
        f"- Health notes / conditions: {profile.get('conditions') or 'none stated'}",
        "- Cuisine preference: "
        + (profile.get("cuisine") or "no strong preference, use widely available, affordable ingredients"),
        f"- Daily food budget: {currency_symbol}{profile.get('budget', 'unspecified')} total for the "
        "whole day, across all meals combined.",
        f"- Number of meals/snacks to plan: {meals_per_day}",
        "",
        "Rules:",
        "- The combined cost of all meals must stay at or under the stated daily budget.",
        "- Respect the diet preference and allergies strictly — never suggest an excluded ingredient.",
        "- Favor whole, minimally processed foods, adequate protein and fiber, and reasonable variety across the day.",
        "- If health notes mention a condition (e.g. diabetes, high blood pressure, PCOS), keep suggestions "
        "generally consistent with common dietary guidance for it (e.g. lower added sugar for diabetes, lower "
        "sodium for high blood pressure) — but do not diagnose or give medical treatment advice, and mention "
        "in the summary note that this isn't medical advice.",
        "- Costs should be realistic local estimates for the given currency and cuisine context.",
        "- Keep each meal description to one or two short sentences a home cook could follow.",
        "",
        "Return ONLY JSON matching this exact shape (no markdown fences, no extra commentary):",
        "{",
        '  "summary": {',
        '    "title": "short title for the day plan",',
        '    "note": "one or two sentences on why this fits their goal/budget; note it is not medical advice if relevant",',
        '    "total_cost": number,',
        '    "total_calories": number,',
        '    "total_protein_g": number,',
        '    "total_carb_g": number,',
        '    "total_fat_g": number',
        "  },",
        '  "meals": [',
        "    {",
        '      "slot": "breakfast | lunch | dinner | snack",',
        '      "name": "meal name",',
        '      "description": "short prep description",',
        '      "cost": number,',
        '      "calories": number,',
        '      "protein_g": number,',
        '      "carb_g": number,',
        '      "fat_g": number',
        "    }",
        "  ]",
        "}",
    ]
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# POST /api/water_log
# ---------------------------------------------------------------------------
@app.route("/api/water_log", methods=["POST", "OPTIONS"])
def water_log():
    if request.method == "OPTIONS":
        return ("", 204)

    body = request.get_json(silent=True)
    if not body or not body.get("date"):
        return jsonify({"error": "Missing date."}), 400

    d = body["date"]
    if not DATE_RE.match(d):
        return jsonify({"error": "Invalid date format."}), 400

    record = {
        "date": d,
        "count": int(body.get("count", 0) or 0),
        "log": body.get("log", []),
        "updated_at": datetime.now().isoformat(),
    }

    path = os.path.join(DATA_DIR, f"water_{d}.json")
    with open(path, "w") as f:
        json.dump(record, f, indent=2)

    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# GET /api/get_water_log
# ---------------------------------------------------------------------------
@app.route("/api/get_water_log", methods=["GET"])
def get_water_log():
    d = request.args.get("date", date.today().isoformat())
    if not DATE_RE.match(d):
        return jsonify({"error": "Invalid date format."}), 400

    path = os.path.join(DATA_DIR, f"water_{d}.json")
    if not os.path.exists(path):
        return jsonify({"date": d, "count": 0, "log": []})

    with open(path) as f:
        return app.response_class(f.read(), mimetype="application/json")


if __name__ == "__main__":
    app.run(debug=True, port=5000)
