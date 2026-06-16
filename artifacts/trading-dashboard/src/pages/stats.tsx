import { useState, useMemo } from "react";
import { useGetOverviewStats, useGetStatsHistory, useListTrades } from "@workspace/api-client-react";
import { formatPnL, getPnLColor } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  LineChart, Line, AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, PieChart, Pie,
} from "recharts";
import { Trophy, TrendingDown, Target, Zap, Activity, CalendarDays, Percent, Brain } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const SETUP_COLORS: Record<string, string> = {
  "EMA PULLBACK":       "#3b82f6",
  "MACD MOMENTUM":      "#a855f7",
  "OB BOUNCE":          "#f97316",
  "FVG FILL":           "#06b6d4",
  "TREND CONTINUATION": "#22c55e",
  "BREAKOUT":           "#ef4444",
};

type Period = "today" | "7d" | "30d" | "all";

const PERIOD_OPTIONS: { value: Period; label: string; days: number | null }[] = [
  { value: "today", label: "Oggi",      days: 0 },
  { value: "7d",    label: "7 Giorni",  days: 7 },
  { value: "30d",   label: "30 Giorni", days: 30 },
  { value: "all",   label: "Tutto",     days: null },
];

function extractSetup(reasoning?: string | null): string | null {
  if (!reasoning) return null;
  const patterns: [RegExp, string][] = [
    [/ema.*pullback|pullback.*ema/i,   "EMA PULLBACK"],
    [/macd.*momentum|momentum.*macd/i, "MACD MOMENTUM"],
    [/order.?block|ob.bounce/i,        "OB BOUNCE"],
    [/fair.?value.?gap|fvg/i,          "FVG FILL"],
    [/trend.?cont/i,                   "TREND CONTINUATION"],
    [/breakout/i,                      "BREAKOUT"],
  ];
  for (const [re, name] of patterns) if (re.test(reasoning)) return name;
  return null;
}

function periodStart(period: Period): Date | null {
  const now = new Date();
  if (period === "today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (period === "7d") {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d;
  }
  if (period === "30d") {
    const d = new Date(now); d.setDate(d.getDate() - 30); return d;
  }
  return null; // all
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Stats() {
  const [period, setPeriod] = useState<Period>("7d");

  const { data: history,   isLoading: historyLoading  } = useGetStatsHistory();
  const { data: allTrades, isLoading: tradesLoading   } = useListTrades({ limit: 5000 });

  const pStart = periodStart(period);

  // Filter trades by period
  const trades = useMemo(() => {
    const raw = allTrades?.trades ?? [];
    if (!pStart) return raw;
    return raw.filter(t => new Date(t.openedAt) >= pStart);
  }, [allTrades, period]);

  // Filter history by period
  const filteredHistory = useMemo(() => {
    const raw = history ? [...history].reverse() : [];
    if (!pStart) return raw;
    return raw.filter(d => new Date(d.date) >= pStart);
  }, [history, period]);

  const closedTrades = trades.filter(t => t.status === "CLOSED");
  const wins         = closedTrades.filter(t => (t.profitLoss ?? 0) > 0).length;
  const losses       = closedTrades.length - wins;
  const winRate      = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const totalPnL     = closedTrades.reduce((s, t) => s + Number(t.profitLoss ?? 0), 0);
  const avgRR        = closedTrades.length > 0
    ? closedTrades.reduce((s, t) => s + Number(t.riskRewardRatio ?? 0), 0) / closedTrades.length
    : 0;

  // Best / worst day in period
  const byDay: Record<string, number> = {};
  for (const t of closedTrades) {
    const day = (t.closedAt ? new Date(t.closedAt) : new Date(t.openedAt)).toISOString().split("T")[0];
    byDay[day] = (byDay[day] ?? 0) + Number(t.profitLoss ?? 0);
  }
  const dayValues = Object.values(byDay);
  const bestDay  = dayValues.length > 0 ? Math.max(...dayValues) : 0;
  const worstDay = dayValues.length > 0 ? Math.min(...dayValues) : 0;
  const activeDays = Object.keys(byDay).length;

  // Streak (in period)
  const sorted = [...closedTrades].sort((a, b) =>
    new Date(a.closedAt ?? a.openedAt).getTime() - new Date(b.closedAt ?? b.openedAt).getTime()
  );
  let currentStreak = 0, longestWinStreak = 0, tempStreak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    const isWin = Number(sorted[i].profitLoss ?? 0) > 0;
    if (i === sorted.length - 1) { currentStreak = isWin ? 1 : -1; }
    else {
      const prevWin = Number(sorted[i + 1].profitLoss ?? 0) > 0;
      if (isWin === prevWin) currentStreak += isWin ? 1 : -1; else break;
    }
  }
  for (const t of sorted) {
    if (Number(t.profitLoss ?? 0) > 0) { tempStreak++; longestWinStreak = Math.max(longestWinStreak, tempStreak); }
    else tempStreak = 0;
  }

  // Setup analysis (period)
  const setupMap: Record<string, { wins: number; losses: number; pips: number }> = {};
  trades.forEach(t => {
    const key = (t as any).setupType ?? extractSetup(t.reasoning);
    if (!key) return;
    if (!setupMap[key]) setupMap[key] = { wins: 0, losses: 0, pips: 0 };
    if ((t.profitLoss ?? 0) > 0) setupMap[key].wins++;
    else if (t.status === "CLOSED") setupMap[key].losses++;
    setupMap[key].pips += Number(t.profitLossPips ?? 0);
  });
  const setupData = Object.entries(setupMap).map(([name, v]) => ({
    name, wins: v.wins, losses: v.losses,
    total: v.wins + v.losses,
    winRate: v.wins + v.losses > 0 ? Math.round((v.wins / (v.wins + v.losses)) * 100) : 0,
    pips: Math.round(v.pips * 10) / 10,
  })).sort((a, b) => b.total - a.total);

  const pieData = setupData.slice(0, 6).map(s => ({ name: s.name, value: s.total }));

  // Symbol performance (period)
  const symMap: Record<string, { wins: number; losses: number; pips: number; pnl: number }> = {};
  trades.filter(t => t.status === "CLOSED").forEach(t => {
    if (!symMap[t.symbol]) symMap[t.symbol] = { wins: 0, losses: 0, pips: 0, pnl: 0 };
    if ((t.profitLoss ?? 0) > 0) symMap[t.symbol].wins++;
    else symMap[t.symbol].losses++;
    symMap[t.symbol].pips += Number(t.profitLossPips ?? 0);
    symMap[t.symbol].pnl  += Number(t.profitLoss ?? 0);
  });
  const symData = Object.entries(symMap).map(([sym, v]) => ({
    sym, wins: v.wins, losses: v.losses,
    total: v.wins + v.losses,
    winRate: v.wins + v.losses > 0 ? Math.round((v.wins / (v.wins + v.losses)) * 100) : 0,
    pips: Math.round(v.pips * 10) / 10,
    pnl: Math.round(v.pnl * 100) / 100,
  })).sort((a, b) => b.pnl - a.pnl);

  const overviewLoading = false;

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-4">

      {/* ── Header + period selector ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Performance Analytics</h1>
          <p className="text-sm text-muted-foreground">I tuoi trade — analisi per periodo selezionato.</p>
        </div>
        <div className="flex gap-1 bg-muted/40 p-1 rounded-lg border border-border">
          {PERIOD_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setPeriod(opt.value)}
              className={cn(
                "px-3 py-1.5 text-xs font-semibold rounded-md transition-all",
                period === opt.value
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Period summary banner ── */}
      <div className="flex items-center gap-4 px-4 py-2.5 rounded-lg border border-border bg-card/50 text-sm font-mono">
        <span className="text-muted-foreground text-xs uppercase tracking-wider">Periodo:</span>
        <span className="font-bold text-foreground">
          {period === "today" ? "Oggi"
            : period === "7d"  ? "Ultimi 7 giorni"
            : period === "30d" ? "Ultimi 30 giorni"
            : "Tutti i trade"}
        </span>
        <span className="text-border">·</span>
        <span>{trades.length} trade totali</span>
        <span className="text-border">·</span>
        <span className={cn(totalPnL >= 0 ? "text-success" : "text-destructive", "font-bold")}>
          {formatPnL(totalPnL)} P&L
        </span>
        <span className="text-border">·</span>
        <span>{winRate.toFixed(1)}% win rate</span>
      </div>

      {/* ── KPI Grid ── */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
        <StatCard title="Win Rate"       value={`${winRate.toFixed(1)}%`}                 icon={Target}       loading={false} />
        <StatCard title="Trade Chiusi"   value={`${wins}V / ${losses}P`}                  icon={Activity}     loading={false} />
        <StatCard title="Avg R:R"        value={`1:${avgRR.toFixed(2)}`}                  icon={Percent}      loading={false} />
        <StatCard title="Giorni Attivi"  value={activeDays}                               icon={CalendarDays} loading={false} />
        <StatCard title="Best Streak"    value={`${longestWinStreak}W`}                   icon={Zap}          loading={false} iconColor="text-success" />
        <StatCard title="Streak Attuale" value={currentStreak > 0 ? `+${currentStreak}W` : `${currentStreak}L`}
          icon={Zap} loading={false}
          iconColor={currentStreak > 0 ? "text-success" : "text-destructive"} />
      </div>

      {/* ── Best / Worst day ── */}
      <div className="grid grid-cols-2 gap-3">
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Miglior Giorno</CardTitle>
            <Trophy className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-3xl font-bold data-number text-success">{formatPnL(bestDay)}</div>
          </CardContent>
        </Card>
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Peggior Giorno</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="text-3xl font-bold data-number text-destructive">{formatPnL(worstDay)}</div>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Cumulative P&L */}
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold tracking-wide">P&L CUMULATIVO</CardTitle>
          </CardHeader>
          <CardContent className="p-4 h-[280px]">
            {historyLoading ? <Skeleton className="h-full w-full" /> :
             !filteredHistory.length ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                Nessun dato nel periodo selezionato
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={getAccumulatedPnL(filteredHistory)} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%"  stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date"
                    tickFormatter={v => new Date(v).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
                    stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11}
                    tickFormatter={v => `$${v}`} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="cumPnL"
                    stroke="hsl(var(--primary))" fillOpacity={1} fill="url(#pnlGrad)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Win Rate trend */}
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold tracking-wide">WIN RATE GIORNALIERO (%)</CardTitle>
          </CardHeader>
          <CardContent className="p-4 h-[280px]">
            {historyLoading ? <Skeleton className="h-full w-full" /> :
             !filteredHistory.length ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                Nessun dato nel periodo selezionato
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={filteredHistory} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date"
                    tickFormatter={v => new Date(v).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
                    stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11}
                    tickFormatter={v => `${v}%`} tickLine={false} axisLine={false} domain={[0, 100]} />
                  <Tooltip content={<CustomTooltip type="percent" />} />
                  <Line type="monotone" dataKey="winRate"
                    stroke="hsl(var(--warning))" strokeWidth={2}
                    dot={{ r: 2, fill: "hsl(var(--warning))" }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Setup + Symbol analysis ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Setup Win Rate */}
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold tracking-wide flex items-center gap-2">
              <Brain className="h-4 w-4 text-muted-foreground" />
              PERFORMANCE PER SETUP CLAUDE
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {tradesLoading ? (
              <div className="space-y-3">{[1,2,3,4,5].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : setupData.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Nessun dato setup nel periodo selezionato
              </div>
            ) : (
              <div className="space-y-4">
                {setupData.map(s => (
                  <div key={s.name}>
                    <div className="flex justify-between items-end mb-1">
                      <span className="text-xs font-semibold">{s.name}</span>
                      <div className="text-right">
                        <span className={`text-xs font-bold ${s.winRate >= 60 ? "text-success" : s.winRate >= 45 ? "text-warning" : "text-destructive"}`}>
                          {s.winRate}%
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-2">
                          {s.wins}V/{s.losses}P · {s.pips > 0 ? "+" : ""}{s.pips} pip
                        </span>
                      </div>
                    </div>
                    <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all",
                        s.winRate >= 65 ? "bg-success" : s.winRate >= 50 ? "bg-warning" : "bg-destructive"
                      )} style={{ width: `${s.winRate}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{s.total} trade totali</div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Symbol performance */}
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold tracking-wide">PERFORMANCE PER COPPIA</CardTitle>
          </CardHeader>
          <CardContent className="p-4">
            {tradesLoading ? (
              <div className="space-y-3">{[1,2,3,4,5,6,7].map(i => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : symData.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-8">
                Nessun dato nel periodo selezionato
              </div>
            ) : (
              <div className="space-y-3">
                {symData.map(s => (
                  <div key={s.sym} className="flex items-center gap-3">
                    <div className="w-16 text-xs font-bold tracking-wider font-mono">{s.sym}</div>
                    <div className="flex-1">
                      <div className="flex justify-between text-[10px] mb-0.5">
                        <span className="text-muted-foreground">{s.wins}V / {s.losses}P</span>
                        <span className={cn("font-semibold", s.winRate >= 60 ? "text-success" : "text-warning")}>
                          {s.winRate}%
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                        <div className={cn("h-full rounded-full",
                          s.winRate >= 60 ? "bg-success" : s.winRate >= 45 ? "bg-warning" : "bg-destructive"
                        )} style={{ width: `${s.winRate}%` }} />
                      </div>
                    </div>
                    <div className={cn("text-xs font-bold data-number w-14 text-right", getPnLColor(s.pnl))}>
                      {s.pnl >= 0 ? "+" : ""}${s.pnl.toFixed(2)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Distribuzione Setup + Trade per giorno ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* Pie chart */}
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold tracking-wide">DISTRIBUZIONE SETUP</CardTitle>
          </CardHeader>
          <CardContent className="p-4 h-[280px]">
            {tradesLoading ? <Skeleton className="h-full w-full" /> :
             pieData.length === 0 ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                Nessun dato nel periodo selezionato
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={pieData} dataKey="value" nameKey="name"
                    cx="50%" cy="50%" outerRadius={90} innerRadius={50}
                    paddingAngle={3}
                    label={({ name, percent }) => `${name.split(" ")[0]} ${(percent * 100).toFixed(0)}%`}
                    labelLine={false} fontSize={10}>
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={Object.values(SETUP_COLORS)[i % Object.values(SETUP_COLORS).length]} />
                    ))}
                  </Pie>
                  <Tooltip content={({ active, payload }) => {
                    if (active && payload?.length) return (
                      <div className="bg-card border border-border p-2 rounded shadow-lg text-xs font-mono">
                        <div className="font-bold">{payload[0].name}</div>
                        <div className="text-muted-foreground">{payload[0].value} trade</div>
                      </div>
                    );
                    return null;
                  }} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Daily trade count bar */}
        <Card className="border-border bg-card/50 shadow-sm">
          <CardHeader className="border-b border-border pb-3 pt-4 px-4">
            <CardTitle className="text-sm font-semibold tracking-wide">TRADE PER GIORNO</CardTitle>
          </CardHeader>
          <CardContent className="p-4 h-[280px]">
            {historyLoading ? <Skeleton className="h-full w-full" /> :
             !filteredHistory.length ? (
              <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                Nessun dato nel periodo selezionato
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={filteredHistory} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="date"
                    tickFormatter={v => new Date(v).toLocaleDateString("it-IT", { day: "numeric", month: "short" })}
                    stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                  <Tooltip content={({ active, payload }) => {
                    if (active && payload?.length) {
                      const d = payload[0].payload;
                      return (
                        <div className="bg-card border border-border p-2 rounded shadow-lg text-xs font-mono">
                          <div className="text-muted-foreground">{new Date(d.date).toLocaleDateString("it-IT")}</div>
                          <div className="font-semibold">{d.totalTrades} trade</div>
                          <div className="text-success">{d.winningTrades} vincenti</div>
                          <div className="text-destructive">{d.losingTrades} perdenti</div>
                          <div className={cn("font-bold mt-1", d.totalProfitLoss >= 0 ? "text-success" : "text-destructive")}>
                            {formatPnL(d.totalProfitLoss)}
                          </div>
                        </div>
                      );
                    }
                    return null;
                  }} />
                  <Bar dataKey="totalTrades" radius={[3, 3, 0, 0]} fill="hsl(var(--primary))" opacity={0.85} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function StatCard({ title, value, icon: Icon, loading, iconColor = "text-muted-foreground" }: any) {
  return (
    <Card className="border-border bg-card/50 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3 px-3">
        <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-tight">
          {title}
        </CardTitle>
        <Icon className={`h-3.5 w-3.5 shrink-0 ${iconColor}`} />
      </CardHeader>
      <CardContent className="px-3 pb-3">
        {loading ? <Skeleton className="h-6 w-16 mt-1" /> : (
          <div className="text-lg font-bold data-number">{value ?? "—"}</div>
        )}
      </CardContent>
    </Card>
  );
}

function getAccumulatedPnL(history: any[]) {
  let acc = 0;
  return history.map(day => {
    acc += day.totalProfitLoss;
    return { ...day, cumPnL: Math.round(acc * 100) / 100 };
  });
}

function CustomTooltip({ active, payload, label, type = "currency" }: any) {
  if (active && payload?.length) {
    const value = payload[0].value;
    return (
      <div className="bg-card border border-border p-2 rounded shadow-lg text-xs font-mono">
        <div className="text-muted-foreground mb-1">{new Date(label).toLocaleDateString("it-IT")}</div>
        <div className="font-bold">{type === "currency" ? formatPnL(value) : `${value?.toFixed(1)}%`}</div>
      </div>
    );
  }
  return null;
}
