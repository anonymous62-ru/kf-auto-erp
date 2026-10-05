// Recherche de clients par plusieurs mots ("Jean Dupont", "Koffi 90 12") :
// chaque mot doit apparaître dans le prénom, le nom, la société ou le
// téléphone. Les caractères spéciaux sont retirés avant d'être insérés dans
// le filtre PostgREST (une virgule ou une parenthèse dans la saisie pouvait
// sinon modifier le filtre lui-même).
export function searchTerms(query: string): string[] {
  return query
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}\s@.+'-]/gu, ' ')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .slice(0, 5);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyClientSearch<T extends { or: (filter: string) => any }>(request: T, query: string): T {
  let r = request;
  for (const term of searchTerms(query)) {
    r = r.or(`first_name.ilike.%${term}%,last_name.ilike.%${term}%,company_name.ilike.%${term}%,phone.ilike.%${term}%`);
  }
  return r;
}

export function matchesAllTerms(haystack: (string | null | undefined)[], query: string): boolean {
  const text = haystack.filter(Boolean).join(' ').toLowerCase();
  return searchTerms(query).every((t) => text.includes(t.toLowerCase()));
}
