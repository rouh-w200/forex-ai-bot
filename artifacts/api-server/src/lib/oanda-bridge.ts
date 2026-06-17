/**
 * OANDA API v20 Bridge
 * Connects the bot to a real OANDA account (practice or live).
 * Set OANDA_API_TOKEN and OANDA_ACCOUNT_ID in Replit Secrets to activate.
 * Set OANDA_ENV=live for a real money account (default: practice/demo).
 */

import { logger } from "./logger";

const ENV         = process.env.OANDA_ENV ?? "practice";
const BASE_URL    = ENV === "live"
  ? "https://api-fxtrade.oanda.com"
  : "https://api-fxpractice.oanda.com";
const TOKEN       = process.env.OANDA_API_TOKEN;
const ACCOUNT_ID  = process.env.OANDA_ACCOUNT_ID;

export function isOandaConnected(): boolean {
  return !!(TOKEN && ACCOUNT_ID);
}

// EURUSD → EUR_USD
function toInstrument(symbol: string): string {
  return `${symbol.slice(0, 3)}_${symbol.slice(3)}`;
}

// EUR_USD → EURUSD
function fromInstrument(instrument: string): string {
  return instrument.replace("_", "");
}

// 0.01 lot = 1000 units; SELL → negative
function lotsToUnits(lots: number, direction: "BUY" | "SELL"): string {
  const units = Math.round(lots * 100_000);
  return direction === "SELL" ? `-${units}` : `${units}`;
}

function headers() {
  return {
    "Authorization": `Bearer ${TOKEN}`,
    "Content-Type": "application/json",
    "Accept-Datetime-Format": "RFC3339",
  };
}

// ─── Place a market order with SL and TP ─────────────────────────────────────
// Uses OANDA's "distance" format so SL/TP are relative to the ACTUAL fill price,
// not a pre-computed simulated price. This guarantees correct pip distances.

export async function placeOandaOrder(opts: {
  symbol: string;
  direction: "BUY" | "SELL";
  lots: number;
  slPips: number;   // SL distance in pips (always positive)
  tpPips: number;   // TP distance in pips (always positive)
}): Promise<{ oandaTradeId: string; entryPrice: number; slPrice: number; tpPrice: number } | null> {
  if (!isOandaConnected()) return null;

  const isJpy     = opts.symbol.includes("JPY");
  const pip       = isJpy ? 0.01 : 0.0001;
  const dp        = isJpy ? 3 : 5;
  const slDist    = (opts.slPips * pip).toFixed(dp);
  const tpDist    = (opts.tpPips * pip).toFixed(dp);

  const body = {
    order: {
      type: "MARKET",
      instrument: toInstrument(opts.symbol),
      units: lotsToUnits(opts.lots, opts.direction),
      // "distance" is relative to fill price → no dependence on simulated prices
      stopLossOnFill:   { distance: slDist, timeInForce: "GTC" },
      takeProfitOnFill: { distance: tpDist, timeInForce: "GTC" },
      timeInForce: "IOC",
      positionFill: "DEFAULT",
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/v3/accounts/${ACCOUNT_ID}/orders`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;

    if (!res.ok) {
      logger.warn({ status: res.status, body: data, symbol: opts.symbol }, "OANDA order rejected");
      return null;
    }

    const fill = data.orderFillTransaction;
    if (!fill) {
      logger.warn({ symbol: opts.symbol, cancel: data.orderCancelTransaction?.reason }, "OANDA order not filled");
      return null;
    }

    const tradeId: string | undefined =
      fill.tradeOpened?.tradeID ?? fill.id?.toString();
    const fillPrice = parseFloat(fill.price ?? "0");

    if (!tradeId || !fillPrice) {
      logger.warn({ symbol: opts.symbol, fill }, "OANDA order filled but tradeID/price missing");
      return null;
    }

    // Compute actual SL/TP prices from the real fill price
    const slPrice = opts.direction === "BUY"
      ? parseFloat((fillPrice - opts.slPips * pip).toFixed(dp))
      : parseFloat((fillPrice + opts.slPips * pip).toFixed(dp));
    const tpPrice = opts.direction === "BUY"
      ? parseFloat((fillPrice + opts.tpPips * pip).toFixed(dp))
      : parseFloat((fillPrice - opts.tpPips * pip).toFixed(dp));

    logger.info(
      { symbol: opts.symbol, direction: opts.direction, tradeId, fillPrice, slPrice, tpPrice, slPips: opts.slPips, tpPips: opts.tpPips },
      "✅ OANDA order placed"
    );
    return { oandaTradeId: tradeId, entryPrice: fillPrice, slPrice, tpPrice };
  } catch (err) {
    logger.error({ err }, "OANDA order fetch error");
    return null;
  }
}

// ─── Close a specific OANDA trade ────────────────────────────────────────────

export async function closeOandaTrade(oandaTradeId: string): Promise<{
  closePrice: number;
  profitLoss: number;
} | null> {
  if (!isOandaConnected()) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/v3/accounts/${ACCOUNT_ID}/trades/${oandaTradeId}/close`,
      { method: "PUT", headers: headers() }
    );

    if (!res.ok) return null;
    const data = await res.json() as any;
    const txn = data.orderFillTransaction;

    return {
      closePrice: parseFloat(txn?.price ?? "0"),
      profitLoss: parseFloat(txn?.pl ?? "0"),
    };
  } catch (err) {
    logger.error({ err, oandaTradeId }, "OANDA close trade error");
    return null;
  }
}

// ─── Fetch real-time prices for all symbols ──────────────────────────────────

export async function getOandaPrices(symbols: string[]): Promise<Record<string, { bid: number; ask: number; mid: number }>> {
  if (!isOandaConnected()) return {};

  const instruments = symbols.map(toInstrument).join(",");
  try {
    const res = await fetch(
      `${BASE_URL}/v3/accounts/${ACCOUNT_ID}/pricing?instruments=${instruments}`,
      { headers: headers() }
    );

    if (!res.ok) return {};
    const data = await res.json() as any;
    const result: Record<string, { bid: number; ask: number; mid: number }> = {};

    for (const p of data.prices ?? []) {
      const sym = fromInstrument(p.instrument);
      const bid = parseFloat(p.bids?.[0]?.price ?? "0");
      const ask = parseFloat(p.asks?.[0]?.price ?? "0");
      result[sym] = { bid, ask, mid: (bid + ask) / 2 };
    }

    return result;
  } catch (err) {
    logger.warn({ err }, "OANDA prices fetch error");
    return {};
  }
}

// ─── Account summary ─────────────────────────────────────────────────────────

export async function getOandaAccountSummary(): Promise<{
  balance: number;
  nav: number;
  unrealizedPL: number;
  openTradeCount: number;
} | null> {
  if (!isOandaConnected()) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/v3/accounts/${ACCOUNT_ID}/summary`,
      { headers: headers() }
    );

    if (!res.ok) return null;
    const data = await res.json() as any;
    const acc = data.account;

    return {
      balance:       parseFloat(acc.balance      ?? "0"),
      nav:           parseFloat(acc.NAV           ?? "0"),
      unrealizedPL:  parseFloat(acc.unrealizedPL  ?? "0"),
      openTradeCount: parseInt(acc.openTradeCount ?? "0"),
    };
  } catch (err) {
    logger.error({ err }, "OANDA account summary error");
    return null;
  }
}

// ─── Get open trades from OANDA ──────────────────────────────────────────────

export async function getOandaOpenTrades(): Promise<Array<{
  tradeId: string;
  instrument: string;
  currentUnrealizedPL: number;
}>> {
  if (!isOandaConnected()) return [];

  try {
    const res = await fetch(
      `${BASE_URL}/v3/accounts/${ACCOUNT_ID}/openTrades`,
      { headers: headers() }
    );

    if (!res.ok) return [];
    const data = await res.json() as any;

    return (data.trades ?? []).map((t: any) => ({
      tradeId: t.id,
      instrument: fromInstrument(t.instrument),
      currentUnrealizedPL: parseFloat(t.unrealizedPL ?? "0"),
    }));
  } catch (err) {
    logger.error({ err }, "OANDA open trades error");
    return [];
  }
}

// ─── Sync: check OANDA for trades that were closed (SL/TP hit) ───────────────

export async function getOandaClosedTrade(oandaTradeId: string): Promise<{
  closePrice: number;
  profitLoss: number;
  closeReason: string;
  closedAt: Date;
} | null> {
  if (!isOandaConnected()) return null;

  try {
    const res = await fetch(
      `${BASE_URL}/v3/accounts/${ACCOUNT_ID}/trades/${oandaTradeId}`,
      { headers: headers() }
    );

    if (!res.ok) return null;
    const data = await res.json() as any;
    const trade = data.trade;

    if (trade.state !== "CLOSED") return null;

    const closePrice = parseFloat(trade.averageClosePrice ?? "0");
    const profitLoss = parseFloat(trade.realizedPL ?? "0");
    const closeReason = profitLoss >= 0 ? "TP_HIT" : "SL_HIT";
    const closedAt = new Date(trade.closeTime ?? Date.now());

    return { closePrice, profitLoss, closeReason, closedAt };
  } catch (err) {
    return null;
  }
}

export { toInstrument, fromInstrument };
