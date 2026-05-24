import "dotenv/config";
import { app } from "./app.js";
import { startScheduledJobs } from "./jobs/scheduler.js";

const PORT = Number(process.env.PORT ?? 3001);


app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 HEUREKA V1 API running on http://0.0.0.0:${PORT}`);
  startScheduledJobs();
});
