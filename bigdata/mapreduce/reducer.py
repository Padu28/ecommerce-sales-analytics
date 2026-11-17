#!/usr/bin/env python3
"""Hadoop Streaming reducer: sums revenue and line counts per key.

Input (sorted by key):  ``key<TAB>revenue<TAB>count``
Output:                 ``key<TAB>total_revenue<TAB>lines``

Also works as a combiner, because it reads and writes the same format.
"""

import sys


def main() -> None:
    current, revenue, lines = None, 0.0, 0
    for raw in sys.stdin:
        parts = raw.rstrip("\n").split("\t")
        if len(parts) < 2:
            continue
        key, value = parts[0], float(parts[1])
        n = int(parts[2]) if len(parts) > 2 else 1
        if current is not None and key != current:
            print(f"{current}\t{revenue:.2f}\t{lines}")
            revenue, lines = 0.0, 0
        current = key
        revenue += value
        lines += n
    if current is not None:
        print(f"{current}\t{revenue:.2f}\t{lines}")


if __name__ == "__main__":
    main()
