#!/usr/bin/env bash
# Run the revenue aggregation on Hadoop with Hadoop Streaming.
#
#   ./run_streaming.sh [country|month|product|hour] [hdfs_input] [hdfs_output]
#
# Local dry run without Hadoop (same logic, Unix sort as the shuffle):
#   ./run_streaming.sh --local country ../../data/raw/online_retail_sample.csv
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--local" ]]; then
  KEY="${2:-country}"
  INPUT="${3:-../../data/raw/online_retail_sample.csv}"
  python3 mapper.py "$KEY" < "$INPUT" 2>/dev/null | LC_ALL=C sort -t$'\t' -k1,1 | python3 reducer.py \
    | sort -t$'\t' -k2,2 -g -r
  exit 0
fi

KEY="${1:-country}"
INPUT="${2:-/data/retail/raw/online_retail.csv}"
OUTPUT="${3:-/data/retail/output/revenue_by_${KEY}}"
STREAMING_JAR=$(ls "$HADOOP_HOME"/share/hadoop/tools/lib/hadoop-streaming-*.jar | head -n1)

hdfs dfs -rm -r -f "$OUTPUT"
hadoop jar "$STREAMING_JAR" \
  -D mapreduce.job.name="basketlens-revenue-by-${KEY}" \
  -D mapreduce.job.reduces=4 \
  -files mapper.py,reducer.py \
  -mapper "python3 mapper.py ${KEY}" \
  -combiner "python3 reducer.py" \
  -reducer "python3 reducer.py" \
  -input "$INPUT" \
  -output "$OUTPUT"

hdfs dfs -cat "$OUTPUT"/part-* | sort -t$'\t' -k2,2 -g -r | head -20
