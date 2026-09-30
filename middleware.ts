// Compatibility shim: upstream tests import `{ middleware } from '@/middleware'`
// while this branch canonicalizes the Next.js 16 edge entry as `proxy.ts`
// (`export async function proxy`). Re-export so both paths resolve.
export { proxy as middleware } from './proxy';
