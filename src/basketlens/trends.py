"""Sales trends, behaviour patterns, anomaly detection and a baseline forecast."""

from __future__ import annotations

import numpy as np
import pandas as pd

WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def kpis(sales: pd.DataFrame, guests: pd.DataFrame | None = None,
         cancellations: pd.DataFrame | None = None) -> dict:
    allsales = sales if guests is None else pd.concat([sales, guests])
    orders = allsales["InvoiceNo"].nunique()
    revenue = float(allsales["Revenue"].sum())
    per_cust = sales.groupby("CustomerID")["InvoiceNo"].nunique()
    out = {
        "revenue": round(revenue, 2),
        "orders": int(orders),
        "customers": int(sales["CustomerID"].nunique()),
        "units": int(allsales["Quantity"].sum()),
        "aov": round(revenue / orders, 2) if orders else 0.0,
        "revenue_per_customer": round(float(sales["Revenue"].sum()) / max(len(per_cust), 1), 2),
        "repeat_rate": round(float((per_cust > 1).mean()), 4) if len(per_cust) else 0.0,
        "products": int(allsales["StockCode"].nunique()),
        "countries": int(allsales["Country"].nunique()),
        "guest_revenue_share": (round(float(guests["Revenue"].sum()) / revenue, 4)
                                if guests is not None and revenue else 0.0),
    }
    if cancellations is not None:
        lost = float(-cancellations["Revenue"].sum())
        out["cancelled_value"] = round(lost, 2)
        out["cancellation_rate"] = round(lost / (revenue + lost), 4) if revenue else 0.0
    return out


def daily_series(allsales: pd.DataFrame) -> pd.DataFrame:
    d = allsales.assign(Date=allsales["InvoiceDate"].dt.normalize())
    g = d.groupby("Date").agg(Revenue=("Revenue", "sum"), Orders=("InvoiceNo", "nunique"),
                              Units=("Quantity", "sum"))
    idx = pd.date_range(g.index.min(), g.index.max(), freq="D")
    return g.reindex(idx, fill_value=0).rename_axis("Date").reset_index()


def monthly_series(allsales: pd.DataFrame) -> pd.DataFrame:
    g = allsales.groupby("YearMonth").agg(
        Revenue=("Revenue", "sum"), Orders=("InvoiceNo", "nunique"),
        Customers=("CustomerID", "nunique"), Units=("Quantity", "sum"))
    g["AOV"] = g["Revenue"] / g["Orders"]
    g["MoMGrowth"] = g["Revenue"].pct_change()
    return g.round(4).reset_index()


def weekday_hour(allsales: pd.DataFrame) -> pd.DataFrame:
    inv = allsales.groupby("InvoiceNo").agg(Day=("OrderDay", "first"), Hour=("OrderHour", "first"),
                                            Revenue=("Revenue", "sum"))
    m = inv.pivot_table(index="Day", columns="Hour", values="Revenue", aggfunc="count", fill_value=0)
    return m.reindex(WEEKDAYS, fill_value=0)


def detect_anomalies(daily: pd.DataFrame, weeks: int = 8, threshold: float = 3.5) -> pd.DataFrame:
    """Flag trading days whose revenue is far from the norm for that weekday.

    For each day the expected revenue is the median of the same weekday over the
    previous ``weeks`` weeks, and the spread is the median absolute deviation
    (MAD) of those days. A robust z-score of ``threshold`` or more is a spike or
    a drop. Because revenue is right-skewed, a day below 25% of its expected
    level is also flagged as a drop. Weekdays the business doesn't normally
    trade (Saturdays in the UCI data) and the Christmas shutdown are ignored.
    """
    t = daily.copy()
    t["dow"] = t["Date"].dt.weekday
    trades = t.groupby("dow")["Revenue"].apply(lambda s: (s > 0).mean() > 0.5)
    t = t[t["dow"].map(trades)].copy()
    grp = t.groupby("dow")["Revenue"]
    t["Expected"] = grp.transform(lambda s: s.rolling(weeks, min_periods=4).median().shift(1))
    mad = t.groupby("dow")["Revenue"].transform(
        lambda s: (s - s.rolling(weeks, min_periods=4).median()).abs().rolling(weeks, min_periods=4)
        .median().shift(1))
    mad = np.maximum(mad, 0.25 * t["Expected"])  # floor: small samples understate spread
    t["Score"] = (0.6745 * (t["Revenue"] - t["Expected"]) / mad.replace(0, np.nan)).fillna(0)
    holiday = ((t["Date"].dt.month == 12) & (t["Date"].dt.day >= 23)) | (
        (t["Date"].dt.month == 1) & (t["Date"].dt.day <= 3))
    t.loc[holiday, "Score"] = 0
    collapse = (t["Revenue"] < 0.25 * t["Expected"]) & ~holiday
    t.loc[collapse, "Score"] = t.loc[collapse, "Score"].clip(upper=-threshold)
    flagged = t[(t["Score"].abs() >= threshold) | collapse].copy()
    flagged["Type"] = np.where(flagged["Score"] > 0, "spike", "drop")
    out = flagged[["Date", "Revenue", "Expected", "Score", "Type"]].reset_index(drop=True)
    return out.round({"Revenue": 2, "Expected": 2, "Score": 2})


def forecast(daily: pd.DataFrame, horizon: int = 30, lookback: int = 90) -> pd.DataFrame:
    """Baseline daily revenue forecast: recent linear trend × weekday profile.

    Fits a straight line to the last ``lookback`` days of weekday-adjusted
    revenue, multiplies back by each weekday's average share, and gives an 80%
    band from the spread of past residuals. Deliberately simple and explainable;
    swap in Prophet or statsmodels for production use.
    """
    t = daily.tail(lookback).copy()
    t["dow"] = t["Date"].dt.weekday
    prof = daily.assign(dow=daily["Date"].dt.weekday).groupby("dow")["Revenue"].mean()
    prof = prof / prof[prof > 0].mean()
    adj = t["Revenue"] / t["dow"].map(prof).replace(0, np.nan)
    mask = adj.notna()
    x = np.arange(len(t))[mask.to_numpy()]
    y = adj[mask].to_numpy()
    slope, intercept = np.polyfit(x, y, 1) if len(x) > 2 else (0.0, float(y.mean()) if len(y) else 0.0)
    resid = y - (slope * x + intercept)
    spread = 1.2816 * float(np.std(resid)) if len(resid) > 2 else 0.0
    rows = []
    last = daily["Date"].max()
    for h in range(1, horizon + 1):
        day = last + pd.Timedelta(days=h)
        f = prof.get(day.weekday(), 0)
        base = max(slope * (len(t) - 1 + h) + intercept, 0)
        rows.append((day, base * f, max((base - spread) * f, 0), (base + spread) * f))
    return pd.DataFrame(rows, columns=["Date", "Forecast", "Low", "High"]).round(
        {"Forecast": 2, "Low": 2, "High": 2})


def country_summary(allsales: pd.DataFrame, cancellations: pd.DataFrame) -> pd.DataFrame:
    g = allsales.groupby("Country").agg(
        Revenue=("Revenue", "sum"), Orders=("InvoiceNo", "nunique"),
        Customers=("CustomerID", "nunique"), Units=("Quantity", "sum"))
    g["AOV"] = g["Revenue"] / g["Orders"]
    g["RevenueShare"] = g["Revenue"] / g["Revenue"].sum()
    lost = (-cancellations.groupby("Country")["Revenue"].sum()).rename("CancelledValue")
    g = g.join(lost).fillna({"CancelledValue": 0})
    return g.sort_values("Revenue", ascending=False).round(4).reset_index()
