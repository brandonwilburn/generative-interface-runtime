// Single-request smoke: confirm the planner → proxy → MiniMax path
// returns 200 and clean JSON, with no 400 noise in between.
const res = await fetch("http://localhost:5173/api/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    model: "MiniMax-M3",
    messages: [
      { role: "user", content: 'Reply with just the word OK as JSON like {"ok": true}.' },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  }),
});
console.log("STATUS", res.status);
const t = await res.text();
console.log("BODY (first 600):", t.slice(0, 600));
