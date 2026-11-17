"""End-to-end pipeline: raw transactions -> analytics tables -> Power BI CSVs + dashboard data."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import __version__
from .customers import ACTIONS, SEGMENTS, add_value, cohorts, rfm, segment_summary
from .data import CleanResult, load
from .products import association_rules, monthly_product_matrix, product_performance
from .trends import country_summary, daily_series, detect_anomalies, forecast, kpis, monthly_series, weekday_hour


@dataclass
class Result:
    clean: CleanResult
    kpis: dict
    customers: pd.DataFrame
    segments: pd.DataFrame
    products: pd.DataFrame
    rules: pd.DataFrame
    monthly: pd.DataFrame
    daily: pd.DataFrame
    countries: pd.DataFrame
    retention: pd.DataFrame
    cohort_revenue: pd.DataFrame
    anomalies: pd.DataFrame
    forecast: pd.DataFrame
    heatmap: pd.DataFrame
    dashboard: dict


def run(clean: CleanResult, forecast_days: int = 30) -> Result:
    sales, guests, canc = clean.sales, clean.guest_sales, clean.cancellations
    allsales = pd.concat([sales, guests], ignore_index=True)

    k = kpis(sales, guests, canc)
    customers = add_value(rfm(sales))
    customers = customers.sort_values("Monetary", ascending=False).reset_index(drop=True)
    segments = segment_summary(customers)
    products = product_performance(allsales, canc)
    rules = association_rules(allsales)
    monthly = monthly_series(allsales)
    daily = daily_series(allsales)
    countries = country_summary(allsales, canc)
    retention, cohort_revenue = cohorts(sales)
    anomalies = detect_anomalies(daily)
    fc = forecast(daily, forecast_days)
    heat = weekday_hour(allsales)

    dash = _dashboard(clean, allsales, k, customers, segments, products, rules, monthly,
                      countries, retention, anomalies, fc)
    return Result(clean, k, customers, segments, products, rules, monthly, daily, countries,
                  retention, cohort_revenue, anomalies, fc, heat, dash)


def _dashboard(clean, allsales, k, customers, segments, products, rules, monthly, countries,
               retention, anomalies, fc) -> dict:
    start = allsales["InvoiceDate"].min().normalize()
    end = allsales["InvoiceDate"].max().normalize()
    country_list = countries["Country"].tolist()
    for c in clean.cancellations["Country"].unique():
        if c not in country_list:
            country_list.append(c)
    cidx = {c: i for i, c in enumerate(country_list)}
    cust_list = customers["CustomerID"].tolist()
    custidx = {c: i for i, c in enumerate(cust_list)}

    inv = allsales.groupby("InvoiceNo").agg(
        ts=("InvoiceDate", "first"), country=("Country", "first"), cust=("CustomerID", "first"),
        revenue=("Revenue", "sum"), units=("Quantity", "sum"), lines=("StockCode", "size"))
    inv = inv.sort_values("ts")
    invoices = [[int((r.ts.normalize() - start).days), cidx[r.country],
                 custidx.get(r.cust, -1) if pd.notna(r.cust) else -1,
                 round(float(r.revenue), 2), int(r.units), int(r.ts.hour), int(r.lines)]
                for r in inv.itertuples()]

    cinv = clean.cancellations.groupby("InvoiceNo").agg(
        ts=("InvoiceDate", "first"), country=("Country", "first"), value=("Revenue", "sum"))
    cancels = [[int((r.ts.normalize() - start).days), cidx[r.country], round(float(-r.value), 2)]
               for r in cinv.itertuples()]

    months = monthly["YearMonth"].tolist()
    top_codes = products["StockCode"].tolist()
    pm = monthly_product_matrix(allsales, top_codes).round(0).astype(int)
    prod_rows = [[p.StockCode, p.Description, round(p.Revenue, 2), int(p.Units), int(p.Orders),
                  int(p.Customers), float(p.AvgPrice), float(p.ReturnRate), p.ABC,
                  pm.loc[p.StockCode].tolist()] for p in products.itertuples()]

    cm = (clean.sales.pivot_table(index="CustomerID", columns="YearMonth", values="Revenue",
                                  aggfunc="sum", fill_value=0)
          .reindex(index=cust_list, columns=months, fill_value=0).round(0).astype(int))
    favourite = (clean.sales.groupby(["CustomerID", "Description"])["Revenue"].sum()
                 .reset_index().sort_values("Revenue", ascending=False)
                 .groupby("CustomerID").head(3).groupby("CustomerID")["Description"].agg(list))
    seg_idx = {s: i for i, s in enumerate(SEGMENTS)}
    cust_rows = [[c.CustomerID, cidx[c.Country], int(c.Recency), int(c.Frequency), round(float(c.Monetary), 2),
                  int(c.R_Score), int(c.F_Score), int(c.M_Score), seg_idx[c.Segment], float(c.AOV),
                  float(c.CLV_12m), float(c.ActiveProbability), float(c.AvgDaysBetweenOrders),
                  c.FirstPurchase.strftime("%Y-%m-%d"), c.LastPurchase.strftime("%Y-%m-%d"),
                  int(c.Products), favourite.get(c.CustomerID, []), cm.loc[c.CustomerID].tolist()]
                 for c in customers.itertuples()]

    top_rules = rules.head(400)
    q = clean.quality.to_frame()
    return {
        "meta": {
            "version": __version__,
            "generated": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "start": start.strftime("%Y-%m-%d"), "end": end.strftime("%Y-%m-%d"),
            "currency": "GBP", "months": months,
        },
        "kpis": k,
        "quality": q.to_dict(orient="records"),
        "countries": country_list,
        "invoice_fields": ["day", "country", "customer", "revenue", "units", "hour", "lines"],
        "invoices": invoices,
        "cancellations": cancels,
        "product_fields": ["code", "name", "revenue", "units", "orders", "customers", "price",
                           "returnRate", "abc", "monthly"],
        "products": prod_rows,
        "rules": top_rules[["Antecedent", "Consequent", "Invoices", "Support", "Confidence",
                            "Lift"]].values.tolist(),
        "segments": SEGMENTS,
        "segment_actions": ACTIONS,
        "segment_summary": segments.to_dict(orient="records"),
        "customer_fields": ["id", "country", "recency", "frequency", "monetary", "r", "f", "m", "segment",
                            "aov", "clv", "active", "interval", "first", "last", "products",
                            "favourites", "monthly"],
        "customers": cust_rows,
        "cohorts": {"labels": retention.index.tolist(),
                    "size": retention["Customers"].astype(int).tolist(),
                    "values": retention.drop(columns="Customers").fillna(-1).values.tolist()},
        "anomalies": [[(r.Date - start).days, round(float(r.Revenue), 2), round(float(r.Expected), 2), r.Type]
                      for r in anomalies.itertuples()],
        "forecast": [[(r.Date - start).days, float(r.Forecast), float(r.Low), float(r.High)]
                     for r in fc.itertuples()],
    }


def export(result: Result, out_dir: str | Path, dashboard_path: str | Path | None = None,
           include_line_level: bool = True) -> list[Path]:
    """Write Power BI-ready CSVs (same names as the original project, plus new tables)."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written = []

    def save(df: pd.DataFrame, name: str, **kw) -> None:
        p = out / name
        df.to_csv(p, index=kw.pop("index", False), **kw)
        written.append(p)

    if include_line_level:
        save(pd.concat([result.clean.sales, result.clean.guest_sales]).sort_values("InvoiceDate"),
             "clean_sales.csv", date_format="%Y-%m-%d %H:%M:%S")
    cust = result.customers.copy()
    for col in ("FirstPurchase", "LastPurchase"):
        cust[col] = cust[col].dt.strftime("%Y-%m-%d")
    save(cust, "customer_rfm_segments.csv")
    save(result.segments, "segment_summary.csv")
    save(result.monthly, "monthly_sales.csv")
    save(result.daily.assign(Date=result.daily["Date"].dt.strftime("%Y-%m-%d")), "daily_sales.csv")
    save(result.countries, "country_sales.csv")
    prod = result.products.copy()
    for col in ("FirstSold", "LastSold"):
        prod[col] = prod[col].dt.strftime("%Y-%m-%d")
    save(prod, "product_sales.csv")
    save(result.rules, "basket_rules.csv")
    save(result.retention, "cohort_retention.csv", index=True)
    save(result.cohort_revenue, "cohort_revenue.csv", index=True)
    save(result.anomalies.assign(Date=result.anomalies["Date"].dt.strftime("%Y-%m-%d")), "anomalies.csv")
    save(result.forecast.assign(Date=result.forecast["Date"].dt.strftime("%Y-%m-%d")), "forecast.csv")
    save(result.heatmap, "weekday_hour_orders.csv", index=True)
    save(result.clean.quality.to_frame(), "data_quality.csv")
    save(result.clean.cancellations.assign(
        InvoiceDate=result.clean.cancellations["InvoiceDate"].dt.strftime("%Y-%m-%d %H:%M:%S")),
        "cancellations.csv")

    if dashboard_path:
        dp = Path(dashboard_path)
        dp.parent.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(result.dashboard, separators=(",", ":"), allow_nan=False, default=str)
        dp.write_text(("window.BASKETLENS_DATA=" + payload + ";\n") if dp.suffix == ".js" else payload,
                      encoding="utf-8")
        written.append(dp)
    return written


def run_from_file(path: str | Path, out_dir: str | Path = "data/processed",
                  dashboard_path: str | Path | None = "dashboard/data/basketlens_data.js",
                  forecast_days: int = 30) -> Result:
    res = run(load(path), forecast_days)
    export(res, out_dir, dashboard_path)
    return res
