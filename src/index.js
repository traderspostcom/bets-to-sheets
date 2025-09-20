import express from "express";
import { fetchOddsAndNormalize } from "./odds.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 3000;

/** Root health check */
app.get("/", (req, res) => {
  res.json({ ok: true, service: "odds-backend is live" });
});

/** Odds lookup route */
app.get("/odds", async (req, res) => {
  try {
    const { sportKey, market, team, side, spreadPoint, totalPoint, books, line } = req.query;

    if (!sportKey) {
      return res.status(400).json({ ok: false, error: "sportKey is required" });
    }

    const oddsInfo = await fetchOddsAndNormalize({
      sportKey,
      market,
      team,
      side,
      spreadPoint: spreadPoint ? Number(spreadPoint) : null,
      totalPoint: totalPoint ? Number(totalPoint) : null,
      books: books ? books.split(",").map(s => s.trim()) : [],
      line
    });

    return res.json({ ok: true, result: oddsInfo });
  } catch (err) {
    console.error("Odds endpoint failed:", err);
    return res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

