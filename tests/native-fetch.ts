// Test-only URL adapter: browser requests use the Vite proxy; Node uses the geometry service in the same container.
const originalFetch=globalThis.fetch;
globalThis.fetch=((input:RequestInfo|URL,init?:RequestInit)=>{
  if(input==='/api/native/union')input=(process.env.NATIVE_TEST_URL??'http://127.0.0.1:8000')+'/union';
  return originalFetch(input,init);
}) as typeof fetch;
