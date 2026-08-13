/**
 * Generates a deterministic hourly product-mix CSV for testing the
 * BYOD upload flow. One row per (day, hour, product) for a 7-day
 * week, with realistic lunch/dinner peaks and a weekend boost.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const PRODUCTS = [
  { category: "mains",  product: "Brisket plate",          unitPrice: 28 },
  { category: "sides",  product: "Smoked mac & cheese",    unitPrice: 8  },
  { category: "drinks", product: "Iced tea",               unitPrice: 4  },
  { category: "dessert",product: "Pecan pie",              unitPrice: 6  },
];

// 2026-08-10 is a Monday. Each day carries:
//   - a "popularity" multiplier (varies the daily total volume)
//   - a per-category emphasis (varies the *product mix* — drinks on
//     weekends, mains early in the week, etc.)
const BASE_CATEGORY_WEIGHT = {
  mains: 1.0,
  sides: 1.3,
  drinks: 2.0,
  dessert: 0.6,
};

const DAYS = [
  {
    date: "2026-08-10", day: "Mon", weekend: false, popularity: 0.78,
    // Monday: people get back to routine — heavy on mains, low on desserts.
    emphasis: { mains: 1.20, sides: 1.10, drinks: 1.70, dessert: 0.45 },
  },
  {
    date: "2026-08-11", day: "Tue", weekend: false, popularity: 0.92,
    // Tuesday: balanced weeknight.
    emphasis: { mains: 1.05, sides: 1.25, drinks: 1.85, dessert: 0.65 },
  },
  {
    date: "2026-08-12", day: "Wed", weekend: false, popularity: 1.00,
    // Wednesday: midweek baseline.
    emphasis: { mains: 1.00, sides: 1.30, drinks: 2.00, dessert: 0.60 },
  },
  {
    date: "2026-08-13", day: "Thu", weekend: false, popularity: 1.05,
    // Thursday: thirsty before the weekend — drinks skew up.
    emphasis: { mains: 0.95, sides: 1.20, drinks: 2.30, dessert: 0.70 },
  },
  {
    date: "2026-08-14", day: "Fri", weekend: false, popularity: 1.28,
    // Friday: celebrating — dessert and mains both up.
    emphasis: { mains: 1.15, sides: 1.10, drinks: 2.10, dessert: 0.95 },
  },
  {
    date: "2026-08-15", day: "Sat", weekend: true,  popularity: 1.55,
    // Saturday: peak day, very drink-heavy (parties, outdoor).
    emphasis: { mains: 1.05, sides: 1.20, drinks: 2.70, dessert: 0.85 },
  },
  {
    date: "2026-08-16", day: "Sun", weekend: true,  popularity: 1.18,
    // Sunday: family-style — strong on mains, modest drinks, light desserts.
    emphasis: { mains: 1.25, sides: 1.35, drinks: 1.50, dessert: 0.55 },
  },
];

// Order volume by hour. 0 = closed. Tuned for a food truck that's
// open 10am-10pm with a lunch peak and a dinner peak.
const HOUR_VOLUME = {
  0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0,
  10: 4,
  11: 9,
  12: 18,
  13: 17,
  14: 8,
  15: 5,
  16: 6,
  17: 14,
  18: 22,
  19: 20,
  20: 11,
  21: 5,
  22: 0, 23: 0,
};

// Per-category weighting — drinks outsell mains in raw count on
// average. The per-day `emphasis` (above) is the multiplier that varies
// the mix day-to-day.
const CATEGORY_WEIGHT = {
  mains: 1.0,
  sides: 1.3,
  drinks: 2.0,
  dessert: 0.6,
};

// A real per-(day, hour, product) hash so the jitter is distinct
// for every key. The previous formula used `d.date.charCodeAt(8)` which
// is "1" for every date in the week — that's why all weekdays and all
// weekends had identical numbers.
function hashSeed(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

const lines = ["day,date,hour,category,product,orders,revenue"];
for (const d of DAYS) {
  for (let hour = 0; hour < 24; hour++) {
    const base = HOUR_VOLUME[hour];
    if (base === 0) continue;
    const weekendBoost = d.weekend ? 1.10 : 1.0;
    for (const p of PRODUCTS) {
      // Per-key deterministic jitter in 0.82..1.18.
      const seed = hashSeed(`${d.date}|${hour}|${p.product}`);
      const jitter = 0.82 + ((seed % 100) / 100) * 0.36;
      const weight =
        CATEGORY_WEIGHT[p.category] * d.emphasis[p.category];
      const orders = Math.max(
        0,
        Math.round(
          base * weight * d.popularity * weekendBoost * jitter,
        ),
      );
      const revenue = orders * p.unitPrice;
      lines.push(
        `${d.day},${d.date},${hour},${p.category},${p.product},${orders},${revenue}`,
      );
    }
  }
}

const out = lines.join("\n") + "\n";
const path = resolve(process.cwd(), "samples", "hourly_product_mix.csv");
writeFileSync(path, out, "utf8");
console.log(`Wrote ${lines.length - 1} rows to ${path}`);
console.log(`Day range: ${DAYS[0].date} (${DAYS[0].day}) to ${DAYS.at(-1).date} (${DAYS.at(-1).day})`);
console.log(`Products: ${PRODUCTS.length} (mains, sides, drinks, dessert)`);
console.log(`\nDaily mix share (mains / sides / drinks / dessert):`);
for (const d of DAYS) {
  let mains = 0, sides = 0, drinks = 0, dessert = 0;
  for (const line of lines.slice(1)) {
    if (!line.startsWith(d.day + ",")) continue;
    const parts = line.split(",");
    if (parts[3] === "mains") mains += Number(parts[5]);
    else if (parts[3] === "sides") sides += Number(parts[5]);
    else if (parts[3] === "drinks") drinks += Number(parts[5]);
    else if (parts[3] === "dessert") dessert += Number(parts[5]);
  }
  const total = mains + sides + drinks + dessert || 1;
  console.log(
    `  ${d.day}  ${(100 * mains / total).toFixed(1).padStart(5)}% mains  ` +
      `${(100 * sides / total).toFixed(1).padStart(5)}% sides  ` +
      `${(100 * drinks / total).toFixed(1).padStart(5)}% drinks  ` +
      `${(100 * dessert / total).toFixed(1).padStart(5)}% dessert`,
  );
}
