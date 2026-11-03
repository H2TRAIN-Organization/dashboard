import { redirect } from 'next/navigation'

/**
 * La ruta antigua del acceso por nombre de participante se conserva como
 * redirección al formulario común. Allí el mismo campo admite correo o nombre
 * de participante y el rol se resuelve siempre desde la sesión del servidor.
 */
export default function AppLoginPage() {
  redirect('/login')
}
