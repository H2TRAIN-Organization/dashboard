'use client'

import LanguageSelector from './LanguageSelector'

/**
 * Selector de idioma de la estructura compartida. Se monta una sola vez en el
 * layout raíz para que aparezca también en el login, en escritorio y en móvil,
 * sin depender de que cada vista lo repita.
 */
export default function GlobalLanguageSelector() {
  return (
    <div
      data-testid="global-language-selector"
      className="fixed bottom-4 right-4 z-[80] print:hidden"
    >
      <div className="sm:hidden">
        <div className="rounded-xl bg-white/95 shadow-lg backdrop-blur-sm">
          <LanguageSelector compact openUp />
        </div>
      </div>
      <div className="hidden sm:block">
        <LanguageSelector openUp />
      </div>
    </div>
  )
}
