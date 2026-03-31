import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { randomUUID } from 'crypto';
import { runClassroomGenerationJob } from './classroom-job-runner';
import {
  createClassroomGenerationJob,
  readClassroomGenerationJob,
} from './classroom-job-store';
import {
  readClassroom
} from './classroom-storage';

// Global singleton registry to prevent hot-reload wipes in development
const globalForMcp = globalThis as unknown as {
  mcpServer?: Server;
  mcpTransport?: WebStandardStreamableHTTPServerTransport;
  mcpInitialized?: boolean;
};

export const mcpTransport =
  globalForMcp.mcpTransport ||
  new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

export const mcpServer =
  globalForMcp.mcpServer ||
  new Server(
    {
      name: 'kelaska-mcp-server',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

if (process.env.NODE_ENV !== 'production') {
  globalForMcp.mcpTransport = mcpTransport;
  globalForMcp.mcpServer = mcpServer;
}

// Tool definitions
const generateClassroomTool: Tool = {
  name: 'generate_classroom',
  description: 'Triggers the generation of a new classroom based on a user prompt/requirement.',
  inputSchema: {
    type: 'object',
    properties: {
      requirement: {
        type: 'string',
        description: 'The topic, description, and requirements for the classroom generation.',
      },
      language: {
        type: 'string',
        description: 'The language for the classroom, e.g., "id-ID", "en-US", "ar-SA". Defaults to "id-ID".',
      },
      enableWebSearch: {
        type: 'boolean',
        description: 'Enable web search for context. Defaults to false.',
      },
      enableImageGeneration: {
        type: 'boolean',
        description: 'Enable AI image generation for scenes. Defaults to false.',
      },
    },
    required: ['requirement'],
  },
};

const checkGenerationStatusTool: Tool = {
  name: 'check_generation_status',
  description: 'Polls the status of an ongoing generation job.',
  inputSchema: {
    type: 'object',
    properties: {
      jobId: {
        type: 'string',
        description: 'The job ID returned from generate_classroom.',
      },
    },
    required: ['jobId'],
  },
};

const getClassroomTool: Tool = {
  name: 'get_classroom',
  description: 'Retrieves the full JSON content of a generated classroom.',
  inputSchema: {
    type: 'object',
    properties: {
      classroomId: {
        type: 'string',
        description: 'The ID of the classroom to retrieve.',
      },
    },
    required: ['classroomId'],
  },
};

export async function initializeMcpServer(baseUrl: string) {
  if (globalForMcp.mcpInitialized) return;
  globalForMcp.mcpInitialized = true;

  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [generateClassroomTool, checkGenerationStatusTool, getClassroomTool],
    };
  });

  mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'generate_classroom') {
      const requirement = String(args?.requirement);
      const language = args?.language ? String(args.language) : 'id-ID';
      const enableWebSearch = Boolean(args?.enableWebSearch);
      const enableImageGeneration = Boolean(args?.enableImageGeneration);

      if (!requirement) {
        throw new Error('Missing requirement');
      }

      const jobId = randomUUID().substring(0, 10);
      const input = {
        requirement,
        language,
        enableWebSearch,
        enableImageGeneration,
      };

      const job = await createClassroomGenerationJob(jobId, input);
      
      // We don't await this so it runs in background, similar to the API route
      // Ensure we don't crash the server if it fails
      runClassroomGenerationJob(jobId, input, baseUrl).catch((e) => {
        console.error('Background Generation Job Failed:', e);
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              jobId,
              status: job.status,
              step: job.step,
              message: job.message,
              pollUrl: `${baseUrl}/api/mcp/generate-classroom/${jobId}`,
            }),
          },
        ],
      };
    }

    if (name === 'check_generation_status') {
      const jobId = String(args?.jobId);
      if (!jobId) throw new Error('Missing jobId');

      const job = await readClassroomGenerationJob(jobId);
      if (!job) {
        throw new Error('Job not found');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              jobId: job.id,
              status: job.status,
              step: job.step,
              progress: job.progress,
              message: job.message,
              scenesGenerated: job.scenesGenerated,
              totalScenes: job.totalScenes,
              result: job.result,
              error: job.error,
              done: job.status === 'succeeded' || job.status === 'failed',
            }),
          },
        ],
      };
    }

    if (name === 'get_classroom') {
      const classroomId = String(args?.classroomId);
      if (!classroomId) throw new Error('Missing classroomId');

      const classroom = await readClassroom(classroomId);
      if (!classroom) {
        throw new Error('Classroom not found');
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(classroom),
          },
        ],
      };
    }

    throw new Error(`Unknown tool: ${name}`);
  });

  await mcpServer.connect(mcpTransport);
}
