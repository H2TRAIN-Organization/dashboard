import { describe, expect, it } from 'vitest'
import { classifyPrivacyDecisionFailure, privacyGateText } from '@/lib/privacy-gate'

describe('classifyPrivacyDecisionFailure: reintento frente a conflicto', () => {
  it('trata red y saturación como fallo transitorio reintentable', () => {
    expect(classifyPrivacyDecisionFailure(408)).toBe('transient')
    expect(classifyPrivacyDecisionFailure(429)).toBe('transient')
    expect(classifyPrivacyDecisionFailure(500)).toBe('transient')
    expect(classifyPrivacyDecisionFailure(503)).toBe('transient')
  })

  it('trata los conflictos de decisión como permanentes que exigen re-sincronizar', () => {
    expect(classifyPrivacyDecisionFailure(400)).toBe('conflict')
    expect(classifyPrivacyDecisionFailure(401)).toBe('conflict')
    expect(classifyPrivacyDecisionFailure(409)).toBe('conflict')
  })

  it('mantiene el diccionario del gate alineado entre idiomas', () => {
    expect(Object.keys(privacyGateText.es).sort()).toEqual(Object.keys(privacyGateText.en).sort())
    for (const value of Object.values(privacyGateText.es)) expect(value.length).toBeGreaterThan(0)
    for (const value of Object.values(privacyGateText.en)) expect(value.length).toBeGreaterThan(0)
  })
})
