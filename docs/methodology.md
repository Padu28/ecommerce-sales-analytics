# Methodology

## 1. Data and cleaning

Input is the UCI Online Retail schema: one row per invoice line.

| Column | Meaning |
| --- | --- |
| `InvoiceNo` | Invoice number; a leading `C` marks a cancellation |
| `StockCode` | Product code |
| `Description` | Product name |
| `Quantity` | Units on the line; negative for returns |
| `InvoiceDate` | Date and time of the invoice |
| `UnitPrice` | Price per unit in GBP |
| `CustomerID` | Customer number; blank for guest checkouts |
| `Country` | Customer's country |

Cleaning steps, each recorded in the data-quality report (`data/processed/data_quality.csv`, *Data and returns* page):

1. **Type and parse.** Trim text, strip a trailing `.0` from customer ids, parse dates and numbers. `Revenue = Quantity × UnitPrice`.
2. **Unreadable or incomplete lines** are removed (missing invoice, product, date, quantity or price).
3. **Blank descriptions** are filled with the most common description of the same stock code.
4. **Cancellations and returns** (`C` invoices or negative quantity) are moved to a separate table for returns analysis.
5. **Zero quantity or price** lines (free samples, manual adjustments) are removed.
6. **Guest checkouts** (no `CustomerID`) are kept for revenue, order, product and market figures but excluded from customer analytics.

## 2. KPIs

| KPI | Definition |
| --- | --- |
| Revenue | Sum of `Revenue` over valid sales lines, guests included |
| Orders | Distinct invoices |
| Active customers | Distinct customer ids |
| Average order value | Revenue ÷ orders |
| Repeat customer rate | Share of customers with more than one invoice |
| Cancelled value | Sum of `-Revenue` over cancellation lines |
| Cancellation rate | Cancelled value ÷ (revenue + cancelled value) |

In the dashboard every KPI is recalculated for the selected date range and country, and compared with the previous period of the same length.

## 3. Customer segmentation (RFM)

Per customer: **Recency** (days from last purchase to the day after the last date in the data), **Frequency** (distinct invoices), **Monetary** (revenue). Each is scored 1–5 by quintile, ranking ties in order so heavily repeated values (one order) don't collapse the bins. Recency is reversed.

| Segment | Rule |
| --- | --- |
| Champions | R ≥ 4, F ≥ 4, M ≥ 4 |
| Loyal Customers | R ≥ 3, F ≥ 3 |
| At Risk | R ≤ 2, F ≥ 3 |
| New/Promising | R ≥ 4, F ≤ 2 |
| Need Attention | R = 3, F ≤ 2 |
| Hibernating | R ≤ 2, F ≤ 2 |

The first five segments are those of the original project; *Hibernating* separates lapsed low-frequency customers from those who only need a nudge. Every (R, F) pair maps to exactly one segment. The same rules are implemented in Hive (`NTILE`) and PySpark (window functions).

**Customer value.** Average order value (AOV), the customer's average days between orders, and:

```
active probability = exp(-max(recency - interval, 0) / (2 × interval))
expected orders 12m = 365 / interval   (capped at 52)
CLV 12m            = AOV × expected orders × active probability
churned            = recency > 90 days
```

A transparent heuristic rather than a fitted BG/NBD model, chosen so the logic can be explained to a sales team. `lifetimes` or `pymc-marketing` can replace it without touching the rest of the pipeline.

**Cohorts.** Customers are grouped by the month of their first purchase; each cell is the share of the cohort that bought again *k* months later. Months that haven't happened yet are blank.

## 4. Products

* **ABC classification.** Products sorted by revenue; A = first 80% of cumulative revenue, B = next 15%, C = last 5%.
* **Return rate.** Units returned ÷ (units sold + units returned).

## 5. Market-basket analysis

Pairwise association rules `A → B` over invoices, restricted to the 120 most frequent products and baskets of at most 60 lines (keeps the full dataset fast):

```
support(A,B)    = invoices with A and B / all invoices
confidence(A→B) = invoices with A and B / invoices with A
lift(A→B)       = confidence(A→B) / (invoices with B / all invoices)
```

Rules need at least 8 shared invoices and 0.4% support. Lift above 1 means the products are bought together more than chance; the dashboard map shows the strongest 60 pairs. The Spark job runs MLlib FP-Growth for itemsets of any size, and Hive has an equivalent SQL view.

## 6. Anomaly detection

For each trading day, the expected revenue is the median of the same weekday over the previous 8 weeks, and the spread is the median absolute deviation (MAD) of those days, with a floor of 25% of the expected value. A robust z-score `0.6745 × (revenue − expected) / MAD` of 3.5 or more is a spike or a drop. Because revenue is right-skewed, a day below 25% of its expected level is also a drop. Weekdays the business doesn't normally trade (Saturdays) and the Christmas shutdown are ignored.

## 7. Forecast

A baseline, not a production model: weekday-adjusted revenue over the last 90 days is fitted with a straight line, projected 30 days ahead, and multiplied back by each weekday's average share. The 80% band is ±1.28 standard deviations of past residuals. Use Prophet, statsmodels ETS or LightGBM for planning-grade forecasts.

## 8. Sample data

`data/raw/online_retail_sample.csv` is generated by `scripts/generate_sample_data.py`. It reproduces the structure of the real dataset (UK-heavy customer base, Christmas peak, no Saturday trading, wholesale quantities, cancellations, guest checkouts, zero prices, blank descriptions) and plants realistic patterns (themed baskets, colour variants, bulk orders, a checkout outage) so every analysis has something to find. All figures in the screenshots come from this synthetic data; run the pipeline on the real dataset for real figures.
