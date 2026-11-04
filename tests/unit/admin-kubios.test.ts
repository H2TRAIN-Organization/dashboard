import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
import { readAllAdminKubios, listAdminKubios, getAdminKubios, sanitizeAdminMeasurement, adminKubiosQuerySchema, filterAdminParticipant } from '@/server/composition/kubios-admin-runtime'
import { handleKubiosMeRequest, handleKubiosHrvResultsRequest, handleKubiosExportRequest } from '@/lib/kubios-snapshot-reader'
import { assertPrivacyAcknowledged, initialPrivacyStatus } from '@/server/domain/privacy'
import type { ActiveActor } from '@/server/domain/user'

const actor: ActiveActor = {userId:'999',username:'admin-no-link',role:'admin'}
const link = (id:number) => ({user_id:id,username:`person-${id}`,team_id:'11111111-1111-4111-8111-111111111111',kubios_member_id:'22222222-2222-4222-8222-222222222222'})
const snapshot = {key_version:1,nonce:'\\x'+'00'.repeat(12),tag:'\\x'+'00'.repeat(16),ciphertext:'\\x01',updated_at:'2026-11-04T12:00:00Z'}
function deps(rpc: (name: string, args: Readonly<Record<string, unknown>>) => PromiseLike<unknown>, plaintext = JSON.stringify({results:[{measured_timestamp:'2026-11-03T10:00:00Z',result:{rmssd_ms:40},access_token:'hidden'}]})) {
  return {createService:()=>({rpc}),decryptSnapshot:vi.fn(()=>plaintext),cryptoEnv:{},now:()=>new Date('2026-11-04T12:01:00Z')}
}
describe('Admin Kubios complete cache read',()=>{
  it('rejects doctor before creating a service and accepts admin without own link',async()=>{
    const rpc=vi.fn().mockResolvedValue({data:[]})
    await expect(readAllAdminKubios({...actor,role:'doctor'},deps(rpc))).rejects.toMatchObject({statusCode:403})
    expect(rpc).not.toHaveBeenCalled()
    expect(await readAllAdminKubios(actor,deps(rpc))).toEqual([])
  })
  it('traverses all keyset pages and returns sanitized user identified measurements',async()=>{
    const rpc=vi.fn(async(name:string,args:Record<string,unknown>)=>name==='kubios_admin_list_links' ? {data:args.p_after_user_id===0 ? Array.from({length:100},(_,i)=>link(i+1)) : args.p_after_user_id===100 ? [link(101)] : []} : {data:[snapshot]})
    const result=await readAllAdminKubios(actor,deps(rpc))
    expect(result).toHaveLength(101)
    expect(result[100]).toMatchObject({userId:101,username:'person-101',measurementCount:1,status:'ready'})
    expect(JSON.stringify(result)).not.toMatch(/access_token|team_id|kubios_member_id|hidden/)
    expect(rpc).toHaveBeenCalledWith('kubios_admin_list_links',{p_after_user_id:100,p_limit:100})
  })
  it('aborts malformed pages, repeated pages, RPC failures and invalid snapshot payload',async()=>{
    await expect(readAllAdminKubios(actor,deps(vi.fn().mockResolvedValue({data:null})))).rejects.toMatchObject({statusCode:503})
    const repeated=vi.fn(async(name:string)=>({data:name==='kubios_admin_list_links' ? Array.from({length:100},(_,i)=>link(i+1)) : [snapshot]}))
    await expect(readAllAdminKubios(actor,deps(repeated))).rejects.toMatchObject({statusCode:503})
    await expect(readAllAdminKubios(actor,deps(vi.fn().mockRejectedValue(new Error('private'))))).rejects.toMatchObject({statusCode:503})
    const rpc=vi.fn(async(name:string)=>({data:name==='kubios_admin_list_links' ? [link(1)] : [snapshot]}))
    await expect(readAllAdminKubios(actor,deps(rpc,'bad JSON'))).rejects.toMatchObject({statusCode:503})
  })
  it('reads only the selected page snapshots and checks exact page completeness',async()=>{
    const rpc=vi.fn(async(name:string)=>name==='kubios_admin_page_links'? {data:{links:[link(201)],total:201}} : {data:[snapshot]})
    const result=await listAdminKubios(actor,adminKubiosQuerySchema.parse({page:3,pageSize:100}),deps(rpc))
    expect(result).toMatchObject({total:201,participants:[{userId:201}]})
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(rpc).toHaveBeenCalledWith('kubios_admin_page_links',{p_search:'',p_offset:200,p_limit:100})
    const incomplete=vi.fn().mockResolvedValue({data:{links:[],total:10}})
    await expect(listAdminKubios(actor,adminKubiosQuerySchema.parse({}),deps(incomplete))).rejects.toMatchObject({statusCode:503})
  })
  it('resolves a detail by the exact verified user link and rejects mismatches',async()=>{
    const rpc=vi.fn(async(name:string)=>({data:name==='kubios_admin_get_link'?[link(2)]:[snapshot]}))
    expect(await getAdminKubios(actor,'2',{},deps(rpc))).toMatchObject({userId:2,username:'person-2'})
    expect(rpc).toHaveBeenCalledTimes(2)
    await expect(getAdminKubios(actor,'3',{},deps(rpc))).rejects.toMatchObject({statusCode:503})
    await expect(getAdminKubios(actor,'2147483648',{},deps(rpc))).rejects.toMatchObject({statusCode:400})
  })
  it('allowlists nested metrics and enforces real ordered calendar date filters',()=>{
    expect(sanitizeAdminMeasurement({timestamp:'2026-01-01T10:00:00Z',result:{rmssd_ms:0,mean_hr_bpm:Infinity,token:'secret',freq_domain:{HF_power:2,token:'secret'}}})).toEqual({measured_timestamp:'2026-01-01T10:00:00.000Z',daily_result:null,result:{rmssd_ms:0,freq_domain:{HF_power:2}}})
    expect(adminKubiosQuerySchema.safeParse({from:'2026-02-30'}).success).toBe(false)
    expect(adminKubiosQuerySchema.safeParse({from:'2026-02-03',to:'2026-01-01'}).success).toBe(false)
    expect(adminKubiosQuerySchema.safeParse({pageSize:101}).success).toBe(false)
    expect(filterAdminParticipant({userId:1,username:'a',status:'ready',syncedAt:null,measurementCount:2,results:[{measured_timestamp:null},{measured_timestamp:'2026-01-01T00:00:00Z'}]}, {from:'2026-01-01',to:'2026-01-01'}).measurementCount).toBe(1)
  })
})
describe('Personal Kubios privacy denial',()=>{
  it('returns exact privacy 403 for all personal readers before any cache access',async()=>{
    const rpc=vi.fn(); const dependency={...deps(rpc),resolveIdentity:async()=>{assertPrivacyAcknowledged({privacy:initialPrivacyStatus()});return {status:'unlinked' as const}}}
    for(const read of [handleKubiosMeRequest,handleKubiosHrvResultsRequest,handleKubiosExportRequest]) {
      const result=await read({sessionToken:'opaque',url:'https://internal.invalid/'},dependency)
      expect(result.status).toBe(403)
      expect(result.body).toMatchObject({error:{code:'PRIVACY_ACTION_REQUIRED'}})
      expect(result.headers['Cache-Control']).toBe('private, no-store')
    }
    expect(rpc).not.toHaveBeenCalled()
  })
})
