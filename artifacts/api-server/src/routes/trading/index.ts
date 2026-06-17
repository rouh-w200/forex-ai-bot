import { Router, type IRouter } from "express";
import { eq, desc, sql, and, gte, lte, count } from "drizzle-orm";
import { db, tradesTable, botSignalsTable } from "@workspace/db";
import {
  GetTradeSignalBody,
  GetTradeSignalResponse,
  ListTradesQueryParams,
  ListTradesResponse,
  OpenTradeBody,
  CloseTradeBody,
  CloseTradeParams,
  GetTradeParams,
  GetTradeResponse,
  CloseTradeResponse,
  GetBotStatusResponse,
} from "@workspace/api-zod";
import { getScalpingSignal } from "../../lib/trading-ai";
import { syncOandaPositions } from "../../lib/autonomous-bot";

const router: IRouter = Router();

const MAX_DAILY_TRADES = 1000;

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// POST /trading/signal — get AI trading decision
router.post("/trading/signal", async (req, res): Promise<void> => {
  const parsed = GetTradeSignalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const data = parsed.data;

  // Count today's trades
  const { start, end } = todayRange();
  const [{ todayCount }] = await db
    .select({ todayCount: count() })
    .from(tradesTable)
    .where(
      and(
        gte(tradesTable.openedAt, start),
        lte(tradesTable.openedAt, end)
      )
    );

  const todayTradeCount = Number(todayCount) || 0;

  if (todayTradeCount >= MAX_DAILY_TRADES) {
    res.status(429).json({ error: `Daily trade limit of ${MAX_DAILY_TRADES} reached.` });
    return;
  }

  const decision = await getScalpingSignal({
    ...data,
    todayTradeCount,
  });

  // Log the signal to DB
  await db.insert(botSignalsTable).values({
    symbol: data.symbol,
    timeframe: data.timeframe,
    action: decision.action,
    confidence: decision.confidence?.toString(),
    reasoning: decision.reasoning,
    stopLossPips: decision.stopLossPips?.toString(),
    takeProfitPips: decision.takeProfitPips?.toString(),
    lotSize: decision.lotSize?.toString(),
    riskRewardRatio: decision.riskRewardRatio?.toString(),
    rsi: data.rsi.toString(),
    spread: data.spread.toString(),
    session: data.session,
    trend: data.trend,
    volatility: data.volatility,
  });

  const response = GetTradeSignalResponse.parse({
    action: decision.action,
    confidence: decision.confidence,
    entryPrice: decision.action === "BUY" ? data.ask : decision.action === "SELL" ? data.bid : undefined,
    stopLossPips: decision.stopLossPips,
    takeProfitPips: decision.takeProfitPips,
    lotSize: decision.lotSize,
    reasoning: decision.reasoning,
    riskRewardRatio: decision.riskRewardRatio,
    maxDailyTradesReached: todayTradeCount >= MAX_DAILY_TRADES,
  });

  res.json(response);
});

// GET /trading/trades
router.get("/trading/trades", async (req, res): Promise<void> => {
  const params = ListTradesQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { limit = 50, offset = 0, date, symbol } = params.data;

  const conditions: ReturnType<typeof and>[] = [];

  if (date) {
    const dateStart = new Date(date);
    const dateEnd = new Date(dateStart.getTime() + 24 * 60 * 60 * 1000);
    conditions.push(gte(tradesTable.openedAt, dateStart), lte(tradesTable.openedAt, dateEnd));
  }

  if (symbol) {
    conditions.push(eq(tradesTable.symbol, symbol));
  }

  let query = db.select().from(tradesTable);
  let countQuery = db.select({ total: count() }).from(tradesTable);

  if (conditions.length > 0) {
    const whereClause = conditions.length === 1 ? conditions[0]! : and(...conditions);
    query = query.where(whereClause) as typeof query;
    countQuery = countQuery.where(whereClause) as typeof countQuery;
  }

  const [trades, [{ total }]] = await Promise.all([
    query.orderBy(desc(tradesTable.openedAt)).limit(limit).offset(offset),
    countQuery,
  ]);

  const serialized = trades.map(serializeTrade);
  res.json(ListTradesResponse.parse({ trades: serialized, total: Number(total), limit, offset }));
});

// POST /trading/trades — log opened trade from EA
router.post("/trading/trades", async (req, res): Promise<void> => {
  const parsed = OpenTradeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  const [trade] = await db.insert(tradesTable).values({
    symbol: d.symbol,
    direction: d.direction,
    entryPrice: d.entryPrice.toString(),
    lotSize: d.lotSize.toString(),
    stopLoss: d.stopLoss.toString(),
    takeProfit: d.takeProfit.toString(),
    stopLossPips: d.stopLossPips?.toString(),
    takeProfitPips: d.takeProfitPips?.toString(),
    confidence: d.confidence?.toString(),
    reasoning: d.reasoning,
    riskRewardRatio: d.riskRewardRatio?.toString(),
    mtTicket: d.mtTicket,
    status: "OPEN",
  }).returning();

  res.status(201).json(serializeTrade(trade));
});

// POST /trading/trades/:id/close
router.post("/trading/trades/:id/close", async (req, res): Promise<void> => {
  const params = CloseTradeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const body = CloseTradeBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [trade] = await db
    .update(tradesTable)
    .set({
      closePrice: body.data.closePrice.toString(),
      profitLoss: body.data.profitLoss.toString(),
      profitLossPips: body.data.profitLossPips?.toString(),
      closeReason: body.data.closeReason,
      status: "CLOSED",
      closedAt: new Date(),
    })
    .where(eq(tradesTable.id, id))
    .returning();

  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }

  res.json(CloseTradeResponse.parse(serializeTrade(trade)));
});

// GET /trading/trades/:id
router.get("/trading/trades/:id", async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(rawId, 10);

  const [trade] = await db.select().from(tradesTable).where(eq(tradesTable.id, id));

  if (!trade) {
    res.status(404).json({ error: "Trade not found" });
    return;
  }

  res.json(GetTradeResponse.parse(serializeTrade(trade)));
});

// GET /bot/status
router.get("/bot/status", async (req, res): Promise<void> => {
  const { start, end } = todayRange();

  const [{ todayCount }] = await db
    .select({ todayCount: count() })
    .from(tradesTable)
    .where(and(gte(tradesTable.openedAt, start), lte(tradesTable.openedAt, end)));

  const [{ openCount }] = await db
    .select({ openCount: count() })
    .from(tradesTable)
    .where(eq(tradesTable.status, "OPEN"));

  const lastSignal = await db
    .select()
    .from(botSignalsTable)
    .orderBy(desc(botSignalsTable.createdAt))
    .limit(1);

  const count_ = Number(todayCount) || 0;

  res.json(GetBotStatusResponse.parse({
    isActive: count_ < MAX_DAILY_TRADES,
    todayTradeCount: count_,
    maxDailyTrades: MAX_DAILY_TRADES,
    tradesRemaining: Math.max(0, MAX_DAILY_TRADES - count_),
    openPositions: Number(openCount) || 0,
    lastSignalAt: lastSignal[0]?.createdAt?.toISOString() ?? null,
    lastSignalAction: lastSignal[0]?.action ?? null,
  }));
});

// POST /trading/admin/sync — trigger OANDA sync and return diagnostic result
router.post("/trading/admin/sync", async (req, res) => {
  const result = await syncOandaPositions();
  res.json(result);
});

// POST /trading/admin/fix-sltp — recompute SL/TP from real entry price for open trades
// Uses current risk targets (SL=$0.60 / TP=$1.20, R:R 1:2)
router.post("/trading/admin/fix-sltp", async (req, res) => {
  const SL_USD = 0.60, TP_USD = 1.20;
  const PIP_VAL: Record<string, number> = {
    EURUSD: 0.10, GBPUSD: 0.10, AUDUSD: 0.10, NZDUSD: 0.10,
    USDCAD: 0.072, USDCHF: 0.112,
    USDJPY: 0.064, GBPJPY: 0.064, EURJPY: 0.064, AUDJPY: 0.064, NZDJPY: 0.064,
    EURGBP: 0.126, EURAUD: 0.064, EURCAD: 0.072, GBPAUD: 0.064,
  };

  const openTrades = await db.select().from(tradesTable).where(eq(tradesTable.status, "OPEN"));
  const results: Array<{ id: number; symbol: string; slOld: string; tpOld: string; slNew: string; tpNew: string; slPips: number; tpPips: number }> = [];

  for (const trade of openTrades) {
    const entry = parseFloat(trade.entryPrice);
    if (!entry) continue;
    const sym = trade.symbol;
    const pv = PIP_VAL[sym] ?? 0.10;
    const isJpy = sym.includes("JPY");
    const pip = isJpy ? 0.01 : 0.0001;
    const dp = isJpy ? 3 : 5;
    const sl = Math.round(SL_USD / pv);
    const tp = Math.round(TP_USD / pv);
    const slNew = trade.direction === "BUY"
      ? (entry - sl * pip).toFixed(dp)
      : (entry + sl * pip).toFixed(dp);
    const tpNew = trade.direction === "BUY"
      ? (entry + tp * pip).toFixed(dp)
      : (entry - tp * pip).toFixed(dp);

    await db.execute(sql`UPDATE trades SET stop_loss=${slNew}, take_profit=${tpNew}, stop_loss_pips=${sl.toString()}, take_profit_pips=${tp.toString()} WHERE id=${trade.id}`);
    results.push({ id: trade.id, symbol: sym, slOld: trade.stopLoss, tpOld: trade.takeProfit, slNew, tpNew, slPips: sl, tpPips: tp });
  }

  req.log.info({ count: results.length }, "admin/fix-sltp complete");
  res.json({ fixed: results.length, trades: results });
});

function serializeTrade(t: typeof tradesTable.$inferSelect) {
  return {
    id: t.id,
    symbol: t.symbol,
    direction: t.direction,
    entryPrice: Number(t.entryPrice),
    closePrice: t.closePrice != null ? Number(t.closePrice) : null,
    lotSize: Number(t.lotSize),
    stopLoss: Number(t.stopLoss),
    takeProfit: Number(t.takeProfit),
    stopLossPips: t.stopLossPips != null ? Number(t.stopLossPips) : null,
    takeProfitPips: t.takeProfitPips != null ? Number(t.takeProfitPips) : null,
    profitLoss: t.profitLoss != null ? Number(t.profitLoss) : null,
    profitLossPips: t.profitLossPips != null ? Number(t.profitLossPips) : null,
    confidence: t.confidence != null ? Number(t.confidence) : null,
    reasoning: t.reasoning ?? null,
    riskRewardRatio: t.riskRewardRatio != null ? Number(t.riskRewardRatio) : null,
    status: t.status,
    closeReason: t.closeReason ?? null,
    mtTicket: t.mtTicket ?? null,
    openedAt: t.openedAt.toISOString(),
    closedAt: t.closedAt?.toISOString() ?? null,
    oandaTradeId: t.oandaTradeId ?? null,
  };
}

export default router;
