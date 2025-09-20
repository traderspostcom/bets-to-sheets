const ODDS_API_BASE = process.env.ODDS_API_BASE || "https://api.the-odds-api.com";
const ODDS_API_KEY  = process.env.ODDS_API_KEY  || "";

/** Convert American odds to decimal & implied% */
function fromAmerican(am) {
  const n = Number(am);
  if (!Number.isFinite(n) || n === 0) return { decimal: "", impliedPct: "" };
  const decimal = n > 0 ? (1 + n/100) : (1 + 100/Math.abs(n));
  const implied = n > 0 ? (100/(n+100)) : (Math.abs(n)/(Math.abs(n)+100));
  return { decimal: Number(decimal.toFixed(4)), impliedPct: Number((implied*100).toFixed(2)) };
}

/** Normalize market names from user ? The Odds API keys */
function normalizeMarket(m) {
  const s = String(m || "").toLowerCase();
  if (["ml","moneyline","h2h"].includes(s)) return "h2h";
  if (["spread","spreads","ats"].includes(s)) return "spreads";
  if (["total","totals","o/u","ou"].includes(s)) return "totals";
  return s || "h2h";
}

/**
 * Pick an outcome from TOA market by:
 * - h2h: team name
 * - spreads: team + desired spread point (closest if exact not found)
 * - totals: Over/Under side + desired total point (closest if exact not found)
 */
function pickOutcome(marketKey, outcomes, { team, side, spreadPoint, totalPoint }) {
  if (!Array.isArray(outcomes) || outcomes.length === 0) return null;
  const byName = (name) => outcomes.find(o => String(o?.name || "").toLowerCase() === String(name || "").toLowerCase());
  const nearestByPoint = (flt, want) => {
    // flt: filter outcomes (e.g., only Over or Under, or only matching team)
    const arr = outcomes.filter(flt);
    if (!arr.length) return null;
    if (want == null) return arr[0];
    let best = null; let bestDiff = Infinity;
    for (const o of arr) {
      const p = Number(o?.point);
      if (!Number.isFinite(p)) continue;
      const diff = Math.abs(p - want);
      if (diff < bestDiff) { best = o; bestDiff = diff; }
    }
    return best || arr[0];
  };

  if (marketKey === "h2h") {
    return team ? byName(team) || outcomes[0] : outcomes[0];
  }

  if (marketKey === "spreads") {
    // outcomes like: { name: "New England Patriots", point: -2.5, price: -110 }
    const teamLower = String(team || "").toLowerCase();
    const flt = (o) => String(o?.name || "").toLowerCase() === teamLower;
    return nearestByPoint(flt, Number(spreadPoint));
  }

  if (marketKey === "totals") {
    // outcomes like: { name: "Over", point: 46.5, price: -108 } / { name: "Under", ... }
    const wantedSide = (String(side || "").toLowerCase().startsWith("u") ? "under" : "over");
    const flt = (o) => String(o?.name || "").toLowerCase() === wantedSide;
    return nearestByPoint(flt, Number(totalPoint));
  }

  return outcomes[0];
}

/**
 * Fetch best price across multiple books for a team/market (+point where relevant).
 * Inputs:
 *  - sportKey: "americanfootball_nfl" (TOA key)
 *  - market:   "h2h" | "spreads" | "totals" (user-friendly values normalized)
 *  - team:     for h2h/spreads (team name)
 *  - side:     for totals ("Over"/"Under")
 *  - spreadPoint: desired spread (e.g., -2.5)
 *  - totalPoint:  desired total (e.g., 46.5)
 *  - books:    array of bookmaker keys (e.g., ["draftkings","fanduel","betmgm"])
 *  - line:     optional provided American odds (used as seed/fallback)
 */
export async function fetchOddsAndNormalize({
  sportKey, market="h2h", team, side, spreadPoint, totalPoint, books=[], line
}) {
  let best = null; // { book, american, decimal, impliedPct, pickedPoint }

  // Seed with provided line if given
  if (line) {
    const { decimal, impliedPct } = fromAmerican(line);
    best = { book: null, american: String(line), decimal, impliedPct };
  }

  const marketKey = normalizeMarket(market);
  const canFetch = Boolean(ODDS_API_BASE && ODDS_API_KEY && sportKey && Array.isArray(books) && books.length);

  if (canFetch) {
    try {
      const url = new URL(`${ODDS_API_BASE}/v4/sports/${sportKey}/odds/`);
      url.searchParams.set("regions", "us");
      url.searchParams.set("markets", marketKey);
      url.searchParams.set("oddsFormat", "american");
      url.searchParams.set("bookmakers", books.join(","));
      url.searchParams.set("apiKey", ODDS_API_KEY);

      const r = await fetch(url);
      if (r.ok) {
        const events = await r.json();
        // pick event: prefer one that mentions team for h2h/spreads; for totals any is fine if team omitted
        const teamLower = String(team || "").toLowerCase();
        const ev = (teamLower
          ? events.find(e => (e.home_team || "").toLowerCase().includes(teamLower) || (e.away_team || "").toLowerCase().includes(teamLower))
          : events[0]
        ) || events[0];

        if (ev && Array.isArray(ev.bookmakers)) {
          for (const b of ev.bookmakers) {
            const mk = (b.markets || []).find(m => String(m?.key || "").toLowerCase() === marketKey);
            if (!mk) continue;

            const outcome = pickOutcome(marketKey, mk.outcomes, { team, side, spreadPoint, totalPoint });
            const american = outcome?.price;
            if (american == null) continue;

            const { decimal, impliedPct } = fromAmerican(american);
            if (!best || decimal > best.decimal) {
              best = {
                book: b.key,
                american: String(american),
                decimal,
                impliedPct,
                pickedPoint: outcome?.point
              };
            }
          }
        }
      }
    } catch (err) {
      console.warn("Odds fetch failed:", err?.message || err);
    }
  }

  const out = {};
  if (best) {
    if (best.book) out["Book"] = best.book;
    out["Odds (Am)"] = best.american;
    out["Decimal"]   = best.decimal;
    out["Implied %"] = best.impliedPct + "%";
    if (marketKey === "spreads" && best.pickedPoint != null) out["Point"] = best.pickedPoint;
    if (marketKey === "totals"  && best.pickedPoint != null) out["Point"] = best.pickedPoint;
  }
  return out;
}