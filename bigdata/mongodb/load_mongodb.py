"""Load cleaned orders and customer profiles into MongoDB.

Collections
  orders      one document per invoice with embedded line items
  customers   one document per customer: RFM scores, segment, CLV, favourite products

Loads are idempotent (upserts keyed on invoice / customer id) and batched, so
re-running after a pipeline refresh updates documents instead of duplicating them.

    docker compose -f bigdata/docker-compose.yml up -d mongodb
    basketlens run
    python bigdata/mongodb/load_mongodb.py --uri mongodb://localhost:27017
"""

from __future__ import annotations

import argparse
import os
import re

import pandas as pd
from pymongo import ASCENDING, DESCENDING, MongoClient, UpdateOne


def batched(ops: list, size: int = 1000):
    for i in range(0, len(ops), size):
        yield ops[i:i + size]


def load_orders(db, sales: pd.DataFrame) -> int:
    sales = sales.copy()
    sales["InvoiceDate"] = pd.to_datetime(sales["InvoiceDate"])
    ops = []
    for inv, g in sales.groupby("InvoiceNo", sort=False):
        first = g.iloc[0]
        doc = {
            "_id": str(inv),
            "invoice_date": first["InvoiceDate"].to_pydatetime(),
            "customer_id": None if pd.isna(first["CustomerID"]) else str(first["CustomerID"]),
            "country": first["Country"],
            "total": round(float(g["Revenue"].sum()), 2),
            "units": int(g["Quantity"].sum()),
            "items": [{"stock_code": r.StockCode, "description": r.Description,
                       "quantity": int(r.Quantity), "unit_price": float(r.UnitPrice),
                       "revenue": float(r.Revenue)} for r in g.itertuples()],
        }
        ops.append(UpdateOne({"_id": doc["_id"]}, {"$set": doc}, upsert=True))
    for chunk in batched(ops):
        db.orders.bulk_write(chunk, ordered=False)
    db.orders.create_index([("customer_id", ASCENDING), ("invoice_date", DESCENDING)])
    db.orders.create_index([("country", ASCENDING)])
    db.orders.create_index([("items.stock_code", ASCENDING)])
    return len(ops)


def snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z][a-z])", "_", name).replace("__", "_").lower()


def load_customers(db, rfm: pd.DataFrame) -> int:
    ops = []
    for r in rfm.to_dict("records"):
        cid = str(r.pop("CustomerID"))
        doc = {snake(k): (None if pd.isna(v) else v) for k, v in r.items()}
        ops.append(UpdateOne({"_id": cid}, {"$set": doc}, upsert=True))
    for chunk in batched(ops):
        db.customers.bulk_write(chunk, ordered=False)
    db.customers.create_index([("segment", ASCENDING), ("monetary", DESCENDING)])
    return len(ops)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--uri", default=os.getenv("MONGO_URI", "mongodb://localhost:27017"))
    ap.add_argument("--db", default=os.getenv("MONGO_DB", "ecommerce"))
    ap.add_argument("--processed", default="data/processed")
    a = ap.parse_args()

    sales = pd.read_csv(f"{a.processed}/clean_sales.csv",
                        dtype={"InvoiceNo": str, "StockCode": str, "CustomerID": str})
    rfm = pd.read_csv(f"{a.processed}/customer_rfm_segments.csv", dtype={"CustomerID": str})
    db = MongoClient(a.uri)[a.db]
    n_orders = load_orders(db, sales)
    n_cust = load_customers(db, rfm)
    print(f"Upserted {n_orders:,} orders and {n_cust:,} customer profiles into '{a.db}'.")


if __name__ == "__main__":
    main()
