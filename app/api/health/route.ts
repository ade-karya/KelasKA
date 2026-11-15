import { apiSuccess } from '@/lib/server/api-response';
import { verifyAccessToken } from '@/lib/server/access-token';
import { resolveServerGenerationCapabilities } from '@/lib/server/generation-capabilities';
import { getParallelSceneConcurrency } from '@/lib/server/provider-config';

const version = process.env.npm_package_version || '0.1.0';

/**
 * Deployment probes (Docker HEALTHCHECK, install.sh keep-alive, uptime checks)
 * hit this route anonymously and only need a 200, so the public answer carries
 * no topology: no exact version, no `accessCodeConfigured`, no feature flags.
 * An owner holding the access-code cookie (`openmaic_access`) gets the full
 * diagnostic payload the docker/compose setup and the installers expect.
 */
function accessCookieToken(request?: Request): string | undefined {
  const header = request?.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === 'openmaic_access') return rest.join('=') || undefined;
  }
  return undefined;
}

export async function GET(request?: Request) {
  const accessCode = process.env.ACCESS_CODE;
  const token = accessCookieToken(request);
  // Anonymous — the probe every deployment allows — never sees topology,
  // regardless of whether ACCESS_CODE is configured. A valid `openmaic_access`
  // token is the only unlock; an unset ACCESS_CODE grants nothing.
  const authenticated =
    Boolean(accessCode) && token !== undefined && verifyAccessToken(token, accessCode as string);

  if (!authenticated) {
    return apiSuccess({ status: 'ok' });
  }

  return apiSuccess({
    status: 'ok',
    version,
    accessCodeConfigured: Boolean(accessCode),
    capabilities: await resolveServerGenerationCapabilities(),
    // How many scenes the browser may generate at once (PARALLEL_SCENE_CONCURRENCY).
    generation: { parallelSceneConcurrency: getParallelSceneConcurrency() },
  });
}
