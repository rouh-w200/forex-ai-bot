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

export async function placeOandaOrder(opts: {
  symbol: string;
  direction: "BUY" | "SELL";
  lots: number;
  slPrice: number;
  tpPrice: number;
}): Promise<{ oandaTradeId: string; entryPrice: number } | null> {
  if (!isOandaConnected()) return null;

  const dp = opts.symbol.includes("JPY") ? 3 : 5;
  const body = {
    order: {
      type: "MARKET",
      instrument: toInstrument(opts.symbol),
      units: lotsToUnits(opts.lots, opts.direction),
      stopLossOnFill: { price: opts.slPrice.toFixed(dp), timeInForce: "GTC" },
      takeProfitOnFill: { price: opts.tpPrice.toFixed(dp), timeInForce: "GTC" },
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
      logger.error({ status: res.status, body: data }, "OANDA order rejected");
      return null;
    }

    const fill = data.orderFillTransaction;
    const tradeId = fill?.tradeOpened?.tradeID ?? fill?.tradesClosed?.[0]?.tradeID;
    const price   = parseFloat(fill?.price ?? "0");

    if (!tradeId) {
      logger.warn({ data }, "OANDA order filled but no tradeID found");
      return null;
    }

    logger.info(
      { symbol: opts.symbol, direction: opts.direction, tradeId, price },
      "✅ OANDA order placed"
    );
    return { oandaTradeId: tradeId, entryPrice: price };
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
