import { NextResponse, type NextRequest } from 'next/server'

import {
  createSessionTokenCodec,
  parseSessionSecret,
  type SessionTokenCodec,
} from '@/server/infrastructure/auth/session-token'

/**
 * MT50: guard server-side real de rutas.
 *
 * Con AUTH_SESSION_SECRET configurado (obligatorio en producción), el proxy
 * valida la cookie de sesión opaca con el mismo codec AES-256-GCM del runtime
 * de auth: token malformado, alterado o caducado → redirect a /login y
 * limpieza de la cookie. Es un chequeo de autenticación, no de autorización:
 * el RBAC real (roles) sigue resolviéndose server-side en cada handler
 * (`requireActor`) y en `getSession`, que recarga el rol desde public.users.
 *
 * Sin AUTH_SESSION_SECRET (desarrollo efímero) el guard no puede validar y no
 * se activa: el login sigue funcionando con el secreto efímero del runtime y
 * los e2e con APIs mockeadas en navegador no se ven afectados.
 *
 * La parte de Estudio se retira del front sin borrar su código fuente
 * (ver README.md): el proxy responde 404 a /study antes de renderizar.
 * Para reactivarla, elimina ese matcher y vuelve a montar la vista.
 */

const SESSION_COOKIE = 'dashboard_session'
const LOGIN_PATH = '/login'

/**
 * Rutas de página que requieren sesión. El matcher de `config` optimiza (solo
 * invoca el proxy en ellas), pero la decisión vive aquí: el proxy no debe
 * depender del matcher para ser correcto.
 */
const PROTECTED_PAGES = [
  '/admin',
  '/analytics',
  '/app-dashboard',
  '/data',
  '/kubios',
  '/overview',
  '/users',
  '/privacy',
] as const

function isProtectedPage(pathname: string): boolean {
  return PROTECTED_PAGES.some(
    (page) => pathname === page || pathname.startsWith(`${page}/`),
  )
}

function readSessionCodec(): SessionTokenCodec | null {
  const secret = process.env.AUTH_SESSION_SECRET
  if (typeof secret !== 'string' || secret.trim().length === 0) {
    return null
  }
  try {
    return createSessionTokenCodec(parseSessionSecret(secret))
  } catch {
    // Clave configurada pero inválida: el runtime de auth también fallará
    // cerrado; el guard no redirige en masa ante un error de configuración.
    return null
  }
}

function notFound(): NextResponse {
  return new NextResponse('Not Found', { status: 404 })
}

export function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl
  if (pathname === '/study' || pathname.startsWith('/study/')) {
    return notFound()
  }

  const codec = readSessionCodec()
  if (codec === null || !isProtectedPage(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value
  const payload = typeof token === 'string' ? codec.open(token, new Date()) : null
  if (payload !== null) {
    return NextResponse.next()
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = LOGIN_PATH
  loginUrl.search = ''
  const redirect = NextResponse.redirect(loginUrl)
  if (token !== undefined) {
    // Cookie inválida o caducada: no arrastrar basura a la siguiente visita.
    redirect.cookies.delete(SESSION_COOKIE)
  }
  return redirect
}

export const config = {
  matcher: [
    '/study/:path*',
    '/admin/:path*',
    '/analytics/:path*',
    '/app-dashboard/:path*',
    '/data/:path*',
    '/kubios/:path*',
    '/overview/:path*',
    '/users/:path*',
    '/privacy/:path*',
  ],
  // El matcher y PROTECTED_PAGES deben mantenerse en sincronía.
}
