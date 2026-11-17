# Big-data layer

The pandas pipeline (`basketlens run`) handles the full 541,909-line UCI dataset in seconds on a laptop. This folder shows the same logic at cluster scale and how the results are served from operational stores.

| Folder | Technology | What it does |
| --- | --- | --- |
| `mapreduce/` | Hadoop Streaming | Revenue and line counts by country, month, product or hour, with a combiner |
| `hive/` | Apache Hive | Raw → clean → mart warehouse: partitioned Parquet facts, KPI, RFM and basket-pair views |
| `spark/` | PySpark + MLlib | Distributed ETL, partitioned Parquet, RFM with window functions, FP-Growth basket rules |
| `mongodb/` | MongoDB | Invoice documents with embedded lines, customer profiles, indexes, example aggregations |
| `cassandra/` | Apache Cassandra | Query-first tables: orders by customer, sales by day, product daily demand, CRM profile |
| `docker-compose.yml` | Docker | Local MongoDB and Cassandra for the loaders |

All layers use the same cleaning rules and the same six RFM segments as the Python package, so numbers agree across tools.

## MapReduce

Try it locally without Hadoop (Unix `sort` stands in for the shuffle):

```bash
./bigdata/mapreduce/run_streaming.sh --local country
./bigdata/mapreduce/run_streaming.sh --local month
```

On a cluster:

```bash
hdfs dfs -mkdir -p /data/retail/raw
hdfs dfs -put data/raw/online_retail_full.csv /data/retail/raw/online_retail.csv
./bigdata/mapreduce/run_streaming.sh country /data/retail/raw/online_retail.csv
```

## Hive

```bash
hdfs dfs -put data/raw/online_retail_full.csv /data/retail/raw/
beeline -u jdbc:hive2://localhost:10000 -f bigdata/hive/ecommerce_hive.sql
```

## Spark

```bash
pip install pyspark
spark-submit bigdata/spark/retail_etl.py --input data/raw/online_retail_full.csv --output warehouse
```

Outputs: `warehouse/sales_fact/` (Parquet partitioned by `year_month`), `warehouse/returns_fact/` and CSV marts in `warehouse/marts/`.

## MongoDB and Cassandra

```bash
pip install pymongo cassandra-driver
docker compose -f bigdata/docker-compose.yml up -d
basketlens run                                           # creates data/processed/*.csv

python bigdata/mongodb/load_mongodb.py
docker exec -i basketlens-cassandra cqlsh < bigdata/cassandra/schema.cql
python bigdata/cassandra/load_cassandra.py
```

Connection settings can also come from environment variables: `MONGO_URI`, `MONGO_DB`, `CASSANDRA_HOSTS`.
