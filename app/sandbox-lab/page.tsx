import { notFound } from 'next/navigation';

import SandboxLab from './sandbox-lab';


export default function SandboxLabPage() {
  if (process.env.STATIC_UI === '1') return <SandboxLab />;
  if (process.env.OPENMAIC_SANDBOX_LAB !== 'true') notFound();
  return <SandboxLab />;
}
