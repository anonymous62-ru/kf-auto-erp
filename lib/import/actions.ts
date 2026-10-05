'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase/server';
import {
  PROSPECT_SOURCES,
  PROSPECT_STATUSES,
  extractPhones,
  phoneKey,
  type ContactRecord,
  type ImportKind,
} from '@/lib/import/contacts';

const MAX_ROWS = 2000;

async function getProfile() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) throw new Error('Non authentifié');
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('organization_id, role')
    .eq('id', userData.user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!profile) throw new Error('Profil introuvable');
  return { supabase, userId: userData.user.id, ...profile };
}

// Numéros déjà présents dans l'organisation (chez moi ou chez un collègue).
// La fonction SQL ne renvoie que la clé du numéro et "est-ce à moi ?",
// jamais le nom du client ni celui du commercial (voir migration 0021).
export async function checkExistingPhones(phones: string[]): Promise<Record<string, 'mine' | 'other'>> {
  const { supabase } = await getProfile();
  const keys = Array.from(new Set(phones.map(phoneKey).filter((k) => k.length === 8))).slice(0, MAX_ROWS * 2);
  if (keys.length === 0) return {};
  const { data, error } = await supabase.rpc('check_existing_phones', { p_phones: keys });
  if (error) throw new Error(error.message);
  const result: Record<string, 'mine' | 'other'> = {};
  for (const row of (data ?? []) as { phone_key: string; mine: boolean }[]) {
    result[row.phone_key] = row.mine ? 'mine' : 'other';
  }
  return result;
}

const clean = (value: unknown, max = 300) =>
  typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) || null : null;
const cleanNotes = (value: unknown) =>
  typeof value === 'string' ? value.trim().slice(0, 4000) || null : null;

function cleanPhone(value: unknown) {
  if (typeof value !== 'string') return null;
  return extractPhones(value)[0] ?? null;
}

function cleanEmail(value: unknown) {
  const v = clean(value, 200);
  return v && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v.toLowerCase() : null;
}

function cleanDate(value: unknown) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

// Enveloppe qui renvoie { error } au lieu de lever une erreur : en
// production, Next.js remplace le message d'une erreur levée par un texte
// générique en anglais.
export async function importContacts(
  kind: ImportKind,
  records: ContactRecord[]
): Promise<{ inserted: number; skipped: number; error?: string }> {
  try {
    return await importContactsInner(kind, records);
  } catch (e) {
    return { inserted: 0, skipped: 0, error: e instanceof Error ? e.message : "L'import a échoué." };
  }
}

async function importContactsInner(kind: ImportKind, records: ContactRecord[]) {
  if (kind !== 'clients' && kind !== 'prospects') throw new Error("Type d'import inconnu");
  if (!Array.isArray(records) || records.length === 0) throw new Error('Aucune ligne à importer.');
  if (records.length > MAX_ROWS) {
    throw new Error(`Import limité à ${MAX_ROWS} lignes à la fois. Découpez le fichier en plusieurs parties.`);
  }

  const { supabase, userId, organization_id } = await getProfile();

  // Vérification refaite côté serveur : on ne fait jamais confiance au
  // navigateur pour les doublons (l'aperçu peut dater de quelques minutes).
  const existing = await checkExistingPhones(records.map((r) => (typeof r.phone === 'string' ? r.phone : '')));
  const seen = new Set<string>();
  let skipped = 0;

  // Lignes SANS téléphone : on les reconnaît par leur nom exact parmi les
  // fiches déjà visibles par l'utilisateur, pour qu'un second import du
  // même fichier ne les crée pas en double.
  const nameKey = (company?: string | null, last?: string | null, first?: string | null) =>
    [company, last, first].map((v) => (v ?? '').toLowerCase().replace(/\s+/g, ' ').trim()).join('|');
  const { data: existingNames } = await supabase.from(kind).select('company_name, last_name, first_name').limit(10000);
  const knownNames = new Set(
    ((existingNames ?? []) as { company_name: string | null; last_name: string | null; first_name: string | null }[]).map(
      (e) => nameKey(e.company_name, e.last_name, e.first_name)
    )
  );

  const rows = [];
  for (const r of records) {
    const phone = cleanPhone(r.phone);
    const key = phone ? phoneKey(phone) : '';
    if (key && (existing[key] || seen.has(key))) {
      skipped++;
      continue;
    }
    if (key) seen.add(key);

    const isCompany = r.isCompany === true;
    const companyName = clean(r.companyName);
    const firstName = clean(r.firstName, 120);
    const lastName = clean(r.lastName, 120);
    if (!companyName && !firstName && !lastName && !phone) {
      skipped++;
      continue;
    }
    if (!phone) {
      const key = nameKey(companyName, lastName, firstName);
      if (knownNames.has(key)) {
        skipped++;
        continue;
      }
      knownNames.add(key);
    }

    const base = {
      organization_id,
      assigned_to: userId,
      created_by: userId,
      first_name: firstName,
      last_name: lastName,
      phone,
      whatsapp: cleanPhone(r.whatsapp),
      email: cleanEmail(r.email),
    };

    if (kind === 'clients') {
      const extra = [r.sector ? `Secteur : ${clean(r.sector)}` : '', cleanNotes(r.notes) ?? ''].filter(Boolean).join('\n');
      rows.push({
        ...base,
        client_type: isCompany ? 'entreprise' : 'particulier',
        company_name: companyName,
        main_contact_name: clean(r.contactName),
        address: clean(r.address),
        city: clean(r.city, 120),
        notes: extra || null,
      });
    } else {
      const notes = [r.address ? `Adresse : ${clean(r.address)}` : '', cleanNotes(r.notes) ?? ''].filter(Boolean).join('\n');
      rows.push({
        ...base,
        company_name: companyName,
        contact_name: clean(r.contactName),
        sector: clean(r.sector, 150),
        source: PROSPECT_SOURCES.includes(r.source) ? r.source : 'autre',
        status: PROSPECT_STATUSES.includes(r.status) ? r.status : 'nouveau',
        next_relance_at: cleanDate(r.nextRelance),
        notes: notes || null,
      });
    }
  }

  let inserted = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await supabase.from(kind).insert(chunk);
    if (error) {
      throw new Error(
        inserted > 0
          ? `${inserted} contacts importés, puis erreur : ${error.message}. Relancez l'import : les contacts déjà importés seront reconnus et ignorés.`
          : error.message
      );
    }
    inserted += chunk.length;
  }

  revalidatePath(`/${kind}`);
  revalidatePath('/dashboard');
  return { inserted, skipped };
}
