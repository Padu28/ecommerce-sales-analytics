"""BasketLens – e-commerce customer behaviour and sales analytics.

Quick start::

    from basketlens import load, run
    result = run(load("data/raw/online_retail_sample.csv"))
    result.kpis, result.customers.head(), result.rules.head()
"""

__version__ = "2.0.0"

from .data import clean, load, read_raw  # noqa: E402
from .pipeline import export, run, run_from_file  # noqa: E402

__all__ = ["read_raw", "clean", "load", "run", "export", "run_from_file", "__version__"]
