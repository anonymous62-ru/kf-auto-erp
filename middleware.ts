// Rafraichit la session Supabase sur chaque requete et protege les routes /(app)
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();

  // /verify/* est une page publique (scannée via QR code sur un document imprimé,
  // sans session) : jamais protégée par l'authentification.
  const isPublicRoute = request.nextUrl.pathname.startsWith('/login') || request.nextUrl.pathname.startsWith('/verify');
  if (!user && !isPublicRoute) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // 2FA : si l'utilisateur a déjà activé la vérification en deux étapes,
  // chaque nouvelle session doit compléter le défi (code à 6 chiffres)
  // avant d'accéder au reste de l'app. currentLevel/nextLevel divergent
  // seulement dans ce cas précis (aal1 -> aal2 requis) — les comptes sans
  // 2FA activée ne sont jamais concernés.
  const isMfaChallengeRoute = request.nextUrl.pathname.startsWith('/mfa-challenge');
  if (user && !isPublicRoute && !isMfaChallengeRoute) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aal && aal.nextLevel === 'aal2' && aal.currentLevel !== aal.nextLevel) {
      return NextResponse.redirect(new URL('/mfa-challenge', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
