import { Router, type IRouter } from "express";
import { eq, and, gte, lte, desc, count, sum, max, min, avg } from "drizzle-orm";
import { db, tradesTable } from "@workspace/db";
import {
  GetDailyStatsResponse,
  GetOverviewStatsResponse,
  GetStatsHistoryResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

function todayRange() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

function dateToRange(dateStr: string) {
  const start = new Date(dateStr);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return { start, end };
}

// GET /stats/daily
router.get("/stats/daily", async (req, res): Promise<void> => {
  const { start, end } = todayRange();

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(gte(tradesTable.openedAt, start), lte(tradesTable.openedAt, end)));

  const closedTrades = trades.filter((t) => t.status === "CLOSED");
  const openTrades = trades.filter((t) => t.status === "OPEN");
  const winningTrades = closedTrades.filter((t) => Number(t.profitLoss) > 0);
  const losingTrades = closedTrades.filter((t) => Number(t.profitLoss) <= 0);
  const totalPL = closedTrades.reduce((sum, t) => sum + Number(t.profitLoss ?? 0), 0);
  const totalPLPips = closedTrades.reduce((sum, t) => sum + Number(t.profitLossPips ?? 0), 0);
  const winRate = closedTrades.length > 0 ? (winningTrades.length / closedTrades.length) * 100 : 0;
  const avgRR = closedTrades.length > 0
    ? closedTrades.reduce((sum, t) => sum + Number(t.riskRewardRatio ?? 0), 0) / closedTrades.length
    : 0;
  const pls = closedTrades.map((t) => Number(t.profitLoss ?? 0));

  res.json(GetDailyStatsResponse.parse({
    date: start.toISOString().split("T")[0],
    totalTrades: trades.length,
    openTrades: openTrades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    totalProfitLoss: totalPL,
    totalProfitLossPips: totalPLPips,
    winRate,
    avgRR,
    tradesRemaining: Math.max(0, 100 - trades.length),
    bestTrade: pls.length > 0 ? Math.max(...pls) : null,
    worstTrade: pls.length > 0 ? Math.min(...pls) : null,
  }));
});

// GET /stats/overview
router.get("/stats/overview", async (req, res): Promise<void> => {
  const allTrades = await db
    .select()
    .from(tradesTable)
    .where(eq(tradesTable.status, "CLOSED"));

  const totalWins = allTrades.filter((t) => Number(t.profitLoss) > 0).length;
  const totalLosses = allTrades.filter((t) => Number(t.profitLoss) <= 0).length;
  const totalPL = allTrades.reduce((s, t) => s + Number(t.profitLoss ?? 0), 0);
  const winRate = allTrades.length > 0 ? (totalWins / allTrades.length) * 100 : 0;
  const avgRR = allTrades.length > 0
    ? allTrades.reduce((s, t) => s + Number(t.riskRewardRatio ?? 0), 0) / allTrades.length
    : 0;

  // Group by day for day stats
  const byDay: Record<string, number> = {};
  for (const t of allTrades) {
    const day = t.closedAt?.toISOString().split("T")[0] ?? t.openedAt.toISOString().split("T")[0];
    byDay[day] = (byDay[day] ?? 0) + Number(t.profitLoss ?? 0);
  }
  const dayValues = Object.values(byDay);
  const bestDay = dayValues.length > 0 ? Math.max(...dayValues) : 0;
  const worstDay = dayValues.length > 0 ? Math.min(...dayValues) : 0;

  // Win/loss streak
  const sorted = [...allTrades].sort((a, b) => new Date(a.closedAt ?? a.openedAt).getTime() - new Date(b.closedAt ?? b.openedAt).getTime());
  let currentStreak = 0;
  let longestWinStreak = 0;
  let tempStreak = 0;

  for (let i = sorted.length - 1; i >= 0; i--) {
    const isWin = Number(sorted[i].profitLoss ?? 0) > 0;
    if (i === sorted.length - 1) {
      currentStreak = isWin ? 1 : -1;
    } else {
      const prevWin = Number(sorted[i + 1].profitLoss ?? 0) > 0;
      if (isWin === prevWin) currentStreak += isWin ? 1 : -1;
      else break;
    }
  }

  for (const t of sorted) {
    if (Number(t.profitLoss ?? 0) > 0) {
      tempStreak++;
      longestWinStreak = Math.max(longestWinStreak, tempStreak);
    } else {
      tempStreak = 0;
    }
  }

  res.json(GetOverviewStatsResponse.parse({
    totalTrades: allTrades.length,
    totalWins,
    totalLosses,
    totalProfitLoss: totalPL,
    winRate,
    avgRR,
    bestDay,
    worstDay,
    activeDays: Object.keys(byDay).length,
    currentStreak,
    longestWinStreak,
  }));
});

// GET /stats/history — last 30 days
router.get("/stats/history", async (req, res): Promise<void> => {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const trades = await db
    .select()
    .from(tradesTable)
    .where(and(gte(tradesTable.openedAt, thirtyDaysAgo), eq(tradesTable.status, "CLOSED")));

  const byDay: Record<string, typeof trades> = {};
  for (const t of trades) {
    const day = t.closedAt?.toISOString().split("T")[0] ?? t.openedAt.toISOString().split("T")[0];
    if (!byDay[day]) byDay[day] = [];
    byDay[day].push(t);
  }

  const history = Object.entries(byDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, dayTrades]) => {
      const wins = dayTrades.filter((t) => Number(t.profitLoss) > 0).length;
      const losses = dayTrades.filter((t) => Number(t.profitLoss) <= 0).length;
      const totalPL = dayTrades.reduce((s, t) => s + Number(t.profitLoss ?? 0), 0);
      const winRate = dayTrades.length > 0 ? (wins / dayTrades.length) * 100 : 0;
      return { date, totalTrades: dayTrades.length, winningTrades: wins, losingTrades: losses, totalProfitLoss: totalPL, winRate };
    });

  res.json(GetStatsHistoryResponse.parse(history));
});

export default router;
