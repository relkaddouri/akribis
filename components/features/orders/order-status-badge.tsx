import type { OrderStatus } from "@/lib/db/generated/enums";
import { Badge } from "@/components/ui/badge";

export const STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING: "En attente",
  PARTIALLY_RECEIVED: "Partielle",
  RECEIVED: "Reçue",
  CANCELLED: "Annulée",
};

const STATUS_VARIANTS: Record<OrderStatus, "secondary" | "default" | "destructive"> = {
  PENDING: "secondary",
  PARTIALLY_RECEIVED: "default",
  RECEIVED: "default",
  CANCELLED: "destructive",
};

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  return <Badge variant={STATUS_VARIANTS[status]}>{STATUS_LABELS[status]}</Badge>;
}
