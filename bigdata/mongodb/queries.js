// BasketLens: example MongoDB aggregations (run in mongosh: `load("bigdata/mongodb/queries.js")`)
db = db.getSiblingDB("ecommerce");

// Revenue by month
printjson(db.orders.aggregate([
  { $group: { _id: { $dateToString: { format: "%Y-%m", date: "$invoice_date" } },
              revenue: { $sum: "$total" }, orders: { $sum: 1 } } },
  { $sort: { _id: 1 } }
]).toArray());

// Top 10 products by revenue (unwinding embedded line items)
printjson(db.orders.aggregate([
  { $unwind: "$items" },
  { $group: { _id: "$items.stock_code", product: { $first: "$items.description" },
              revenue: { $sum: "$items.revenue" }, units: { $sum: "$items.quantity" } } },
  { $sort: { revenue: -1 } }, { $limit: 10 }
]).toArray());

// Customers at risk with the highest spend: who should the account team call first?
printjson(db.customers.find(
  { segment: "At Risk" },
  { _id: 1, country: 1, recency: 1, frequency: 1, monetary: 1, clv_12m: 1 }
).sort({ monetary: -1 }).limit(10).toArray());

// A single customer's last five orders
printjson(db.orders.find({ customer_id: "17841" }).sort({ invoice_date: -1 }).limit(5).toArray());
