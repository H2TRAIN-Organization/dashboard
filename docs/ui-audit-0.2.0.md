# Auditoría UI 0.2.0 — Dashboard H2TRAIN

Fecha: 2026-11-13 · Rama: `feature/ui-overhaul-0.2.0`
Skills aplicadas: `pick-ui-library` (elección de librería), `dashboard-design` (jerarquía/QA),
`charting` (anti-patrones de gráficos), `design-critique` + `accessibility-review` (revisión).
Regla de librería: **la librería del árbol gana** — todo el catálogo pick-ui-library ya está
en `package.json`; no se añaden dependencias nuevas.

Alcance: solo visual/UX. **Ningún cambio elimina datos, gráficos o funciones existentes.**
Los `data-testid` y ids usados por e2e se preservan: `global-language-selector`,
`admin-kubios-page-count|sync|sync-message|sync-retry|row`, `users-page-size`,
`kubios-date-from|to`.

## A. Transversales (todas las páginas)

| # | Hallazgo | Evidencia | Mejora | Herramienta/skill/librería | Prioridad |
|---|----------|-----------|--------|----------------------------|-----------|
| A1 | Sistema de botones inexistente: `<Button>` base-ui+cva en `src/components/ui/button.tsx` con 0 usos; ~40 estilos de `<button>` duplicados (gradiente 3-stop azul, outline blanco, rojo, ghost…) | button.tsx; users/page.tsx:330; data/page.tsx:567-573 | Migrar a `<Button>` con variantes `primary/outline/ghost/danger` que reproduzcan el look actual (gradiente azul incluido) | pick-ui-library → base-ui + cva | Alta |
| A2 | Modales a mano con overlays incoherentes (`bg-black/70` users vs `bg-black/60` privacy) y `confirm()` nativo en borrados | users/page.tsx:727,808,149,215; privacy/PrivacyRejection.tsx:99-107 | Primitiva `Dialog`/`AlertDialog` base-ui: un overlay token, focus-trap y dismiss accesibles de fábrica | base-ui (`@base-ui/react/dialog`), ui-styling | Alta |
| A3 | Dropdown de idioma a mano (click-outside manual, `z-[99999]`, items con hack `mx-1`) | LanguageSelector.tsx:28-39,57,104 | Reemplazar por `Menu` base-ui; z-index del sistema; quitar `hover:scale` del trigger fijo | base-ui menu | Media |
| A4 | 4 looks de loading: glass (users:389), card (admin-kubios:328), texto (database:90, study:39), spinner suelto (overview:337) | — | Componente compartido `LoadingState` (spinner + label, misma tarjeta glass) usado en todas las páginas | dashboard-design (estados), DRY | Media |
| A5 | Hex inline de gráficos en overview y HRVCharts violando `chart-theme.ts` (único origen de verdad); tooltip oscuro en overview contradice el claro del theme | overview/page.tsx:227-231,537,544-553,576-585; HRVCharts.tsx:141-239 | Consumir `CHART_SERIES_COLORS`/`seriesColor()`/`CHART_TOOLTIP_*` (DIP); tooltip claro en todo | charting (tokens), SOLID-DIP | Alta |
| A6 | Emojis como iconos en navegación (🏠👥📊❤️📈🗂️⚙️🔒) y banderas 🇪🇸🇺🇸 en el selector | Navigation.tsx:52-69; LanguageSelector.tsx:22-24 | Iconos lucide-react coherentes; en el selector, iniciales `ES/EN` | lucide-react (ya en árbol) | Media |
| A7 | Micro-interacción inconsistente: `hover:scale-105`, `hover:-translate-y-1`, `hover:-translate-y-2` y sombras distintas por botón | Navigation.tsx:106,256; admin/page.tsx:161 | Un solo patrón: transición CSS de fondo/borde/sombra; scale solo en tarjetas-Link, nunca en controles fijos | pick-ui-library ("un hover no necesita motion") | Media |
| A8 | Blobs decorativos duplicados en cada página (`animate-pulse` ×3) | page.tsx:241-245; data/page.tsx:534-538; users:293-299; kubios:572-577; overview:300-302 | Componente compartido `AmbientBackdrop`; misma estética, un solo markup | DRY / clean code | Baja |
| A9 | Tarjetas glass duplicadas inline con radios/sombras variables (`rounded-2xl/3xl`, `shadow-xl/2xl`) | ChartCard.tsx:32; users:306; data:544; kubios:165 | Variantes de `Card` (cva) con el look actual como único origen | shadcn/ui Card + cva | Media |

## B. Por página

| Página | # | Hallazgo | Mejora | Prioridad |
|--------|---|----------|--------|-----------|
| Home `/` | B1 | Hero gigante: `text-6xl md:text-8xl`, márgenes `mb-20/mb-8` (page.tsx:266-272) | Reducir tipografía y márgenes a escala del resto (jerarquía: la pregunta primero) | Media |
| Home | B2 | Grid de 4 columnas con 6-7 tarjetas (KubiosSummaryCard incluido) sin altura coherente | Orden y anchos coherentes; tarjetas iguales por fila (dashboard-design) | Media |
| Login | B3 | Botón submit con spinner `border-b-2` (medio círculo) y gradiente 3-stop (login:220-224) | `<Button primary>` + `Loader2` girando completo | Baja |
| Login | B4 | Doble columna con logotipo enorme y pesos descompensados en móvil | Compactar panel izquierdo; mantener identidad visual | Baja |
| Users | B5 | Duplicación de acciones tarjeta vs tabla (468-492 vs 621-645) | Extraer `UserActions` compartido (DRY) | Media |
| Users | B6 | `<select>` y checkbox nativos sin estilo común (423,606,754) | `Select` compartido + checkbox estilizado | Media |
| Users | B7 | `confirm()` nativo sin i18n para borrar (149,215) | `AlertDialog` con textos del diccionario | Alta |
| Data | B8 | Header desproporcionado (`p-10`, título `text-5xl`) frente al contenido (544-556) | Compactar cabecera; acciones a la derecha | Media |
| Data | B9 | Select con data-uri SVG inline y estilos ad-hoc (654-663) | `Select` compartido (A6) | Media |
| Analytics | B10 | `sparkColor` hex inline (431,444,457,501) | Tokens del theme | Baja |
| Overview | B11 | Dos familias de tarjeta: `rounded-2xl shadow-lg` (356-408) vs `rounded-lg shadow-sm` (561-684) | Unificar en `Card` (A9) | Alta |
| Overview | B12 | `fill="#8884d8"` relic de Recharts y grid sin tokens (537,573) | Tokens del theme | Media |
| Overview | B13 | `text-black` vs `text-gray-900`; grids condicionales que colapsan (562,597,642,685; 355,426) | Tokens tipográficos; layout estable con placeholder honesto (`—`) | Media |
| Kubios | B14 | Card doble-glass (386) y labels de `ReferenceLine` solapables (HrvLineChart:167-178) | Card única; etiquetas de media con colocación anti-solape | Media |
| Admin Kubios | B15 | Columna sticky `bg-white` no combina con `hover:bg-blue-50/40` de fila (table:116-123) | Hover coherente en sticky | Baja |
| Admin | B16 | `hover:shadow-3xl` no existe en Tailwind (161); `lg:grid-cols-4` con 2 items (156); pill "operational" verde sin dato (207-211) | Sombra válida; grid honesto; indicador gris hasta tener uptime real | Media |
| Admin DB | B17 | Estilo divergente total (slate sólido, botones `<a>`, estado busy sin estilo) (79,84-86,97) | Alinear al sistema visual sin tocar función ni testids | Media |
| Privacy | B18 | Overlays y focus-trap manuales divergentes (Boundary:199-233 vs Rejection:98-150) | `AlertDialog` base-ui para ambos | Alta |
| Language | B19 | Banderas emoji + `z-[99999]` (22-24,57,104) | Iniciales ES/EN + Menu base-ui (A3/A6) | Media |
| Navegación | B20 | Sin enlaces rápidos en escritorio (solo móvil); título duplicado con logo | Fila de píldoras de navegación en escritorio (no duplica lo retirado por MT43: nada bajo el encabezado del contenido) | Media |

## C. Fuera de alcance

- `study-page-view.tsx`: la ruta `/study` responde 404 por diseño (page.tsx:11-15); no se toca.
- Contenido, datos, endpoints, permisos y flujos: intactos.
- Readiness con 4 colores (kubios:37-45): es semántica de dato, se mantiene.
