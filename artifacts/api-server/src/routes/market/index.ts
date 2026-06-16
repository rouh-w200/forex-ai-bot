import { Router, type IRouter } from "express";
import { getOandaAccountSummary, getOandaOpenTrades, isOandaConnected } from "../../lib/oanda-bridge";

const router: IRouter = Router();

// ─── OANDA Diagnostic ────────────────────────────────────────────────────────

router.get("/oanda/status", async (req, res): Promise<void> => {
  const connected = isOandaConnected();
  if (!connected) {
    res.json({ connected: false, reason: "OANDA_API_TOKEN or OANDA_ACCOUNT_ID not set" });
    return;
  }

  const [summary, openTrades] = await Promise.all([
    getOandaAccountSummary(),
    getOandaOpenTrades(),
  ]);

  if (!summary) {
    res.json({
      connected: false,
      reason: "Token set but OANDA API rejected the request — token may be expired or have wrong permissions",
    });
    return;
  }

  res.json({
    connected: true,
    balance: summary.balance,
    nav: summary.nav,
    unrealizedPL: summary.unrealizedPL,
    openTradeCount: summary.openTradeCount,
    oandaOpenTrades: openTrades.slice(0, 5),
  });
});

// ─── Market Candles ──────────────────────────────────────────────────────────

const SYMBOL_MAP: Record<string, string> = {
  EURUSD: "EURUSD=X",
  GBPUSD: "GBPUSD=X",
  USDJPY: "USDJPY=X",
  GBPJPY: "GBPJPY=X",
  AUDUSD: "AUDUSD=X",
  EURJPY: "EURJPY=X",
  USDCAD: "USDCAD=X",
};

const INTERVAL_RANGE: Record<string, { range: string }> = {
  "1m":  { range: "1d" },
  "5m":  { range: "5d" },
  "15m": { range: "5d" },
  "1h":  { range: "1mo" },
};

router.get("/market/candles", async (req, res): Promise<void> => {
  const symbol   = typeof req.query.symbol   === "string" ? req.query.symbol   : null;
  const interval = typeof req.query.interval === "string" ? req.query.interval : "5m";

  if (!symbol) {
    res.status(400).json({ error: "symbol is required" });
    return;
  }
  const yahooSymbol = SYMBOL_MAP[symbol.toUpperCase()];
  if (!yahooSymbol) {
    res.status(400).json({ error: `Unknown symbol: ${symbol}` });
    return;
  }

  const rangeConfig = INTERVAL_RANGE[interval] ?? { range: "5d" };

  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooSymbol}?interval=${interval}&range=${rangeConfig.range}&includePrePost=false`;

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json",
    },
  });

  if (!response.ok) {
    res.status(502).json({ error: "Failed to fetch market data" });
    return;
  }

  const json = await response.json() as any;
  const result = json?.chart?.result?.[0];

  if (!result) {
    res.status(502).json({ error: "No data returned from Yahoo Finance" });
    return;
  }

  const timestamps: number[] = result.timestamp ?? [];
  const quote = result.indicators?.quote?.[0] ?? {};
  const opens:  number[] = quote.open  ?? [];
  const highs:  number[] = quote.high  ?? [];
  const lows:   number[] = quote.low   ?? [];
  const closes: number[] = quote.close ?? [];

  const candles = timestamps
    .map((t, i) => ({
      time:  t,
      open:  opens[i],
      high:  highs[i],
      low:   lows[i],
      close: closes[i],
    }))
    .filter(c => c.open != null && c.high != null && c.low != null && c.close != null);

  res.json({ symbol, interval, candles });
});

export default router;
