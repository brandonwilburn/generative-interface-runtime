# SampleStore API

A small merchant/ecommerce API used to demonstrate the BYOAPI flow.
All data is generated at startup; the same numbers appear on every run.

Base URL: `http://localhost:49200`

The same API is also documented in OpenAPI 3.0 format at
`GET /openapi.json` while the sample server is running.

## Authentication

The `/v1/account/me` endpoint requires a static demo key:

```
Authorization: Bearer demo-key-12345
```

Add it under ＋ Connect data → API keys as a named key (e.g.
`sample_demo`), then reference the key name when registering the
API source.

## Endpoints

All field names below are exactly the names you'll see in the
JSON response. Use these names (not invented aliases) in chart
keys, table columns, and where filters.

### GET /v1/products
List every product in the catalog with its current stock level.
**The list does NOT include `unitsSold` or `revenue`** — use
`/v1/products/best-sellers` for that.

**Response 200**
```json
{ "products": [
  { "id": "p_001", "name": "Smoked plate", "category": "mains", "price": 32.49, "inStock": 237 }
]}
```

### GET /v1/products/{id}
Returns one product (fields: `id`, `name`, `category`, `price`, `inStock`) plus `unitsSold` (int) and `revenue` (number) summed across all paid orders.

| Param | In   | Type   | Required | Description                |
|-------|------|--------|----------|----------------------------|
| id    | path | string | yes      | Product id, e.g. `p_001` |

**Response 200** — product + `unitsSold` + `revenue`.
**Response 404** — `{ "error": "not_found", "path": "..." }`.

### GET /v1/products/best-sellers?limit=10
Top-selling products, sorted by `unitsSold` desc. **Use this for "best sellers" charts** (the regular products list does not include sales data).

| Param | In    | Type | Required | Default | Description                |
|-------|-------|------|----------|---------|----------------------------|
| limit | query | int  | no       | 10      | Max products (≤ 20)        |

**Response 200** — `{ "total", "products": [{ id, name, category, price, unitsSold, revenue }] }`.

### GET /v1/orders?limit=20
Recent orders. Each Order has: `id`, `date` (YYYY-MM-DD), **`day` (Mon..Sun)**, `customerId`, `customerName`, `items`, `total`, `status`.

| Param  | In    | Type | Required | Default | Description                  |
|--------|-------|------|----------|---------|------------------------------|
| limit  | query | int  | no       | 20      | Max orders to return (≤ 100) |

**Response 200** — `{ "orders": [Order, ...] }`.

### GET /v1/orders/recent
The 20 most recent orders. Same shape as `/v1/orders`.

### GET /v1/customers/top?limit=10
Top customers by `lifetimeSpend`, sorted desc. Each Customer has: `id`, `name`, `email`, `segment`, `lifetimeSpend`, `orders`, `lastOrder`.

| Param | In    | Type | Required | Default | Description                |
|-------|-------|------|----------|---------|----------------------------|
| limit | query | int  | no       | 10      | Max customers (≤ 50)      |

**Response 200** — `{ "customers": [Customer, ...] }`.

### GET /v1/revenue/series?days=30
Daily revenue time series, oldest first. **Use this for line/area charts with `x: "date"` and `y: "revenue"`.**

| Param | In    | Type | Required | Default | Description                |
|-------|-------|------|----------|---------|----------------------------|
| days  | query | int  | no       | 30      | Window length (≤ 90)       |

**Response 200** — `{ "days": 30, "series": [{ "date", "day", "orders", "paidOrders", "revenue" }] }`.

### GET /v1/revenue/by-category
**Use this for "revenue share" pie charts** with `x: "category"` and `y: "revenue"`. Returns total revenue grouped by product category, sorted desc.

**Response 200** — `{ "total", "categories": [{ "category", "revenue", "units" }] }`.

### GET /v1/revenue/by-day
Total revenue aggregated by day-of-week (Mon..Sun), in calendar order.
**Use this for a single bar chart of revenue by weekday** across the full 30-day window.

**Response 200** — `{ "total", "days": [{ "day", "revenue", "orders" }] }`.

### GET /v1/inventory/low-stock?threshold=20
Products with `inStock` below the threshold, sorted by `inStock` asc.

| Param      | In    | Type | Required | Default | Description                  |
|------------|-------|------|----------|---------|------------------------------|
| threshold  | query | int  | no       | 20      | Return if `inStock < N`    |

**Response 200** — `{ "threshold", "count", "products": [{ id, name, category, inStock, threshold }] }`.

### GET /v1/account/me  *(auth required)*
Returns the authenticated account. Requires `Authorization: Bearer demo-key-12345`.

**Response 200** — `{ "id", "name", "role", "plan", "email", "createdAt" }`.
**Response 401** — `{ "error": "unauthorized" }`.

## Schemas

### Product
`{ id: string, name: string, category: "mains"|"sides"|"drinks"|"dessert"|"merch", price: number, inStock: int }`

### ProductWithStats (single-product + best-sellers)
`{ id, name, category, price, inStock, unitsSold: int, revenue: number }`

### Order
`{ id, date (YYYY-MM-DD), day: "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", customerId, customerName, items: [{ productId, name, price, qty }], total: number, status: "paid"|"refunded"|"pending" }`

### Customer
`{ id, name, email, segment: "vip"|"regular"|"new"|"lapsed", lifetimeSpend: number, orders: int, lastOrder (YYYY-MM-DD) }`

### RevenuePoint
`{ date (YYYY-MM-DD), day: "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", orders: int, paidOrders: int, revenue: number }`

### CategoryRow
`{ category: string, revenue: number, units: int }`

### DayOfWeekRow
`{ day: "Mon"|"Tue"|"Wed"|"Thu"|"Fri"|"Sat"|"Sun", revenue: number, orders: int }`

### Account
`{ id, name, role, plan, email, createdAt (ISO 8601) }`
