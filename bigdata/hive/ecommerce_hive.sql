-- =============================================================================
-- BasketLens: Hive data warehouse for online-retail transactions
--
-- Layers
--   raw     online_retail_raw   external table over the CSV landed in HDFS
--   clean   sales_fact          valid sales, Parquet, partitioned by year_month
--           returns_fact        cancellations / returns, Parquet
--   mart    views for KPIs, RFM segmentation, products, countries and baskets
--
-- Run:  hdfs dfs -mkdir -p /data/retail/raw
--       hdfs dfs -put data/raw/online_retail_full.csv /data/retail/raw/
--       beeline -u jdbc:hive2://localhost:10000 -f bigdata/hive/ecommerce_hive.sql
-- =============================================================================

CREATE DATABASE IF NOT EXISTS ecommerce_analytics
COMMENT 'Online retail customer behaviour and sales analytics';
USE ecommerce_analytics;

SET hive.exec.dynamic.partition = true;
SET hive.exec.dynamic.partition.mode = nonstrict;

-- ---------------------------------------------------------------- raw layer
CREATE EXTERNAL TABLE IF NOT EXISTS online_retail_raw (
  InvoiceNo   STRING,
  StockCode   STRING,
  Description STRING,
  Quantity    STRING,
  InvoiceDate STRING,
  UnitPrice   STRING,
  CustomerID  STRING,
  Country     STRING
)
ROW FORMAT SERDE 'org.apache.hadoop.hive.serde2.OpenCSVSerde'
WITH SERDEPROPERTIES ("separatorChar" = ",", "quoteChar" = "\"")
STORED AS TEXTFILE
LOCATION '/data/retail/raw'
TBLPROPERTIES ("skip.header.line.count" = "1");

-- -------------------------------------------------------------- clean layer
CREATE TABLE IF NOT EXISTS sales_fact (
  InvoiceNo   STRING,
  StockCode   STRING,
  Description STRING,
  Quantity    INT,
  InvoiceTs   TIMESTAMP,
  UnitPrice   DECIMAL(10,2),
  CustomerID  STRING,
  Country     STRING,
  Revenue     DECIMAL(12,2),
  OrderHour   INT,
  OrderDay    STRING
)
PARTITIONED BY (year_month STRING)
STORED AS PARQUET;

INSERT OVERWRITE TABLE sales_fact PARTITION (year_month)
SELECT TRIM(InvoiceNo),
       TRIM(StockCode),
       TRIM(Description),
       CAST(Quantity AS INT),
       CAST(InvoiceDate AS TIMESTAMP),
       CAST(UnitPrice AS DECIMAL(10,2)),
       NULLIF(REGEXP_REPLACE(TRIM(CustomerID), '\\.0$', ''), ''),
       TRIM(Country),
       CAST(CAST(Quantity AS INT) * CAST(UnitPrice AS DECIMAL(10,2)) AS DECIMAL(12,2)),
       HOUR(CAST(InvoiceDate AS TIMESTAMP)),
       DATE_FORMAT(CAST(InvoiceDate AS TIMESTAMP), 'EEEE'),
       DATE_FORMAT(CAST(InvoiceDate AS TIMESTAMP), 'yyyy-MM') AS year_month
FROM online_retail_raw
WHERE UPPER(InvoiceNo) NOT LIKE 'C%'
  AND CAST(Quantity AS INT) > 0
  AND CAST(UnitPrice AS DOUBLE) > 0
  AND CAST(InvoiceDate AS TIMESTAMP) IS NOT NULL;

CREATE TABLE IF NOT EXISTS returns_fact STORED AS PARQUET AS
SELECT TRIM(InvoiceNo) AS InvoiceNo, TRIM(StockCode) AS StockCode, TRIM(Description) AS Description,
       CAST(Quantity AS INT) AS Quantity, CAST(InvoiceDate AS TIMESTAMP) AS InvoiceTs,
       CAST(UnitPrice AS DECIMAL(10,2)) AS UnitPrice, TRIM(CustomerID) AS CustomerID,
       TRIM(Country) AS Country,
       CAST(-CAST(Quantity AS INT) * CAST(UnitPrice AS DECIMAL(10,2)) AS DECIMAL(12,2)) AS ValueReturned
FROM online_retail_raw
WHERE UPPER(InvoiceNo) LIKE 'C%' OR CAST(Quantity AS INT) < 0;

-- --------------------------------------------------------------- mart layer

-- Headline KPIs
CREATE OR REPLACE VIEW v_kpis AS
SELECT ROUND(SUM(Revenue), 2)                              AS revenue,
       COUNT(DISTINCT InvoiceNo)                           AS orders,
       COUNT(DISTINCT CustomerID)                          AS customers,
       ROUND(SUM(Revenue) / COUNT(DISTINCT InvoiceNo), 2)  AS avg_order_value,
       SUM(Quantity)                                       AS units
FROM sales_fact;

-- Monthly trend with month-on-month growth
CREATE OR REPLACE VIEW v_monthly AS
SELECT year_month,
       ROUND(SUM(Revenue), 2) AS revenue,
       COUNT(DISTINCT InvoiceNo) AS orders,
       COUNT(DISTINCT CustomerID) AS customers,
       ROUND(SUM(Revenue) / LAG(SUM(Revenue)) OVER (ORDER BY year_month) - 1, 4) AS mom_growth
FROM sales_fact
GROUP BY year_month;

-- Country performance
CREATE OR REPLACE VIEW v_country AS
SELECT Country,
       ROUND(SUM(Revenue), 2) AS revenue,
       COUNT(DISTINCT InvoiceNo) AS orders,
       COUNT(DISTINCT CustomerID) AS customers,
       ROUND(SUM(Revenue) / COUNT(DISTINCT InvoiceNo), 2) AS avg_order_value
FROM sales_fact
GROUP BY Country;

-- Product performance with return rate
CREATE OR REPLACE VIEW v_products AS
SELECT s.StockCode,
       MAX(s.Description) AS product,
       SUM(s.Quantity) AS units,
       ROUND(SUM(s.Revenue), 2) AS revenue,
       COUNT(DISTINCT s.InvoiceNo) AS orders,
       ROUND(COALESCE(MAX(r.units_returned), 0) / (SUM(s.Quantity) + COALESCE(MAX(r.units_returned), 0)), 4)
         AS return_rate
FROM sales_fact s
LEFT JOIN (SELECT StockCode, -SUM(Quantity) AS units_returned FROM returns_fact GROUP BY StockCode) r
  ON s.StockCode = r.StockCode
GROUP BY s.StockCode;

-- When do customers order? (orders by weekday and hour)
CREATE OR REPLACE VIEW v_weekday_hour AS
SELECT OrderDay, OrderHour, COUNT(DISTINCT InvoiceNo) AS orders, ROUND(SUM(Revenue), 2) AS revenue
FROM sales_fact
GROUP BY OrderDay, OrderHour;

-- RFM scores and segments (same rules as the Python pipeline)
CREATE OR REPLACE VIEW v_customer_rfm AS
WITH base AS (
  SELECT CustomerID,
         DATEDIFF(DATE_ADD((SELECT MAX(InvoiceTs) FROM sales_fact), 1), MAX(InvoiceTs)) AS recency,
         COUNT(DISTINCT InvoiceNo) AS frequency,
         ROUND(SUM(Revenue), 2) AS monetary
  FROM sales_fact
  WHERE CustomerID IS NOT NULL
  GROUP BY CustomerID
), scored AS (
  SELECT *,
         6 - NTILE(5) OVER (ORDER BY recency)   AS r_score,
         NTILE(5) OVER (ORDER BY frequency)     AS f_score,
         NTILE(5) OVER (ORDER BY monetary)      AS m_score
  FROM base
)
SELECT *,
       CASE
         WHEN r_score >= 4 AND f_score >= 4 AND m_score >= 4 THEN 'Champions'
         WHEN r_score >= 3 AND f_score >= 3 THEN 'Loyal Customers'
         WHEN r_score <= 2 AND f_score >= 3 THEN 'At Risk'
         WHEN r_score >= 4 AND f_score <= 2 THEN 'New/Promising'
         WHEN r_score = 3  AND f_score <= 2 THEN 'Need Attention'
         ELSE 'Hibernating'
       END AS segment
FROM scored;

-- Market basket: product pairs bought on the same invoice, with lift
CREATE OR REPLACE VIEW v_basket_pairs AS
WITH lines AS (
  SELECT DISTINCT InvoiceNo, StockCode FROM sales_fact
), totals AS (
  SELECT COUNT(DISTINCT InvoiceNo) AS n FROM lines
), item AS (
  SELECT StockCode, COUNT(*) AS cnt FROM lines GROUP BY StockCode
), pairs AS (
  SELECT a.StockCode AS item_a, b.StockCode AS item_b, COUNT(*) AS together
  FROM lines a JOIN lines b ON a.InvoiceNo = b.InvoiceNo AND a.StockCode < b.StockCode
  GROUP BY a.StockCode, b.StockCode
  HAVING COUNT(*) >= 20
)
SELECT p.item_a, p.item_b, p.together,
       ROUND(p.together / t.n, 4) AS support,
       ROUND(p.together / ia.cnt, 4) AS confidence_a_to_b,
       ROUND((p.together / ia.cnt) / (ib.cnt / t.n), 2) AS lift
FROM pairs p
CROSS JOIN totals t
JOIN item ia ON p.item_a = ia.StockCode
JOIN item ib ON p.item_b = ib.StockCode;

-- ------------------------------------------------------------- ad-hoc queries
SELECT * FROM v_kpis;
SELECT * FROM v_monthly ORDER BY year_month;
SELECT * FROM v_country ORDER BY revenue DESC LIMIT 10;
SELECT * FROM v_products ORDER BY revenue DESC LIMIT 10;
SELECT segment, COUNT(*) AS customers, ROUND(SUM(monetary), 2) AS revenue
FROM v_customer_rfm GROUP BY segment ORDER BY revenue DESC;
SELECT * FROM v_basket_pairs ORDER BY lift DESC LIMIT 20;
