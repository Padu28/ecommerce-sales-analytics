import subprocess
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))
sys.path.insert(0, str(ROOT / "scripts"))

from basketlens import clean, export, load, run  # noqa: E402
from basketlens.customers import SEGMENTS, rfm  # noqa: E402
from basketlens.products import association_rules  # noqa: E402
from basketlens.trends import detect_anomalies  # noqa: E402
from generate_sample_data import generate  # noqa: E402

REAL_SAMPLE = ROOT / "data" / "sample" / "online_retail_real_sample.csv"


@pytest.fixture(scope="module")
def synthetic():
    return clean(generate(700, seed=3))


@pytest.fixture(scope="module")
def result(synthetic):
    return run(synthetic, forecast_days=14)


def test_real_uci_sample_loads():
    res = load(REAL_SAMPLE)
    assert len(res.sales) == 40
    assert res.sales["CustomerID"].nunique() == 5
    assert set(res.sales["Country"]) == {"United Kingdom", "France"}
    assert res.sales["Revenue"].sum() == pytest.approx(2252.69, abs=0.05)


def test_cleaning_rules_and_quality_report():
    df = pd.DataFrame({
        "InvoiceNo": ["1", "1", "C2", "3", "4", "5"],
        "StockCode": ["A", "B", "A", "A", "A", None],
        "Description": ["x", None, "x", "x", "x", "x"],
        "Quantity": [2, 1, -1, 3, 0, 1],
        "InvoiceDate": ["2011-01-03 10:00"] * 6,
        "UnitPrice": [1.5, 2.0, 1.5, 1.0, 1.0, 1.0],
        "CustomerID": ["12345.0", "12345", "12345", None, "9", "9"],
        "Country": ["United Kingdom"] * 6,
    })
    res = clean(df)
    assert res.sales["CustomerID"].unique().tolist() == ["12345"]   # .0 stripped
    assert len(res.sales) == 2
    assert len(res.cancellations) == 1
    assert len(res.guest_sales) == 1
    removed = {s["rule"]: s["removed"] for s in res.quality.steps}
    assert removed["Unreadable or incomplete lines"] == 1
    assert removed["Zero quantity or price"] == 1
    steps = res.quality.steps
    assert steps[-1]["remaining"] == len(res.sales)


def test_every_rf_combination_has_one_segment():
    rows = []
    for r in range(1, 6):
        for f in range(1, 6):
            rows.append((r, f))
    g = pd.DataFrame(rows, columns=["R_Score", "F_Score"]).assign(M_Score=3)
    seg = np.select(
        [(g.R_Score >= 4) & (g.F_Score >= 4) & (g.M_Score >= 4), (g.R_Score >= 3) & (g.F_Score >= 3),
         (g.R_Score <= 2) & (g.F_Score >= 3), (g.R_Score >= 4) & (g.F_Score <= 2),
         (g.R_Score == 3) & (g.F_Score <= 2)],
        ["Champions", "Loyal Customers", "At Risk", "New/Promising", "Need Attention"], default="Hibernating")
    assert set(seg) <= set(SEGMENTS)


def test_rfm_scores(synthetic):
    c = rfm(synthetic.sales)
    for col in ("R_Score", "F_Score", "M_Score"):
        assert c[col].between(1, 5).all()
    assert c["CustomerID"].is_unique
    assert set(c["Segment"]) <= set(SEGMENTS)
    g = c.groupby("Recency")["R_Score"].agg(["min", "max"]).sort_index()
    assert (g["min"].values[:-1] >= g["max"].values[1:]).all()


def test_association_rule_maths():
    inv = [("1", ["A", "B"]), ("2", ["A", "B"]), ("3", ["A", "C"]), ("4", ["B"]), ("5", ["C"])]
    sales = pd.DataFrame([(i, s, s) for i, items in inv for s in items],
                         columns=["InvoiceNo", "StockCode", "Description"])
    rules = association_rules(sales, min_support=0, min_pair_count=1)
    ab = rules[(rules.Antecedent == "A") & (rules.Consequent == "B")].iloc[0]
    assert ab.Invoices == 2
    assert ab.Support == pytest.approx(0.4)
    assert ab.Confidence == pytest.approx(2 / 3, abs=1e-3)
    assert ab.Lift == pytest.approx((2 / 3) / (3 / 5), abs=1e-3)


def test_anomaly_detection_finds_spike_and_drop():
    days = pd.date_range("2011-01-03", periods=140, freq="D")
    rng = np.random.default_rng(0)
    rev = rng.normal(5000, 300, len(days)).clip(0)
    rev[days.weekday == 5] = 0
    rev[100] = 25000
    rev[120] = 100
    out = detect_anomalies(pd.DataFrame({"Date": days, "Revenue": rev}))
    flagged = dict(zip(out["Date"], out["Type"]))
    assert flagged.get(days[100]) == "spike"
    assert flagged.get(days[120]) == "drop"
    assert not any(d.weekday() == 5 for d in flagged)


def test_forecast_shape(result):
    fc = result.forecast
    assert len(fc) == 14
    assert (fc["Forecast"] >= 0).all()
    assert (fc["Low"] <= fc["Forecast"]).all() and (fc["Forecast"] <= fc["High"]).all()


def test_pipeline_outputs(result, tmp_path):
    k = result.kpis
    assert k["revenue"] > 0 and k["orders"] > 0
    assert 0 <= k["repeat_rate"] <= 1
    assert result.products["ABC"].isin(["A", "B", "C"]).all()
    assert abs(result.segments["CustomerShare"].sum() - 1) < 1e-3
    d = result.dashboard
    assert {"meta", "kpis", "invoices", "products", "customers", "rules", "quality", "forecast"} <= set(d)
    assert len(d["customers"]) == len(result.customers)
    assert sum(r[3] for r in d["invoices"]) == pytest.approx(k["revenue"], rel=1e-6)
    files = export(result, tmp_path, tmp_path / "data.js")
    names = {f.name for f in files}
    assert {"clean_sales.csv", "customer_rfm_segments.csv", "monthly_sales.csv", "country_sales.csv",
            "product_sales.csv", "basket_rules.csv", "data.js"} <= names
    assert (tmp_path / "data.js").read_text().startswith("window.BASKETLENS_DATA=")


def test_mapreduce_matches_pandas(tmp_path):
    df = generate(150, seed=5)
    csv = tmp_path / "in.csv"
    df.to_csv(csv, index=False)
    mr = ROOT / "bigdata" / "mapreduce"
    mapped = subprocess.run([sys.executable, str(mr / "mapper.py"), "country"], stdin=csv.open(),
                            capture_output=True, text=True, check=True).stdout
    shuffled = "".join(sorted(mapped.splitlines(keepends=True), key=lambda line: line.split("\t")[0]))
    reduced = subprocess.run([sys.executable, str(mr / "reducer.py")], input=shuffled,
                             capture_output=True, text=True, check=True).stdout
    got = {line.split("\t")[0]: float(line.split("\t")[1]) for line in reduced.splitlines()}
    d = df.copy()
    valid = d[~d["InvoiceNo"].str.startswith("C") & (d["Quantity"] > 0) & (d["UnitPrice"] > 0)]
    want = (valid["Quantity"] * valid["UnitPrice"]).groupby(valid["Country"]).sum()
    for country, value in want.items():
        assert got[country] == pytest.approx(value, abs=0.05 * max(1, valid.shape[0] / 100))
