import { notFound } from 'next/navigation'

// Renderizado a petición para que notFound() se emita antes del streaming
// y la respuesta lleve el estado HTTP 404 real, no un soft-404 prerenderizado.
export const dynamic = 'force-dynamic'

/**
 * La parte de Estudio se retira del front para que no sea accesible por
 * nadie: la ruta /study responde 404. El código fuente original se mantiene
 * intacto (vista cliente en `study-page-view.tsx`, gráficos y API) porque
 * no se sabe con certeza cuál es el objetivo de esa parte; ver README.md.
 * Para reactivarla, elimina este guard y vuelve a montar `StudyPageView`.
 */
export default function StudyPage() {
  notFound()
}
