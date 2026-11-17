"""Customer analytics: RFM segmentation, lifetime value, churn and cohorts."""

from __future__ import annotations

import numpy as np
import pandas as pd

SEGMENTS = ["Champions", "Loyal Customers", "New/Promising", "Need Attention", "At Risk", "Hibernating"]

ACTIONS = {
    "Champions": "Reward and retain: early access, account manager, referral programme.",
    "Loyal Customers": "Upsell premium lines and bundles; invite to a loyalty tier.",
    "New/Promising": "Nurture: welcome series and a second-order incentive within 30 days.",
    "Need Attention": "Re-engage with personalised offers based on past baskets.",
    "At Risk": "Win back now: personal outreach and a time-limited offer.",
    "Hibernating": "Low-cost reactivation campaigns only.",
}

CHURN_DAYS = 90


def rfm(sales: pd.DataFrame, snapshot: pd.Timestamp | None = None) -> pd.DataFrame:
    """Recency (days), Frequency (distinct invoices) and Monetary (revenue) per customer,
    scored into quintiles and labelled with a segment.

    Rules (evaluated in order)::

        Champions        R >= 4, F >= 4, M >= 4
        Loyal Customers  R >= 3, F >= 3
        At Risk          R <= 2, F >= 3
        New/Promising    R >= 4, F <= 2
        Need Attention   R == 3, F <= 2
        Hibernating      R <= 2, F <= 2

    This keeps the five segments of the original project and splits out
    *Hibernating* customers, who the original grouped under *Need Attention*.
    Every (R, F) combination maps to exactly one segment.
    """
    if snapshot is None:
        snapshot = sales["InvoiceDate"].max() + pd.Timedelta(days=1)
    g = sales.groupby("CustomerID").agg(
        Country=("Country", "first"),
        FirstPurchase=("InvoiceDate", "min"),
        LastPurchase=("InvoiceDate", "max"),
        Frequency=("InvoiceNo", "nunique"),
        Monetary=("Revenue", "sum"),
        Units=("Quantity", "sum"),
        Products=("StockCode", "nunique"),
    ).reset_index()
    g["Recency"] = (snapshot - g["LastPurchase"]).dt.days
    g["TenureDays"] = (snapshot - g["FirstPurchase"]).dt.days

    def score(s: pd.Series, reverse: bool = False) -> pd.Series:
        if len(s) < 5:
            r = s.rank(pct=True)
            out = np.ceil(r * 5).clip(1, 5).astype(int)
        else:
            out = pd.qcut(s.rank(method="first"), 5, labels=[1, 2, 3, 4, 5]).astype(int)
        return 6 - out if reverse else out

    g["R_Score"] = score(g["Recency"], reverse=True)
    g["F_Score"] = score(g["Frequency"])
    g["M_Score"] = score(g["Monetary"])
    g["RFM_Score"] = g["R_Score"].astype(str) + g["F_Score"].astype(str) + g["M_Score"].astype(str)
    g["Segment"] = np.select(
        [(g.R_Score >= 4) & (g.F_Score >= 4) & (g.M_Score >= 4),
         (g.R_Score >= 3) & (g.F_Score >= 3),
         (g.R_Score <= 2) & (g.F_Score >= 3),
         (g.R_Score >= 4) & (g.F_Score <= 2),
         (g.R_Score == 3) & (g.F_Score <= 2)],
        ["Champions", "Loyal Customers", "At Risk", "New/Promising", "Need Attention"],
        default="Hibernating")
    return g


def add_value(cust: pd.DataFrame, horizon_days: int = 365) -> pd.DataFrame:
    """Add average order value, purchase rate, churn flag and a 12-month CLV estimate.

    CLV = AOV × expected orders in the horizon × probability the customer is active.
    The purchase rate is orders per active day; activity decays with the time since
    the last order relative to the customer's own buying interval.
    """
    c = cust.copy()
    c["AOV"] = (c["Monetary"] / c["Frequency"]).round(2)
    span = (c["LastPurchase"] - c["FirstPurchase"]).dt.days.clip(lower=1)
    interval = (span / (c["Frequency"] - 1).clip(lower=1)).where(c["Frequency"] > 1)
    interval = interval.fillna(interval.median() if interval.notna().any() else 60).clip(lower=7)
    c["AvgDaysBetweenOrders"] = interval.round(1)
    c["ActiveProbability"] = np.exp(-np.maximum(c["Recency"] - interval, 0) / (2 * interval)).round(3)
    c["ExpectedOrders12m"] = (horizon_days / interval).clip(upper=52).round(2)
    c["CLV_12m"] = (c["AOV"] * c["ExpectedOrders12m"] * c["ActiveProbability"]).round(2)
    c["Churned"] = c["Recency"] > CHURN_DAYS
    c["Action"] = c["Segment"].map(ACTIONS)
    return c


def segment_summary(cust: pd.DataFrame) -> pd.DataFrame:
    g = cust.groupby("Segment").agg(
        Customers=("CustomerID", "size"), Revenue=("Monetary", "sum"),
        AvgRecency=("Recency", "mean"), AvgFrequency=("Frequency", "mean"),
        AvgMonetary=("Monetary", "mean"), CLV_12m=("CLV_12m", "sum"),
    )
    g["CustomerShare"] = g["Customers"] / g["Customers"].sum()
    g["RevenueShare"] = g["Revenue"] / g["Revenue"].sum()
    g = g.reindex([s for s in SEGMENTS if s in g.index])
    g["Action"] = [ACTIONS[s] for s in g.index]
    return g.round(4).reset_index()


def cohorts(sales: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Monthly acquisition cohorts: customer retention and revenue per cohort month.

    Returns ``(retention, revenue)``; retention cells are the share of the cohort
    buying in month *k*, revenue cells the cohort's revenue in month *k*.
    Unobservable future cells are ``NaN``.
    """
    s = sales[["CustomerID", "InvoiceDate", "Revenue"]].copy()
    s["Month"] = s["InvoiceDate"].dt.to_period("M")
    first = s.groupby("CustomerID")["Month"].min().rename("Cohort")
    s = s.join(first, on="CustomerID")
    s["Age"] = (s["Month"] - s["Cohort"]).apply(lambda x: x.n)
    active = s.groupby(["Cohort", "Age"])["CustomerID"].nunique().unstack()
    revenue = s.groupby(["Cohort", "Age"])["Revenue"].sum().unstack()
    size = active[0]
    retention = active.div(size, axis=0)
    last = s["Month"].max()
    for coh in retention.index:
        mask = retention.columns > (last - coh).n
        retention.loc[coh, mask] = np.nan
        revenue.loc[coh, mask] = np.nan
    retention = retention.round(4)
    retention.insert(0, "Customers", size.astype(int))
    retention.index = retention.index.astype(str)
    revenue.index = revenue.index.astype(str)
    return retention, revenue.round(2)
