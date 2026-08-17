import { DashboardSpec, type DashboardSpec as DashboardSpecType } from "@/dsl/schema";

const source = "user.northstar_commerce_analytics";

export function showcaseDashboard(): DashboardSpecType {
  return DashboardSpec.parse({
    type: "dashboard",
    title: "Northstar 2025",
    description: "Growth held. Mix did not.",
    generatedFor: "Prepare the Northstar annual performance brief for leadership",
    hero: {
      eyebrow: "2025 annual performance",
      body: "Revenue improved 3.6% in H2, but the year ended 0.5% below plan. The next constraint is product concentration—not demand.",
      variant: "cover",
      height: "standard",
      alignment: "left",
      foreground: "light",
      background: {
        type: "image",
        src: "/northstar-hero.svg",
        position: "center",
        overlay: "dark",
      },
    },
    datasets: {
      executiveTotals: {
        source,
        transform: {
          metrics: [
            { field: "revenue", operation: "sum", as: "revenue" },
            { field: "target_revenue", operation: "sum", as: "target" },
            { field: "profit", operation: "sum", as: "profit" },
            { field: "orders", operation: "sum", as: "orders" },
          ],
          limit: 1,
        },
      },
      monthlyMomentum: {
        source,
        transform: {
          dimensions: [{ field: "date", as: "month", timeBucket: "month" }],
          metrics: [
            { field: "revenue", operation: "sum", as: "revenue" },
            { field: "target_revenue", operation: "sum", as: "target" },
            { field: "orders", operation: "sum", as: "orders" },
          ],
          sort: [{ field: "month", direction: "asc" }],
          limit: 12,
        },
      },
      channelPerformance: {
        source,
        transform: {
          dimensions: [{ field: "channel" }],
          metrics: [
            { field: "revenue", operation: "sum", as: "revenue" },
            { field: "ad_spend", operation: "sum", as: "adSpend" },
            { field: "conversion_rate", operation: "average", as: "conversion" },
          ],
          sort: [{ field: "revenue", direction: "desc" }],
          limit: 10,
        },
      },
      dailyEfficiency: {
        source,
        transform: {
          dimensions: [{ field: "date" }],
          metrics: [
            { field: "ad_spend", operation: "sum", as: "adSpend" },
            { field: "revenue", operation: "sum", as: "revenue" },
          ],
          sort: [{ field: "date", direction: "asc" }],
          limit: 365,
        },
      },
      productPortfolio: {
        source,
        transform: {
          dimensions: [{ field: "product" }, { field: "category" }],
          metrics: [
            { field: "revenue", operation: "sum", as: "revenue" },
            { field: "profit", operation: "sum", as: "profit" },
            { field: "orders", operation: "sum", as: "orders" },
          ],
          sort: [{ field: "revenue", direction: "desc" }],
          limit: 12,
        },
      },
      categoryMix: {
        source,
        transform: {
          dimensions: [{ field: "category" }],
          metrics: [{ field: "revenue", operation: "sum", as: "revenue" }],
          sort: [{ field: "revenue", direction: "desc" }],
          limit: 8,
        },
      },
      weekdayDemand: {
        source,
        transform: {
          dimensions: [{ field: "weekday" }, { field: "weekday_index", as: "weekdayIndex" }],
          metrics: [
            { field: "orders", operation: "sum", as: "orders" },
            { field: "checkouts", operation: "sum", as: "checkouts" },
          ],
          sort: [{ field: "weekdayIndex", direction: "asc" }],
          limit: 7,
        },
      },
    },
    children: [
      {
        type: "section",
        columns: 12,
        children: [
          {
            type: "metricCard",
            label: "Net revenue",
            valueRef: { dataset: "executiveTotals", pick: "revenue" },
            format: "currency",
            emphasis: "primary",
            caption: "0.5% below full-year plan",
            layout: { columnSpan: 3 },
          },
          {
            type: "metricCard",
            label: "Revenue plan",
            valueRef: { dataset: "executiveTotals", pick: "target" },
            format: "currency",
            caption: "The benchmark for the year",
            layout: { columnSpan: 3 },
          },
          {
            type: "metricCard",
            label: "Contribution profit",
            valueRef: { dataset: "executiveTotals", pick: "profit" },
            format: "currency",
            caption: "49.1% of net revenue",
            layout: { columnSpan: 3 },
          },
          {
            type: "metricCard",
            label: "Completed orders",
            valueRef: { dataset: "executiveTotals", pick: "orders" },
            format: "number",
            caption: "Across every market and channel",
            layout: { columnSpan: 3 },
          },
        ],
      },
      {
        type: "section",
        title: "1 / Momentum",
        description: "The second half grew, but a stronger finish was still needed to make plan.",
        columns: 12,
        children: [
          {
            type: "chart",
            kind: "composed",
            title: "H2 grew while the plan gap widened",
            description: "Monthly actual revenue, target, and completed order volume.",
            caption: "H2 revenue was 3.6% above H1. Actual revenue nevertheless trailed target in every month from July through December.",
            data: { dataset: "monthlyMomentum" },
            xAxis: { key: "month", label: "Month", format: "shortDate" },
            yAxes: [
              { id: "money", label: "Revenue (USD)", side: "left", format: "currency" },
              { id: "volume", label: "Completed orders", side: "right", format: "compact" },
            ],
            series: [
              { key: "revenue", label: "Actual revenue", type: "bar", color: "chart.1", yAxisId: "money" },
              { key: "target", label: "Revenue plan", type: "line", color: "chart.4", yAxisId: "money", curve: "monotone", showDots: false },
              { key: "orders", label: "Orders", type: "area", color: "chart.2", yAxisId: "volume", curve: "monotone", fillOpacity: 0.1 },
            ],
            options: { showGrid: true, showLegend: true, showTooltip: true, legendPosition: "bottom" },
            height: 420,
            layout: { columnSpan: 8 },
          },
          {
            type: "text",
            title: "Read the shape, not just the total",
            as: "p",
            tone: "neutral",
            content:
              "Revenue peaked in May at $2.03M. The business carried more revenue in H2 than H1, but each of the final six months landed below plan.\n\nDecember recovered to $1.94M, yet the $52K monthly gap left the year 0.5% short overall. The priority is a repeatable close—not simply a larger top-of-funnel target.",
            layout: { columnSpan: 4, surface: "none", padding: "comfortable", verticalAlign: "center" },
          },
        ],
      },
      {
        type: "section",
        title: "2 / Acquisition quality",
        description: "Where efficient demand already exists—and where the evidence stops short of causation.",
        columns: 12,
        children: [
          {
            type: "text",
            title: "High-intent channels carry the economics",
            as: "p",
            tone: "neutral",
            content:
              "Organic, Direct, and Email generated $15.2M—68% of annual revenue—on only $40.5K of recorded media spend. Email converted at 10.6%, the strongest rate in the mix.\n\nProtect lifecycle and direct-demand programs first. Treat the spend relationship below as a diagnostic clue, not proof that additional paid media causes additional revenue.",
            layout: { columnSpan: 4, surface: "none", padding: "comfortable", verticalAlign: "center" },
          },
          {
            type: "chart",
            kind: "composed",
            title: "Revenue scale and conversion quality diverge",
            description: "Channel revenue is shown against average conversion rate on an independent axis.",
            caption: "Email has the highest conversion rate at 10.6%; Organic has the highest revenue at $5.43M.",
            data: { dataset: "channelPerformance" },
            xAxis: { key: "channel", label: "Acquisition channel" },
            yAxes: [
              { id: "money", label: "Revenue (USD)", side: "left", format: "currency" },
              { id: "rate", label: "Conversion rate", side: "right", format: "percent", domain: [0, "auto"] },
            ],
            series: [
              { key: "revenue", label: "Revenue", type: "bar", color: "chart.1", yAxisId: "money" },
              { key: "conversion", label: "Conversion rate", type: "line", color: "chart.5", yAxisId: "rate", showDots: true },
            ],
            options: { showGrid: true, showLegend: true, showTooltip: true, legendPosition: "bottom" },
            height: 370,
            layout: { columnSpan: 8 },
          },
          {
            type: "separator",
            spacing: "comfortable",
            layout: { columnSpan: 12 },
          },
          {
            type: "chart",
            kind: "scatter",
            title: "Daily media spend and revenue move together",
            description: "Each point is one day in 2025, aggregated from the cohort-level source table.",
            caption: "This view shows association only. Incrementality requires an experiment or a causal model before budget is reallocated.",
            data: { dataset: "dailyEfficiency" },
            xAxis: { key: "adSpend", type: "number", label: "Daily advertising spend (USD)", format: "currency" },
            yAxes: [{ id: "primary", label: "Daily revenue (USD)", format: "currency" }],
            series: [{ key: "revenue", label: "Daily revenue", color: "chart.2" }],
            options: { showGrid: true, showLegend: false, showTooltip: true },
            height: 330,
            layout: { columnSpan: 12 },
          },
        ],
      },
      {
        type: "section",
        title: "3 / Portfolio concentration",
        description: "The company has broad demand, but revenue risk is concentrated in a narrow product core.",
        columns: 12,
        children: [
          {
            type: "chart",
            kind: "treemap",
            title: "Two products account for 54% of revenue",
            description: "Tile area represents annual net revenue by product.",
            caption: "Orbit Pro and Signal Hub generated $12.1M combined. Both sit inside the Hardware category.",
            data: { dataset: "productPortfolio" },
            xAxis: { key: "product" },
            series: [{ key: "revenue", label: "Revenue", format: "currency", color: "chart.3", showLabels: true }],
            options: { showLegend: false, showTooltip: true },
            height: 370,
            layout: { columnSpan: 7 },
          },
          {
            type: "text",
            title: "The constraint is mix, not reach",
            as: "p",
            tone: "neutral",
            content:
              "Hardware contributes $15.4M, or 68.8% of company revenue. The top two products alone contribute 53.9%.\n\nThat concentration makes the plan sensitive to a small number of product cycles. The practical move is to increase subscription and add-on attach around the existing hardware base before chasing a new audience.",
            layout: { columnSpan: 5, surface: "none", padding: "comfortable", verticalAlign: "center" },
          },
          {
            type: "separator",
            spacing: "comfortable",
            layout: { columnSpan: 12 },
          },
          {
            type: "chart",
            kind: "donut",
            title: "Revenue mix remains hardware-led",
            description: "Annual revenue grouped into four product categories.",
            caption: "Subscriptions, add-ons, and services together account for only 31.2% of revenue.",
            data: { dataset: "categoryMix" },
            xAxis: { key: "category" },
            series: [{ key: "revenue", label: "Revenue", format: "currency", color: "chart.2", showLabels: true }],
            options: { showLegend: true, showTooltip: true, legendPosition: "bottom" },
            height: 360,
            layout: { columnSpan: 4 },
          },
          {
            type: "table",
            title: "Product operating scorecard",
            description: "Exact values behind the portfolio view, ordered by revenue.",
            data: { dataset: "productPortfolio" },
            columns: [
              { key: "product", label: "Product" },
              { key: "category", label: "Category" },
              { key: "orders", label: "Orders", format: "number", align: "right" },
              { key: "revenue", label: "Revenue", format: "currency", align: "right" },
              { key: "profit", label: "Profit", format: "currency", align: "right" },
            ],
            pageSize: 8,
            layout: { columnSpan: 8 },
          },
        ],
      },
      {
        type: "section",
        title: "4 / Operating rhythm",
        description: "Demand changes by day of week, which creates a concrete staffing decision.",
        columns: 12,
        children: [
          {
            type: "chart",
            kind: "bar",
            title: "Weekend order volume runs above the weekday baseline",
            description: "Completed orders and checkout attempts by day of week.",
            caption: "The average weekend day produced 12.4% more completed orders than the average weekday.",
            data: { dataset: "weekdayDemand" },
            xAxis: { key: "weekday", label: "Day of week" },
            yAxes: [{ id: "primary", label: "Transactions", format: "compact" }],
            series: [
              { key: "checkouts", label: "Checkout attempts", color: "chart.4" },
              { key: "orders", label: "Completed orders", color: "chart.1" },
            ],
            options: { showGrid: true, showLegend: true, showTooltip: true, legendPosition: "bottom" },
            height: 350,
            layout: { columnSpan: 8 },
          },
          {
            type: "text",
            title: "Weekend demand is structural",
            as: "p",
            tone: "neutral",
            content:
              "Saturday and Sunday generated 31.0% of weekly orders despite representing only two days. Both days exceeded 22,400 completed orders.\n\nStaff customer care and fulfillment to the demand curve. Weekend coverage should be a planned operating capacity, not an exception handled through overtime.",
            layout: { columnSpan: 4, surface: "none", padding: "comfortable", verticalAlign: "center" },
          },
        ],
      },
      {
        type: "section",
        title: "Decision memo",
        description: "Three actions supported by the evidence above—and the portable recipe that produced it.",
        columns: 12,
        children: [
          {
            type: "text",
            as: "h2",
            tone: "emphasis",
            content: "Protect efficient demand. Diversify the revenue mix. Staff the week we actually have.",
            layout: { columnSpan: 12, surface: "none" },
          },
          {
            type: "insight",
            severity: "positive",
            title: "1. Protect high intent",
            content: "Prioritize Email, Direct, and Organic retention before increasing broad paid acquisition.",
            layout: { columnSpan: 4 },
          },
          {
            type: "insight",
            severity: "warning",
            title: "2. Reduce product risk",
            content: "Grow subscription and add-on attach around the hardware base to reduce reliance on two products.",
            layout: { columnSpan: 4 },
          },
          {
            type: "insight",
            severity: "info",
            title: "3. Plan weekend capacity",
            content: "Align fulfillment and support staffing with a weekend order rate that runs 12.4% above weekdays.",
            layout: { columnSpan: 4 },
          },
          {
            type: "codeBlock",
            title: "The portable recipe behind the monthly evidence",
            language: "json",
            code: `{
  "source": "user.northstar_commerce_analytics",
  "transform": {
    "dimensions": [{ "field": "date", "as": "month", "timeBucket": "month" }],
    "metrics": [
      { "field": "revenue", "operation": "sum", "as": "revenue" },
      { "field": "target_revenue", "operation": "sum", "as": "target" }
    ],
    "sort": [{ "field": "month", "direction": "asc" }],
    "limit": 12
  }
}`,
            caption: "The dashboard JSON stores the intent. The runtime validates it, compiles the transform to SQL, and queries the local SQLite source.",
            layout: { columnSpan: 10, columnStart: 2 },
          },
        ],
      },
    ],
  });
}
