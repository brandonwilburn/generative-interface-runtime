import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";

const Dashboard = z.object({
  type: z.literal("dashboard"),
  title: z.string(),
  children: z.array(z.object({ type: z.literal("section") })).min(1),
});
const schema = zodToJsonSchema(Dashboard, "ui_specification");
delete schema["$schema"];
console.log(JSON.stringify(schema, null, 2));
