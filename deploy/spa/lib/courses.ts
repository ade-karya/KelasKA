/** Client-side course library calls. No server/Next APIs. */

export interface CourseSummary {
  id: string;
  name: string;
  description?: string;
  sceneCount: number;
  createdAt: number;
  updatedAt: number;
  isOwner?: boolean;
}

function errorMessage(response: Response): string {
  if (response.status === 401 || response.status === 403) {
    return 'Sesi aplikasi belum aktif atau akun belum disetujui.';
  }
  return `Permintaan gagal (${response.status}).`;
}

export async function fetchCourses(fetchImpl: typeof fetch = fetch): Promise<CourseSummary[]> {
  const response = await fetchImpl('/api/stages', {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!response.ok) throw new Error(errorMessage(response));
  const body = (await response.json()) as { stages?: CourseSummary[] };
  return Array.isArray(body.stages) ? body.stages : [];
}

export async function createCourse(
  name: string,
  description: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CourseSummary> {
  const response = await fetchImpl('/api/stages', {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: name.trim(),
      ...(description.trim() ? { description: description.trim() } : {}),
    }),
  });
  if (!response.ok) throw new Error(errorMessage(response));
  const body = (await response.json()) as { stage?: CourseSummary };
  if (!body.stage) throw new Error('Respons pembuatan kelas tidak valid.');
  return body.stage;
}

export function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
