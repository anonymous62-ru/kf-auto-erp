// Numéro au format international attendu par les liens wa.me (chiffres
// seulement, indicatif pays compris). Les numéros togolais sont souvent
// saisis ou importés sur 8 chiffres ("90 12 34 56") : sans l'indicatif 228,
// le lien WhatsApp ouvrait une conversation avec un numéro inexistant.
// Si plusieurs numéros sont dans le champ ("22 21 31 06 / 90 99 69 31"),
// on garde le premier.
export function toWhatsappNumber(phone: string | null | undefined): string {
  const first = (phone ?? '').split(/[\/;,*|]/)[0] ?? '';
  let digits = first.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 8) digits = `228${digits}`;
  return digits;
}
