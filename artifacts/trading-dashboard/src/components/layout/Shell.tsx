import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Link, useLocation } from "wouter";
import { MonitorDot, History, BarChart3, CandlestickChart, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

interface ShellProps {
  children: ReactNode;
}

const mobileNav = [
  { href: "/",       label: "Terminal",  icon: MonitorDot },
  { href: "/chart",  label: "Grafico",   icon: CandlestickChart },
  { href: "/trades", label: "Cronologia", icon: History },
  { href: "/stats",  label: "Analytics", icon: BarChart3 },
];

export function Shell({ children }: ShellProps) {
  const [location] = useLocation();

  return (
    <div className="flex h-screen w-full bg-background overflow-hidden selection:bg-primary/20">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Mobile Header */}
        <header className="h-14 border-b border-border bg-card flex items-center justify-between px-4 md:hidden shrink-0">
          <div className="font-bold text-primary tracking-wider flex items-center gap-2">
            <Zap className="h-4 w-4 text-warning" />
            SCALP.BOT
          </div>
          <div className="text-xs text-muted-foreground font-mono animate-pulse">● LIVE</div>
        </header>

        <main className="flex-1 overflow-auto p-4 md:p-6 lg:p-8 pb-20 md:pb-6">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="md:hidden shrink-0 h-16 border-t border-border bg-card flex items-stretch">
          {mobileNav.map((item) => {
            const isActive = location === item.href;
            return (
              <Link key={item.href} href={item.href} className="flex-1">
                <div className={cn(
                  "flex flex-col items-center justify-center h-full gap-1 transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}>
                  <item.icon className={cn("h-5 w-5", isActive && "text-primary")} />
                  <span className="text-[10px] font-medium tracking-wide">{item.label}</span>
                </div>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
