import { notFound } from 'next/navigation';
import { sandboxWorkspaceEnabled } from '@/lib/server/sandbox/settings';
import PBLExamples from './pbl-examples';
export default async function PBLExamplesPage() {
  if (process.env.STATIC_UI === '1') return <PBLExamples />;
  if (!(await sandboxWorkspaceEnabled())) notFound();
  return <PBLExamples />;
}
