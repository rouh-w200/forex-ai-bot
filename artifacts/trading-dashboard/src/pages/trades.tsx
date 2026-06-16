import { useState, Fragment } from "react";
import { useListTrades } from "@workspace/api-client-react";
import { formatPnL, formatPrice, formatPips, getPnLColor, getStatusColor, formatTime, formatDate } from "@/lib/format";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, ChevronDown, Brain } from "lucide-react";
import { formatDistanceStrict } from "date-fns";

const SETUP_COLORS: Record<string, string> = {
  EMA_PULLBACK:       "bg-blue-500/15 text-blue-400 border-blue-500/30",
  MACD_MOMENTUM:      "bg-purple-500/15 text-purple-400 border-purple-500/30",
  OB_BOUNCE:          "bg-orange-500/15 text-orange-400 border-orange-500/30",
  FVG_FILL:           "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  TREND_CONTINUATION: "bg-green-500/15 text-green-400 border-green-500/30",
  BREAKOUT:           "bg-red-500/15 text-red-400 border-red-500/30",
};

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

function SetupBadge({ setup }: { setup?: string | null }) {
  if (!setup) return <span className="text-muted-foreground text-xs">—</span>;
  const label = setup.replace(/_/g, " ");
  const cls = SETUP_COLORS[setup] ?? "bg-muted text-muted-foreground border-border";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide border ${cls}`}>
      {label}
    </span>
  );
}

export default function Trades() {
  const [page, setPage]       = useState(0);
  const [expanded, setExpanded] = useState<number | null>(null);
  const limit = 20;

  const { data: tradesData, isLoading } = useListTrades({ limit, offset: page * limit });

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto pb-4 flex flex-col h-[calc(100vh-8rem)]">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Cronologia Trade</h1>
        <p className="text-sm text-muted-foreground">Log completo con setup, indicatori e ragionamento di Claude.</p>
      </div>

      <Card className="border-border bg-card/50 shadow-sm flex-1 flex flex-col overflow-hidden">
        <CardContent className="p-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="bg-muted/50 sticky top-0 z-10">
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="w-[140px] text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Ora / Coppia
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Tipo
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Setup Claude
                </TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Entrata → Uscita
                </TableHead>
                <TableHead className="text-center text-xs uppercase tracking-wider text-muted-foreground font-semibold hidden sm:table-cell">
                  SL / TP
                </TableHead>
                <TableHead className="text-center text-xs uppercase tracking-wider text-muted-foreground font-semibold hidden md:table-cell">
                  Conf.
                </TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  P&L
                </TableHead>
                <TableHead className="text-xs uppercase tracking-wider text-muted-foreground font-semibold hidden lg:table-cell">
                  Durata
                </TableHead>
                <TableHead className="text-right text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Stato
                </TableHead>
                <TableHead className="w-8" />
              </TableRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <TableRow key={i} className="border-border">
                    {Array.from({ length: 9 }).map((_, j) => (
                      <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                    ))}
                    <TableCell />
                  </TableRow>
                ))
              ) : tradesData?.trades.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={10} className="h-48 text-center text-muted-foreground">
                    Nessun trade trovato.
                  </TableCell>
                </TableRow>
              ) : (
                tradesData?.trades.map((trade) => {
                  const duration = trade.closedAt && trade.openedAt
                    ? formatDistanceStrict(new Date(trade.openedAt), new Date(trade.closedAt))
                    : "—";
                  const setup = (trade as any).setupType ?? extractSetup(trade.reasoning);
                  const confidence = (trade as any).confidence as number | null;
                  const isOpen = expanded === trade.id;

                  return (
                    <Fragment key={trade.id}>
                      <TableRow
                        className={`border-border hover:bg-muted/20 cursor-pointer transition-colors ${trade.status === "OPEN" ? "bg-warning/5 border-l-2 border-l-warning" : ""}`}
                        onClick={() => setExpanded(isOpen ? null : trade.id)}
                      >
                        {/* Ora / Coppia */}
                        <TableCell>
                          <div className="font-bold tracking-wider text-sm">{trade.symbol}</div>
                          <div className="text-[10px] text-muted-foreground data-number">
                            {formatDate(trade.openedAt)} {formatTime(trade.openedAt)}
                          </div>
                        </TableCell>

                        {/* Tipo */}
                        <TableCell>
                          <div className={`flex items-center gap-1 font-semibold text-sm ${trade.direction === "BUY" ? "text-success" : "text-destructive"}`}>
                            {trade.direction === "BUY"
                              ? <ArrowUpRight className="h-3.5 w-3.5" />
                              : <ArrowDownRight className="h-3.5 w-3.5" />}
                            {trade.direction}
                          </div>
                          <div className="text-[10px] text-muted-foreground">{trade.lotSize} lot</div>
                        </TableCell>

                        {/* Setup Claude */}
                        <TableCell>
                          <SetupBadge setup={setup} />
                        </TableCell>

                        {/* Entrata → Uscita */}
                        <TableCell className="text-right data-number text-sm">
                          <div>{formatPrice(trade.entryPrice)}</div>
                          {trade.closePrice && (
                            <div className="text-[10px] text-muted-foreground">→ {formatPrice(trade.closePrice)}</div>
                          )}
                        </TableCell>

                        {/* SL / TP */}
                        <TableCell className="text-center text-xs text-muted-foreground data-number hidden sm:table-cell">
                          <span className="text-destructive/70">{trade.stopLossPips ?? "—"}</span>
                          {" / "}
                          <span className="text-success/70">{trade.takeProfitPips ?? "—"}</span>
                          <div className="text-[9px] opacity-60">pips</div>
                        </TableCell>

                        {/* Confidence */}
                        <TableCell className="text-center hidden md:table-cell">
                          {confidence != null ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="h-1.5 w-12 bg-muted rounded-full overflow-hidden">
                                <div
                                  className={`h-full rounded-full ${confidence >= 75 ? "bg-success" : confidence >= 55 ? "bg-warning" : "bg-muted-foreground"}`}
                                  style={{ width: `${confidence}%` }}
                                />
                              </div>
                              <span className="text-[10px] text-muted-foreground font-mono">{confidence}%</span>
                            </div>
                          ) : <span className="text-muted-foreground text-xs">—</span>}
                        </TableCell>

                        {/* P&L */}
                        <TableCell className="text-right">
                          <div className={`font-bold data-number text-sm ${getPnLColor(trade.profitLoss)}`}>
                            {trade.status === "OPEN" ? (
                              <span className="text-warning text-xs animate-pulse">APERTO</span>
                            ) : formatPnL(trade.profitLoss)}
                          </div>
                          {trade.status === "CLOSED" && (
                            <div className={`text-[10px] data-number ${getPnLColor(trade.profitLossPips)} opacity-70`}>
                              {formatPips(trade.profitLossPips)} pip
                            </div>
                          )}
                        </TableCell>

                        {/* Durata */}
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap hidden lg:table-cell">
                          {duration}
                        </TableCell>

                        {/* Stato */}
                        <TableCell className="text-right">
                          <Badge variant="outline"
                            className={`text-[10px] h-5 px-1.5 rounded-sm border-0 font-mono ${getStatusColor(trade.status)}`}>
                            {trade.status}
                          </Badge>
                        </TableCell>

                        {/* Expand */}
                        <TableCell className="w-8 pr-2">
                          <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`} />
                        </TableCell>
                      </TableRow>

                      {/* Expanded detail row */}
                      {isOpen && (
                        <TableRow className="border-border bg-muted/10 hover:bg-muted/10">
                          <TableCell colSpan={10} className="px-4 py-3">
                            <div className="flex flex-col gap-3">
                              {/* Claude reasoning */}
                              {trade.reasoning && (
                                <div className="flex items-start gap-2">
                                  <Brain className="h-3.5 w-3.5 text-primary mt-0.5 shrink-0" />
                                  <div>
                                    <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold mb-1">
                                      Ragionamento Claude
                                    </div>
                                    <p className="text-xs text-foreground leading-relaxed">{trade.reasoning}</p>
                                  </div>
                                </div>
                              )}

                              {/* Trade details grid */}
                              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">Entrata</div>
                                  <div className="font-mono text-foreground">{formatPrice(trade.entryPrice)}</div>
                                </div>
                                {trade.closePrice && (
                                  <div className="space-y-0.5">
                                    <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">Uscita</div>
                                    <div className="font-mono text-foreground">{formatPrice(trade.closePrice)}</div>
                                  </div>
                                )}
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">Stop Loss</div>
                                  <div className="font-mono text-destructive/80">
                                    {formatPrice(trade.stopLoss)} ({trade.stopLossPips ?? "—"} pip)
                                  </div>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">Take Profit</div>
                                  <div className="font-mono text-success/80">
                                    {formatPrice(trade.takeProfit)} ({trade.takeProfitPips ?? "—"} pip)
                                  </div>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">R:R Ratio</div>
                                  <div className="font-mono text-foreground">1:{Number(trade.riskRewardRatio ?? 0).toFixed(2)}</div>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">Confidence AI</div>
                                  <div className="font-mono text-foreground">{confidence ?? "—"}%</div>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">Chiusura</div>
                                  <div className="text-foreground">{trade.closeReason?.replace(/_/g, " ") || "—"}</div>
                                </div>
                                <div className="space-y-0.5">
                                  <div className="text-muted-foreground uppercase tracking-wider text-[9px] font-semibold">Durata</div>
                                  <div className="text-foreground">{duration}</div>
                                </div>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>

        {/* Pagination */}
        <div className="border-t border-border p-3 flex items-center justify-between bg-muted/20 shrink-0">
          <div className="text-xs text-muted-foreground">
            {tradesData
              ? `${page * limit + 1}–${Math.min((page + 1) * limit, tradesData.total)} di ${tradesData.total} trade`
              : "Caricamento..."}
          </div>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" className="h-8 w-8 p-0"
              onClick={() => setPage(p => Math.max(0, p - 1))}
              disabled={page === 0 || isLoading}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" className="h-8 w-8 p-0"
              onClick={() => setPage(p => p + 1)}
              disabled={!tradesData || (page + 1) * limit >= tradesData.total || isLoading}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
