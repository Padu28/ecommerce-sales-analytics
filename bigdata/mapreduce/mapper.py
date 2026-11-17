#!/usr/bin/env python3
"""Hadoop Streaming mapper for online-retail transactions.

Emits ``key<TAB>revenue<TAB>1`` for every valid sales line. The key is chosen
with the first argument (default ``country``):

    country   revenue by country
    month     revenue by year-month (YYYY-MM)
    product   revenue by StockCode|Description
    hour      revenue by hour of day

Valid line = not a cancellation (InvoiceNo starting with C), quantity > 0,
unit price > 0. Malformed rows are counted on stderr as Hadoop counters.
"""

import csv
import sys

KEYS = ("country", "month", "product", "hour")


def counter(name: str) -> None:
    sys.stderr.write(f"reporter:counter:BasketLens,{name},1\n")


def main() -> None:
    key_type = sys.argv[1] if len(sys.argv) > 1 else "country"
    if key_type not in KEYS:
        sys.exit(f"key must be one of {KEYS}")
    for row in csv.reader(sys.stdin):
        if len(row) < 8 or row[0] == "InvoiceNo":
            continue
        invoice, stock, desc, qty, ts, price, _customer, country = row[:8]
        try:
            q, p = float(qty), float(price)
        except ValueError:
            counter("malformed")
            continue
        if invoice.upper().startswith("C") or q <= 0 or p <= 0:
            counter("filtered")
            continue
        if key_type == "country":
            key = country
        elif key_type == "month":
            key = ts[:7]
        elif key_type == "hour":
            key = ts[11:13]
        else:
            key = f"{stock}|{desc}"
        print(f"{key}\t{q * p:.2f}\t1")


if __name__ == "__main__":
    main()
