export function formatPrice(price: number | null | undefined): string {
  if (price == null) return "—";
  return price.toFixed(5);
}

export function formatPnL(amount: number | null | undefined): string {
  if (amount == null) return "—";
  const formatted = Math.abs(amount).toFixed(2);
  return amount >= 0 ? `+$${formatted}` : `-$${formatted}`;
}

export function formatPips(pips: number | null | undefined): string {
  if (pips == null) return "—";
  const formatted = Math.abs(pips).toFixed(1);
  return pips >= 0 ? `+${formatted}` : `-${formatted}`;
}

export function getPnLColor(amount: number | null | undefined): string {
  if (amount == null || amount === 0) return "text-muted-foreground";
  return amount > 0 ? "text-success" : "text-destructive";
}

export function getStatusColor(status: string): string {
  switch (status.toUpperCase()) {
    case "OPEN":
      return "bg-warning/20 text-warning border-warning/30";
    case "CLOSED":
      return "bg-muted text-muted-foreground border-muted";
    case "CANCELLED":
      return "bg-destructive/10 text-destructive border-destructive/20";
    default:
      return "bg-muted text-muted-foreground border-muted";
  }
}

export function formatTime(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatDate(isoString: string | null | undefined): string {
  if (!isoString) return "—";
  return new Date(isoString).toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}
