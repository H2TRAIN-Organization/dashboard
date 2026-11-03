import { redirect } from 'next/navigation'

/**
 * El inicio personal histórico se conserva como redirección al inicio común.
 * Las opciones de ambos dashboards se muestran en `/` según el rol real.
 */
export default function AppDashboardPage() {
  redirect('/')
}
