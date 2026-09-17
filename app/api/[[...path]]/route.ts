// Single catch-all API dispatcher for Vercel Hobby plan.
//
// The Hobby plan allows max 12 Serverless Functions per deployment.
// With 69 app/api route files + 4 dynamic pages + middleware,
// a plain Next.js build produces ~74 functions and Vercel rejects the deploy:
//   "No more than 12 Serverless Functions can be added to a Deployment..."
//
// This file consolidates ALL /api routes into ONE function. The original
// implementations live next to it as `handler.ts` (not `route.ts`, so Next.js
// does not treat them as separate routes or functions). This dispatcher matches
// the request pathname and forwards to the matching handler with an emulated
// `{ params }` object, preserving URLs so the frontend needs no changes.
//
// Function count after this change:
//   1 API dispatcher + 4 dynamic pages + 1 middleware = ~6 (under 12).

import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

import * as accessCodeStatus from '@/app/api/access-code/status/handler';
import * as accessCodeVerify from '@/app/api/access-code/verify/handler';
import * as agentOwnerEvents from '@/app/api/agent/owner-events/handler';
import * as agentRuntime from '@/app/api/agent/runtime/handler';
import * as agentSessionsByIdCancel from '@/app/api/agent/sessions/[id]/cancel/handler';
import * as agentSessionsByIdEvents from '@/app/api/agent/sessions/[id]/events/handler';
import * as agentSessionsById from '@/app/api/agent/sessions/[id]/handler';
import * as agentSessionsByIdMessages from '@/app/api/agent/sessions/[id]/messages/handler';
import * as agentSessions from '@/app/api/agent/sessions/handler';
import * as agentSessionsStatus from '@/app/api/agent/sessions/status/handler';
import * as agentSkillsById from '@/app/api/agent/skills/[id]/handler';
import * as agentSkills from '@/app/api/agent/skills/handler';
import * as azureVoices from '@/app/api/azure-voices/handler';
import * as chat from '@/app/api/chat/handler';
import * as chatPi from '@/app/api/chat/pi/handler';
import * as chatPiWhiteboardVisibility from '@/app/api/chat/pi/whiteboard-visibility/handler';
import * as classroom from '@/app/api/classroom/handler';
import * as classroomMediaByClassroomIdByPath from '@/app/api/classroom-media/[classroomId]/[...path]/handler';
import * as comfyuiWorkflows from '@/app/api/comfyui-workflows/handler';
import * as exportVideoCapability from '@/app/api/export-video/capability/handler';
import * as exportVideoRenderByJobIdDownload from '@/app/api/export-video/render/[jobId]/download/handler';
import * as exportVideoRenderByJobId from '@/app/api/export-video/render/[jobId]/handler';
import * as exportVideoRender from '@/app/api/export-video/render/handler';
import * as extractDocument from '@/app/api/extract-document/handler';
import * as foldersById from '@/app/api/folders/[id]/handler';
import * as folders from '@/app/api/folders/handler';
import * as foldersMembers from '@/app/api/folders/members/handler';
import * as generateAgentProfiles from '@/app/api/generate/agent-profiles/handler';
import * as generateImage from '@/app/api/generate/image/handler';
import * as generateSceneActions from '@/app/api/generate/scene-actions/handler';
import * as generateSceneContent from '@/app/api/generate/scene-content/handler';
import * as generateSceneOutlinesStream from '@/app/api/generate/scene-outlines-stream/handler';
import * as generateTts from '@/app/api/generate/tts/handler';
import * as generateVideo from '@/app/api/generate/video/handler';
import * as generateVoice from '@/app/api/generate/voice/handler';
import * as generateClassroomByJobId from '@/app/api/generate-classroom/[jobId]/handler';
import * as generateClassroom from '@/app/api/generate-classroom/handler';
import * as health from '@/app/api/health/handler';
import * as materialsById from '@/app/api/materials/[id]/handler';
import * as materials from '@/app/api/materials/handler';
import * as parsePdf from '@/app/api/parse-pdf/handler';
import * as pblV2Evaluate from '@/app/api/pbl/v2/evaluate/handler';
import * as pblV2Instructor from '@/app/api/pbl/v2/instructor/handler';
import * as pblV2OpenTask from '@/app/api/pbl/v2/open-task/handler';
import * as pblV2Simulator from '@/app/api/pbl/v2/simulator/handler';
import * as pblV2TaskUpdate from '@/app/api/pbl/v2/task/update/handler';
import * as persistenceByPath from '@/app/api/persistence/[...path]/handler';
import * as providerProbeModels from '@/app/api/provider/probe-models/handler';
import * as proxyMedia from '@/app/api/proxy-media/handler';
import * as quizGrade from '@/app/api/quiz-grade/handler';
import * as serverProviders from '@/app/api/server-providers/handler';
import * as skillsById from '@/app/api/skills/[id]/handler';
import * as stageMetaByStageId from '@/app/api/stage-meta/[stageId]/handler';
import * as stagesByIdFreshness from '@/app/api/stages/[id]/freshness/handler';
import * as stagesByIdGenerationComplete from '@/app/api/stages/[id]/generation-complete/handler';
import * as stagesById from '@/app/api/stages/[id]/handler';
import * as stagesByIdManifest from '@/app/api/stages/[id]/manifest/handler';
import * as stagesByIdPublish from '@/app/api/stages/[id]/publish/handler';
import * as stagesByIdScenes from '@/app/api/stages/[id]/scenes/handler';
import * as stagesByIdStatus from '@/app/api/stages/[id]/status/handler';
import * as stagesByIdUnpublish from '@/app/api/stages/[id]/unpublish/handler';
import * as stages from '@/app/api/stages/handler';
import * as transcription from '@/app/api/transcription/handler';
import * as usage from '@/app/api/usage/handler';
import * as verifyImageProvider from '@/app/api/verify-image-provider/handler';
import * as verifyModel from '@/app/api/verify-model/handler';
import * as verifyPdfProvider from '@/app/api/verify-pdf-provider/handler';
import * as verifyVideoProvider from '@/app/api/verify-video-provider/handler';
import * as webSearch from '@/app/api/web-search/handler';

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

function notFound(): Response {
  return Response.json(
    { success: false, errorCode: 'NOT_FOUND', error: 'Not found' },
    { status: 404 },
  );
}

function methodNotAllowed(): Response {
  return Response.json(
    { success: false, errorCode: 'METHOD_NOT_ALLOWED', error: 'Method not allowed' },
    { status: 405 },
  );
}

type ApiHandlerFn = (
  req: NextRequest,
  ctx: { params: Promise<Record<string, string | string[]>> },
) => Promise<Response> | Response;

async function callHandler(
  req: NextRequest,
  method: string,
  mod: Record<string, unknown>,
  params: Record<string, string | string[]>,
): Promise<Response> {
  let fn = mod[method] as ApiHandlerFn | undefined;
  // Next.js serves HEAD via GET when only GET exists.
  if (!fn && method === 'HEAD' && typeof mod.GET === 'function') {
    fn = mod.GET as unknown as ApiHandlerFn;
  }
  if (!fn) return methodNotAllowed();
  return fn(req, { params: Promise.resolve(params) });
}

async function dispatch(req: NextRequest, method: string): Promise<Response> {
  const url = new URL(req.url);
  let pathname = url.pathname;
  if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
  const segs = pathname.split('/').filter(Boolean);
  if (segs[0] !== 'api') return notFound();
  const rest = segs.slice(1).map(safeDecode);

  // ---- length 4 (after /api): most specific first ----
  // POST /api/agent/sessions/[id]/cancel
  if (
    rest.length === 4 &&
    rest[0] === 'agent' &&
    rest[1] === 'sessions' &&
    rest[3] === 'cancel'
  ) {
    return callHandler(req, method, agentSessionsByIdCancel as unknown as Record<string, unknown>, {
      id: rest[2],
    });
  }
  // GET /api/agent/sessions/[id]/events
  if (
    rest.length === 4 &&
    rest[0] === 'agent' &&
    rest[1] === 'sessions' &&
    rest[3] === 'events'
  ) {
    return callHandler(req, method, agentSessionsByIdEvents as unknown as Record<string, unknown>, {
      id: rest[2],
    });
  }
  // POST /api/agent/sessions/[id]/messages
  if (
    rest.length === 4 &&
    rest[0] === 'agent' &&
    rest[1] === 'sessions' &&
    rest[3] === 'messages'
  ) {
    return callHandler(req, method, agentSessionsByIdMessages as unknown as Record<string, unknown>, {
      id: rest[2],
    });
  }
  // GET,DELETE /api/export-video/render/[jobId]/download
  if (
    rest.length === 4 &&
    rest[0] === 'export-video' &&
    rest[1] === 'render' &&
    rest[3] === 'download'
  ) {
    return callHandler(
      req,
      method,
      exportVideoRenderByJobIdDownload as unknown as Record<string, unknown>,
      { jobId: rest[2] },
    );
  }
  // POST /api/pbl/v2/task/update
  if (
    rest.length === 4 &&
    rest[0] === 'pbl' &&
    rest[1] === 'v2' &&
    rest[2] === 'task' &&
    rest[3] === 'update'
  ) {
    return callHandler(req, method, pblV2TaskUpdate as unknown as Record<string, unknown>, {});
  }

  // ---- length 3 ----
  // POST /api/chat/pi/whiteboard-visibility
  if (rest.length === 3 && rest[0] === 'chat' && rest[1] === 'pi' && rest[2] === 'whiteboard-visibility') {
    return callHandler(
      req,
      method,
      chatPiWhiteboardVisibility as unknown as Record<string, unknown>,
      {},
    );
  }
  // GET /api/agent/sessions/status (static — must precede /api/agent/sessions/[id])
  if (rest.length === 3 && rest[0] === 'agent' && rest[1] === 'sessions' && rest[2] === 'status') {
    return callHandler(req, method, agentSessionsStatus as unknown as Record<string, unknown>, {});
  }
  // GET,PATCH /api/agent/sessions/[id]
  if (rest.length === 3 && rest[0] === 'agent' && rest[1] === 'sessions') {
    return callHandler(req, method, agentSessionsById as unknown as Record<string, unknown>, {
      id: rest[2],
    });
  }
  // GET,DELETE /api/agent/skills/[id]
  if (rest.length === 3 && rest[0] === 'agent' && rest[1] === 'skills') {
    return callHandler(req, method, agentSkillsById as unknown as Record<string, unknown>, {
      id: rest[2],
    });
  }
  // GET,DELETE /api/export-video/render/[jobId]
  if (rest.length === 3 && rest[0] === 'export-video' && rest[1] === 'render') {
    return callHandler(req, method, exportVideoRenderByJobId as unknown as Record<string, unknown>, {
      jobId: rest[2],
    });
  }
  // GET /api/stages/[id]/freshness
  if (rest.length === 3 && rest[0] === 'stages' && rest[2] === 'freshness') {
    return callHandler(req, method, stagesByIdFreshness as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // POST /api/stages/[id]/generation-complete
  if (rest.length === 3 && rest[0] === 'stages' && rest[2] === 'generation-complete') {
    return callHandler(
      req,
      method,
      stagesByIdGenerationComplete as unknown as Record<string, unknown>,
      { id: rest[1] },
    );
  }
  // GET /api/stages/[id]/manifest
  if (rest.length === 3 && rest[0] === 'stages' && rest[2] === 'manifest') {
    return callHandler(req, method, stagesByIdManifest as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // POST /api/stages/[id]/publish
  if (rest.length === 3 && rest[0] === 'stages' && rest[2] === 'publish') {
    return callHandler(req, method, stagesByIdPublish as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // GET /api/stages/[id]/scenes
  if (rest.length === 3 && rest[0] === 'stages' && rest[2] === 'scenes') {
    return callHandler(req, method, stagesByIdScenes as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // GET /api/stages/[id]/status
  if (rest.length === 3 && rest[0] === 'stages' && rest[2] === 'status') {
    return callHandler(req, method, stagesByIdStatus as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // POST /api/stages/[id]/unpublish
  if (rest.length === 3 && rest[0] === 'stages' && rest[2] === 'unpublish') {
    return callHandler(req, method, stagesByIdUnpublish as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // POST /api/pbl/v2/evaluate
  if (rest.length === 3 && rest[0] === 'pbl' && rest[1] === 'v2' && rest[2] === 'evaluate') {
    return callHandler(req, method, pblV2Evaluate as unknown as Record<string, unknown>, {});
  }
  // POST /api/pbl/v2/instructor
  if (rest.length === 3 && rest[0] === 'pbl' && rest[1] === 'v2' && rest[2] === 'instructor') {
    return callHandler(req, method, pblV2Instructor as unknown as Record<string, unknown>, {});
  }
  // POST /api/pbl/v2/open-task
  if (rest.length === 3 && rest[0] === 'pbl' && rest[1] === 'v2' && rest[2] === 'open-task') {
    return callHandler(req, method, pblV2OpenTask as unknown as Record<string, unknown>, {});
  }
  // POST /api/pbl/v2/simulator
  if (rest.length === 3 && rest[0] === 'pbl' && rest[1] === 'v2' && rest[2] === 'simulator') {
    return callHandler(req, method, pblV2Simulator as unknown as Record<string, unknown>, {});
  }

  // ---- length 2 ----
  // GET /api/access-code/status
  if (rest.length === 2 && rest[0] === 'access-code' && rest[1] === 'status') {
    return callHandler(req, method, accessCodeStatus as unknown as Record<string, unknown>, {});
  }
  // POST /api/access-code/verify
  if (rest.length === 2 && rest[0] === 'access-code' && rest[1] === 'verify') {
    return callHandler(req, method, accessCodeVerify as unknown as Record<string, unknown>, {});
  }
  // GET /api/agent/owner-events
  if (rest.length === 2 && rest[0] === 'agent' && rest[1] === 'owner-events') {
    return callHandler(req, method, agentOwnerEvents as unknown as Record<string, unknown>, {});
  }
  // GET /api/agent/runtime
  if (rest.length === 2 && rest[0] === 'agent' && rest[1] === 'runtime') {
    return callHandler(req, method, agentRuntime as unknown as Record<string, unknown>, {});
  }
  // GET,POST /api/agent/sessions
  if (rest.length === 2 && rest[0] === 'agent' && rest[1] === 'sessions') {
    return callHandler(req, method, agentSessions as unknown as Record<string, unknown>, {});
  }
  // GET,POST /api/agent/skills
  if (rest.length === 2 && rest[0] === 'agent' && rest[1] === 'skills') {
    return callHandler(req, method, agentSkills as unknown as Record<string, unknown>, {});
  }
  // POST /api/chat/pi
  if (rest.length === 2 && rest[0] === 'chat' && rest[1] === 'pi') {
    return callHandler(req, method, chatPi as unknown as Record<string, unknown>, {});
  }
  // GET /api/export-video/capability
  if (rest.length === 2 && rest[0] === 'export-video' && rest[1] === 'capability') {
    return callHandler(req, method, exportVideoCapability as unknown as Record<string, unknown>, {});
  }
  // POST /api/export-video/render
  if (rest.length === 2 && rest[0] === 'export-video' && rest[1] === 'render') {
    return callHandler(req, method, exportVideoRender as unknown as Record<string, unknown>, {});
  }
  // POST /api/folders/members (static — must precede /api/folders/[id])
  if (rest.length === 2 && rest[0] === 'folders' && rest[1] === 'members') {
    return callHandler(req, method, foldersMembers as unknown as Record<string, unknown>, {});
  }
  // PATCH,DELETE /api/folders/[id]
  if (rest.length === 2 && rest[0] === 'folders') {
    return callHandler(req, method, foldersById as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // POST /api/generate/agent-profiles
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'agent-profiles') {
    return callHandler(req, method, generateAgentProfiles as unknown as Record<string, unknown>, {});
  }
  // POST /api/generate/image
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'image') {
    return callHandler(req, method, generateImage as unknown as Record<string, unknown>, {});
  }
  // POST /api/generate/scene-actions
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'scene-actions') {
    return callHandler(req, method, generateSceneActions as unknown as Record<string, unknown>, {});
  }
  // POST /api/generate/scene-content
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'scene-content') {
    return callHandler(req, method, generateSceneContent as unknown as Record<string, unknown>, {});
  }
  // POST /api/generate/scene-outlines-stream
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'scene-outlines-stream') {
    return callHandler(
      req,
      method,
      generateSceneOutlinesStream as unknown as Record<string, unknown>,
      {},
    );
  }
  // POST /api/generate/tts
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'tts') {
    return callHandler(req, method, generateTts as unknown as Record<string, unknown>, {});
  }
  // POST /api/generate/video
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'video') {
    return callHandler(req, method, generateVideo as unknown as Record<string, unknown>, {});
  }
  // POST /api/generate/voice
  if (rest.length === 2 && rest[0] === 'generate' && rest[1] === 'voice') {
    return callHandler(req, method, generateVoice as unknown as Record<string, unknown>, {});
  }
  // GET /api/generate-classroom/[jobId]
  if (rest.length === 2 && rest[0] === 'generate-classroom') {
    return callHandler(req, method, generateClassroomByJobId as unknown as Record<string, unknown>, {
      jobId: rest[1],
    });
  }
  // GET /api/materials/[id]
  if (rest.length === 2 && rest[0] === 'materials') {
    return callHandler(req, method, materialsById as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // POST /api/provider/probe-models
  if (rest.length === 2 && rest[0] === 'provider' && rest[1] === 'probe-models') {
    return callHandler(req, method, providerProbeModels as unknown as Record<string, unknown>, {});
  }
  // GET /api/skills/[id]
  if (rest.length === 2 && rest[0] === 'skills') {
    return callHandler(req, method, skillsById as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }
  // GET /api/stage-meta/[stageId]
  if (rest.length === 2 && rest[0] === 'stage-meta') {
    return callHandler(req, method, stageMetaByStageId as unknown as Record<string, unknown>, {
      stageId: rest[1],
    });
  }
  // GET,PATCH,PUT,DELETE /api/stages/[id]
  if (rest.length === 2 && rest[0] === 'stages') {
    return callHandler(req, method, stagesById as unknown as Record<string, unknown>, {
      id: rest[1],
    });
  }

  // ---- length 1 ----
  if (rest.length === 1 && rest[0] === 'health') {
    return callHandler(req, method, health as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'chat') {
    return callHandler(req, method, chat as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'classroom') {
    return callHandler(req, method, classroom as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'azure-voices') {
    return callHandler(req, method, azureVoices as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'comfyui-workflows') {
    return callHandler(req, method, comfyuiWorkflows as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'extract-document') {
    return callHandler(req, method, extractDocument as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'folders') {
    return callHandler(req, method, folders as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'generate-classroom') {
    return callHandler(req, method, generateClassroom as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'materials') {
    return callHandler(req, method, materials as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'parse-pdf') {
    return callHandler(req, method, parsePdf as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'proxy-media') {
    return callHandler(req, method, proxyMedia as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'quiz-grade') {
    return callHandler(req, method, quizGrade as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'server-providers') {
    return callHandler(req, method, serverProviders as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'stages') {
    return callHandler(req, method, stages as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'transcription') {
    return callHandler(req, method, transcription as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'usage') {
    return callHandler(req, method, usage as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'verify-image-provider') {
    return callHandler(req, method, verifyImageProvider as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'verify-model') {
    return callHandler(req, method, verifyModel as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'verify-pdf-provider') {
    return callHandler(req, method, verifyPdfProvider as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'verify-video-provider') {
    return callHandler(req, method, verifyVideoProvider as unknown as Record<string, unknown>, {});
  }
  if (rest.length === 1 && rest[0] === 'web-search') {
    return callHandler(req, method, webSearch as unknown as Record<string, unknown>, {});
  }

  // ---- catch-alls (must be last) ----
  // GET /api/classroom-media/[classroomId]/[...path]
  if (rest.length >= 3 && rest[0] === 'classroom-media') {
    return callHandler(
      req,
      method,
      classroomMediaByClassroomIdByPath as unknown as Record<string, unknown>,
      { classroomId: rest[1], path: rest.slice(2) },
    );
  }
  // ALL /api/persistence/[...path] (also bare /api/persistence for handler compat)
  if (rest.length >= 1 && rest[0] === 'persistence') {
    return callHandler(req, method, persistenceByPath as unknown as Record<string, unknown>, {
      path: rest.slice(1),
    });
  }

  return notFound();
}

export async function GET(req: NextRequest): Promise<Response> {
  return dispatch(req, 'GET');
}

export async function POST(req: NextRequest): Promise<Response> {
  return dispatch(req, 'POST');
}

export async function PUT(req: NextRequest): Promise<Response> {
  return dispatch(req, 'PUT');
}

export async function PATCH(req: NextRequest): Promise<Response> {
  return dispatch(req, 'PATCH');
}

export async function DELETE(req: NextRequest): Promise<Response> {
  return dispatch(req, 'DELETE');
}

export async function HEAD(req: NextRequest): Promise<Response> {
  return dispatch(req, 'HEAD');
}

export async function OPTIONS(req: NextRequest): Promise<Response> {
  return dispatch(req, 'OPTIONS');
}
