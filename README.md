NickelTrack
===========

NickelTrack is a prototype app and data pipeline for estimating dietary nickel
intake from meals.

This repo currently contains:

- A simple static UI (`index.html`, `css/style.css`, `js/app.js`)
- A data-processing script (`build_nickel_database.py`) that builds a merged
  food–nickel JSON dataset from:
  - `lowNiDiet_r9.1.1_summaryTables.csv` (primary source; PDF fallback if CSV missing)
  - `fda_nickel_2018_2020.csv` (secondary, FY2018–FY2020 FDA TDS nickel)
  - `2022-10-27_Occurrence of nickel in prepared foods of BfR MEAL study.xlsx` (secondary, BfR MEAL study)

Running the nickel data builder
-------------------------------

1. Create a virtual environment (optional but recommended) and install deps:

   ```bash
   cd "NickelTrack"
   python3 -m venv .venv
   source .venv/bin/activate
   pip install -r requirements.txt
   ```

2. Make sure the following files are present alongside the script:

   - `lowNiDiet_r9.1.1_summaryTables.csv` (or `lowNiDiet_r9.1.1_summaryTables.pdf` as fallback)
   - `fda_nickel_2018_2020.csv`
   - `2022-10-27_Occurrence of nickel in prepared foods of BfR MEAL study.xlsx` (optional)

3. Run the builder:

   ```bash
   python3 build_nickel_database.py
   ```

This will write:

- `nickel_foods.json` – combined foods with per-serving and per-100 g nickel,
  banded into very_low/low/medium/high
- `nickel_bands.json` – the thresholds used for those bands (derived from the
  data; you can edit these later if you prefer other cut points)

AI meal parsing (optional)
---------------------------

To use “Suggest foods with AI” (describe a meal in words; AI suggests components;
matched foods are added to the meal; you edit servings/remove as usual):

1. Install dependencies: `pip install -r requirements.txt` (includes `flask` and `openai`).
2. Set your OpenAI API key: `export OPENAI_API_KEY=your_key`
3. Run the server: `python server.py`
4. Open **http://localhost:5000** in your browser.

Meal descriptions are sent to OpenAI to extract a list of food items; the app
matches them to the nickel database and adds matches to the meal. Unmatched
items are listed so you can add them manually from the food database if needed.

Future work
-----------

- Add explicit cross-source mappings so overlapping foods share a single
  canonical entry with averaged values across all sources.
