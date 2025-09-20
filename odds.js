const ODDS_API_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com";
const ODDS_API_KEY  = process.env.ODDS_API_KEY  || "";

/** Convert American odds to decimal & implied probability */
function fromAmerican(am) {
  const n = Number(am);
  if (!Number.isFinite(n) || n === 0) return { decimal: "", impliedPct: "" };
  const decimal = n > 0 ? (1 + n / 100) : (1 + 100 / Math.abs(n));
  const implied = n > 0 ? (100 / (n + 100)) : (Math.abs(n) / (Math.abs(n) + 100));
  return { decimal: Number(decimal.toFixed(4)), impliedPct: Number((implied * 100).toFixed(2)) };
}

/** Normalize market names from user input to Odds API keys */
function normalizeMarket(m) {
  const s = String(m || "").toLowerCase();
  if (["ml", "moneyline", "h2h"].includes(s)) return "h2h";
  if (["spread", "spreads", "ats"].includes(s)) return "spreads";
  if (["total", "totals", "o/u", "ou"].includes(s)) return "totals";
  return "h2h"; // fallback
}

/** Select the closest matching outcome from a market */
function pickOutcome(marketKey, outcomes, { team, side, spreadPoint, totalPoint }) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return null;

  const byName = (name) =>
    outcomes.find((o) => String(o?.name || "").toLowerCase() === String(name || "").toLowerCase());

  const nearestByPoint = (flt, want) => {
    const arr = outcomes.filter(flt);
    if (!arr.length) return null;
    if (want == null) return arr[0];
    return arr.reduce((best, o) => {
      const p = Number(o?.point);
      if (!Number.isFinite(p)) return best;
      return Math.abs(p - want) < Math.abs((best?.point ?? 999) - want) ? o : best;
    }, null);
  };

  if (marketKey === "h2h") {
    return team ? byName(team) || outcomes[0] : outcomes[0];
  }

  if (marketKey === "spreads") {
    const teamLower = String(team || "").toLowerCase();
    const flt = (o) => String(o?.name || "").toLowerCase() === teamLower;
    return nearestByPoint(flt, Number(spreadPoint));
  }

  if (marketKey === "totals") {
    const wantedSide = String(side || "").toLowerCase().startsWith("u") ? "under" : "over";
    const flt = (o) => String(o?.name || "").toLowerCase() === wantedSide;
    return nearestByPoint(flt, Number(totalPoint));
  }

  return outcomes[0];
}

/**
 * Fetch best odds across books for a given market.
 */
export async function fetchOddsAndNormalize({
  sportKey,
  market = "h2h",
  team,
  side,
  spreadPoint,
  totalPoint,
  books = [],
  line,
}) {
  let best = null; // will hold best price found
  const marketKey = normalizeMarket(market);

  // Seed with provided line if user already has one
  if (line) {
    const { decimal, impliedPct } = fromAmerican(line);
    best = { book: "provided", american: String(line), decimal, impliedPct };
  }

  // Call The Odds API
  if (ODDS_API_BASE && ODDS_API_KEY && sportKey && books.length) {
    try {
      const url = new URL(`${ODDS_API_BASE}/v4/sports/${sportKey}/odds/`);
      url.searchParams.set("regions", "us");
      url.searchParams.set("markets", marketKey);
      url.searchParams.set("oddsFormat", "american");
      url.searchParams.set("bookmakers", books.join(","));
      url.searchParams.set("apiKey", ODDS_API_KEY);

      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const events = await r.json();
      if (!Array.isArray(events) || events.length === 0) return {};

      // find event containing team
      const teamLower = String(team || "").toLowerCase();
      const ev =
        teamLower && marketKey !== "totals"
          ? events.find(
              (e) =>
                (e.home_team || "").toLowerCase().includes(teamLower) ||
                (e.away_team || "").toLowerCase().includes(teamLower)
            ) || events[0]
          : events[0];

      if (ev && Array.isArray(ev.bookmakers)) {
        for (const b of ev.bookmakers) {
          const mk = (b.markets || []).find(
            (m) => String(m?.key || "").toLowerCase() === marketKey
          );
          if (!mk) continue;

          const outcome = pickOutcome(marketKey, mk.outcomes, {
            team,
            side,
            spreadPoint,
            totalPoint,
          });

          if (!outcome?.price) continue;

          const { decimal, impliedPct } = fromAmerican(outcome.price);
          if (!best || decimal > best.decimal) {
            best = {
              book: b.key,
              american: String(outcome.price),
              decimal,
              impliedPct,
              pickedPoint: outcome.point,
              market: marketKey,
            };
          }
        }
      }
    } catch (err) {
      console.warn("Odds fetch failed:", err.message || err);
    }
  }

  // Final normalized output
  return best
    ? {
        Market: best.market || marketKey,
        Book: best.book,
        Odds: best.american,
        Decimal: best.decimal,
        "Implied %": best.impliedPct + "%",
        ...(marketKey !== "h2h" && best.pickedPoint != null ? { Point: best.pickedPoint } : {}),
      }
    : {};
}
