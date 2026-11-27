/**
 * Delete a workbench conversation from the rail.
 *
 * This used to be a Server Action. The Vercel branch is a static export, and a
 * static export cannot contain Server Actions, so the same call now goes
 * through `DELETE /api/agent/sessions/<id>` — one code path for both
 * deployments, with the owner scope enforced by the route.
 */
export async function deleteWorkspaceSession(id: string): Promise<{ deleted: boolean }> {
  const sessionId = id.trim();
  if (!sessionId) return { deleted: false };
  try {
    const response = await fetch(`/api/agent/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
    });
    if (!response.ok) return { deleted: false };
    const body = (await response.json().catch(() => null)) as { deleted?: unknown } | null;
    return { deleted: body?.deleted === true };
  } catch {
    return { deleted: false };
  }
}
