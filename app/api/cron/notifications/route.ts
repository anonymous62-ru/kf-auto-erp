// Envoi des e-mails en file (email_outbox).
// Appelée par pg_cron (Supabase, toutes les 10 minutes, via pg_net) et par
// le cron Vercel quotidien de secours (vercel.json). Accessible sans session
// (voir middleware.ts) mais protégée par l'en-tête
// « Authorization: Bearer <CRON_SECRET> ».

import { createHash, timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { processOutbox } from '@/lib/email/outbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  // Comparaison à temps constant (empreintes de même longueur).
  const a = createHash('sha256').update(header).digest();
  const b = createHash('sha256').update(`Bearer ${secret}`).digest();
  return timingSafeEqual(a, b);
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 401 });
  }
  try {
    const result = await processOutbox(25);
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Erreur inconnue' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    );
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
