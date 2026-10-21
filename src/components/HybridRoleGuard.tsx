'use client'

/**
 * Hybrid protected content uses the shared verified session, so it accepts
 * either email or username login while keeping AuthContext and AppAuthContext
 * scoped to their respective methods.
 */
export { default } from './RoleGuard'
