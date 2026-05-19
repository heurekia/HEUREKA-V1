import "dotenv/config";
import { app } from "./app.js";

const PORT = Number(process.env.PORT ?? 3001);

if (process.env.RUN_SEED === "true") {
  try {
    const { seed } = await import("./scripts/seed.js");
    await seed();
  } catch (err) {
    console.warn("⚠️ Seed skipped or failed (data may already exist):", err);
  }
}

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HEUREKA V1 API running on http://0.0.0.0:${PORT}`);
});
