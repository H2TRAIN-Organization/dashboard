'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { Eye, EyeOff, Lock, LogIn, Mail, Shield, User } from 'lucide-react'
import { useLanguage } from '@/contexts/LanguageContext'
import { useSession } from '@/contexts/SessionContext'
import { ApiError, errorFrom } from '@/lib/api-client'
import { Button } from '@/components/ui/button'
import {
  buildLoginIdentityAttempts,
  toLoginInput,
} from '@/components/dashboard-shell/login-identity'

export default function LoginPage() {
  const { t } = useLanguage()
  const { session, loading: sessionLoading, login } = useSession()
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!sessionLoading && session !== null) {
      router.replace('/')
    }
  }, [router, session, sessionLoading])

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    const [attempt] = buildLoginIdentityAttempts(identifier)
    if (attempt === undefined) return

    setSubmitting(true)
    setError('')

    try {
      await login(toLoginInput(attempt, password))
      router.replace('/')
    } catch (caught) {
      // El backend decide si un identificador con @ pertenece a una cuenta de
      // correo o a un nombre de participante antiguo. Aquí no se reintenta con
      // otro método: un 401 por ambigüedad no debe eludirse desde la UI.
      const message =
        caught instanceof ApiError && caught.status === 401
          ? t.auth.invalidCredentials
          : errorFrom(caught).message || t.auth.unexpectedError
      setError(message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative flex min-h-screen overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -top-40 -right-40 h-80 w-80 rounded-full bg-blue-400 opacity-20 mix-blend-multiply blur-xl animate-pulse"></div>
        <div className="absolute -bottom-40 -left-40 h-80 w-80 rounded-full bg-indigo-400 opacity-20 mix-blend-multiply blur-xl animate-pulse delay-1000"></div>
        <div className="absolute left-1/2 top-40 h-80 w-80 rounded-full bg-purple-400 opacity-20 mix-blend-multiply blur-xl animate-pulse delay-500"></div>
      </div>

      <div className="relative hidden w-1/2 flex-col items-center justify-center bg-gradient-to-br from-blue-600 via-blue-700 to-indigo-800 p-12 text-white lg:flex">
        <div className="absolute inset-0 opacity-10">
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.1'%3E%3Ccircle cx='30' cy='30' r='4'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`,
            }}
          ></div>
        </div>

        <div className="relative z-10 max-w-md">
          <div className="mb-12">
            <div className="mb-6 flex items-center justify-center">
              <div className="rounded-3xl bg-white/20 p-4 backdrop-blur-sm">
                <Image
                  src="/logo-horizontal.png?v=10"
                  alt="H2TRAIN Logo"
                  width={700}
                  height={250}
                  className="h-32 w-auto rounded-2xl"
                  priority
                />
              </div>
            </div>
            <h1 className="mb-4 bg-gradient-to-r from-white to-blue-100 bg-clip-text text-center text-5xl font-bold text-transparent">
              Diabetes Tracker Dashboard
            </h1>
          </div>

          <div className="space-y-8">
            <div className="group flex items-start space-x-4">
              <div className="rounded-xl bg-white/20 p-4 backdrop-blur-sm transition-all duration-300 group-hover:bg-white/30">
                <User className="h-7 w-7" />
              </div>
              <div>
                <h2 className="mb-2 text-lg font-semibold">{t.auth.unifiedAccess}</h2>
                <p className="text-sm leading-relaxed text-blue-100">
                  {t.auth.unifiedAccessDescription}
                </p>
              </div>
            </div>

            <div className="group flex items-start space-x-4">
              <div className="rounded-xl bg-white/20 p-4 backdrop-blur-sm transition-all duration-300 group-hover:bg-white/30">
                <Shield className="h-7 w-7" />
              </div>
              <div>
                <h2 className="mb-2 text-lg font-semibold">{t.auth.advancedSecurity}</h2>
                <p className="text-sm leading-relaxed text-blue-100">
                  {t.auth.advancedSecurityDesc}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      <main className="relative z-10 flex w-full items-center justify-center p-6 sm:p-8 lg:w-1/2">
        <div className="w-full max-w-md">
          <div className="mb-10 text-center">
            <div className="mb-8 flex justify-center lg:hidden">
              <div className="rounded-2xl border border-white/20 bg-white/90 p-6 shadow-lg backdrop-blur-sm">
                <Image
                  src="/logo-horizontal.png?v=10"
                  alt="H2TRAIN Logo"
                  width={300}
                  height={90}
                  className="h-16 w-auto rounded-xl"
                  priority
                />
              </div>
            </div>

            <h2 className="mb-3 text-4xl font-bold text-gray-900">{t.auth.welcome}</h2>
            <p className="text-lg text-gray-600">{t.auth.unifiedAccessDescription}</p>
          </div>

          <div className="relative rounded-3xl border border-white/20 bg-white/80 p-6 shadow-2xl backdrop-blur-xl sm:p-10">
            <div className="absolute -right-4 -top-4 h-8 w-8 rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 opacity-20"></div>
            <div className="absolute -bottom-4 -left-4 h-6 w-6 rounded-full bg-gradient-to-r from-purple-500 to-pink-500 opacity-20"></div>

            <form onSubmit={handleSubmit} className="space-y-8" noValidate>
              {error && (
                <div
                  role="alert"
                  className="flex items-center space-x-2 rounded-xl border border-red-200 bg-red-50/80 px-4 py-4 text-sm text-red-700 backdrop-blur-sm"
                >
                  <div className="h-2 w-2 rounded-full bg-red-500"></div>
                  <span>{error}</span>
                </div>
              )}

              <div className="space-y-2">
                <label htmlFor="identifier" className="block text-sm font-semibold text-gray-700">
                  {t.auth.identifier}
                </label>
                <div className="group relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <Mail className="h-5 w-5 text-gray-400 transition-colors group-focus-within:text-blue-500" />
                  </div>
                  <input
                    id="identifier"
                    name="identifier"
                    type="text"
                    inputMode="text"
                    autoComplete="username"
                    value={identifier}
                    onChange={(event) => setIdentifier(event.target.value)}
                    required
                    aria-describedby="identifier-hint"
                    className="block w-full rounded-xl border border-gray-200 bg-white/50 py-4 pl-12 pr-4 text-gray-900 placeholder-gray-500 transition-all duration-200 hover:bg-white/70 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    placeholder={t.auth.identifierPlaceholder}
                  />
                </div>
                <p id="identifier-hint" className="text-xs text-gray-500">
                  {t.auth.identifierHint}
                </p>
              </div>

              <div className="space-y-2">
                <label htmlFor="password" className="block text-sm font-semibold text-gray-700">
                  {t.auth.password}
                </label>
                <div className="group relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                    <Lock className="h-5 w-5 text-gray-400 transition-colors group-focus-within:text-blue-500" />
                  </div>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="block w-full rounded-xl border border-gray-200 bg-white/50 py-4 pl-12 pr-14 text-gray-900 placeholder-gray-500 transition-all duration-200 hover:bg-white/70 focus:border-transparent focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
                  />
                  {/* MT57: este botón es un adorno del input (estirado con
                      inset-y-0); la primitiva normalizaría altura e icono, así
                      que se mantiene como <button> nativo. */}
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    aria-label={showPassword ? t.auth.hidePassword : t.auth.showPassword}
                    className="absolute inset-y-0 right-0 flex items-center rounded-r-xl pr-4 transition-colors hover:bg-gray-50"
                  >
                    {showPassword ? (
                      <EyeOff className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                    ) : (
                      <Eye className="h-5 w-5 text-gray-400 hover:text-gray-600" />
                    )}
                  </button>
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting}
                variant="primary"
                size="xl"
                className="w-full duration-300 hover:-translate-y-0.5"
              >
                {submitting ? (
                  <span className="flex items-center justify-center">
                    <span className="mr-3 h-6 w-6 animate-spin rounded-full border-b-2 border-white"></span>
                    {t.auth.loggingIn}
                  </span>
                ) : (
                  <span className="flex items-center justify-center">
                    <LogIn className="mr-2 h-5 w-5" />
                    {t.auth.signIn}
                  </span>
                )}
              </Button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
