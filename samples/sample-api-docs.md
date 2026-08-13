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

### GET /v1/products
List every product in the catalog with its current stock level.

**Response 200**
```json
{ "products": [{ "id": "p_001", "name": "Smoked plate", "category": "mains", "price": 32.49, "inStock": 237 }] }
```

### GET /v1/products/{id}
Returns one product plus its total units sold and revenue across
all paid orders.

| Param | In   | Type   | Required | Description                |
|-------|------|--------|----------|----------------------------|
| id    | path | string | yes      | Product id, e.g. `p_001` |

**Response 200** — product + `unitsSold` (int) + `revenue` (number).
**Response 404** — `{ "error": "not_found", "path": "..." }`.

### GET /v1/orders
Recent orders.

| Param  | In    | Type | Required | Default | Description                  |
|--------|-------|------|----------|---------|------------------------------|
| limit  | query | int  | no       | 20      | Max orders to return (≤ 100) |

**Response 200** — `{ "orders": [Order, ...] }`.

### GET /v1/orders/recent
The 20 most recent orders. Same shape as `/v1/orders`.

### GET /v1/customers/top
Top customers by lifetime spend, sorted descending.

| Param | In    | Type | Required | Default | Description                |
|-------|-------|------|----------|---------|----------------------------|
| limit | query | int  | no       | 10      | Max customers (≤ 50)      |

**Response 200** — `{ "customers": [Customer, ...] }`.

### GET /v1/revenue/series
Daily revenue series. Returns one entry per day for the requested
window, oldest first.

| Param | In    | Type | Required | Default | Description                |
|-------|-------|------|----------|---------|----------------------------|
| days  | query | int  | no       | 30      | Window length (≤ 90)       |

**Response 200** — `{ "days": 30, "series": [{ "date", "orders", "paidOrders", "revenue" }] }`.

### GET /v1/inventory/low-stock
Products whose `inStock` is below the given threshold.

| Param      | In    | Type | Required | Default | Description                  |
|------------|-------|------|----------|---------|------------------------------|
| threshold  | query | int  | no       | 20      | Return if `inStock < N`    |

**Response 200** — `{ "threshold", "count", "products": [...] }`.

### GET /v1/account/me  *(auth required)*
Returns the authenticated account. Requires `Authorization: Bearer demo-key-12345`.

**Response 200** — `{ "id", "name", "role", "plan", "email", "createdAt" }`.
**Response 401** — `{ "error": "unauthorized" }`.

## Schemas

### Product
`{ id: string, name: string, category: "mains"|"sides"|"drinks"|"dessert"|"merch", price: number, inStock: int }`

### Order
`{ id, date (YYYY-MM-DD), customerId, customerName, items: [{ productId, name, price, qty }], total: number, status: "paid"|"refunded"|"pending" }`

### Customer
`{ id, name, email, segment: "vip"|"regular"|"new"|"lapsed", lifetimeSpend: number, orders: int, lastOrder (YYYY-MM-DD) }`

### RevenuePoint
`{ date, orders: int, paidOrders: int, revenue: number }`

### Account
`{ id, name, role, plan, email, createdAt (ISO 8601) }`
