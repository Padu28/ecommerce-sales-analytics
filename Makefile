.PHONY: help install sample download run test lint dashboard mapreduce clean

PY ?= python

help:        ## Show this help
	@grep -E '^[a-z]+:.*##' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*## "}; {printf "  %-11s %s\n", $$1, $$2}'

install:     ## Install the package with dev and notebook extras
	$(PY) -m pip install -e ".[dev,notebook]"

sample:      ## Regenerate the synthetic sample dataset
	$(PY) scripts/generate_sample_data.py

download:    ## Download the official UCI Online Retail dataset
	$(PY) -m pip install ucimlrepo && basketlens download

run:         ## Run the pipeline on the sample data
	basketlens run

test:        ## Run tests
	$(PY) -m pytest

lint:        ## Lint
	ruff check src tests scripts bigdata

dashboard:   ## Serve the dashboard at http://localhost:8000
	$(PY) -m http.server 8000 --bind 127.0.0.1 --directory dashboard

mapreduce:   ## Run the MapReduce job locally (no Hadoop needed)
	bash bigdata/mapreduce/run_streaming.sh --local country

clean:       ## Remove caches and build output
	rm -rf .pytest_cache .ruff_cache build dist src/*.egg-info warehouse
