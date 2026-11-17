"""Generate a realistic synthetic online-retail dataset.

The output has exactly the schema of the UCI Online Retail dataset (ID 352)::

    InvoiceNo,StockCode,Description,Quantity,InvoiceDate,UnitPrice,CustomerID,Country

and reproduces its well-known characteristics so every part of the pipeline can
be demonstrated without downloading the real file:

* a UK-based online gift wholesaler: ~88% of customers in the United Kingdom
* 1 Dec 2010 to 9 Dec 2011, strong build-up to Christmas, no Saturday trading
* wholesale customers ordering in multiples of 6 / 12 alongside retail buyers
* cancellations (invoice numbers starting with ``C``, negative quantities)
* lines without a CustomerID (guest checkouts), zero prices and blank descriptions
* themed baskets and colour variants, so market-basket analysis finds real patterns

Usage::

    python scripts/generate_sample_data.py --invoices 9000 --seed 11
"""

from __future__ import annotations

import argparse
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

START = datetime(2010, 12, 1)
END = datetime(2011, 12, 9, 20, 0)

COLOURS = ["RED", "PINK", "BLUE", "WHITE", "GREEN", "IVORY"]

# theme: (base unit price, seasonal Christmas boost, product names)
CATALOGUE: dict[str, tuple[float, float, list[str]]] = {
    "christmas": (2.9, 3.5, [
        "15CM CHRISTMAS GLASS BALL 20 LIGHTS", "WOODEN BOX ADVENT CALENDAR",
        "CHRISTMAS PUDDING TRINKET POT", "EUCALYPTUS PINECONE WREATH",
        "PAPER CHAIN KIT VINTAGE CHRISTMAS", "PAPER CHAIN KIT 50'S CHRISTMAS",
        "SET OF 6 WOODEN STAR DECORATIONS", "CHRISTMAS GINGHAM HEART",
        "ROTATING SILVER ANGELS T-LIGHT HLDR", "WOODEN TREE CHRISTMAS SCANDINAVIAN",
        "SET OF 20 VINTAGE CHRISTMAS NAPKINS", "CHRISTMAS CRAFT LITTLE FRIENDS",
        "SNOWFLAKE PORTABLE TABLE LIGHT", "CHRISTMAS STAR WISH LIST CHALKBOARD",
    ]),
    "lights": (2.6, 1.4, [
        "{c} CHERRY LIGHTS", "{c} HANGING HEART T-LIGHT HOLDER",
        "HANGING HEART ZINC T-LIGHT HOLDER", "STAR T-LIGHT HOLDER WILLIE WINKIE",
        "LANTERN CREAM GAZEBO", "MOROCCAN TEA GLASS", "GLASS STAR FROSTED T-LIGHT HOLDER",
        "COLOUR GLASS T-LIGHT HOLDER HANGING",
    ]),
    "kitchen": (3.4, 1.0, [
        "BAKING SET 9 PIECE RETROSPOT", "RETRO SPOT TEA SET CERAMIC 11 PC",
        "HEART MEASURING SPOONS LARGE", "LUNCHBOX WITH CUTLERY RETROSPOT",
        "LUNCHBOX WITH CUTLERY FAIRY CAKES", "RETRO COFFEE MUGS ASSORTED",
        "SAVE THE PLANET MUG", "JAM MAKING SET WITH JARS", "SET OF 3 CAKE TINS PANTRY DESIGN",
        "REGENCY CAKESTAND 3 TIER", "{c} RETROSPOT CHARLOTTE BAG", "SET OF 4 PANTRY JELLY MOULDS",
        "RECIPE BOX PANTRY YELLOW DESIGN", "GREEN REGENCY TEACUP AND SAUCER",
        "ROSES REGENCY TEACUP AND SAUCER", "PINK REGENCY TEACUP AND SAUCER",
        "SET OF 6 SPICE TINS PANTRY DESIGN", "ENAMEL BREAD BIN CREAM",
    ]),
    "party": (0.9, 1.1, [
        "PACK OF 6 SKULL PAPER CUPS", "PACK OF 20 SKULL PAPER NAPKINS",
        "RETRO SPORT PARTY BAG STICKER SET", "PARTY BUNTING", "PACK OF 72 RETROSPOT CAKE CASES",
        "PACK OF 60 PINK PAISLEY CAKE CASES", "SPACEBOY BIRTHDAY CARD", "SKULL PAPER PLATES",
        "PAPER BUNTING RETROSPOT", "{c} PAPER PARASOL", "PARTY CONES CANDY ASSORTED",
        "SET OF 6 FUNKY BEAKERS",
    ]),
    "home": (4.8, 1.2, [
        "FANCY FONT HOME SWEET HOME DOORMAT", "DOOR MAT BLACK FLOCK", "LOVE BUILDING BLOCK WORD",
        "HOME BUILDING BLOCK WORD", "RECORD FRAME 7 SINGLE SIZE", "ASSORTED COLOUR BIRD ORNAMENT",
        "WHITE METAL LANTERN", "VINTAGE BILLBOARD DRINK ME MUG", "HEART OF WICKER LARGE",
        "HEART OF WICKER SMALL", "{c} POLKADOT CUSHION COVER", "CHALKBOARD KITCHEN ORGANISER",
        "WOOD 2 DRAWER CABINET WHITE FINISH", "SMALL WHITE HEART OF WICKER",
    ]),
    "kids": (2.2, 1.3, [
        "CHARLIE LOLA BISCUITS TINS", "CHARLIE AND LOLA FIGURES TINS",
        "CHARLIE LOLA WASTEPAPER BIN BLUE", "CHARLIE LOLA WASTEPAPER BIN FLORA",
        "STRIPES DESIGN MONKEY DOLL", "BLUE PADDED SOFT MOBILE", "FLORAL BLUE MONSTER",
        "INFLATABLE POLITICAL GLOBE", "SPACEBOY LUNCH BOX", "DOLLY GIRL LUNCH BOX",
        "ROUND SNACK BOXES SET OF4 WOODLAND", "CHILDRENS CUTLERY SPACEBOY",
        "CHILDRENS CUTLERY DOLLY GIRL", "ALARM CLOCK BAKELIKE {c}",
    ]),
    "bags": (1.9, 1.0, [
        "JUMBO BAG {c} RETROSPOT", "LUNCH BAG {c} RETROSPOT", "LUNCH BAG BLACK SKULL",
        "JUMBO STORAGE BAG SUKI", "JUMBO SHOPPER VINTAGE RED PAISLEY", "LUNCH BAG SPACEBOY DESIGN",
        "LUNCH BAG DOLLY GIRL DESIGN", "JUMBO BAG APPLES", "JUMBO BAG STRAWBERRY",
    ]),
    "wrap": (0.6, 1.8, [
        "WRAP ENGLISH ROSE", "WRAP BLUE RUSSIAN FOLKART", "SET OF THREE VINTAGE GIFT WRAPS",
        "GIFT BAG BIRTHDAY", "WRAP CHRISTMAS VILLAGE", "WRAP VINTAGE LEAF DESIGN",
        "SMALL {c} RETROSPOT GIFT BAG", "RIBBON REEL STRIPES DESIGN",
    ]),
    "garden": (3.1, 0.6, [
        "GARDENERS KNEELING PAD KEEP CALM", "GARDENERS KNEELING PAD CUP OF TEA",
        "WATERING CAN PINK BUNNY", "WATERING CAN BLUE ELEPHANT", "SET OF 3 BIRD HOUSES",
        "HANGING JAM JAR T-LIGHT HOLDER", "GARDEN METAL SIGN", "{c} SPOTTY BIRD FEEDER",
    ]),
    "stationery": (1.4, 1.0, [
        "PACK OF 12 LONDON TISSUES", "ASSORTED COLOURS SILK FAN", "SET OF 4 KNICK KNACK TINS POPPIES",
        "PAPER CRAFT LITTLE BIRDIE", "RETROSPOT LARGE MILK JUG", "WORLD WAR 2 GLIDERS ASSTD DESIGNS",
        "VINTAGE SNAP CARDS", "POPCORN HOLDER", "{c} NOTEBOOK SPOTTY",
    ]),
    "pets": (2.8, 1.0, ["CAT BOWL", "DOG BOWL CHASING BALL DESIGN", "PET MUG KEEP CALM", "DOG LICENCE WALL ART"]),
}

COUNTRIES = {
    "United Kingdom": 0.880, "Germany": 0.022, "France": 0.021, "Spain": 0.008, "Belgium": 0.006,
    "Switzerland": 0.006, "Portugal": 0.005, "Italy": 0.004, "Finland": 0.003, "Austria": 0.003,
    "Norway": 0.003, "Netherlands": 0.003, "Australia": 0.003, "Denmark": 0.002, "Channel Islands": 0.002,
    "Sweden": 0.002, "Cyprus": 0.002, "Japan": 0.002, "Poland": 0.002, "EIRE": 0.003, "USA": 0.002,
    "Israel": 0.001, "Canada": 0.001, "Greece": 0.001, "Singapore": 0.001, "Iceland": 0.001,
    "Lithuania": 0.001, "Brazil": 0.001, "United Arab Emirates": 0.001,
}

# relative order volume by month (Dec 2010 .. Dec 2011)
MONTH_FACTOR = {12: 1.05, 1: 0.70, 2: 0.66, 3: 0.88, 4: 0.75, 5: 0.95, 6: 0.90,
                7: 0.88, 8: 0.90, 9: 1.25, 10: 1.40, 11: 1.85}
WEEKDAY_FACTOR = [1.0, 1.05, 1.1, 1.25, 0.9, 0.0, 0.6]   # Mon..Sun, no Saturdays
HOURS = np.arange(7, 21)
OUTAGES = {"2011-06-14": 0.08, "2011-10-04": 0.15}
BULK_ORDERS = [("2011-01-18 10:01:00", "RECIPE BOX PANTRY YELLOW DESIGN", 4800),
               ("2011-05-19 11:12:00", "PAPER CRAFT LITTLE BIRDIE", 9600),
               ("2011-09-20 12:20:00", "WORLD WAR 2 GLIDERS ASSTD DESIGNS", 14400)]
HOUR_WEIGHTS = np.array([1, 3, 6, 9, 11, 13, 13, 11, 9, 7, 4, 2, 1, 0.5], dtype=float)


def build_catalogue(rng: np.random.Generator) -> pd.DataFrame:
    rows = []
    code = 20600
    for theme, (base, season, names) in CATALOGUE.items():
        for name in names:
            variants = [name.replace("{c}", c) for c in rng.choice(COLOURS, 3, replace=False)] \
                if "{c}" in name else [name]
            family = name
            base_code = code
            for vi, v in enumerate(variants):
                suffix = "ABCDEFG"[vi] if len(variants) > 1 else ""
                rows.append({
                    "StockCode": f"{base_code}{suffix}" if suffix else str(base_code),
                    "Description": v, "theme": theme, "family": family,
                    "price": round(float(base * rng.lognormal(0, 0.35)), 2),
                    "season": season,
                })
            code += int(rng.integers(3, 40))
    cat = pd.DataFrame(rows)
    # popularity follows a long tail
    cat["pop"] = rng.pareto(1.3, len(cat)) + 0.2
    return cat


def generate(n_invoices: int = 9000, seed: int = 11) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    cat = build_catalogue(rng)
    themes = list(CATALOGUE)
    by_theme = {t: cat.index[cat["theme"] == t].to_numpy() for t in themes}
    by_family = cat.groupby("family").groups

    # ---- customers ----
    n_customers = int(n_invoices / 4.2)
    countries = list(COUNTRIES)
    cw = np.array(list(COUNTRIES.values()))
    cw = cw / cw.sum()
    cust_ids = rng.choice(np.arange(12346, 18288), n_customers, replace=False)
    total_days = (END - START).days
    customers = []
    for cid in cust_ids:
        wholesale = rng.random() < 0.3
        start = int(rng.integers(0, total_days - 5)) if rng.random() < 0.55 else 0
        churn_day = total_days if rng.random() < 0.6 else int(rng.integers(start, total_days))
        customers.append({
            "id": str(cid), "country": rng.choice(countries, p=cw), "wholesale": wholesale,
            "start": start, "end": max(churn_day, start + 1),
            "weight": rng.pareto(1.6) + (2.5 if wholesale else 0.6),
            "themes": rng.choice(themes, 3, replace=False),
        })
    weights = np.array([c["weight"] for c in customers])

    # ---- invoice timestamps with seasonality and weekday pattern ----
    days = [START + timedelta(days=d) for d in range(total_days + 1)]
    day_w = np.array([MONTH_FACTOR[d.month] * WEEKDAY_FACTOR[d.weekday()] for d in days])
    for d_str, factor in OUTAGES.items():                     # e.g. a checkout outage
        day_w[(datetime.fromisoformat(d_str) - START).days] *= factor
    day_w = day_w / day_w.sum()
    inv_days = np.sort(rng.choice(len(days), n_invoices, p=day_w))

    rows = []
    cancellations = []
    invoice_no = 536365
    for di in inv_days:
        day = days[di]
        hour = int(rng.choice(HOURS, p=HOUR_WEIGHTS / HOUR_WEIGHTS.sum()))
        ts = day.replace(hour=hour, minute=int(rng.integers(0, 60)))
        if ts > END:
            ts = END
        active = np.array([(c["start"] <= di <= c["end"]) for c in customers])
        guest = rng.random() < 0.12 or not active.any()
        if guest:
            cust = {"id": "", "country": "United Kingdom", "wholesale": False,
                    "themes": rng.choice(themes, 3, replace=False)}
        else:
            w = weights * active
            cust = customers[int(rng.choice(len(customers), p=w / w.sum()))]

        n_items = int(np.clip(rng.geometric(0.11 if cust["wholesale"] else 0.22), 1, 60))
        chosen: list[int] = []
        xmas = day.month in (9, 10, 11, 12)
        for _ in range(n_items):
            theme = rng.choice(cust["themes"]) if rng.random() < 0.8 else rng.choice(themes)
            if xmas and rng.random() < 0.25:
                theme = "christmas"
            pool = by_theme[theme]
            p = cat.loc[pool, "pop"].to_numpy() * np.where(
                xmas, cat.loc[pool, "season"].to_numpy(), 1.0)
            pick = int(rng.choice(pool, p=p / p.sum()))
            chosen.append(pick)
            fam = by_family[cat.at[pick, "family"]]
            if len(fam) > 1 and rng.random() < 0.45:      # colour siblings bought together
                chosen.append(int(rng.choice([f for f in fam if f != pick])))
        chosen = list(dict.fromkeys(chosen))

        lines = []
        for pi in chosen:
            if cust["wholesale"]:
                qty = int(rng.choice([6, 12, 12, 24, 24, 36, 48, 96]))
            else:
                qty = int(rng.choice([1, 1, 2, 2, 3, 4, 6, 12]))
            price = cat.at[pi, "price"]
            if cust["wholesale"] and qty >= 24:
                price = round(price * 0.85, 2)
            if rng.random() < 0.002:
                price = 0.0
            desc = cat.at[pi, "Description"] if rng.random() > 0.002 else ""
            lines.append((str(invoice_no), cat.at[pi, "StockCode"], desc, qty,
                          ts.strftime("%Y-%m-%d %H:%M:%S"), price, cust["id"], cust["country"]))
        rows.extend(lines)

        if cust["id"] and rng.random() < 0.07:              # later cancellation
            cts = ts + timedelta(days=int(rng.integers(0, 12)), hours=int(rng.integers(0, 4)))
            if cts <= END and cts.weekday() != 5:
                for ln in rng.choice(len(lines), size=max(1, len(lines) // 3), replace=False):
                    inv, sc, desc, qty, _, price, cid, ctry = lines[ln]
                    cancellations.append((f"C{invoice_no + 500000}", sc, desc, -qty,
                                          cts.strftime("%Y-%m-%d %H:%M:%S"), price, cid, ctry))
        invoice_no += 1

    # Bulk wholesale orders that show up as revenue spikes.
    big = [c for c in customers if c["wholesale"] and c["country"] == "United Kingdom"][:3]
    for (d_str, code_pick, qty), cust in zip(BULK_ORDERS, big):
        ts = datetime.fromisoformat(d_str)
        pi = int(cat.index[cat["Description"] == code_pick][0])
        rows.append((str(invoice_no), cat.at[pi, "StockCode"], code_pick, qty, ts.strftime("%Y-%m-%d %H:%M:%S"),
                     round(cat.at[pi, "price"] * 0.6, 2), cust["id"], cust["country"]))
        invoice_no += 1

    df = pd.DataFrame(rows + cancellations, columns=[
        "InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate", "UnitPrice",
        "CustomerID", "Country"])
    df = df.sort_values(["InvoiceDate", "InvoiceNo"], kind="stable").reset_index(drop=True)
    return df


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--invoices", type=int, default=9000)
    ap.add_argument("--seed", type=int, default=11)
    ap.add_argument("--out", type=Path,
                    default=Path(__file__).resolve().parents[1] / "data" / "raw" / "online_retail_sample.csv")
    a = ap.parse_args()
    df = generate(a.invoices, a.seed)
    a.out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(a.out, index=False)
    print(f"Wrote {len(df):,} lines, {df['InvoiceNo'].nunique():,} invoices -> {a.out}")


if __name__ == "__main__":
    main()
