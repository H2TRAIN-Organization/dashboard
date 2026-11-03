import { NextResponse } from 'next/server'

const GONE_BODY = { error: 'gone', message: 'Endpoint deshabilitado' } as const

function gone(): NextResponse {
  return NextResponse.json(GONE_BODY, {
    status: 410,
    headers: { 'Cache-Control': 'no-store' },
  })
}

/**
 * Endpoint retirado (K50). Devolvía resultados HRV de ejemplo sin sesión y sin
 * vincularlos al usuario autenticado. No lee la petición ni realiza ninguna
 * llamada externa.
 */
export async function GET(): Promise<NextResponse> {
  return gone()
}

export async function POST(): Promise<NextResponse> {
  return gone()
}

export async function PUT(): Promise<NextResponse> {
  return gone()
}

export async function PATCH(): Promise<NextResponse> {
  return gone()
}

export async function DELETE(): Promise<NextResponse> {
  return gone()
}
