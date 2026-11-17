"""Command-line interface.

Examples::

    basketlens run                                   # bundled sample data
    basketlens run --input data/raw/online_retail_full.csv
    basketlens download                              # official UCI dataset (needs internet)
    basketlens sample --invoices 20000
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

DEFAULT_INPUT = "data/raw/online_retail_sample.csv"


def gbp(x: float) -> str:
    for unit, div in (("m", 1e6), ("k", 1e3)):
        if abs(x) >= div:
            return f"£{x / div:,.2f}{unit}"
    return f"£{x:,.2f}"


def cmd_run(a: argparse.Namespace) -> int:
    from .pipeline import run_from_file

    src = Path(a.input)
    if not src.exists():
        print(f"Input not found: {src}\nRun `basketlens download` for the full UCI dataset, "
              f"or `basketlens sample` to generate sample data.", file=sys.stderr)
        return 1
    t0 = time.perf_counter()
    r = run_from_file(src, a.output, a.dashboard or None, a.forecast_days)
    k = r.kpis
    print(f"\nBasketLens  |  {r.dashboard['meta']['start']} to {r.dashboard['meta']['end']}  |  "
          f"{time.perf_counter() - t0:.1f}s\n")
    print("  Data quality")
    for s in r.clean.quality.steps:
        print(f"    {s['rule']:<34} {s['removed']:>9,} removed   {s['remaining']:>9,} remaining")
    print("\n  Headline KPIs")
    rows = [("Revenue", gbp(k["revenue"])), ("Orders", f"{k['orders']:,}"),
            ("Customers", f"{k['customers']:,}"), ("Average order value", gbp(k["aov"])),
            ("Repeat customer rate", f"{k['repeat_rate']:.1%}"),
            ("Cancellation rate", f"{k.get('cancellation_rate', 0):.1%}"),
            ("Products / countries", f"{k['products']:,} / {k['countries']}")]
    for name, val in rows:
        print(f"    {name:<24} {val:>14}")
    print("\n  Customer segments")
    for s in r.segments.itertuples():
        print(f"    {s.Segment:<18} {s.Customers:>6,} customers   {s.RevenueShare:>6.1%} of revenue")
    if not r.rules.empty:
        best = r.rules.iloc[0]
        print(f"\n  Strongest basket rule: {best.AntecedentName} -> {best.ConsequentName} "
              f"(lift {best.Lift:.1f}, confidence {best.Confidence:.0%})")
    print(f"  Anomalous trading days: {len(r.anomalies)}")
    print(f"\n  Power BI CSVs -> {Path(a.output).resolve()}")
    if a.dashboard:
        print(f"  Dashboard     -> {Path(a.dashboard).resolve()}")
    return 0


def cmd_download(a: argparse.Namespace) -> int:
    try:
        from ucimlrepo import fetch_ucirepo
    except ImportError:
        print("Install the downloader first: pip install ucimlrepo", file=sys.stderr)
        return 1
    ds = fetch_ucirepo(id=352)
    df = ds.data.features.copy()
    if "InvoiceNo" not in df.columns and ds.data.ids is not None:
        df = ds.data.ids.join(df)
    if "CustomerID" in df.columns:
        df["CustomerID"] = df["CustomerID"].astype("Int64")
    out = Path(a.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(out, index=False)
    print(f"Saved {len(df):,} rows to {out}")
    return 0


def cmd_sample(a: argparse.Namespace) -> int:
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))
    from generate_sample_data import generate  # type: ignore

    df = generate(a.invoices, a.seed)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(a.out, index=False)
    print(f"Wrote {len(df):,} lines -> {a.out}")
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="basketlens", description="E-commerce customer and sales analytics")
    sub = p.add_subparsers(dest="command", required=True)

    r = sub.add_parser("run", help="Run the analytics pipeline")
    r.add_argument("--input", "-i", default=DEFAULT_INPUT)
    r.add_argument("--output", "-o", default="data/processed")
    r.add_argument("--dashboard", "-d", default="dashboard/data/basketlens_data.js")
    r.add_argument("--forecast-days", type=int, default=30)
    r.set_defaults(func=cmd_run)

    d = sub.add_parser("download", help="Download the official UCI Online Retail dataset")
    d.add_argument("--out", default="data/raw/online_retail_full.csv")
    d.set_defaults(func=cmd_download)

    s = sub.add_parser("sample", help="Generate synthetic sample data")
    s.add_argument("--invoices", type=int, default=9000)
    s.add_argument("--seed", type=int, default=11)
    s.add_argument("--out", default=DEFAULT_INPUT)
    s.set_defaults(func=cmd_sample)
    return p


def main(argv: list[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    return a.func(a)


if __name__ == "__main__":
    raise SystemExit(main())
