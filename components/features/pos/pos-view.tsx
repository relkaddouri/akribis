"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Maximize2, Minimize2, ShoppingCart } from "lucide-react";
import { addToCart, type CartLine } from "@/lib/pos/cart";
import { computeChange } from "@/lib/pos/change";
import { calculerPartage, contientRemboursable } from "@/lib/pos/tiers-payant";
import { listOrganismesActifs } from "@/lib/server/organismes";
import { createSale, type Receipt } from "@/lib/offline/sales";
import type { ProductRecord } from "@/lib/offline/products";
import { cn } from "@/lib/utils";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { ProductSearch } from "@/components/features/pos/product-search";
import {
  CartLines,
  CheckoutPanel,
  type PaymentMethod,
} from "@/components/features/pos/cart-panel";
import { ReceiptView } from "@/components/features/pos/receipt-view";
import {
  ClientPicker,
  type SelectedClient,
} from "@/components/features/pos/client-picker";

/** How long an added line stays highlighted. */
const FLASH_MS = 700;

export function PosView() {
  const queryClient = useQueryClient();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const [lines, setLines] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod | null>(
    null,
  );
  const [cashReceived, setCashReceived] = useState(0);
  const [client, setClient] = useState<SelectedClient>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  /** Product id of the line to highlight after an add, cleared on a timer. */
  const [flashedProductId, setFlashedProductId] = useState<string | null>(null);
  const [insurerId, setInsurerId] = useState<string | null>(null);
  /**
   * Mode caisse : le vrai plein écran du navigateur.
   *
   * `requestFullscreen()` est le seul moyen de faire disparaître les
   * onglets et la barre d'adresse — une surcouche CSS recouvre
   * l'application, jamais le navigateur. L'appel exige un geste de
   * l'utilisateur : le clic sur le bouton en est un.
   *
   * La surcouche est conservée par-dessus, sans quoi la barre latérale et
   * l'en-tête resteraient visibles à l'intérieur du plein écran.
   */
  const [pleinEcran, setPleinEcran] = useState(false);

  /**
   * L'état suit le navigateur, jamais l'inverse.
   *
   * On peut sortir du plein écran par F11, par Échap, ou par le menu du
   * navigateur, sans passer par notre bouton. Sans cette écoute, la
   * surcouche resterait affichée en fenêtre normale, recouvrant
   * l'application entière sans plus rien pour la fermer.
   */
  useEffect(() => {
    const suivre = () => setPleinEcran(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", suivre);
    return () => document.removeEventListener("fullscreenchange", suivre);
  }, []);

  async function basculerPleinEcran() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refus du navigateur — politique de l'appareil, iframe sans
      // autorisation. On ne bascule pas la surcouche : elle masquerait la
      // navigation sans rien apporter, et sans issue visible.
    }
  }

  // Lecture ouverte à tous les rôles : un assistant tient la caisse et
  // doit pouvoir choisir l'organisme, sans pouvoir en gérer aucun.
  const organismesQuery = useQuery({
    queryKey: ["organismes-actifs"],
    queryFn: () => listOrganismesActifs(),
  });
  const organismes = useMemo(
    () => organismesQuery.data ?? [],
    [organismesQuery.data],
  );
  const organisme = organismes.find((o) => o.id === insurerId) ?? null;
  // A card payment is settled by the terminal, so only cash has to be
  // covered before the sale can be validated.
  /**
   * Ce que le client règle au comptoir : le total moins ce qui sera
   * réclamé à l'organisme. C'est ce montant, et non le total, que les
   * espèces doivent couvrir.
   */
  const aEncaisser = calculerPartage(
    lines,
    organisme && contientRemboursable(lines) ? organisme.tauxCouverture : null,
  ).partClient;

  const cashCovers =
    paymentMethod !== "CASH" ||
    cashReceived === 0 ||
    computeChange(aEncaisser, cashReceived).isSufficient;
  const canValidate = lines.length > 0 && paymentMethod !== null && cashCovers;

  // Dropping the client invalidates a credit sale: there would be no
  // account left to charge.
  useEffect(() => {
    if (client === null && paymentMethod === "CREDIT") setPaymentMethod(null);
  }, [client, paymentMethod]);

  useEffect(() => {
    // Focus on mount and again after each completed sale, so the next
    // customer can be scanned straight away without reaching for the mouse.
    searchInputRef.current?.focus();
  }, [receipt]);

  useEffect(() => {
    if (!flashedProductId) return;
    const timeout = setTimeout(() => setFlashedProductId(null), FLASH_MS);
    return () => clearTimeout(timeout);
  }, [flashedProductId]);

  const mutation = useMutation({
    mutationFn: () =>
      createSale({
        paymentMethod: paymentMethod!,
        clientId: client?.id,
        clientName: client?.name,
        // Seul l'identifiant part au serveur ; le taux ne sert qu'au ticket
        // imprimé hors ligne — le serveur relit le sien.
        insurerId: organisme?.id,
        insurerTaux: organisme?.tauxCouverture,
        items: lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
        })),
      }),
    onSuccess: (result) => {
      setReceipt(result);
      setLines([]);
      setPaymentMethod(null);
      setCashReceived(0);
      setInsurerId(null);
      setClient(null);
      setWarning(null);
      queryClient.invalidateQueries({ queryKey: ["products"] });
    },
  });

  const clearCart = useCallback(() => {
    setLines([]);
    setPaymentMethod(null);
    setCashReceived(0);
    setWarning(null);
    searchInputRef.current?.focus();
  }, []);

  /**
   * Till-wide shortcuts. Both are bound on the container rather than the
   * window so they only fire while the POS is on screen; the search field
   * and the client picker stop their own Enter/Escape from bubbling here,
   * which keeps "add this product" and "close this dropdown" working.
   */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter") {
      if (!canValidate || mutation.isPending) return;
      event.preventDefault();
      mutation.mutate();
      return;
    }
    if (event.key === "Escape") {
      // En plein écran, Échap en sort — le navigateur le fait déjà de son
      // côté, et vider le panier au même geste ferait faire deux choses
      // contradictoires à la même touche, au comptoir, devant un client.
      if (pleinEcran) {
        void basculerPleinEcran();
        return;
      }
      if (lines.length > 0) {
        event.preventDefault();
        clearCart();
      }
    }
  }

  function handleSelectProduct(product: ProductRecord) {
    // Functional update: onSelect can fire from an async keydown handler
    // (barcode fast-path), so a scan-add landing while another update is
    // still in flight must build on the latest state, not a stale
    // `lines` closure that would silently clobber it.
    let capped = false;
    setLines((prevLines) => {
      const result = addToCart(prevLines, {
        id: product.id,
        name: product.name,
        price: product.price,
        quantityInStock: product.quantityInStock,
        // Le droit à remboursement voyage avec le produit : l'oublier ici
        // rendait le sélecteur de tiers payant définitivement invisible.
        remboursable: product.remboursable,
        baseRemboursement: product.baseRemboursement,
      });
      capped = result.capped;
      return result.lines;
    });
    setWarning(
      capped
        ? product.quantityInStock <= 0
          ? `Rupture de stock : "${product.name}".`
          : `Stock limité pour "${product.name}" (${product.quantityInStock} disponible(s)).`
        : null,
    );
    setFlashedProductId(product.id);
    searchInputRef.current?.focus();
  }

  function handleNewSale() {
    setReceipt(null);
    mutation.reset();
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-sp-lg",
        // La surcouche recouvre la barre latérale et l'en-tête de
        // l'application ; son propre défilement remplace celui de <main>,
        // qu'elle masque.
        pleinEcran && "fixed inset-0 z-50 overflow-y-auto bg-background px-sp-lg pb-sp-lg",
      )}
      onKeyDown={handleKeyDown}
    >
      <DashboardHeader
        title="Caisse"
        icon={<ShoppingCart />}
        actions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void basculerPleinEcran()}
          >
            {pleinEcran ? <Minimize2 /> : <Maximize2 />}
            {pleinEcran ? "Quitter le plein écran" : "Plein écran"}
          </Button>
        }
      />

      {/*
        Deux colonnes : à gauche ce que l'officine vend, à droite ce qu'elle
        encaisse. Une seule colonne obligeait à un pied de caisse collant
        pour garder le bouton Valider à portée — et ce pied, haut de près de
        450 px, flottait au-dessus des lignes du panier qu'il n'avait pas
        encore dépassées. Chaque ajout le faisait grandir, donc recouvrir
        davantage.

        La colonne de droite est `sticky` **en entier** : elle reste en vue
        pendant que le panier défile, sans jamais rien recouvrir puisqu'elle
        occupe sa propre piste de grille. `self-start` est indispensable —
        sans lui, l'élément s'étire sur toute la hauteur de la rangée et
        `sticky` n'a plus de course.

        En dessous de `lg`, tout s'empile dans l'ordre : panier, puis
        encaissement. Rien ne recouvre rien là non plus.
      */}
      <div className="grid w-full gap-sp-md lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
        <div className="flex min-w-0 flex-col gap-sp-md">
          <ProductSearch ref={searchInputRef} onSelect={handleSelectProduct} />

          <CartLines
            lines={lines}
            onChangeLines={setLines}
            flashedProductId={flashedProductId}
            tauxCouverture={organisme?.tauxCouverture ?? null}
            insurerNom={organisme?.nom ?? null}
          />
        </div>

        <div className="flex min-w-0 flex-col gap-sp-md lg:sticky lg:top-sp-lg">
          <ClientPicker value={client} onChange={setClient} />

          {warning && (
            <Alert variant="destructive">
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          )}

          {mutation.isError && (
            <Alert variant="destructive">
              <AlertDescription>
                {(mutation.error as Error).message}
              </AlertDescription>
            </Alert>
          )}

          <CheckoutPanel
            lines={lines}
            paymentMethod={paymentMethod}
            onChangePaymentMethod={setPaymentMethod}
            cashReceived={cashReceived}
            onChangeCashReceived={setCashReceived}
            onValidate={() => mutation.mutate()}
            isSubmitting={mutation.isPending}
            canValidate={canValidate}
            hasClient={client !== null}
            organismes={organismes}
            insurerId={insurerId}
            onChangeInsurer={setInsurerId}
          />
        </div>

        {/* Sous les deux colonnes : le rappel clavier vaut pour l'écran
            entier, pas pour l'une d'elles. */}
        <p className="text-center text-xs text-muted-foreground lg:col-span-2">
          <kbd className="rounded border border-border bg-card px-sp-xs py-0.5 font-medium">
            Entrée
          </kbd>{" "}
          valider la vente ·{" "}
          <kbd className="rounded border border-border bg-card px-sp-xs py-0.5 font-medium">
            Échap
          </kbd>{" "}
          vider le panier
        </p>
      </div>

      {/* Par-dessus le comptoir, et non à sa place : la caisse reste
          visible derrière le ticket, et « Nouvelle vente » n'est plus une
          navigation mais une fermeture. */}
      {receipt && <ReceiptView receipt={receipt} onNewSale={handleNewSale} />}
    </div>
  );
}
