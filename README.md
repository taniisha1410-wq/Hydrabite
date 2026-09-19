# Springline — Water Reminder & Budget-Aware Meal Planner

A small full-stack app:

- **Frontend:** plain HTML/CSS/JS (`index.html`, `css/style.css`, `js/app.js`)
- **Backend:** Python / Flask (`server.py`) — talks to the **Gemini API** to generate a meal plan, and stores your daily water log as JSON files (no database needed). It also serves the frontend, so one process runs the whole app.

## What it does

- **Water reminder:** set a daily glass goal, log glasses with one tap, see a filling bottle animation, and get browser notifications at an interval you choose while the tab is open.
- **Profile & budget:** enter age, sex, weight, height, activity level, health goal, diet type, allergies, health notes, cuisine preference, currency, and daily food budget. The app estimates calorie and macro (protein/carb/fat) targets using the Mifflin–St Jeor formula.
- **Meal plan:** sends your profile + targets to a PHP endpoint, which prompts Gemini to build one full day of meals that fit your budget and macros, respecting allergies and diet preference. Returns structured JSON that's rendered as meal cards with cost and macros per meal.

## 1. Requirements

- Python 3.8+
- A free Gemini API key from **https://aistudio.google.com/apikey**

## 2. Install and add your Gemini API key

From the project's root folder (the one containing `index.html` and `server.py`):

```bash
python -m venv venv
source venv/bin/activate        # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

Set your key as an environment variable (recommended — never hardcode a real key in source control):

```bash
export GEMINI_API_KEY="your-key-here"     # Windows (cmd): set GEMINI_API_KEY=your-key-here
```

(For quick local testing only, you can instead paste it directly over
`PASTE_YOUR_GEMINI_API_KEY_HERE` in `server.py`.)

## 3. Run it locally

```bash
python server.py
```

Then open **http://localhost:5000** in your browser. Flask serves the frontend and the API from the same process, so there's nothing else to configure.

For production, run it behind a real WSGI server instead of the Flask dev server, e.g.:

```bash
pip install gunicorn
gunicorn -w 2 -b 0.0.0.0:5000 server:app
```

## 4. Using the app

1. Go to **Profile & budget**, fill in your details and daily food budget, and save.
2. Check **Today** to see your estimated calorie/macro targets.
3. Go to **Meal plan** and click **Generate today's plan** — this calls Gemini through `php/generate_plan.php`.
4. Go to **Water** to set your glass goal, turn on reminders, and log water as you drink it.

## Project structure

```
index.html
css/style.css
js/app.js
server.py              # Flask app: serves the frontend + all API routes
requirements.txt       # Flask, requests
data/
  water_YYYY-MM-DD.json  # created automatically per day (not web-accessible —
                          # server.py only ever serves /, /css/*, /js/*)

API routes (all handled by server.py):
  POST /api/generate_plan     # builds the prompt, calls Gemini, returns JSON meal plan
  POST /api/water_log         # save today's water count/log
  GET  /api/get_water_log     # read back a day's water log
```

## Notes & next steps

- **Storage is per-server, not per-user.** There's no login system, so everyone hitting the same backend shares the same `data/water_*.json` files. For multiple people, add simple authentication and namespace files by user ID (e.g. `water_{userId}_{date}.json`), or move to a real database (MySQL/SQLite).
- **The macro/calorie estimate is a starting point, not medical advice.** The app says as much in the UI; for real health conditions, encourage checking with a doctor or dietitian.
- **Model choice:** `server.py` defaults to `gemini-2.0-flash`. Override it by setting the `GEMINI_MODEL` environment variable to any other current Gemini model that supports `generateContent` + JSON responses.
- **Costs are model estimates**, not live grocery prices — good for rough budgeting, not exact quotes.
- If you deploy this publicly, restrict the CORS header in `server.py`'s `add_cors_headers` to your actual domain instead of `*`.
