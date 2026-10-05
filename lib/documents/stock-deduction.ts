// Déduction automatique du stock à la facturation.
//
// Règle du DG (appel du 04/10) : un devis peut mentionner un article qu'on
// n'a pas encore en stock (le devis reste normal, rien ne bloque) — mais
// dès que ce document devient une FACTURE, l'article est considéré vendu et
// le stock doit être retiré automatiquement sur la plateforme, sans action
// manuelle de qui que ce soit.
//
// Appelé depuis les 4 endroits où un document de type "facture" peut être
// créé : création directe (lib/documents/actions.ts:createDocument),
// conversion devis/proforma -> facture (convertToFacture), et les deux
// chemins hors-ligne équivalents (lib/offline/create.ts, lib/offline/sync.ts).
//
// Portée actuelle : uniquement les lignes liées à un produit du catalogue
// (document_items.product_id -> products). Les pièces détachées (table
// "parts", module Atelier/SAV) ne sont pas encore sélectionnables depuis un
// devis/facture classique — voir la note dans le cahier des charges KF Auto
// ERP sur ce point précis, à étendre une fois le moteur hors-ligne mis à
// jour en conséquence.
//
// Le stock n'est jamais bloquant : si la quantité en stock devient
// négative, on laisse passer (un commercial a pu vendre avant que la pièce
// ne soit physiquement réceptionnée) — c'est un signal à régulariser, pas
// une erreur à l'utilisateur en plein encaissement.
import type { SupabaseClient } from '@supabase/supabase-js';

export interface StockDeductionItem {
  productId?: string | null;
  quantity: number;
}

// Depuis le 04/10 (soir), la déduction est faite par la fonction SQL
// apply_facture_stock (migration 0022) : un commercial n'a pas le droit de
// modifier directement le stock d'un produit, et la mise à jour échouait en
// silence quand c'était lui qui facturait. La fonction relit elle-même les
// lignes de la facture et ne s'applique qu'une fois par facture.
//
// Volontairement non bloquant : la facture est déjà enregistrée à ce
// stade ; lever une erreur ferait croire à un échec de création (et, en
// synchronisation hors-ligne, provoquerait une nouvelle tentative qui
// créerait la facture en double). L'erreur est seulement journalisée.
export async function applyFactureStockDeduction(
  supabase: SupabaseClient,
  params: {
    organizationId: string;
    documentId: string;
    documentNumber: string;
    items: StockDeductionItem[];
    performedBy: string;
  }
) {
  if (!params.items.some((i) => !!i.productId)) return;
  const { error } = await supabase.rpc('apply_facture_stock', { p_document_id: params.documentId });
  if (error) console.error('Déduction du stock impossible pour', params.documentNumber, error.message);
}
