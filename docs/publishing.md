# Publishing on GitHub

1. Create an empty public repository named `ecommerce-sales-analytics` at https://github.com/new (no README, licence or .gitignore). If you choose another name, replace `ecommerce-sales-analytics` in `README.md`, `pyproject.toml` and `CONTRIBUTING.md`.
2. **Turn on Pages first:** *Settings > Pages > Source: GitHub Actions*.
3. From the project folder:

   ```bash
   git init
   git config user.name "Padmashree Shah"
   git config user.email "Padmashreeshah@gmail.com"
   git add .
   git commit -m "BasketLens v2.0.0: e-commerce customer and sales analytics platform"
   git branch -M main
   git remote add origin https://github.com/Padu28/ecommerce-sales-analytics.git
   git push -u origin main
   ```

4. Check *Actions*: **CI** and **Deploy dashboard to GitHub Pages** should both turn green. The dashboard goes live at https://padu28.github.io/ecommerce-sales-analytics/
5. On the repository page, click the gear next to **About**: add a description, tick *Use your GitHub Pages website*, and add topics such as `ecommerce-analytics`, `customer-segmentation`, `market-basket-analysis`, `rfm-analysis`, `pyspark`, `hive`, `mongodb`, `cassandra`, `power-bi`, `data-visualization`.
6. Pin the repository on your profile and create a `v2.0.0` release from the changelog.
