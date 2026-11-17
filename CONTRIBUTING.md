# Contributing

## Set up

```bash
git clone https://github.com/Padu28/ecommerce-sales-analytics.git
cd ecommerce-sales-analytics
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[dev,notebook]"
```

## Before a pull request

```bash
ruff check src tests scripts bigdata
pytest
basketlens run          # rebuild dashboard data if outputs changed
make dashboard          # check the UI at http://localhost:8000
```

Guidelines:
* Keep the core pipeline on pandas and numpy only; heavier tools belong in `bigdata/` or optional extras.
* The dashboard has no build step: plain HTML, CSS and JavaScript.
* Keep cleaning and segmentation rules identical across Python, Hive and Spark. Update all three, and `docs/methodology.md`, together.
* Never commit real customer data.
* Add a test for any change to cleaning, scoring, rules or detection, and update `CHANGELOG.md`.
