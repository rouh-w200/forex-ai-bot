import { useGetBotStatus, useGetDailyStats, useListTrades, useGetStatsHistory, getGetBotStatusQueryKey, getGetDailyStatsQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Activity, ArrowDownRight, ArrowUpRight, Target, TrendingUp, Clock, Ban, MonitorDot, Brain, Cpu, BarChart3
} from "lucide-react";
import { formatPnL, formatPrice, getPnLColor, getStatusColor, formatTime } from "@/lib/format";
import {
  BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";

const SETUP_COLORS: Record<string, string> = {
  EMA_PULLBACK:        "bg-blue-500/15 text-blue-400 border-blue-500/30",
  MACD_MOMENTUM:       "bg-purple-500/15 text-purple-400 border-purple-500/30",
  OB_BOUNCE:           "bg-orange-500/15 text-orange-400 border-orange-500/30",
  FVG_FILL:            "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  TREND_CONTINUATION:  "bg-green-500/15 text-green-400 border-green-500/30",
  BREAKOUT:            "bg-red-500/15 text-red-400 border-red-500/30",
};

function SetupBadge({ setup }: { setup?: string | null }) {
  if (!setup) return null;
  const label = setup.replace(/_/g, " ");
  const cls = SETUP_COLORS[setup] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-bold tracking-wide border ${cls}`}>
      {label}
    </span>
  );
}

function ConfidenceBar({ value }: { value?: number | null }) {
  if (value == null) return null;
  const color = value >= 75 ? "bg-success" : value >= 55 ? "bg-warning" : "bg-muted-foreground";
  return (
    <div className="flex items-center gap-1.5 mt-1">
      <div className="h-1 w-16 bg-muted rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[10px] text-muted-foreground font-mono">{value}%</span>
    </div>
  );
}

export default function Dashboard() {
  const { data: botStatus, isLoading: botLoading } = useGetBotStatus({
    query: { refetchInterval: 5000, queryKey: getGetBotStatusQueryKey() }
  });
  const { data: dailyStats, isLoading: dailyLoading } = useGetDailyStats({
    query: { refetchInterval: 10000, queryKey: getGetDailyStatsQueryKey() }
  });
  const { data: tradesData, isLoading: tradesLoading } = useListTrades({ limit: 12 });
  const { data: historyData, isLoading: historyLoading } = useGetStatsHistory();

  // Setup breakdown from today's trades
  const setupCounts: Record<string, { wins: number; total: number }> = {};
  tradesData?.trades?.forEach(t => {
    const key = (t as any).setupType ?? extractSetup(t.reasoning);
    if (!key) return;
    if (!setupCounts[key]) setupCounts[key] = { wins: 0, total: 0 };
    setupCounts[key].total++;
    if ((t.profitLoss ?? 0) > 0) setupCounts[key].wins++;
  });
  const setupData = Object.entries(setupCounts).map(([name, v]) => ({
    name: name.replace(/_/g, " "),
    total: v.total,
    winRate: v.total > 0 ? Math.round((v.wins / v.total) * 100) : 0,
  })).sort((a, b) => b.total - a.total).slice(0, 5);

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Terminal</h1>
          <p className="text-sm text-muted-foreground">Esecuzione in tempo reale e stato del bot.</p>
        </div>
        {botLoading ? (
          <Skeleton className="h-6 w-24" />
        ) : (
          <Badge variant="outline" className={botStatus?.isActive
            ? "bg-success/10 text-success border-success/20"
            : "bg-destructive/10 text-destructive border-destructive/20"}>
            <Activity className="h-3 w-3 mr-1" />
            {botStatus?.isActive ? "SYSTEM ACTIVE" : "SYSTEM HALTED"}
          </Badge>
        )}
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">P&L Oggi</CardTitle>
            <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {dailyLoading ? <Skeleton className="h-7 w-24 mt-1" /> : (
              <>
                <div className={`text-2xl font-bold data-number ${getPnLColor(dailyStats?.totalProfitLoss)}`}>
                  {formatPnL(dailyStats?.totalProfitLoss || 0)}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5 data-number">
                  {dailyStats?.totalProfitLossPips
                    ? (dailyStats.totalProfitLossPips > 0 ? "+" : "") + dailyStats.totalProfitLossPips.toFixed(1)
                    : "0.0"} pips
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Win Rate</CardTitle>
            <Target className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {dailyLoading ? <Skeleton className="h-7 w-20 mt-1" /> : (
              <>
                <div className="text-2xl font-bold data-number">{(dailyStats?.winRate || 0).toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  <span className="text-success font-medium">{dailyStats?.winningTrades || 0}W</span>
                  {" – "}
                  <span className="text-destructive font-medium">{dailyStats?.losingTrades || 0}L</span>
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trade Oggi</CardTitle>
            <Activity className="h-3.5 w-3.5 text-muted-foreground" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {botLoading ? <Skeleton className="h-7 w-20 mt-1" /> : (
              <>
                <div className="text-2xl font-bold data-number">
                  {botStatus?.todayTradeCount || 0}
                  <span className="text-muted-foreground text-base"> / {botStatus?.maxDailyTrades || 100}</span>
                </div>
                <div className="mt-1.5 h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <div className="h-full bg-primary rounded-full transition-all"
                    style={{ width: `${Math.min(100, ((botStatus?.todayTradeCount || 0) / (botStatus?.maxDailyTrades || 100)) * 100)}%` }} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Posizioni Aperte</CardTitle>
            <Clock className="h-3.5 w-3.5 text-warning" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            {botLoading ? <Skeleton className="h-7 w-12 mt-1" /> : (
              <>
                <div className="text-2xl font-bold data-number text-warning">{botStatus?.openPositions || 0}</div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Ultimo segnale: <span className="text-foreground font-medium">{botStatus?.lastSignalAction || "—"}</span>
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Live Trade Feed — with setup + confidence + reasoning */}
        <Card className="col-span-1 lg:col-span-2 border-border bg-card/50 shadow-sm flex flex-col">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold tracking-wide flex items-center gap-2">
              <MonitorDot className="h-4 w-4 text-muted-foreground" />
              LIVE TRADE FEED
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto">
            {tradesLoading ? (
              <div className="p-4 space-y-3">
                {[1, 2, 3, 4].map(i => <Skeleton key={i} className="h-16 w-full" />)}
              </div>
            ) : !tradesData?.trades?.length ? (
              <div className="flex flex-col items-center justify-center h-48 text-muted-foreground">
                <Ban className="h-8 w-8 mb-2 opacity-50" />
                <p className="text-sm">Nessun trade oggi.</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {tradesData.trades.map((trade) => {
                  const setup = (trade as any).setupType ?? extractSetup(trade.reasoning);
                  return (
                    <div key={trade.id}
                      className={`flex items-start justify-between px-4 py-3 transition-colors hover:bg-muted/20 ${trade.status === "OPEN" ? "bg-warning/5 border-l-2 border-l-warning" : ""}`}>
                      {/* Left: direction + info */}
                      <div className="flex items-start gap-3 min-w-0">
                        <div className={`flex items-center justify-center h-9 w-9 rounded shrink-0 ${trade.direction === "BUY" ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive"}`}>
                          {trade.direction === "BUY"
                            ? <ArrowUpRight className="h-5 w-5" />
                            : <ArrowDownRight className="h-5 w-5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-bold tracking-wider text-sm">{trade.symbol}</span>
                            <Badge variant="outline"
                              className={`text-[9px] h-4 px-1 rounded-sm border-0 font-mono ${getStatusColor(trade.status)}`}>
                              {trade.status}
                            </Badge>
                            {setup && <SetupBadge setup={setup} />}
                          </div>
                          <div className="text-[11px] text-muted-foreground mt-0.5 data-number flex flex-wrap gap-x-2">
                            <span>{formatTime(trade.openedAt)}</span>
                            <span>·</span>
                            <span>{trade.lotSize} lot</span>
                            <span>·</span>
                            <span>
                              {formatPrice(trade.entryPrice)}
                              {trade.status === "CLOSED" && ` → ${formatPrice(trade.closePrice)}`}
                            </span>
                            {trade.stopLossPips && (
                              <><span>·</span><span className="text-destructive/70">SL {trade.stopLossPips}p</span></>
                            )}
                            {trade.takeProfitPips && (
                              <><span>·</span><span className="text-success/70">TP {trade.takeProfitPips}p</span></>
                            )}
                          </div>
                          {/* Claude Reasoning */}
                          {trade.reasoning && (
                            <p className="text-[10px] text-muted-foreground mt-1 leading-tight italic line-clamp-2 max-w-xs md:max-w-none">
                              {trade.reasoning}
                            </p>
                          )}
                          <ConfidenceBar value={(trade as any).confidence} />
                        </div>
                      </div>

                      {/* Right: P&L */}
                      <div className="text-right shrink-0 ml-2">
                        {trade.status === "CLOSED" ? (
                          <>
                            <div className={`font-bold data-number text-sm ${getPnLColor(trade.profitLoss)}`}>
                              {formatPnL(trade.profitLoss)}
                            </div>
                            <div className={`text-[10px] data-number ${getPnLColor(trade.profitLossPips)} opacity-80`}>
                              {trade.profitLossPips
                                ? (trade.profitLossPips > 0 ? "+" : "") + trade.profitLossPips.toFixed(1)
                                : "0.0"} pips
                            </div>
                            {trade.riskRewardRatio && (
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                R:R {Number(trade.riskRewardRatio).toFixed(1)}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="text-warning text-xs font-medium animate-pulse">ACTIVE</div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Right column: 30-day chart + Setup breakdown */}
        <div className="flex flex-col gap-4">
          {/* 30-Day P&L Chart */}
          <Card className="border-border bg-card/50 shadow-sm flex flex-col">
            <CardHeader className="border-b border-border pb-3 pt-4 px-4">
              <CardTitle className="text-sm font-semibold tracking-wide flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-muted-foreground" />
                P&L 30 GIORNI
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 h-[220px]">
              {historyLoading ? <Skeleton className="h-full w-full" /> :
               !historyData?.length ? (
                <div className="flex items-center justify-center h-full text-muted-foreground text-xs">Nessun dato</div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <ReBarChart data={historyData.slice(-30).reverse()} margin={{ top: 5, right: 5, left: -22, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={(v) => new Date(v).getDate().toString()}
                      stroke="hsl(var(--muted-foreground))" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10}
                      tickFormatter={(v) => `$${v}`} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{ fill: "hsl(var(--muted))" }}
                      content={({ active, payload }) => {
                        if (active && payload?.length) {
                          const d = payload[0].payload;
                          return (
                            <div className="bg-card border border-border p-2 rounded shadow-lg text-xs font-mono">
                              <div className="text-muted-foreground">{new Date(d.date).toLocaleDateString("it-IT")}</div>
                              <div className={d.totalProfitLoss >= 0 ? "text-success" : "text-destructive"}>
                                {formatPnL(d.totalProfitLoss)}
                              </div>
                              <div className="text-foreground">{d.winningTrades}V / {d.losingTrades}P</div>
                            </div>
                          );
                        }
                        return null;
                      }} />
                    <Bar dataKey="totalProfitLoss" radius={[2, 2, 0, 0]}>
                      {historyData.slice(-30).reverse().map((e, i) => (
                        <Cell key={i} fill={e.totalProfitLoss >= 0 ? "hsl(var(--success))" : "hsl(var(--destructive))"} />
                      ))}
                    </Bar>
                  </ReBarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          {/* Claude Setups Breakdown */}
          <Card className="border-border bg-card/50 shadow-sm">
            <CardHeader className="border-b border-border pb-3 pt-4 px-4">
              <CardTitle className="text-sm font-semibold tracking-wide flex items-center gap-2">
                <Brain className="h-4 w-4 text-muted-foreground" />
                SETUP CLAUDE OGGI
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              {tradesLoading ? (
                <div className="space-y-2">{[1,2,3].map(i=><Skeleton key={i} className="h-8 w-full"/>)}</div>
              ) : setupData.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-4">
                  Nessun trade oggi
                </div>
              ) : (
                <div className="space-y-2.5">
                  {setupData.map(s => (
                    <div key={s.name}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="font-medium">{s.name}</span>
                        <span className="text-muted-foreground">{s.total} trade · {s.winRate}% win</span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full"
                          style={{ width: `${s.winRate}%` }} />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Indicators Legend */}
          <Card className="border-border bg-card/50 shadow-sm">
            <CardHeader className="border-b border-border pb-3 pt-4 px-4">
              <CardTitle className="text-sm font-semibold tracking-wide flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                INDICATORI IN USO
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4">
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  { label: "EMA 20/50/200", desc: "Trend stack" },
                  { label: "RSI 14", desc: "Momentum" },
                  { label: "MACD Hist", desc: "Espansione" },
                  { label: "ADX / ±DI", desc: "Forza trend" },
                  { label: "Bollinger", desc: "Volatilità" },
                  { label: "Order Block", desc: "SMC/ICT" },
                  { label: "Fair Value Gap", desc: "Liquidità" },
                  { label: "ATR", desc: "SL/TP size" },
                  { label: "Volume Ratio", desc: "Conferma" },
                  { label: "Killzone", desc: "Sessione" },
                ].map(ind => (
                  <div key={ind.label} className="flex flex-col">
                    <span className="font-medium text-foreground">{ind.label}</span>
                    <span className="text-muted-foreground text-[10px]">{ind.desc}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function extractSetup(reasoning?: string | null): string | null {
  if (!reasoning) return null;
  const patterns: [RegExp, string][] = [
    [/ema.*pullback|pullback.*ema/i, "EMA_PULLBACK"],
    [/macd.*momentum|momentum.*macd/i, "MACD_MOMENTUM"],
    [/order.?block|ob.bounce/i, "OB_BOUNCE"],
    [/fair.?value.?gap|fvg/i, "FVG_FILL"],
    [/trend.?cont/i, "TREND_CONTINUATION"],
    [/breakout/i, "BREAKOUT"],
  ];
  for (const [re, name] of patterns) if (re.test(reasoning)) return name;
  return null;
}

