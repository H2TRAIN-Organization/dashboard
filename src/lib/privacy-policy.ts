/** Draft notice: update version and hash together whenever either translation changes. */
export const PRIVACY_POLICY_VERSION = '2026-11-12-draft-1'
export const privacyPolicy = {
  es: {
    title: 'Aviso de privacidad',
    paragraphs: [
      'Responsable: Universidad de Las Palmas de Gran Canaria. Contacto: h2train@proton.me.',
      'Finalidad: tratamiento y consulta de datos médicos y de Kubios mediante este dashboard. Categorías: identificativos, medicación, alimentación, ejercicio, ánimo, ciclo y variabilidad de la frecuencia cardíaca (HRV). La base indicada, según declaración del responsable, es el consentimiento explícito obtenido externamente; reconocer este aviso de lectura y acceso no lo sustituye ni lo modifica.',
      'Acceso: los participantes consultan sus propios datos y el personal autorizado los consulta según su rol. El rol médico no concede acceso global a Kubios.',
      'Conservación prevista: un año desde la recogida. Este texto es un borrador; la aplicación operativa del plazo y del borrado está pendiente de verificar.',
      'Puede solicitar acceso, rectificación, supresión, limitación, oposición y portabilidad, cuando corresponda, y retirar el consentimiento externo a través del contacto indicado, sin afectar al tratamiento lícito anterior. También puede reclamar ante la autoridad de protección de datos competente.',
      'Proveedores conocidos: Supabase, Vercel y Kubios. Sus condiciones y posibles transferencias internacionales están pendientes de verificar antes de declarar este texto definitivo. Este borrador no afirma conformidad jurídica absoluta.',
      'Aceptar este aviso permite acceder a los datos. La aceptación se registra una única vez por cuenta en la base de datos: no se vuelve a pedir en futuros inicios de sesión, salvo que se publique una versión nueva de este aviso. Rechazar cierra y revoca únicamente esta sesión; no retira el consentimiento externo ni borra datos.',
    ],
    accept: 'He leído y acepto continuar', reject: 'Rechazar y cerrar sesión',
    confirm: 'Confirmo que quiero rechazar el aviso y cerrar esta sesión',
    unavailable: 'No se pudo verificar la privacidad. El acceso a datos permanece bloqueado.',
    retry: 'Reintentar', loading: 'Verificando privacidad…', policy: 'Consultar aviso y contacto',
  },
  en: {
    title: 'Privacy notice',
    paragraphs: [
      'Controller: Universidad de Las Palmas de Gran Canaria. Contact: h2train@proton.me.',
      'Purpose: processing and consulting medical and Kubios data through this dashboard. Categories: identifiers, medication, food, exercise, mood, cycle and heart rate variability (HRV). According to the controller’s declaration, the stated basis is explicit consent obtained externally; acknowledging this access notice does not replace or modify it.',
      'Access: participants consult their own data and authorized staff consult data according to their role. The doctor role does not grant global Kubios access.',
      'Planned retention: one year from collection. This text is a draft; operational retention and deletion arrangements remain to be verified.',
      'You may request access, rectification, erasure, restriction, objection and portability where applicable, and withdraw external consent through the contact provided, without affecting previous lawful processing. You may also complain to the competent data protection authority.',
      'Known providers: Supabase, Vercel and Kubios. Their terms and possible international transfers remain to be verified before this text is declared final. This draft does not claim absolute legal compliance.',
      'Accepting this notice enables data access. The acceptance is recorded once per account in the database: it is not requested again on future sign-ins unless a new version of this notice is published. Rejecting closes and revokes only this session; it does not withdraw external consent or delete data.',
    ],
    accept: 'I have read and accept to continue', reject: 'Reject and sign out',
    confirm: 'I confirm that I want to reject the notice and close this session',
    unavailable: 'Privacy could not be verified. Data access remains blocked.',
    retry: 'Retry', loading: 'Verifying privacy…', policy: 'Read notice and contact',
  },
} as const

// SHA-256 of JSON.stringify(privacyPolicy), checked by the policy contract test.
export const PRIVACY_POLICY_HASH = '46f0453728eed97e4329ccf822c130c2062bdb3c6969e75d6f0c0318da22881d'
