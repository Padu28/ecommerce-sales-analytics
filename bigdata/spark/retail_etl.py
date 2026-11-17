"""BasketLens distributed ETL and analytics with PySpark.

Cleans raw transactions, writes a partitioned Parquet warehouse and computes the
same marts as the pandas pipeline at cluster scale, including RFM segmentation
with window functions and market-basket rules with MLlib FP-Growth.

    spark-submit bigdata/spark/retail_etl.py \
        --input data/raw/online_retail_full.csv --output warehouse

Local run (no cluster):  pip install pyspark && python bigdata/spark/retail_etl.py
"""

from __future__ import annotations

import argparse

from pyspark.ml.fpm import FPGrowth
from pyspark.sql import DataFrame, SparkSession, Window
from pyspark.sql import functions as F
from pyspark.sql import types as T

SCHEMA = T.StructType([
    T.StructField("InvoiceNo", T.StringType()),
    T.StructField("StockCode", T.StringType()),
    T.StructField("Description", T.StringType()),
    T.StructField("Quantity", T.IntegerType()),
    T.StructField("InvoiceDate", T.StringType()),
    T.StructField("UnitPrice", T.DoubleType()),
    T.StructField("CustomerID", T.StringType()),
    T.StructField("Country", T.StringType()),
])


def load(spark: SparkSession, path: str) -> DataFrame:
    df = (spark.read.option("header", True).option("quote", '"').option("escape", '"')
          .schema(SCHEMA).csv(path))
    return (df
            .withColumn("InvoiceNo", F.trim("InvoiceNo"))
            .withColumn("CustomerID", F.regexp_replace(F.trim("CustomerID"), r"\.0$", ""))
            .withColumn("InvoiceTs", F.to_timestamp("InvoiceDate"))
            .withColumn("Revenue", F.round(F.col("Quantity") * F.col("UnitPrice"), 2))
            .withColumn("IsCancellation", F.upper("InvoiceNo").startswith("C")))


def clean(df: DataFrame) -> tuple[DataFrame, DataFrame]:
    valid = df.filter(F.col("InvoiceTs").isNotNull() & F.col("Quantity").isNotNull()
                      & F.col("UnitPrice").isNotNull())
    returns = valid.filter(F.col("IsCancellation") | (F.col("Quantity") < 0))
    sales = (valid.filter(~F.col("IsCancellation") & (F.col("Quantity") > 0) & (F.col("UnitPrice") > 0))
             .withColumn("year_month", F.date_format("InvoiceTs", "yyyy-MM"))
             .withColumn("OrderHour", F.hour("InvoiceTs"))
             .withColumn("OrderDay", F.date_format("InvoiceTs", "EEEE")))
    return sales, returns


def rfm(sales: DataFrame) -> DataFrame:
    customers = sales.filter(F.col("CustomerID").isNotNull() & (F.col("CustomerID") != ""))
    snapshot = customers.agg(F.date_add(F.max(F.to_date("InvoiceTs")), 1).alias("s")).first()["s"]
    base = customers.groupBy("CustomerID").agg(
        F.datediff(F.lit(snapshot), F.max(F.to_date("InvoiceTs"))).alias("Recency"),
        F.countDistinct("InvoiceNo").alias("Frequency"),
        F.round(F.sum("Revenue"), 2).alias("Monetary"),
        F.first("Country").alias("Country"))
    scored = (base
              .withColumn("R_Score", 6 - F.ntile(5).over(Window.orderBy("Recency")))
              .withColumn("F_Score", F.ntile(5).over(Window.orderBy("Frequency")))
              .withColumn("M_Score", F.ntile(5).over(Window.orderBy("Monetary"))))
    r, f, m = F.col("R_Score"), F.col("F_Score"), F.col("M_Score")
    return scored.withColumn(
        "Segment",
        F.when((r >= 4) & (f >= 4) & (m >= 4), "Champions")
         .when((r >= 3) & (f >= 3), "Loyal Customers")
         .when((r <= 2) & (f >= 3), "At Risk")
         .when((r >= 4) & (f <= 2), "New/Promising")
         .when((r == 3) & (f <= 2), "Need Attention")
         .otherwise("Hibernating"))


def basket_rules(sales: DataFrame, min_support: float, min_confidence: float) -> DataFrame:
    baskets = sales.groupBy("InvoiceNo").agg(F.collect_set("StockCode").alias("items"))
    model = FPGrowth(itemsCol="items", minSupport=min_support, minConfidence=min_confidence).fit(baskets)
    return (model.associationRules
            .withColumn("antecedent", F.concat_ws(",", "antecedent"))
            .withColumn("consequent", F.concat_ws(",", "consequent"))
            .orderBy(F.desc("lift")))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="data/raw/online_retail_sample.csv")
    ap.add_argument("--output", default="warehouse")
    ap.add_argument("--min-support", type=float, default=0.01)
    ap.add_argument("--min-confidence", type=float, default=0.3)
    a = ap.parse_args()

    spark = (SparkSession.builder.appName("BasketLensRetailETL")
             .config("spark.sql.session.timeZone", "UTC").getOrCreate())
    spark.sparkContext.setLogLevel("WARN")

    raw = load(spark, a.input)
    sales, returns = clean(raw)
    sales.cache()

    sales.write.mode("overwrite").partitionBy("year_month").parquet(f"{a.output}/sales_fact")
    returns.write.mode("overwrite").parquet(f"{a.output}/returns_fact")

    marts = {
        "monthly_sales": sales.groupBy("year_month").agg(
            F.round(F.sum("Revenue"), 2).alias("Revenue"),
            F.countDistinct("InvoiceNo").alias("Orders"),
            F.countDistinct("CustomerID").alias("Customers")).orderBy("year_month"),
        "country_sales": sales.groupBy("Country").agg(
            F.round(F.sum("Revenue"), 2).alias("Revenue"),
            F.countDistinct("InvoiceNo").alias("Orders")).orderBy(F.desc("Revenue")),
        "product_sales": sales.groupBy("StockCode").agg(
            F.max("Description").alias("Description"), F.sum("Quantity").alias("Units"),
            F.round(F.sum("Revenue"), 2).alias("Revenue")).orderBy(F.desc("Revenue")),
        "weekday_hour": sales.groupBy("OrderDay", "OrderHour").agg(
            F.countDistinct("InvoiceNo").alias("Orders")),
        "customer_rfm": rfm(sales),
        "basket_rules": basket_rules(sales, a.min_support, a.min_confidence),
    }
    for name, frame in marts.items():
        frame.coalesce(1).write.mode("overwrite").option("header", True).csv(f"{a.output}/marts/{name}")
        print(f"wrote {a.output}/marts/{name}")

    kpi = sales.agg(F.round(F.sum("Revenue"), 2).alias("revenue"),
                    F.countDistinct("InvoiceNo").alias("orders"),
                    F.countDistinct("CustomerID").alias("customers")).first()
    print(f"Revenue £{kpi['revenue']:,.2f} | orders {kpi['orders']:,} | customers {kpi['customers']:,}")
    spark.stop()


if __name__ == "__main__":
    main()
