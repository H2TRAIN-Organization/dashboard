import { apiRequest, buildQuery } from './api-client'
import type { AdminKubiosPage, AdminKubiosParticipant } from './admin-kubios-contract'
import type { StudyPeriod, StudyResponse } from './study-contract'
export const studyAdminApi = {
  study: (period: StudyPeriod, signal?: AbortSignal) => apiRequest<StudyResponse>(`/api/study${buildQuery({ period })}`, { signal }),
  participants: (query: Record<string, string | number>, signal?: AbortSignal) => apiRequest<AdminKubiosPage>(`/api/admin/kubios/participants${buildQuery(query)}`, { signal }),
  participant: (userId: string, from: string, to: string, signal?: AbortSignal) => apiRequest<AdminKubiosParticipant>(`/api/admin/kubios/participants/${encodeURIComponent(userId)}${buildQuery({ from, to })}`, { signal }),
}
