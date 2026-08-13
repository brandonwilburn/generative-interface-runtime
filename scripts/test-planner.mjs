// Quick test: send a real planner-shaped request through the proxy and check
// what comes back. Used for verifying the json_schema path + thinking-token
// stripping during dev.
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

const Dashboard = z.object({
  type: z.literal("dashboard"),
  title: z.string(),
  children: z.array(z.object({ type: z.literal("section") })).min(1),
});
const schema = zodToJsonSchema(Dashboard, "ui_specification");
delete schema["$schema"];

const body = {
  model: "MiniMax-M3",
  messages: [
    {
      role: "system",
      content: "You are a planner. Output a JSON object matching the schema.",
    },
    {
      role: "user",
      content: "Create a dashboard titled Hello World with one section.",
    },
  ],
  temperature: 0.2,
  response_format: {
    type: "json_schema",
    json_schema: { name: "ui_specification", strict: true, schema },
  },
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
