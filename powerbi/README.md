# Power BI dashboard

The web dashboard in `dashboard/` needs no licence and runs anywhere. For organisations standardised on Microsoft, this folder lets you build the same report in Power BI Desktop and publish it to the Power BI Service.

| File | Purpose |
| --- | --- |
| `measures.dax` | All measures: the original KPIs plus cancellation rate, guest share, MoM growth, 7-day average, top-10% share, at-risk revenue, CLV and forecast |
| `basketlens_theme.json` | Colour theme matching the web dashboard (*View > Themes > Browse for themes*) |
| `ecommerce_dashboard.pbix` | Save your finished report here |

## 1. Prepare the data

```bash
basketlens run                                        # bundled sample
# or, with the full UCI dataset:
basketlens download
basketlens run --input data/raw/online_retail_full.csv
```

## 2. Load tables

*Get data > Text/CSV* from `data/processed/`:

| Table | Set types |
| --- | --- |
| `clean_sales.csv` | InvoiceDate: Date/Time, Revenue and UnitPrice: Decimal, Quantity: Whole number, CustomerID and InvoiceNo: Text |
| `customer_rfm_segments.csv` | Recency, Frequency: Whole number; Monetary, CLV_12m: Decimal; Churned: True/False |
| `cancellations.csv` | as `clean_sales` |
| `product_sales.csv`, `basket_rules.csv`, `daily_sales.csv`, `forecast.csv`, `anomalies.csv`, `cohort_retention.csv` | optional pages |

Relationships:
* `customer_rfm_segments[CustomerID]` 1 → * `clean_sales[CustomerID]`
* `'Date'[Date]` 1 → * `clean_sales[Order Date]` (create the `Date` table and `Order Date` column from the helper section of `measures.dax`)

Paste the measures from `measures.dax`, sort `Segment` by `Segment Order`, and apply the theme. Currency is GBP (£), as in the original dataset.

## 3. Pages

**Executive overview**
* KPI cards: Total Revenue, Total Orders, Total Customers, Average Order Value, Repeat Customer Rate, Cancellation Rate
* Line chart: `Order Date` by Total Revenue and Revenue 7d Avg; add `forecast` as a second series
* Matrix heatmap: Weekday × hour by Total Orders (conditional background colour)
* Bar chart: Country by Total Revenue (Top 10)

**Products**
* Bar: Description by Units Sold (Top 10) and by Total Revenue
* Table from `product_sales`: StockCode, Description, ABC, Revenue, ReturnRate (data bars)
* Pareto: Revenue column with CumulativeShare line (line and clustered column chart)

**Basket analysis**
* Table from `basket_rules` filtered to Lift ≥ 3: AntecedentName, ConsequentName, Support, Confidence, Lift
* Slicer: AntecedentName, so a merchandiser can pick a product and see what to cross-sell

**Customers**
* Donut: Segment by customer count
* Scatter: Frequency vs Monetary, bubble size Monetary, legend Segment
* Table: CustomerID, Recency, Frequency, Monetary, Segment, CLV_12m, Action
* Matrix: `cohort_retention` (unpivot month columns in Power Query)

**Markets**
* Map or filled map: Country by Total Revenue
* Card: International Revenue Share

**Data quality**
* Table from `data_quality.csv`; funnel chart of `remaining` by `rule`
* Column chart: month by Cancelled Value

Slicers on every page: Country, Order Date, Segment, StockCode.

## 4. Publish

*File > Publish > Publish to Power BI*, then schedule a refresh pointed at the folder or SharePoint library where the pipeline writes `data/processed/`. Use row-level security on `Country` for regional managers.
