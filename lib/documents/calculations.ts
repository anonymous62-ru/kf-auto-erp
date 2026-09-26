// Calculs partages entre le formulaire client et la revalidation serveur (Phase 4/6)
export interface DocumentItemInput {
  quantity: number;
  unitPrice: number;
  taxRate: number; // ex: 18 pour 18%
  discountPercent?: number;
}

export function computeLineTotal(item: DocumentItemInput): number {
  const base = item.quantity * item.unitPrice;
  const afterDiscount = base * (1 - (item.discountPercent ?? 0) / 100);
  return round2(afterDiscount * (1 + item.taxRate / 100));
}

export function computeDocumentTotals(items: DocumentItemInput[]) {
  const subtotal = round2(
    items.reduce((sum, i) => sum + i.quantity * i.unitPrice * (1 - (i.discountPercent ?? 0) / 100), 0)
  );
  const taxAmount = round2(
    items.reduce((sum, i) => {
      const base = i.quantity * i.unitPrice * (1 - (i.discountPercent ?? 0) / 100);
      return sum + base * (i.taxRate / 100);
    }, 0)
  );
  const totalAmount = round2(subtotal + taxAmount);
  return { subtotal, taxAmount, totalAmount };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function formatCFA(amount: number): string {
  // Intl.NumberFormat('fr-FR') insère un "espace fine insécable" (U+202F)
  // comme séparateur de milliers — invisible à l'écran, mais absent de
  // l'encodage WinAnsi que pdf-lib utilise pour ses polices standard : le
  // PDF plantait dès qu'un montant dépassait 999 (ex: une facture signée
  // avec un vrai montant). Remplacé par une espace normale, strictement
  // identique visuellement, mais sans risque d'encodage.
  return new Intl.NumberFormat('fr-FR').format(Math.round(amount)).replace(/ /g, ' ') + ' FCFA';
}
