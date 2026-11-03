/**
 * Resolutor ESM para las pruebas K14.
 *
 * Los módulos de producción usan imports relativos sin extensión, como exige
 * la convención de Next.js (`./kubios-config`, no `./kubios-config.ts`). Node
 * 24 no resuelve esos especificadores por sí solo en ESM, así que el arnés de
 * pruebas registra este hook, que solo actúa sobre especificadores relativos
 * sin extensión y prueba `.ts`, `.tsx`, `.mjs` y `.js` antes de fallar.
 *
 * No modifica el código fuente ni los imports de producción.
 *
 * Uso:
 *   import { register } from 'node:module'
 *   register(new URL('./kubios-sync.k14.loader.mjs', import.meta.url))
 */

const EXTENSIONS = ['.ts', '.tsx', '.mjs', '.js']
const HAS_EXTENSION = /\.[cm]?[jt]sx?$/

export async function resolve(specifier, context, nextResolve) {
  const isRelative = specifier.startsWith('./') || specifier.startsWith('../')

  if (isRelative && !HAS_EXTENSION.test(specifier)) {
    for (const extension of EXTENSIONS) {
      try {
        return await nextResolve(`${specifier}${extension}`, context)
      } catch {
        // Se intenta la siguiente extensión; si ninguna existe, resuelve Node.
      }
    }
  }

  return nextResolve(specifier, context)
}
