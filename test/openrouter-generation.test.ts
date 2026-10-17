import { afterEach, beforeEach, expect, test } from 'bun:test';
import { getModelCatalog } from '@/lib/ai/model-catalog';
import { openRouterProvider } from '@/lib/ai/openrouter-provider';

const originalFetch = globalThis.fetch;
const bodies: Record<string, unknown>[] = [];
beforeEach(async () => {
 const text = {id:'test/reasoning',reasoning:{mandatory:true,supported_efforts:['low','medium','high']},pricing:{prompt:'0',completion:'0'},architecture:{output_modalities:['text']}};
 const image = {id:'test/image',pricing:{prompt:'0',completion:'0',image_output:'0.00001'}};
 const fetcher = (async (url: string) => Response.json({data:String(url).endsWith('/images/models') ? [{id:image.id,supported_parameters:{quality:{values:['auto','high']}}}] : String(url).includes('output_modalities=image') ? [image] : [text,{id:'test/plain',pricing:{prompt:'0',completion:'0'}}]})) as unknown as typeof fetch;
 await getModelCatalog({refresh:true,fetcher});
 bodies.length=0;
 globalThis.fetch = (async (url: string, init?: RequestInit) => {
  bodies.push(JSON.parse(String(init?.body)) as Record<string,unknown>);
  return Response.json(String(url).endsWith('/images') ? {data:[{b64_json:btoa('image'),media_type:'image/jpeg'}]} : {choices:[{message:{content:'Answer'},finish_reason:'stop'}],usage:{completion_tokens:300,completion_tokens_details:{reasoning_tokens:200}}});
 }) as unknown as typeof fetch;
});
afterEach(() => {globalThis.fetch=originalFetch;});
const chat = {model:'test/reasoning',system:'Rules',prompt:'Summarize',maxTokens:500,userId:'test',signal:new AbortController().signal};
test('forwards reasoning effort and reserves a separate completion allowance', async () => {
 const result=await openRouterProvider.chat({...chat,reasoningEffort:'medium',reasoningTokenAllowance:2048});
 expect(bodies[0]).toMatchObject({reasoning:{effort:'medium',exclude:true},max_tokens:2548});
 expect(result.usage.reasoningTokens).toBe(200);
});
test('mandatory reasoning uses the model default for an incompatible saved off setting', async () => {
 await openRouterProvider.chat({...chat,reasoningEffort:'none',reasoningTokenAllowance:1024});
 expect(bodies[0]).toMatchObject({reasoning:{exclude:true},max_tokens:1524});
 expect((bodies[0]?.reasoning as Record<string,unknown>).effort).toBeUndefined();
});
test('non-reasoning models retain the original feature output limit', async () => {
 await openRouterProvider.chat({...chat,model:'test/plain',reasoningEffort:'high',reasoningTokenAllowance:4096});
 expect(bodies[0]?.max_tokens).toBe(500);
 expect(bodies[0]?.reasoning).toBeUndefined();
});
test('forwards supported image quality and omits unsupported settings', async () => {
 const image={model:'test/image',prompt:'Scene',aspectRatio:'16:9' as const,format:'jpeg' as const,userId:'test',signal:chat.signal};
 await openRouterProvider.image({...image,quality:'high'});
 expect(bodies[0]).toMatchObject({quality:'high',aspect_ratio:'16:9',output_format:'jpeg'});
 await openRouterProvider.image({...image,quality:'max'});
 expect(bodies[1]?.quality).toBeUndefined();
});
