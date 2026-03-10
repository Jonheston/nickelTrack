"""
Build a merged nickel-foods JSON dataset for NickelTrack.

Primary source:
- lowNiDiet_r9.1.1_summaryTables.csv  (serving-based nickel data, English names;
  preferred over PDF when available)

Secondary sources:
- fda_nickel_2018_2020.csv            (FY2018–FY2020 TDS nickel results)
- 2022-10-27_Occurrence of nickel in prepared foods of BfR MEAL study.xlsx
  (BfR MEAL study nickel in prepared foods, Germany; µg/100 g from mg/kg)

This script:
- Parses the lowNiDiet CSV (or PDF fallback) into structured rows
- Parses the FDA nickel CSV into structured rows
- Parses the BfR MEAL Excel Nickel sheet into structured rows
- Normalises units to µg/serving and µg/100 g where possible
- Computes empirical nickel bands (very_low/low/medium/high) from µg/100 g
- Writes:
    - nickel_foods.json   (main combined dataset)
    - nickel_bands.json   (band thresholds, overwritten)

NOTE: Cross-source food-name reconciliation is intentionally conservative.
      lowNiDiet rows are authoritative; FDA and BfR rows are added as separate
      entries unless you later add explicit mappings.
"""

from __future__ import annotations

import csv
import dataclasses
import json
import math
import re
import shlex
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional

import pdfplumber  # type: ignore[import]


ROOT = Path(__file__).resolve().parent


@dataclass
class SourceEntry:
  source_id: str
  food_name_original: str
  nickel_ug_per_serving: Optional[float] = None
  serving_size_g: Optional[float] = None
  nickel_ug_per_100g: Optional[float] = None
  units_original: Optional[str] = None
  value_type: str = "measured"  # e.g. measured, summary_mean, below_lod
  country: Optional[str] = None
  year_range: Optional[str] = None
  num_sources: Optional[int] = None
  stddev_ug_per_serving: Optional[float] = None
  min_ug_per_serving: Optional[float] = None
  max_ug_per_serving: Optional[float] = None
  notes: List[str] = field(default_factory=list)


@dataclass
class Food:
  id: str
  name_en: str
  category: str
  sub_category: Optional[str]
  nickel_ug_per_serving: Optional[float]
  serving_size_g: Optional[float]
  nickel_ug_per_100g: Optional[float]
  nickel_band: Optional[str]
  sources: List[SourceEntry] = field(default_factory=list)
  notes: List[str] = field(default_factory=list)

  def to_dict(self) -> Dict[str, Any]:
    return {
      "id": self.id,
      "name_en": self.name_en,
      "category": self.category,
      "sub_category": self.sub_category,
      "nickel_ug_per_serving": self.nickel_ug_per_serving,
      "serving_size_g": self.serving_size_g,
      "nickel_ug_per_100g": self.nickel_ug_per_100g,
      "nickel_band": self.nickel_band,
      "sources": [dataclasses.asdict(s) for s in self.sources],
      "notes": self.notes,
    }


SLUG_INVALID_RE = re.compile(r"[^a-z0-9]+")


def slugify(value: str) -> str:
  value = value.strip().lower()
  value = SLUG_INVALID_RE.sub("-", value)
  value = value.strip("-")
  return value or "food"


def infer_sub_category(name_en: str, category: str) -> Optional[str]:
  """Very simple heuristic sub-category."""
  name = name_en.lower()
  if any(w in name for w in ["beverage", "drink", "milk", "yogurt", "buttermilk"]):
    return "beverage"
  if any(w in name for w in ["cheese", "quark", "paneer", "halloumi"]):
    return "cheese"
  if any(w in name for w in ["bread", "baguette", "muffin", "crackers", "pastries", "dough"]):
    return "bread_and_bakery"
  if "cereal" in name or "noodles" in name or "pasta" in name:
    return "grain_product"
  return None


def parse_serving_grams(desc: str) -> Optional[float]:
  """Extract numeric grams from 'Food name, 30 g*' style descriptors."""
  m = re.search(r",\s*([\d.]+)\s*g\b", desc)
  if not m:
    return None
  try:
    return float(m.group(1))
  except ValueError:
    return None


def clean_lownidiet_name(desc: str) -> str:
  """Remove serving info and asterisks from lowNiDiet description."""
  name = re.sub(r",\s*[\d.]+\s*g\*?", "", desc)
  name = name.replace("*", "")
  return name.strip()


def parse_lownidiet_csv(csv_path: Path) -> List[SourceEntry]:
  """
  Parse lowNiDiet summary tables from the CSV.
  Columns: Category, Food or category (serving), Number of sources,
  Mean Ni (ug/serving), Stddev (ug/serving), Min Ni (ug/serving), Max Ni (ug/serving).
  """
  rows: List[SourceEntry] = []

  # CSV may be Latin-1/CP1252 (e.g. Crème fraîche); use latin-1 to accept all bytes
  with csv_path.open("r", encoding="latin-1") as f:
    reader = csv.DictReader(f)
    for raw in reader:
      category = (raw.get("Category") or "").strip()
      food_serving = (raw.get("Food or category (serving)") or "").strip()
      if not food_serving:
        continue

      try:
        num_sources = int(float(raw.get("Number of sources") or 0))
      except (ValueError, TypeError):
        num_sources = 0

      try:
        mean_ug = float(raw.get("Mean Ni (ug/serving)") or 0)
      except (ValueError, TypeError):
        continue

      try:
        stddev_ug = float(raw.get("Stddev (ug/serving)") or 0)
      except (ValueError, TypeError):
        stddev_ug = 0.0

      try:
        min_ug = float(raw.get("Min Ni (ug/serving)") or 0)
      except (ValueError, TypeError):
        min_ug = mean_ug

      try:
        max_ug = float(raw.get("Max Ni (ug/serving)") or 0)
      except (ValueError, TypeError):
        max_ug = mean_ug

      serving_g = parse_serving_grams(food_serving)
      nickel_ug_per_100g = (
        (mean_ug / serving_g * 100.0) if serving_g and serving_g > 0 else None
      )

      entry = SourceEntry(
        source_id="lowNiDiet",
        food_name_original=food_serving,
        nickel_ug_per_serving=mean_ug,
        serving_size_g=serving_g,
        nickel_ug_per_100g=nickel_ug_per_100g,
        units_original="ug/serving",
        value_type="summary_mean",
        country="various",
        year_range=None,
        num_sources=num_sources,
        stddev_ug_per_serving=stddev_ug,
        min_ug_per_serving=min_ug,
        max_ug_per_serving=max_ug,
        notes=[f"category::{category}"] if category else [],
      )
      rows.append(entry)

  return rows


def parse_lownidiet(pdf_path: Path) -> List[SourceEntry]:
  """
  Parse lowNiDiet summary tables from the PDF.

  Note: Depending on pdfplumber's layout handling, columns may be separated
  by tabs OR by runs of multiple spaces. We handle both.
  """
  rows: List[SourceEntry] = []
  current_category: Optional[str] = None

  header_markers = {
    "number of",
    "mean ni",
    "stddev",
    "min ni",
    "max ni",
  }

  import pdfplumber  # local import to make failure clearer

  with pdfplumber.open(str(pdf_path)) as pdf:  # type: ignore[arg-type]
    for page in pdf.pages:
      text = page.extract_text() or ""
      for raw_line in text.splitlines():
        line = raw_line.rstrip()
        if not line:
          continue

        lower = line.lower()

        # Skip footer / header noise
        if "nickel in foods" in lower or "rebelytics" in lower or "page " in lower or "--" in lower:
          continue

        # Column-header lines (start of each table)
        if any(h in lower for h in header_markers):
          continue

        # Try to split into description + 5 numeric columns
        if "\t" in line:
          parts = [p for p in line.split("\t") if p.strip()]
        else:
          # Split on 2+ spaces to approximate column breaks
          parts = [p for p in re.split(r"\s{2,}", line) if p.strip()]

        if len(parts) < 2:
          # Treat as possible category heading: no clear columns
          current_category = line.strip()
          continue

        desc = parts[0].strip()

        # If the first column itself looks like a header, treat as category and skip
        if desc.lower() in {"number of", "mean ni", "stddev", "min ni", "max ni"}:
          current_category = line.strip()
          continue

        numeric_parts: List[float] = []
        for token in parts[1:]:
          token = token.replace(",", "").strip()
          try:
            numeric_parts.append(float(token))
          except ValueError:
            numeric_parts = []
            break

        # Expect: num_sources, mean, stddev, min, max
        if len(numeric_parts) != 5:
          continue

        num_sources, mean_ug_serving, stddev_ug_serving, min_ug_serving, max_ug_serving = numeric_parts

        serving_g = parse_serving_grams(desc)
        name_en = clean_lownidiet_name(desc)

        entry = SourceEntry(
          source_id="lowNiDiet",
          food_name_original=desc,
          nickel_ug_per_serving=mean_ug_serving,
          serving_size_g=serving_g,
          nickel_ug_per_100g=(mean_ug_serving / serving_g * 100.0) if serving_g and serving_g > 0 else None,
          units_original="ug/serving",
          value_type="summary_mean",
          country="various",
          year_range=None,
          num_sources=int(num_sources),
          stddev_ug_per_serving=stddev_ug_serving,
          min_ug_per_serving=min_ug_serving,
          max_ug_per_serving=max_ug_serving,
          notes=[],
        )
        if current_category:
          entry.notes.append(f"category::{current_category}")

        rows.append(entry)

  return rows


def parse_fda_csv(csv_path: Path) -> List[SourceEntry]:
  """
  Parse fda_nickel_2018_2020.csv (space-delimited with quoted description).
  """
  rows: List[SourceEntry] = []

  with csv_path.open("r", encoding="utf-8") as f:
    header = f.readline()
    if not header:
      return rows

    for raw_line in f:
      raw_line = raw_line.strip()
      if not raw_line:
        continue
      parts = shlex.split(raw_line)
      if len(parts) < 12:
        continue

      (
        fiscal_year,
        calendar_year,
        collection,
        tds_food_number,
        tds_food_description,
        season,
        tds_food_list_type,
        region,
        analyte,
        units,
        concentration,
        reporting_limit,
      ) = parts[:12]

      if analyte.lower() != "nickel":
        continue

      try:
        conc_val = float(concentration)
      except ValueError:
        continue

      nickel_ug_per_100g = conc_val * 0.1

      entry = SourceEntry(
        source_id="FDA_TDS_2018_2020",
        food_name_original=tds_food_description,
        nickel_ug_per_serving=None,
        serving_size_g=None,
        nickel_ug_per_100g=nickel_ug_per_100g,
        units_original=units,
        value_type="measured",
        country="US",
        year_range=f"{calendar_year}",
        notes=[
          f"season::{season}",
          f"region::{region}",
          f"collection::{collection}",
          f"reporting_limit::{reporting_limit}",
        ],
      )
      rows.append(entry)

  return rows


def parse_bfr_excel(xlsx_path: Path) -> List[SourceEntry]:
  """
  Parse BfR MEAL study Excel, sheet 'Nickel'.
  Row 0 = header; data from row 1.
  Col 0 = Main food group, 1 = MEAL food pool (English), 3 = year, 4 = n,
  13 = Unit (mg/kg), 16 = Result mLB, 17 = Result UB.
  Converts mg/kg to µg/100g (multiply by 100).
  """
  try:
    import pandas as pd  # type: ignore[import]
  except ImportError:
    return []

  rows: List[SourceEntry] = []

  try:
    df = pd.read_excel(str(xlsx_path), sheet_name="Nickel", header=0)
  except Exception:
    return rows

  # Expect columns like 'Main food group', 'MEAL food pool', 'Sampling year',
  # 'Sub-samples (n)', 'Unit', '1Result mLB', '1Result UB'
  col_main = None
  col_food = None
  col_year = None
  col_n = None
  col_unit = None
  col_mlb = None
  col_ub = None
  for c in df.columns:
    cstr = str(c).strip().lower()
    if "main food" in cstr or cstr == "0":
      col_main = c
    if "meal food pool" in cstr or "meal food" in cstr or cstr == "1":
      col_food = c
    if "sampling year" in cstr or "year" in cstr or cstr == "3":
      col_year = c
    if "sub-samples" in cstr or cstr == "4":
      col_n = c
    if cstr == "unit" or cstr == "13":
      col_unit = c
    if "result mlb" in cstr or "1result mlb" in cstr or cstr == "16":
      col_mlb = c
    if "result ub" in cstr or "1result ub" in cstr or cstr == "17":
      col_ub = c

  # Fallback: use positional indices if column names differ
  if col_food is None and len(df.columns) >= 2:
    col_main = df.columns[0]
    col_food = df.columns[1]
  if col_year is None and len(df.columns) >= 4:
    col_year = df.columns[3]
  if col_n is None and len(df.columns) >= 5:
    col_n = df.columns[4]
  if col_unit is None and len(df.columns) >= 14:
    col_unit = df.columns[13]
  if col_mlb is None and len(df.columns) >= 17:
    col_mlb = df.columns[16]
  if col_ub is None and len(df.columns) >= 18:
    col_ub = df.columns[17]

  if col_food is None:
    return rows

  for _, r in df.iterrows():
    food_name = (r.get(col_food) if col_food else None)
    if pd.isna(food_name) or not str(food_name).strip():
      continue
    food_name = str(food_name).strip()
    main_group = str(r.get(col_main, "") or "").strip() if col_main else ""

    try:
      year_val = int(float(r.get(col_year) or 0))
    except (ValueError, TypeError):
      year_val = None
    try:
      n_val = int(float(r.get(col_n) or 0))
    except (ValueError, TypeError):
      n_val = None

    unit = str(r.get(col_unit) or "").strip().lower() if col_unit else ""
    if "mg/kg" not in unit and unit != "mg/kg":
      # Still use the numeric columns; BfR data is mg/kg
      pass

    try:
      mlb = float(r.get(col_mlb) or 0)
    except (ValueError, TypeError):
      mlb = None
    try:
      ub = float(r.get(col_ub) or 0)
    except (ValueError, TypeError):
      ub = None

    if mlb is None and ub is None:
      continue
    if mlb is not None and ub is not None:
      conc_mg_kg = (mlb + ub) / 2.0
    else:
      conc_mg_kg = mlb if mlb is not None else ub
    # mg/kg -> µg/100g: 1 mg/kg = 100 µg/100g
    nickel_ug_per_100g = conc_mg_kg * 100.0

    entry = SourceEntry(
      source_id="BfR_MEAL",
      food_name_original=food_name,
      nickel_ug_per_serving=None,
      serving_size_g=None,
      nickel_ug_per_100g=nickel_ug_per_100g,
      units_original="mg/kg",
      value_type="measured",
      country="DE",
      year_range=str(year_val) if year_val else None,
      num_sources=n_val,
      notes=[f"category::{main_group}"] if main_group else [],
    )
    rows.append(entry)

  return rows


def build_foods(
  low_entries: List[SourceEntry],
  fda_entries: List[SourceEntry],
  bfr_entries: Optional[List[SourceEntry]] = None,
) -> List[Food]:
  foods: List[Food] = []

  for entry in low_entries:
    category = "Uncategorised"
    new_notes: List[str] = []
    for note in entry.notes:
      if note.startswith("category::"):
        category = note.split("category::", 1)[1]
      else:
        new_notes.append(note)
    entry.notes = new_notes

    name_en = clean_lownidiet_name(entry.food_name_original)
    food_id = slugify(name_en)
    sub_category = infer_sub_category(name_en, category)

    foods.append(
      Food(
        id=food_id,
        name_en=name_en,
        category=category,
        sub_category=sub_category,
        nickel_ug_per_serving=entry.nickel_ug_per_serving,
        serving_size_g=entry.serving_size_g,
        nickel_ug_per_100g=entry.nickel_ug_per_100g,
        nickel_band=None,
        sources=[entry],
        notes=[],
      )
    )

  grouped_fda: Dict[str, List[SourceEntry]] = defaultdict(list)
  for entry in fda_entries:
    grouped_fda[entry.food_name_original].append(entry)

  for original_name, entries in grouped_fda.items():
    name_en = original_name
    category = "FDA TDS foods"
    sub_category = infer_sub_category(name_en, category)
    food_id = slugify(name_en)

    valid_vals = [e.nickel_ug_per_100g for e in entries if e.nickel_ug_per_100g is not None]
    mean_100g = sum(valid_vals) / len(valid_vals) if valid_vals else None

    foods.append(
      Food(
        id=food_id,
        name_en=name_en,
        category=category,
        sub_category=sub_category,
        nickel_ug_per_serving=None,
        serving_size_g=None,
        nickel_ug_per_100g=mean_100g,
        nickel_band=None,
        sources=entries,
        notes=[],
      )
    )

  # BfR MEAL entries (Option B: separate food entries, grouped by name)
  bfr_entries = bfr_entries or []
  grouped_bfr: Dict[str, List[SourceEntry]] = defaultdict(list)
  for entry in bfr_entries:
    grouped_bfr[entry.food_name_original].append(entry)

  existing_ids = {f.id for f in foods}
  for original_name, entries in grouped_bfr.items():
    name_en = original_name
    category = "BfR MEAL study"
    sub_category = infer_sub_category(name_en, category)
    base_id = slugify(name_en)
    food_id = base_id
    idx = 0
    while food_id in existing_ids:
      idx += 1
      food_id = f"{base_id}-bfr-{idx}"
    existing_ids.add(food_id)

    valid_vals = [e.nickel_ug_per_100g for e in entries if e.nickel_ug_per_100g is not None]
    mean_100g = sum(valid_vals) / len(valid_vals) if valid_vals else None

    foods.append(
      Food(
        id=food_id,
        name_en=name_en,
        category=category,
        sub_category=sub_category,
        nickel_ug_per_serving=None,
        serving_size_g=None,
        nickel_ug_per_100g=mean_100g,
        nickel_band=None,
        sources=entries,
        notes=[],
      )
    )

  return foods


def normalize_name(name: str) -> str:
  """Normalize food name for dedup comparison."""
  n = name.lower().strip()
  n = re.sub(r"\s*\(.*?\)\s*", " ", n)  # remove parentheticals
  n = n.strip(", ")
  n = re.sub(r"\s+", " ", n)
  return n


def name_similarity(a: str, b: str) -> float:
  """Jaccard token-overlap similarity between two food names."""
  a_tokens = set(normalize_name(a).split())
  b_tokens = set(normalize_name(b).split())
  if not a_tokens or not b_tokens:
    return 0.0
  intersection = a_tokens & b_tokens
  union = a_tokens | b_tokens
  return len(intersection) / len(union)


SOURCE_PRIORITY = {"lowNiDiet": 0, "FDA_TDS_2018_2020": 1, "BfR_MEAL": 2}


def deduplicate_foods(foods: List[Food], threshold: float = 0.7) -> List[Food]:
  """Merge foods that represent the same item across sources."""
  groups: Dict[str, List[Food]] = defaultdict(list)
  group_keys: List[str] = []

  for food in foods:
    key = normalize_name(food.name_en)
    matched_key = None
    for existing_key in group_keys:
      if name_similarity(key, existing_key) >= threshold:
        matched_key = existing_key
        break
    if matched_key:
      groups[matched_key].append(food)
    else:
      groups[key].append(food)
      group_keys.append(key)

  merged: List[Food] = []
  for key in group_keys:
    group = groups[key]
    if len(group) == 1:
      merged.append(group[0])
      continue

    # Sort by source priority: lowNiDiet first
    group.sort(key=lambda f: min(
      (SOURCE_PRIORITY.get(s.source_id, 99) for s in f.sources),
      default=99
    ))

    primary = group[0]
    all_sources: List[SourceEntry] = []
    for food in group:
      all_sources.extend(food.sources)

    vals_100g = [f.nickel_ug_per_100g for f in group if f.nickel_ug_per_100g is not None]
    avg_100g = sum(vals_100g) / len(vals_100g) if vals_100g else primary.nickel_ug_per_100g

    alt_names = [f.name_en for f in group[1:] if f.name_en != primary.name_en]
    notes = [f"merged_from:{len(group)}_sources"]
    notes.extend(f"alt_name::{n}" for n in alt_names)

    merged.append(Food(
      id=primary.id,
      name_en=primary.name_en,
      category=primary.category,
      sub_category=primary.sub_category,
      nickel_ug_per_serving=primary.nickel_ug_per_serving,
      serving_size_g=primary.serving_size_g,
      nickel_ug_per_100g=avg_100g,
      nickel_band=None,
      sources=all_sources,
      notes=notes,
    ))

  return merged


def compute_bands(foods: Iterable[Food]) -> Dict[str, Any]:
  values: List[float] = [
    f.nickel_ug_per_100g for f in foods if f.nickel_ug_per_100g is not None and f.nickel_ug_per_100g >= 0
  ]
  values.sort()
  if not values:
    return {}

  def percentile(p: float) -> float:
    k = (len(values) - 1) * p
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
      return float(values[int(k)])
    return float(values[f] + (values[c] - values[f]) * (k - f))

  p25 = percentile(0.25)
  p50 = percentile(0.50)
  p75 = percentile(0.75)

  bands = [
    {"id": "very_low", "label": "Very low nickel", "max_ug_per_100g": p25},
    {"id": "low", "label": "Low nickel", "max_ug_per_100g": p50},
    {"id": "medium", "label": "Medium nickel", "max_ug_per_100g": p75},
    {"id": "high", "label": "High nickel", "max_ug_per_100g": None},
  ]

  return {
    "description": "Nickel band thresholds based on empirical quartiles of nickel_ug_per_100g from lowNiDiet + FDA data.",
    "bands": bands,
  }


def assign_bands(foods: List[Food], bands_conf: Dict[str, Any]) -> None:
  bands = bands_conf.get("bands", [])
  ordered = sorted(
    bands,
    key=lambda b: float("inf") if b.get("max_ug_per_100g") is None else b["max_ug_per_100g"],
  )

  for food in foods:
    v = food.nickel_ug_per_100g
    if v is None:
      food.nickel_band = None
      continue
    for band in ordered:
      max_val = band.get("max_ug_per_100g")
      if max_val is None or v <= max_val:
        food.nickel_band = band["id"]
        break


def main() -> None:
  lownidiet_csv_path = ROOT / "lowNiDiet_r9.1.1_summaryTables.csv"
  lownidiet_pdf_path = ROOT / "lowNiDiet_r9.1.1_summaryTables.pdf"
  fda_csv_path = ROOT / "fda_nickel_2018_2020.csv"
  bfr_xlsx_path = ROOT / "2022-10-27_Occurrence of nickel in prepared foods of BfR MEAL study.xlsx"
  out_foods_path = ROOT / "nickel_foods.json"
  out_bands_path = ROOT / "nickel_bands.json"

  # Primary source: lowNiDiet — prefer CSV (Option A), fallback to PDF
  low_entries: List[SourceEntry] = []
  primary_source_name: str
  if lownidiet_csv_path.exists():
    print(f"Parsing lowNiDiet CSV: {lownidiet_csv_path}")
    low_entries = parse_lownidiet_csv(lownidiet_csv_path)
    primary_source_name = "lowNiDiet_r9.1.1_summaryTables.csv"
    print(f"  Parsed {len(low_entries)} lowNiDiet rows")
  elif lownidiet_pdf_path.exists():
    print(f"Parsing lowNiDiet PDF: {lownidiet_pdf_path}")
    low_entries = parse_lownidiet(lownidiet_pdf_path)
    primary_source_name = "lowNiDiet_r9.1.1_summaryTables.pdf"
    print(f"  Parsed {len(low_entries)} lowNiDiet rows")
  else:
    raise SystemExit(
      "Low nickel diet data not found. Provide lowNiDiet_r9.1.1_summaryTables.csv or lowNiDiet_r9.1.1_summaryTables.pdf"
    )

  fda_entries: List[SourceEntry] = []
  if fda_csv_path.exists():
    print(f"Parsing FDA CSV: {fda_csv_path}")
    fda_entries = parse_fda_csv(fda_csv_path)
    print(f"  Parsed {len(fda_entries)} FDA rows")
  else:
    print("FDA CSV not found; skipping FDA integration.")

  bfr_entries: List[SourceEntry] = []
  if bfr_xlsx_path.exists():
    print(f"Parsing BfR MEAL Excel: {bfr_xlsx_path}")
    bfr_entries = parse_bfr_excel(bfr_xlsx_path)
    print(f"  Parsed {len(bfr_entries)} BfR MEAL rows")
  else:
    print("BfR MEAL Excel not found; skipping BfR integration.")

  foods = build_foods(low_entries, fda_entries, bfr_entries)
  print(f"  Before deduplication: {len(foods)} foods")
  foods = deduplicate_foods(foods, threshold=0.7)
  print(f"  After deduplication: {len(foods)} foods")
  bands_conf = compute_bands(foods)
  assign_bands(foods, bands_conf)

  secondary_sources: List[str] = ["fda_nickel_2018_2020.csv"]
  if bfr_entries:
    secondary_sources.append("2022-10-27_Occurrence of nickel in prepared foods of BfR MEAL study.xlsx")

  payload = {
    "meta": {
      "generated_at": datetime.utcnow().isoformat() + "Z",
      "primary_source": primary_source_name,
      "secondary_sources": secondary_sources,
      "notes": [
        "Bands are empirical quartiles; adjust nickel_bands.json if you want different thresholds.",
        "Per-serving canonical values come from lowNiDiet when available; FDA and BfR entries are per-100 g.",
      ],
    },
    "foods": [f.to_dict() for f in foods],
  }

  with out_foods_path.open("w", encoding="utf-8") as f:
    json.dump(payload, f, ensure_ascii=False, indent=2)
  print(f"Wrote {out_foods_path}")

  with out_bands_path.open("w", encoding="utf-8") as f:
    json.dump(bands_conf, f, ensure_ascii=False, indent=2)
  print(f"Wrote {out_bands_path}")


if __name__ == "__main__":
  main()

