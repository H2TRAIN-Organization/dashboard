import { NextResponse } from 'next/server'

/**
 * La parte de Estudio se retira del front sin borrar su código fuente
 * (ver README.md): el proxy responde 404 a /study antes de renderizar,
 * de modo que la ruta no es accesible por nadie y la respuesta lleva el
 * estado HTTP 404 real. Para reactivar la parte de estudio, elimina este
 * matcher y vuelve a montar la vista de estudio como página.
 */
export function proxy() {
  return new NextResponse('Not Found', { status: 404 })
}

export const config = {
  matcher: ['/study', '/study/:path*'],
}
