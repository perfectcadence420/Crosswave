import { api, db } from "./_lib/core.js";
export default api(["GET"], async (_req, res) => {
  const rows = await db()`SELECT 1 AS ok`;
  return res.status(200).json({ service: "crosswave-api", database: rows[0]?.ok === 1 ? "ok" : "error" });
});
