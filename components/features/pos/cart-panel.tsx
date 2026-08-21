"use client";

import {
  Banknote,
  CreditCard,
  Minus,
  Plus,
  Trash2,
  UserRound,
} from "lucide-react";
import {
  computeCartTotal,
  getLineTotal,
  removeFromCart,
  setCartLineQuantity,
  type CartLine,
} from "@/lib/pos/cart";
import { computeChange, quickCashAmounts } from "@/lib/pos/change";
import { calculerPartage, contientRemboursable } from "@/lib/pos/tiers-payant";
import type { OrganismeRecord } from "@/lib/server/organismes";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export type PaymentMethod = "CASH" | "CARD" | "CREDIT";

/** Sentinelle non vide : Radix refuse un SelectItem de valeur "". */
const AUCUN_ORGANISME = "__aucun__";

function formatMoney(value: number): string {
  return value.toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * The change display. Large and unmissable on purpose — this is the one
 * number the cashier reads while counting notes out of the drawer.
 * A short payment shows what's still owed as a positive amount rather
 * than negative change.
 */
function ChangeDisplay({
  total,
  received,
}: {
  total: number;
  received: number;
}) {
  const { isSufficient, change, missing } = computeChange(total, received);

  if (received <= 0) return null;

  return (
    <div
      className={cn(
        "rounded-xl px-sp-md py-sp-sm text-center",
        isSufficient
          ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200"
          : "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
      )}
      aria-live="polite"
    >
      <p className="text-sm font-medium">
        {isSufficient ? "Monnaie à rendre" : "Montant manquant"}
      </p>
      <p className="font-heading text-4xl font-extrabold tabular-nums">
        {formatMoney(isSufficient ? change : missing)}
        <span className="ml-sp-xs text-lg font-bold">MAD</span>
      </p>
    </div>
  );
}

/**
 * Ce que rapporte une ligne remboursable, en sous-titre.
 *
 * `null` dès qu'il n'y a rien à dire — ligne non remboursable, base
 * absente, ou aucun organisme retenu : une mention vide sur chaque ligne
 * d'un panier de parapharmacie serait du bruit.
 */
function detailRemboursement(
  line: CartLine,
  tauxCouverture: number | null,
  insurerNom: string | null,
): string | null {
  const { partAssurance } = calculerPartage([line], tauxCouverture);
  // `partAssurance <= 0` couvre le taux absent, le taux nul, la ligne non
  // remboursable et la base manquante — tous les cas où il n'y a rien à
  // dire. Reste le nom, sans lequel la mention n'aurait pas de sujet.
  if (partAssurance <= 0 || insurerNom === null) return null;
  return ` · base ${formatMoney(line.baseRemboursement!)} → ${insurerNom} ${formatMoney(partAssurance)}`;
}

/**
 * Les lignes du panier — ce que l'officine vend.
 *
 * Séparé de l'encaissement depuis que le comptoir est en deux colonnes :
 * la liste défile à gauche, le règlement reste en vue à droite.
 */
export function CartLines({
  lines,
  onChangeLines,
  flashedProductId,
  tauxCouverture,
  insurerNom,
}: {
  lines: CartLine[];
  onChangeLines: (lines: CartLine[]) => void;
  /** Ligne à mettre en évidence après un ajout, effacée par une minuterie. */
  flashedProductId?: string | null;
  /** Taux de l'organisme retenu, pour le détail par ligne. */
  tauxCouverture: number | null;
  insurerNom: string | null;
}) {
  return (
    <div className="flex flex-col gap-sp-md">
      {lines.length === 0 ? (
        <div className="rounded-xl bg-card p-sp-2xl text-center shadow-card">
          <p className="font-heading font-semibold text-foreground">
            Le panier est vide
          </p>
          <p className="mt-sp-sm text-sm text-muted-foreground">
            Scannez un code-barres ou recherchez un produit.
          </p>
        </div>
      ) : (
        <ul className="space-y-sp-sm pb-sp-md">
          {lines.map((line) => (
            <li
              key={line.productId}
              className={cn(
                "flex items-center gap-sp-md rounded-xl bg-card p-sp-md shadow-soft transition-colors duration-300",
                // Confirms the add even when it only bumped the quantity of
                // a line already in the cart, which is otherwise easy to miss.
                flashedProductId === line.productId &&
                  "bg-accent ring-2 ring-primary",
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground">
                  {line.productName}
                </p>
                <p className="text-sm text-muted-foreground">
                  {formatMoney(line.unitPrice)} × {line.quantity}
                  {/* La base et ce qu'elle rapporte, par ligne : c'est là
                      que le fait existe. Le client demande au comptoir
                      pourquoi il paie 4,61 et non 3,52 — sans la base à
                      l'écran, le pharmacien n'a rien à répondre. Et une
                      base aberrante (70,00 sur un produit vendu 18,00) se
                      voit ici, avant de valider, plutôt qu'au rejet du
                      bordereau des semaines plus tard. */}
                  {detailRemboursement(line, tauxCouverture, insurerNom)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-sp-xs">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Retirer une unité de ${line.productName}`}
                  className="size-10"
                  onClick={() =>
                    onChangeLines(
                      setCartLineQuantity(
                        lines,
                        line.productId,
                        line.quantity - 1,
                      ),
                    )
                  }
                >
                  <Minus className="size-4" />
                </Button>
                <span className="w-10 text-center text-lg font-semibold tabular-nums">
                  {line.quantity}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label={`Ajouter une unité de ${line.productName}`}
                  className="size-10"
                  disabled={line.quantity >= line.availableStock}
                  onClick={() =>
                    onChangeLines(
                      setCartLineQuantity(
                        lines,
                        line.productId,
                        line.quantity + 1,
                      ),
                    )
                  }
                >
                  <Plus className="size-4" />
                </Button>
              </div>

              <span className="w-24 shrink-0 text-right font-semibold tabular-nums">
                {formatMoney(getLineTotal(line))}
              </span>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={`Retirer ${line.productName} du panier`}
                className="size-10 text-muted-foreground hover:text-destructive"
                onClick={() =>
                  onChangeLines(removeFromCart(lines, line.productId))
                }
              >
                <Trash2 className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ce que l'officine encaisse : organisme, montants, paiement, validation. */
export function CheckoutPanel({
  lines,
  paymentMethod,
  onChangePaymentMethod,
  cashReceived,
  onChangeCashReceived,
  onValidate,
  isSubmitting,
  canValidate,
  hasClient,
  organismes,
  insurerId,
  onChangeInsurer,
}: {
  /** Lues seulement : le partage se calcule dessus. */
  lines: CartLine[];
  paymentMethod: PaymentMethod | null;
  onChangePaymentMethod: (method: PaymentMethod) => void;
  /** Cash handed over, in MAD. 0 means "nothing entered yet". */
  cashReceived: number;
  onChangeCashReceived: (amount: number) => void;
  onValidate: () => void;
  isSubmitting: boolean;
  canValidate: boolean;
  /** Credit is only offered with a client attached — nobody to bill otherwise. */
  hasClient: boolean;
  /** Les organismes actifs de l'officine. Vide = aucun conventionnement. */
  organismes: OrganismeRecord[];
  insurerId: string | null;
  onChangeInsurer: (insurerId: string | null) => void;
}) {
  const total = computeCartTotal(lines);

  // Le sélecteur n'apparaît que s'il y a de quoi rembourser : le proposer
  // sur un panier de parapharmacie promettrait une prise en charge que le
  // calcul refuserait ensuite.
  const proposerTiersPayant =
    contientRemboursable(lines) && organismes.length > 0;
  const organisme = organismes.find((o) => o.id === insurerId) ?? null;
  const partage = calculerPartage(
    lines,
    proposerTiersPayant && organisme ? organisme.tauxCouverture : null,
  );

  /**
   * Seule la part client passe en caisse. La monnaie, les montants
   * rapides et le contrôle « le compte y est-il » portent donc sur elle,
   * jamais sur le total : le reste sera réclamé à l'organisme, pas au
   * client qui est devant le comptoir.
   */
  const aEncaisser = partage.partClient;
  const quickAmounts = quickCashAmounts(aEncaisser);

  return (
    <div className="flex flex-col gap-sp-md">
      {proposerTiersPayant && (
        <div className="space-y-sp-xs">
          <label
            htmlFor="organisme-vente"
            className="block text-sm font-medium text-muted-foreground"
          >
            Tiers payant
          </label>
          <Select
            value={insurerId ?? AUCUN_ORGANISME}
            onValueChange={(valeur) =>
              onChangeInsurer(valeur === AUCUN_ORGANISME ? null : valeur)
            }
          >
            <SelectTrigger id="organisme-vente" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={AUCUN_ORGANISME}>
                — Aucun (le client paie tout) —
              </SelectItem>
              {organismes.map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.nom} — {o.tauxCouverture} %
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {/* Plus de `sticky` : ce bloc occupe désormais sa propre colonne, et
          c'est la colonne entière qui reste en vue pendant que le panier
          défile à gauche. Un pied collant flottait au-dessus des lignes
          qu'il n'avait pas encore dépassées — il grandissait à chaque
          ajout, et recouvrait le panier d'autant. */}
      <div className="space-y-sp-md rounded-xl bg-card p-sp-md shadow-card">
        {/* Les deux montants séparés, et seulement quand il y a vraiment
            deux montants : sur une vente ordinaire, une ligne « part
            organisme : 0,00 » serait du bruit à chaque passage en caisse. */}
        {partage.partAssurance > 0 ? (
          <div className="space-y-sp-xs">
            <div className="flex items-baseline justify-between text-sm text-muted-foreground">
              <span>Total de la vente</span>
              <span className="tabular-nums">{formatMoney(total)} MAD</span>
            </div>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">
                Part {organisme?.nom ?? "organisme"} — à réclamer
              </span>
              <span className="tabular-nums text-muted-foreground">
                −{formatMoney(partage.partAssurance)} MAD
              </span>
            </div>
            <div className="flex items-baseline justify-between border-t border-border pt-sp-xs">
              <span className="text-lg font-medium text-muted-foreground">
                À encaisser
              </span>
              <span className="font-heading text-4xl font-extrabold tabular-nums text-foreground">
                {formatMoney(aEncaisser)}
                <span className="ml-sp-xs text-lg font-bold">MAD</span>
              </span>
            </div>
          </div>
        ) : (
          <div className="flex items-baseline justify-between">
            <span className="text-lg font-medium text-muted-foreground">
              Total
            </span>
            <span className="font-heading text-4xl font-extrabold tabular-nums text-foreground">
              {formatMoney(total)}
              <span className="ml-sp-xs text-lg font-bold">MAD</span>
            </span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-sp-sm">
          <Button
            type="button"
            variant={paymentMethod === "CASH" ? "default" : "outline"}
            className="h-16 text-base"
            onClick={() => onChangePaymentMethod("CASH")}
          >
            <Banknote className="size-5" />
            Espèces
          </Button>
          <Button
            type="button"
            variant={paymentMethod === "CARD" ? "default" : "outline"}
            className="h-16 text-base"
            onClick={() => onChangePaymentMethod("CARD")}
          >
            <CreditCard className="size-5" />
            Carte
          </Button>
          {/* Full width: a credit sale is the exception, and it needs room
              to explain itself. Disabled without a client, with the reason
              stated rather than left to guesswork. */}
          <Button
            type="button"
            variant={paymentMethod === "CREDIT" ? "default" : "outline"}
            className="col-span-2 h-16 text-base"
            disabled={!hasClient}
            title={
              hasClient ? undefined : "Associez un client pour vendre à crédit"
            }
            onClick={() => onChangePaymentMethod("CREDIT")}
          >
            <UserRound className="size-5" />
            {hasClient
              ? "Crédit client (à payer plus tard)"
              : "Crédit client — associez un client"}
          </Button>
        </div>

        {paymentMethod === "CASH" && (
          <div className="space-y-sp-sm">
            <label
              htmlFor="cash-received"
              className="block text-sm font-medium text-muted-foreground"
            >
              Montant reçu du client
            </label>
            <input
              id="cash-received"
              type="number"
              min={0}
              step="0.01"
              inputMode="decimal"
              value={cashReceived === 0 ? "" : cashReceived}
              onChange={(event) =>
                onChangeCashReceived(Number(event.target.value) || 0)
              }
              placeholder="0,00"
              className="h-14 w-full rounded-lg bg-muted/60 px-sp-md text-right font-heading text-2xl font-bold tabular-nums text-foreground outline-none transition-colors focus:bg-muted focus:ring-2 focus:ring-ring"
            />

            <div className="flex flex-wrap gap-sp-sm">
              <Button
                type="button"
                variant="outline"
                className="h-12 flex-1 text-base"
                onClick={() => onChangeCashReceived(total)}
              >
                Compte juste
              </Button>
              {quickAmounts.map((amount) => (
                <Button
                  key={amount}
                  type="button"
                  variant="outline"
                  className="h-12 flex-1 text-base tabular-nums"
                  onClick={() => onChangeCashReceived(amount)}
                >
                  {amount}
                </Button>
              ))}
            </div>

            <ChangeDisplay total={aEncaisser} received={cashReceived} />
          </div>
        )}

        <Button
          type="button"
          size="lg"
          className="h-16 w-full text-lg"
          disabled={!canValidate || isSubmitting}
          onClick={onValidate}
        >
          {isSubmitting ? "Enregistrement..." : "Valider la vente"}
        </Button>
      </div>
    </div>
  );
}
