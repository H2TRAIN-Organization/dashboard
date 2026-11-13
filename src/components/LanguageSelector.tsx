'use client'

import { useLanguage } from '@/contexts/LanguageContext'
import { Globe, Check } from 'lucide-react'
import { Menu as MenuPrimitive } from '@base-ui/react/menu'
import { cn } from 'cn'

interface LanguageSelectorProps {
  compact?: boolean
  /** Abre el menú hacia arriba cuando el selector vive junto al borde inferior. */
  openUp?: boolean
}

/**
 * Selector de idioma del dashboard (MT61) sobre el menú accesible de base-ui:
 * navegación por teclado, cierre con Esc/click fuera y `menuitemradio` de
 * fábrica. Las banderas emoji se sustituyen por las iniciales ES/EN.
 */
export default function LanguageSelector({
  compact = false,
  openUp = false,
}: LanguageSelectorProps) {
  const { language, setLanguage, t } = useLanguage()

  const languages = [
    { code: 'es' as const, name: 'Español' },
    { code: 'en' as const, name: 'English' },
  ]

  const currentLanguage = languages.find((lang) => lang.code === language)

  const triggerClassName = cn(
    'flex items-center border shadow-sm outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring data-[popup-open]:bg-blue-100/70',
    compact
      ? 'h-9 w-9 justify-center rounded-lg border-blue-200 bg-white text-blue-700 hover:bg-blue-50'
      : 'gap-2 rounded-xl border-gray-200/50 bg-white/90 px-4 py-3 text-gray-700 backdrop-blur-sm hover:bg-blue-50',
  )

  return (
    <MenuPrimitive.Root>
      <MenuPrimitive.Trigger
        aria-label={t.common.language || 'Language'}
        title={t.common.language || 'Language'}
        className={triggerClassName}
      >
        <Globe
          className={cn('text-blue-600', compact ? 'h-4 w-4' : 'h-5 w-5')}
          aria-hidden="true"
        />
        {!compact && (
          <>
            <span className="text-xs font-bold tracking-wide text-blue-700">
              {currentLanguage?.code.toUpperCase()}
            </span>
            <span className="text-sm font-semibold text-gray-800">
              {currentLanguage?.name}
            </span>
          </>
        )}
      </MenuPrimitive.Trigger>

      <MenuPrimitive.Portal>
        <MenuPrimitive.Positioner
          side={openUp ? 'top' : 'bottom'}
          align="end"
          sideOffset={8}
          className="z-50 outline-none"
        >
          <MenuPrimitive.Popup className="min-w-40 rounded-xl border border-gray-200/50 bg-white/95 py-2 shadow-xl backdrop-blur-xl outline-none sm:min-w-52 sm:rounded-2xl">
            <MenuPrimitive.RadioGroup
              value={language}
              onValueChange={(value) => {
                if (value === 'es' || value === 'en') setLanguage(value)
              }}
            >
              {languages.map((lang) => (
                <MenuPrimitive.RadioItem
                  key={lang.code}
                  value={lang.code}
                  className="mx-1 flex w-[calc(100%-0.5rem)] items-center justify-between rounded-lg px-3 py-2 text-sm outline-none transition-colors duration-150 data-[highlighted]:bg-blue-50 data-[checked]:bg-blue-100 data-[checked]:font-semibold data-[checked]:text-blue-700"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-xs font-bold tracking-wide text-blue-700">
                      {lang.code.toUpperCase()}
                    </span>
                    <span className="font-medium">{lang.name}</span>
                  </span>
                  <MenuPrimitive.RadioItemIndicator>
                    <Check className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                  </MenuPrimitive.RadioItemIndicator>
                </MenuPrimitive.RadioItem>
              ))}
            </MenuPrimitive.RadioGroup>
          </MenuPrimitive.Popup>
        </MenuPrimitive.Positioner>
      </MenuPrimitive.Portal>
    </MenuPrimitive.Root>
  )
}
