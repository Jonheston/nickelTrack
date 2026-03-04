import pdfplumber
import pandas as pd

pdf_path = "lowNiDiet_r9.1.1_summaryTables.pdf"

rows = []
current_category = None

with pdfplumber.open(pdf_path) as pdf:
    for page in pdf.pages:
        text = page.extract_text()

        # detect category headings
        for line in text.split("\n"):
            if ":" not in line and "Number of sources" not in line:
                if line.strip().endswith("products") or \
                   line.strip().startswith("Fruits") or \
                   line.strip().startswith("Vegetables") or \
                   line.strip().startswith("Meat") or \
                   line.strip().startswith("Fish") or \
                   line.strip().startswith("Beans") or \
                   line.strip().startswith("Nuts") or \
                   line.strip().startswith("Beverages") or \
                   line.strip().startswith("Grain") or \
                   line.strip().startswith("Whole grains"):
                    current_category = line.strip()

        table = page.extract_table()

        if table:
            header = table[0]
            for r in table[1:]:
                if r and len(r) >= 5:
                    rows.append({
                        "category": current_category,
                        "food_serving": r[0],
                        "num_sources": r[1],
                        "mean_ug_per_serving": r[2],
                        "stddev_ug_per_serving": r[3],
                        "min_ug_per_serving": r[4],
                        "max_ug_per_serving": r[5] if len(r) > 5 else None
                    })

df = pd.DataFrame(rows)
df.to_csv("nickel_foods_dataset.csv", index=False)

print("CSV saved as nickel_foods_dataset.csv")