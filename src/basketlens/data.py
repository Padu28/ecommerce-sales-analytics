"""Loading, validation and cleaning of raw online-retail transactions."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

REQUIRED = ["InvoiceNo", "StockCode", "Description", "Quantity", "InvoiceDate",
            "UnitPrice", "CustomerID", "Country"]


@dataclass
class QualityReport:
    """Row counts at each cleaning step, used for the data-quality funnel."""

    raw_rows: int = 0
    steps: list[dict] = field(default_factory=list)

    def add(self, rule: str, removed: int, remaining: int, detail: str = "") -> None:
        self.steps.append({"rule": rule, "removed": int(removed), "remaining": int(remaining),
                           "detail": detail})

    def to_frame(self) -> pd.DataFrame:
        return pd.DataFrame(self.steps)


@dataclass
class CleanResult:
    raw: pd.DataFrame            # typed raw lines, with flags
    sales: pd.DataFrame          # valid positive sales lines with a customer
    guest_sales: pd.DataFrame    # valid positive sales lines without a customer
    cancellations: pd.DataFrame  # cancellation / return lines
    quality: QualityReport


def read_raw(path: str | Path) -> pd.DataFrame:
    """Read the UCI Online Retail CSV (or the bundled sample) with safe dtypes."""
    p = Path(path)
    if p.suffix.lower() in (".xlsx", ".xls"):
        df = pd.read_excel(p, dtype={"InvoiceNo": str, "StockCode": str, "CustomerID": str})
    else:
        df = pd.read_csv(p, dtype={"InvoiceNo": "string", "StockCode": "string",
                                   "CustomerID": "string", "Description": "string",
                                   "Country": "string"})
    missing = [c for c in REQUIRED if c not in df.columns]
    if missing:
        raise ValueError(f"{p} is missing required columns: {missing}")
    return df[REQUIRED + [c for c in df.columns if c not in REQUIRED and c != "Revenue"]]


def clean(df: pd.DataFrame) -> CleanResult:
    """Type, flag and filter transactions, recording every rule in a quality report."""
    q = QualityReport(raw_rows=len(df))
    d = df.copy()
    d["InvoiceNo"] = d["InvoiceNo"].astype("string").str.strip()
    d["StockCode"] = d["StockCode"].astype("string").str.strip()
    d["Description"] = d["Description"].astype("string").str.strip()
    d["Country"] = d["Country"].astype("string").str.strip()
    d["CustomerID"] = (d["CustomerID"].astype("string").str.strip()
                       .str.replace(r"\.0$", "", regex=True).replace({"": pd.NA, "nan": pd.NA}))
    d["InvoiceDate"] = pd.to_datetime(d["InvoiceDate"], errors="coerce")
    d["Quantity"] = pd.to_numeric(d["Quantity"], errors="coerce")
    d["UnitPrice"] = pd.to_numeric(d["UnitPrice"], errors="coerce")
    d["Revenue"] = (d["Quantity"] * d["UnitPrice"]).round(2)
    d["IsCancellation"] = d["InvoiceNo"].str.upper().str.startswith("C", na=False)
    q.add("Raw transaction lines", 0, len(d))

    n = len(d)
    d = d.dropna(subset=["InvoiceNo", "StockCode", "InvoiceDate", "Quantity", "UnitPrice"])
    q.add("Unreadable or incomplete lines", n - len(d), len(d),
          "Missing invoice, product, date, quantity or price")

    # Fill blank descriptions from the most common description of the same product.
    common = (d.dropna(subset=["Description"]).groupby("StockCode")["Description"]
              .agg(lambda s: s.mode().iat[0] if not s.mode().empty else pd.NA))
    d["Description"] = d["Description"].fillna(d["StockCode"].map(common)).fillna("UNKNOWN ITEM")

    cancellations = d[d["IsCancellation"] | (d["Quantity"] < 0)].copy()
    n = len(d)
    d = d[~(d["IsCancellation"] | (d["Quantity"] < 0))]
    q.add("Cancellations and returns", n - len(d), len(d), "Kept separately for returns analysis")

    n = len(d)
    d = d[(d["Quantity"] > 0) & (d["UnitPrice"] > 0)]
    q.add("Zero quantity or price", n - len(d), len(d), "Free samples, adjustments, test lines")

    guests = d[d["CustomerID"].isna()].copy()
    n = len(d)
    d = d[d["CustomerID"].notna()].copy()
    q.add("No customer ID (guest checkout)", n - len(d), len(d),
          "Counted in revenue views, excluded from customer analytics")

    for frame in (d, guests):
        frame["YearMonth"] = frame["InvoiceDate"].dt.to_period("M").astype(str)
        frame["OrderDay"] = frame["InvoiceDate"].dt.day_name()
        frame["OrderHour"] = frame["InvoiceDate"].dt.hour
    return CleanResult(raw=df, sales=d.reset_index(drop=True), guest_sales=guests.reset_index(drop=True),
                       cancellations=cancellations.reset_index(drop=True), quality=q)


def load(path: str | Path) -> CleanResult:
    return clean(read_raw(path))
