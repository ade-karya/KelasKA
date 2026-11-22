/** Minimal read-only classroom helpers for the static SPA. */

export interface ClassroomScene {
  id: string;
  title: string;
  order: number;
  type: string;
  content?: {
    type?: string;
    canvas?: { elements?: Array<{ type?: string; content?: string }> };
    questions?: Array<{ question: string; options?: Array<{ label: string; value: string }> }>;
  };
}

export interface ClassroomDocument {
  stage: { id: string; name: string; description?: string; updatedAt: number };
  scenes: ClassroomScene[];
}

export async function fetchStage(
  id: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ClassroomDocument> {
  const response = await fetchImpl(`/api/stages/${encodeURIComponent(id)}`, {
    cache: 'no-store',
    credentials: 'include',
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? 'Sesi aplikasi belum aktif atau kelas ini bukan milik Anda.'
        : `Kelas gagal dimuat (${response.status}).`,
    );
  }
  return (await response.json()) as ClassroomDocument;
}

/** Slide text elements store HTML; strip tags for this lightweight viewer. */
export function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim();
}

export function slideText(scene: ClassroomScene): string[] {
  const elements = scene.content?.canvas?.elements ?? [];
  return elements
    .filter((element) => element.type === 'text' && typeof element.content === 'string')
    .map((element) => stripHtml(element.content ?? ''))
    .filter((text) => text.length > 0);
}

export function orderedScenes(document: ClassroomDocument): ClassroomScene[] {
  return [...document.scenes].sort((a, b) => a.order - b.order);
}
