import { logger } from "./logger";

export interface MarketData {
  symbol: string;
  timeframe: string;
  bid: number;
  ask: number;
  spread: number;

  // Price action
  highPrice: number;
  lowPrice: number;
  closePrice: number;
  openPrice?: number;
  prevClose?: number;

  // Trend
  ema20: number;
  ema50: number;
  ema200: number;
  atr?: number;

  // Momentum
  rsi: number;
  rsiPrev?: number;
  macdMain: number;
  macdSignal: number;
  macdHistogram: number;
  macdHistPrev?: number;

  // Volatility
  bollingerUpper?: number;
  bollingerMid?: number;
  bollingerLower?: number;
  bollingerWidth?: number;

  // Strength
  adx?: number;
  plusDI?: number;
  minusDI?: number;

  // Volume
  volume: number;
  volumeAvg?: number;
  volumeRatio?: number;

  // Smart Money
  swingHigh?: number;
  swingLow?: number;
  structureBias?: string;
  nearOrderBlock?: boolean;
  fairValueGap?: string;
  liquidityLevel?: string;

  // Context
  session: string;
  killzone?: boolean;
  trend: string;
  volatility: string;
  dxyBias?: string;
  riskSentiment?: string;

  // State
  consecutiveLosses?: number;
  accountBalance: number;
  accountEquity: number;
  openPositions: number;
  todayTradeCount: number;
  dailyTarget?: number;
}

export interface TradingDecision {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  entryPrice?: number;
  stopLossPips?: number;
  takeProfitPips?: number;
  lotSize?: number;
  reasoning: string;
  riskRewardRatio?: number;
  setupType?: string;
}

const MAX_DAILY_TRADES = 1000;
const GEMINI_MODEL     = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(d: MarketData): string {
  const emaStack =
    d.closePrice > d.ema20 && d.ema20 > d.ema50 && d.ema50 > d.ema200
      ? "BULLISH (price>EMA20>EMA50>EMA200)"
      : d.closePrice < d.ema20 && d.ema20 < d.ema50 && d.ema50 < d.ema200
      ? "BEARISH (price<EMA20<EMA50<EMA200)"
      : d.closePrice > d.ema20 && d.ema20 > d.ema50
      ? "PARTIAL_BULL (price>EMA20>EMA50)"
      : d.closePrice < d.ema20 && d.ema20 < d.ema50
      ? "PARTIAL_BEAR (price<EMA20<EMA50)"
      : "MIXED";

  const macdHist    = d.macdMain - d.macdSignal;
  const macdHistPrv = d.macdHistPrev ?? macdHist;
  const macdDir     =
    macdHist > 0 && Math.abs(macdHist) > Math.abs(macdHistPrv)
      ? "EXPANDING_POSITIVE"
      : macdHist < 0 && Math.abs(macdHist) > Math.abs(macdHistPrv)
      ? "EXPANDING_NEGATIVE"
      : macdHist > 0
      ? "POSITIVE_SHRINKING"
      : macdHist < 0
      ? "NEGATIVE_SHRINKING"
      : "FLAT";

  const rsiDir =
    d.rsiPrev != null
      ? d.rsi > d.rsiPrev
        ? "RISING"
        : d.rsi < d.rsiPrev
        ? "FALLING"
        : "FLAT"
      : "UNKNOWN";

  const adx    = (d.adx    ?? 0).toFixed(1);
  const plusDI = (d.plusDI ?? 0).toFixed(1);
  const minusDI = (d.minusDI ?? 0).toFixed(1);

  return `You are an expert Forex scalping AI trading 0.01 lots on M5. Analyze the data below and decide BUY, SELL, or HOLD.

PAIR: ${d.symbol} | TF: ${d.timeframe}
SESSION: ${d.session}${d.killzone ? " ★KILLZONE★" : ""}
REGIME: trend=${d.trend} volatility=${d.volatility}

PRICE:
  bid=${d.bid.toFixed(5)} ask=${d.ask.toFixed(5)} close=${d.closePrice.toFixed(5)}
  spread=${d.spread.toFixed(1)}pip  ATR=${(d.atr ?? 0).toFixed(5)}
  high=${d.highPrice.toFixed(5)} low=${d.lowPrice.toFixed(5)}

EMA STACK: ${emaStack}
  EMA20=${d.ema20.toFixed(5)} EMA50=${d.ema50.toFixed(5)} EMA200=${d.ema200.toFixed(5)}

ADX/DI: ADX=${adx} +DI=${plusDI} -DI=${minusDI}

MOMENTUM:
  RSI(14)=${d.rsi.toFixed(1)} [${rsiDir}]${d.rsiPrev != null ? ` prev=${d.rsiPrev.toFixed(1)}` : ""}
  MACD hist=${macdHist.toFixed(6)} [${macdDir}]  main=${d.macdMain.toFixed(6)} sig=${d.macdSignal.toFixed(6)}

BOLLINGER:
  upper=${(d.bollingerUpper ?? 0).toFixed(5)} mid=${(d.bollingerMid ?? 0).toFixed(5)} lower=${(d.bollingerLower ?? 0).toFixed(5)}  width=${(d.bollingerWidth ?? 0).toFixed(5)}

SMART MONEY:
  swingHigh=${d.swingHigh?.toFixed(5) ?? "N/A"} swingLow=${d.swingLow?.toFixed(5) ?? "N/A"}
  structureBias=${d.structureBias ?? "N/A"}  nearOrderBlock=${d.nearOrderBlock ? "YES" : "NO"}
  FVG=${d.fairValueGap ?? "NONE"}  liquidityLevel=${d.liquidityLevel ?? "N/A"}

MACRO: DXY=${d.dxyBias ?? "N/A"}  riskSentiment=${d.riskSentiment ?? "N/A"}

STATE: balance=$${d.accountBalance.toFixed(2)} equity=$${d.accountEquity.toFixed(2)}
  openPositions=${d.openPositions}/15  todayTrades=${d.todayTradeCount}  consecutiveLosses=${d.consecutiveLosses ?? 0}

DECISION RULES:
1. BUY when: EMA partial/full bullish stack + RSI 38-62 RISING + MACD EXPANDING_POSITIVE + ADX>18 with +DI>-DI
2. SELL when: EMA partial/full bearish stack + RSI 38-62 FALLING + MACD EXPANDING_NEGATIVE + ADX>18 with -DI>+DI
3. HOLD when: <2 confluent factors, RSI>70 or <30, ADX<18, mixed EMA, or spread>2.5pip
4. ★KILLZONE★: accept 1 strong factor if all others neutral (not contradictory)
5. Confidence 60-70=marginal, 71-80=good, 81-90=strong, 91-95=very strong conviction
6. SL=12pip TP=24pip (R:R 1:2, fixed) — your job is only direction + confidence

Respond ONLY with valid JSON (no markdown, no text outside JSON):
{"action":"BUY","confidence":75,"reasoning":"EMA bull + MACD expand + ADX 28 +DI>-DI","setupType":"TREND_CONTINUATION"}

setupType options: EMA_PULLBACK | MACD_MOMENTUM | TREND_CONTINUATION | OB_BOUNCE | MOMENTUM | REVERSAL`;
}

// ── Gemini REST call ──────────────────────────────────────────────────────────

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
}
interface GeminiResponse {
  candidates?: GeminiCandidate[];
}

async function callGemini(prompt: string): Promise<string> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY env var not set");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      contents:       [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        temperature:      0.2,
        maxOutputTokens:  200,
      },
    }),
    signal: AbortSignal.timeout(12_000),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const json = (await res.json()) as GeminiResponse;
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Empty Gemini response — no text in candidates");
  return text;
}

// ── Response parser ───────────────────────────────────────────────────────────

interface GeminiDecision {
  action:     string;
  confidence: number;
  reasoning:  string;
  setupType?: string;
}

function parseGeminiResponse(text: string): TradingDecision | null {
  try {
    const raw = JSON.parse(text.trim()) as GeminiDecision;
    if (!["BUY", "SELL", "HOLD"].includes(raw.action)) return null;
    if (typeof raw.confidence !== "number")              return null;

    const slPips = 12;
    const tpPips = 24;

    return {
      action:         raw.action as "BUY" | "SELL" | "HOLD",
      confidence:     Math.min(95, Math.max(50, Math.round(raw.confidence))),
      reasoning:      String(raw.reasoning ?? "").slice(0, 180),
      setupType:      raw.setupType ?? "TREND_CONTINUATION",
      stopLossPips:   slPips,
      takeProfitPips: tpPips,
      lotSize:        0.01,
      riskRewardRatio: tpPips / slPips,
    };
  } catch {
    return null;
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

/**
 * Gemini AI scalping signal engine.
 * Hard pre-filters run first (no API call needed for obvious rejects).
 * Falls back to HOLD if Gemini is unreachable or returns garbage.
 */
export async function getScalpingSignal(data: MarketData): Promise<TradingDecision> {
  if (data.todayTradeCount >= MAX_DAILY_TRADES) {
    return { action: "HOLD", confidence: 100, reasoning: "Daily limit of 1000 trades reached." };
  }
  if ((data.consecutiveLosses ?? 0) >= 4) {
    return { action: "HOLD", confidence: 100, reasoning: "Circuit breaker: 4 consecutive losses. Pausing." };
  }
  if (data.spread > 3) {
    return { action: "HOLD", confidence: 80, reasoning: `Spread ${data.spread.toFixed(1)} pips too wide — cost kills edge.` };
  }
  if ((data.adx ?? 25) < 15) {
    return { action: "HOLD", confidence: 70, reasoning: `ADX ${(data.adx ?? 0).toFixed(1)} — market ranging, no trend to follow.` };
  }

  try {
    const prompt   = buildPrompt(data);
    const rawText  = await callGemini(prompt);
    const decision = parseGeminiResponse(rawText);

    if (decision) {
      logger.info(
        { action: decision.action, confidence: decision.confidence, symbol: data.symbol, setup: decision.setupType },
        "Gemini signal"
      );
      return decision;
    }

    logger.warn(
      { symbol: data.symbol, raw: rawText.slice(0, 120) },
      "Gemini unparseable response — HOLD"
    );
  } catch (err) {
    logger.warn(
      { err: String(err), symbol: data.symbol },
      "Gemini call failed — HOLD"
    );
  }

  return { action: "HOLD", confidence: 50, reasoning: "Gemini unavailable — holding." };
}
