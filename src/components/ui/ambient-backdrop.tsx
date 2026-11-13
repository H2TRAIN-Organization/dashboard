/**
 * Fondo ambiental del dashboard (MT59). Los tres blobs suaves con pulso que
 * cada página copiaba inline viven aquí; una sola implementación garantiza
 * la misma estética (y el mismo `aria-hidden`) en todas las vistas.
 */
export function AmbientBackdrop() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-400 opacity-10 mix-blend-multiply blur-xl animate-pulse"></div>
      <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-1000"></div>
      <div className="absolute left-1/2 top-40 h-80 w-80 rounded-full bg-purple-400 opacity-10 mix-blend-multiply blur-xl animate-pulse delay-500"></div>
    </div>
  )
}
