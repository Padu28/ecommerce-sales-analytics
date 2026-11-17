-- BasketLens: Cassandra schema, modelled around the queries the business runs.
-- Apply with: cqlsh -f bigdata/cassandra/schema.cql

CREATE KEYSPACE IF NOT EXISTS ecommerce
WITH replication = {'class': 'SimpleStrategy', 'replication_factor': 1};

USE ecommerce;

-- Q1: "Show this customer's order lines, newest first" (customer service view)
CREATE TABLE IF NOT EXISTS customer_orders (
  customer_id  text,
  invoice_date timestamp,
  invoice_no   text,
  stock_code   text,
  description  text,
  quantity     int,
  unit_price   double,
  revenue      double,
  country      text,
  PRIMARY KEY ((customer_id), invoice_date, invoice_no, stock_code)
) WITH CLUSTERING ORDER BY (invoice_date DESC, invoice_no ASC, stock_code ASC);

-- Q2: "What sold on a given day in a given country?" (daily operations view)
CREATE TABLE IF NOT EXISTS sales_by_day (
  country     text,
  sale_date   date,
  invoice_no  text,
  stock_code  text,
  quantity    int,
  revenue     double,
  PRIMARY KEY ((country, sale_date), invoice_no, stock_code)
);

-- Q3: "Daily units and revenue for a product" (demand planning view)
CREATE TABLE IF NOT EXISTS product_daily (
  stock_code  text,
  sale_date   date,
  units       int,
  revenue     double,
  PRIMARY KEY ((stock_code), sale_date)
) WITH CLUSTERING ORDER BY (sale_date DESC);

-- Q4: "Customer profile with segment" (CRM lookup)
CREATE TABLE IF NOT EXISTS customer_profile (
  customer_id text PRIMARY KEY,
  country     text,
  recency     int,
  frequency   int,
  monetary    double,
  segment     text,
  clv_12m     double
);
