# Changelog

Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [SemVer](https://semver.org/).

## [2.0.0] - 2026-11-17

### Added
* `basketlens` Python package and CLI (`basketlens run | download | sample`).
* Data-quality audit: every cleaning rule with rows removed and remaining.
* Guest checkouts kept for revenue views, excluded from customer analytics.
* Six-segment RFM with average order value, purchase interval, active probability, 12-month CLV, churn flag and a recommended action per customer.
* Monthly acquisition cohorts (customer retention and revenue).
* Product ABC classification and return rates.
* Market-basket association rules (support, confidence, lift).
* Weekday-aware anomaly detection for spikes and drops.
* 30-day baseline revenue forecast with an 80% band.
* Weekday × hour ordering pattern.
* Interactive web dashboard (works offline and on GitHub Pages):
  * revenue pulse timeline: drag to choose any period, with anomaly pins and forecast
  * KPIs with change against the previous period and sparklines
  * automatically written "What changed" insights
  * products with Pareto chart, ABC filter and product profiles
  * force-directed basket map with product recommendations and a rules explorer
  * customer segments, RFM scatter, cohort heatmap and customer profiles with copyable account summaries
  * markets with growth, home vs international split and order value by country
  * data pipeline funnel, cancellations, most-returned products and unusual-day log
  * command palette (Ctrl K), CSV exports, PDF executive report, shareable URLs, light and dark themes, keyboard shortcuts, responsive layout
* Big-data layer rebuilt: Hive raw/clean/mart warehouse with partitioned Parquet and RFM and basket views; Hadoop Streaming with selectable keys, combiner and local mode; PySpark ETL with window-function RFM and MLlib FP-Growth; idempotent MongoDB loader with indexes and example aggregations; query-first Cassandra schema with concurrent loader; Docker Compose for MongoDB and Cassandra.
* Synthetic, privacy-safe sample dataset and generator.
* Power BI measures, theme and page guide.
* Tests, linting, GitHub Actions CI and GitHub Pages deployment.

### Changed
* Output CSV names kept from v1 (`clean_sales.csv`, `customer_rfm_segments.csv`, `monthly_sales.csv`, `country_sales.csv`, `product_sales.csv`), now written to `data/processed/`.
* *Need Attention* split into *Need Attention* and *Hibernating*.

## [1.0.0]

* Python cleaning and RFM script, Hive queries, MapReduce job, PySpark ETL, MongoDB and Cassandra loaders and a Power BI build guide.
