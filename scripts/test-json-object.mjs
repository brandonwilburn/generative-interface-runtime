// Test json_object mode with a JSON-eliciting system prompt.
const body = {
  model: "MiniMax-M3",
  messages: [
    {
      role: "system",
      content:
        "You are a planner. Your response must be a single JSON object. " +
        "The first character of your response must be { and the last must be }. " +
        "No prose, no markdown fences, no commentary.",
    },
    {
      role: "user",
      content:
        'Create a JSON dashboard with title "Hello World" and one section of type "section". Output JSON only.',
    },
  ],
  temperature: 0.2,
  response_format: { type: "json_object" },
};

const res = await fetch("http://localhost:5173/api/chat/completions", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
console.log("STATUS", res.status);
const text = await res.text();
console.log("BODY (first 1500 chars):");
console.log(text.slice(0, 1500));
