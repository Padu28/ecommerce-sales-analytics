"""Load cleaned sales and customer profiles into Cassandra with concurrent writes.

    docker compose -f bigdata/docker-compose.yml up -d cassandra
    docker exec -i basketlens-cassandra cqlsh < bigdata/cassandra/schema.cql
    basketlens run
    python bigdata/cassandra/load_cassandra.py --hosts 127.0.0.1
"""

from __future__ import annotations

import argparse
import os

import pandas as pd
from cassandra.cluster import Cluster
from cassandra.concurrent import execute_concurrent_with_args


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--hosts", default=os.getenv("CASSANDRA_HOSTS", "127.0.0.1"))
    ap.add_argument("--keyspace", default="ecommerce")
    ap.add_argument("--processed", default="data/processed")
    ap.add_argument("--concurrency", type=int, default=64)
    a = ap.parse_args()

    sales = pd.read_csv(f"{a.processed}/clean_sales.csv",
                        dtype={"InvoiceNo": str, "StockCode": str, "CustomerID": str})
    sales["InvoiceDate"] = pd.to_datetime(sales["InvoiceDate"])
    sales["SaleDate"] = sales["InvoiceDate"].dt.date
    rfm = pd.read_csv(f"{a.processed}/customer_rfm_segments.csv", dtype={"CustomerID": str})

    cluster = Cluster(a.hosts.split(","))
    session = cluster.connect(a.keyspace)

    known = sales.dropna(subset=["CustomerID"])
    q1 = session.prepare("""INSERT INTO customer_orders (customer_id, invoice_date, invoice_no, stock_code,
        description, quantity, unit_price, revenue, country) VALUES (?,?,?,?,?,?,?,?,?)""")
    execute_concurrent_with_args(session, q1, [
        (r.CustomerID, r.InvoiceDate.to_pydatetime(), r.InvoiceNo, r.StockCode, r.Description,
         int(r.Quantity), float(r.UnitPrice), float(r.Revenue), r.Country)
        for r in known.itertuples()], concurrency=a.concurrency)

    q2 = session.prepare("""INSERT INTO sales_by_day (country, sale_date, invoice_no, stock_code, quantity,
        revenue) VALUES (?,?,?,?,?,?)""")
    execute_concurrent_with_args(session, q2, [
        (r.Country, r.SaleDate, r.InvoiceNo, r.StockCode, int(r.Quantity), float(r.Revenue))
        for r in sales.itertuples()], concurrency=a.concurrency)

    daily = sales.groupby(["StockCode", "SaleDate"]).agg(units=("Quantity", "sum"),
                                                        revenue=("Revenue", "sum")).reset_index()
    q3 = session.prepare("INSERT INTO product_daily (stock_code, sale_date, units, revenue) VALUES (?,?,?,?)")
    execute_concurrent_with_args(session, q3, [
        (r.StockCode, r.SaleDate, int(r.units), float(r.revenue)) for r in daily.itertuples()],
        concurrency=a.concurrency)

    q4 = session.prepare("""INSERT INTO customer_profile (customer_id, country, recency, frequency, monetary,
        segment, clv_12m) VALUES (?,?,?,?,?,?,?)""")
    execute_concurrent_with_args(session, q4, [
        (r.CustomerID, r.Country, int(r.Recency), int(r.Frequency), float(r.Monetary), r.Segment,
         float(r.CLV_12m)) for r in rfm.itertuples()], concurrency=a.concurrency)

    print(f"Loaded {len(known):,} customer order lines, {len(sales):,} daily sales lines, "
          f"{len(daily):,} product-days and {len(rfm):,} customer profiles.")
    cluster.shutdown()


if __name__ == "__main__":
    main()
