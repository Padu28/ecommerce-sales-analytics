"""Product analytics: performance, ABC classification, returns and market baskets."""

from __future__ import annotations

from collections import Counter
from itertools import combinations

import pandas as pd


def product_performance(sales: pd.DataFrame, cancellations: pd.DataFrame) -> pd.DataFrame:
    """Revenue, units, orders, customers, price and return rate per product, with ABC class.

    ABC classification ranks products by revenue: **A** products make up the first
    80% of revenue, **B** the next 15%, **C** the remaining 5%.
    """
    g = sales.groupby("StockCode").agg(
        Description=("Description", lambda s: s.mode().iat[0]),
        Revenue=("Revenue", "sum"), Units=("Quantity", "sum"),
        Orders=("InvoiceNo", "nunique"), Customers=("CustomerID", "nunique"),
        AvgPrice=("UnitPrice", "mean"), FirstSold=("InvoiceDate", "min"),
        LastSold=("InvoiceDate", "max"),
    )
    returned = (-cancellations.groupby("StockCode")["Quantity"].sum()).rename("UnitsReturned")
    g = g.join(returned).fillna({"UnitsReturned": 0})
    g["ReturnRate"] = (g["UnitsReturned"] / (g["Units"] + g["UnitsReturned"])).round(4)
    g = g.sort_values("Revenue", ascending=False)
    share = g["Revenue"].cumsum() / g["Revenue"].sum()
    g["CumulativeShare"] = share.round(4)
    g["ABC"] = pd.cut(share, [-1, 0.80, 0.95, 1.01], labels=["A", "B", "C"]).astype(str)
    g["Rank"] = range(1, len(g) + 1)
    g["AvgPrice"] = g["AvgPrice"].round(2)
    g["Revenue"] = g["Revenue"].round(2)
    return g.reset_index()


def monthly_product_matrix(sales: pd.DataFrame, codes: list[str]) -> pd.DataFrame:
    months = sorted(sales["YearMonth"].unique())
    m = (sales[sales["StockCode"].isin(codes)]
         .pivot_table(index="StockCode", columns="YearMonth", values="Revenue", aggfunc="sum", fill_value=0))
    return m.reindex(index=codes, columns=months, fill_value=0)


def association_rules(sales: pd.DataFrame, top_n: int = 120, min_support: float = 0.004,
                      min_pair_count: int = 8, max_basket: int = 60) -> pd.DataFrame:
    """Pairwise market-basket rules ``A -> B`` over invoices.

    * **support** – share of invoices containing both A and B
    * **confidence** – share of invoices with A that also contain B
    * **lift** – confidence divided by B's overall frequency; above 1 means the
      pair is bought together more often than chance

    Only the ``top_n`` most frequent products are considered and very large
    baskets are skipped, which keeps this fast on the full 500k-line dataset.
    """
    baskets = sales.groupby("InvoiceNo")["StockCode"].agg(lambda s: frozenset(s))
    n = len(baskets)
    item_counts = Counter(i for b in baskets for i in b)
    top = {i for i, _ in item_counts.most_common(top_n)}
    pair_counts: Counter = Counter()
    for b in baskets:
        items = sorted(top.intersection(b))
        if 2 <= len(items) <= max_basket:
            pair_counts.update(combinations(items, 2))
    rows = []
    for (a, b), c in pair_counts.items():
        if c < min_pair_count or c / n < min_support:
            continue
        for x, y in ((a, b), (b, a)):
            conf = c / item_counts[x]
            lift = conf / (item_counts[y] / n)
            rows.append((x, y, c, c / n, conf, lift))
    rules = pd.DataFrame(rows, columns=["Antecedent", "Consequent", "Invoices", "Support",
                                        "Confidence", "Lift"])
    if rules.empty:
        return rules
    names = sales.groupby("StockCode")["Description"].agg(lambda s: s.mode().iat[0])
    rules.insert(1, "AntecedentName", rules["Antecedent"].map(names))
    rules.insert(3, "ConsequentName", rules["Consequent"].map(names))
    rules[["Support", "Confidence", "Lift"]] = rules[["Support", "Confidence", "Lift"]].round(4)
    return rules.sort_values(["Lift", "Invoices"], ascending=False).reset_index(drop=True)
