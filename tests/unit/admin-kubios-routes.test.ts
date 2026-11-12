import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
vi.mock('server-only',()=>({}))
const mocks=vi.hoisted(()=>({getSession:vi.fn(),rpc:vi.fn(),decrypt:vi.fn()}))
vi.mock('@/server/composition/runtime',()=>({getServerRuntime:async()=>({useCases:{auth:{getSession:mocks.getSession}}})}))
vi.mock('@/server/composition/kubios-runtime',()=>({createKubiosRpcClient:()=>({rpc:mocks.rpc})}))
vi.mock('@/lib/kubios-crypto',()=>({decryptKubiosSnapshot:mocks.decrypt}))
import { GET as list } from '@/app/api/admin/kubios/participants/route'
import { GET as detail } from '@/app/api/admin/kubios/participants/[userId]/route'
import { GET as csv } from '@/app/api/admin/kubios/participants/[userId]/export/route'
import { PRIVACY_POLICY_HASH, PRIVACY_POLICY_VERSION } from '@/server/domain/privacy'
const session=(role='admin',state='complete')=>({user:{id:'999',username:'admin-without-kubios-link',role},privacy:{policyVersion:PRIVACY_POLICY_VERSION,policyHash:PRIVACY_POLICY_HASH,state}})
function req(path='/api/admin/kubios/participants',authenticated=true) {return new NextRequest(`https://dashboard.test${path}`,{headers:authenticated?{cookie:'dashboard_session=opaque'}:{}})}
const context={params:Promise.resolve({userId:'2'})}
beforeEach(()=>{mocks.getSession.mockResolvedValue(session());mocks.rpc.mockReset();mocks.decrypt.mockReturnValue(JSON.stringify({results:[{measured_timestamp:'2026-01-02T12:00:00Z',result:{rmssd_ms:32},token:'hidden'}]}))})
describe('Admin Kubios HTTP boundaries',()=>{
  it('requires a real session cookie and rejects doctor and initial privacy before RPC',async()=>{
    expect((await list(req(undefined,false))).status).toBe(401)
    mocks.getSession.mockResolvedValue(session('doctor'))
    expect((await list(req())).status).toBe(403)
    mocks.getSession.mockResolvedValue(session('admin','initial'))
    for(const route of [list,detail,csv]) {
      const response=await route(req(),context)
      expect(response.status).toBe(403)
      expect(await response.json()).toMatchObject({error:{code:'PRIVACY_ACTION_REQUIRED'}})
      expect(response.headers.get('cache-control')).toBe('private, no-store')
    }
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('lists participants by cursor and exports only safe cache data for any admin',async()=>{
    mocks.rpc.mockImplementation(async(name:string)=> {
      const link={user_id:2,username:'Alice',team_id:'11111111-1111-4111-8111-111111111111',kubios_member_id:'22222222-2222-4222-8222-222222222222'}
      if(name==='kubios_admin_list_participants') return {data:[{user_id:2,username:'Alice'}]}
      if(name==='kubios_admin_get_link' || name==='kubios_admin_list_links') return {data:[link]}
      return {data:[{key_version:1,nonce:'\\x'+'00'.repeat(12),tag:'\\x'+'00'.repeat(16),ciphertext:'\\x01',updated_at:'2026-01-02T12:00:00Z'}]}
    })
    const response=await list(req('/api/admin/kubios/participants'))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({participants:[{userId:2,username:'Alice'}],nextCursor:null})
    const detailResponse=await detail(req(),context)
    expect(detailResponse.status).toBe(200)
    expect(await detailResponse.text()).not.toMatch(/hidden|token|team_id/)
    const exported=await csv(req(),context)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-type')).toContain('text/csv')
    expect(await exported.text()).toContain('32')
  })
  it('validates unknown selectors, pages and missing participants without echoing private errors',async()=>{
    expect((await list(req('/api/admin/kubios/participants?team_id=x'))).status).toBe(400)
    expect((await list(req('/api/admin/kubios/participants?pageSize=101'))).status).toBe(400)
    mocks.rpc.mockResolvedValue({data:[]})
    expect((await detail(req(),context)).status).toBe(404)
    mocks.rpc.mockRejectedValue(new Error('private-secret'))
    const response=await list(req())
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private-secret')
  })
})
