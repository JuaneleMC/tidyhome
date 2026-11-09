import type { APIRoute } from 'astro';
import { MCP_TOOLS, executeMcpTool } from '../../lib/mcpTools';

export const prerender = false;

const DEFAULT_MCP_KEY = 'th-mcp-9f8e7d6c5b4a2026';

function getConfiguredApiKey(): string {
  const envKey =
    (typeof process !== 'undefined' && process.env?.MCP_API_KEY) ||
    (import.meta as any).env?.MCP_API_KEY;
  return envKey && String(envKey).trim() ? String(envKey).trim() : DEFAULT_MCP_KEY;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, x-api-key, x-mcp-user, Mcp-Session-Id, Accept',
  'Access-Control-Expose-Headers': 'Mcp-Session-Id',
};

function isAuthorized(request: Request, url: URL): boolean {
  const expectedKey = getConfiguredApiKey();

  const queryKey =
    url.searchParams.get('key') ||
    url.searchParams.get('apiKey') ||
    url.searchParams.get('api_key') ||
    url.searchParams.get('token');
  if (queryKey && queryKey.trim() === expectedKey) return true;

  const headerApiKey = request.headers.get('x-api-key');
  if (headerApiKey && headerApiKey.trim() === expectedKey) return true;

  const authHeader = request.headers.get('authorization');
  if (authHeader) {
    const cleaned = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (cleaned === expectedKey) return true;
  }

  return false;
}

function getDefaultUser(request: Request, url: URL): string | null {
  return (
    url.searchParams.get('user') ||
    url.searchParams.get('usuario') ||
    request.headers.get('x-mcp-user') ||
    null
  );
}

async function handleJsonRpcMessage(
  msg: any,
  context: { defaultUserName?: string | null }
): Promise<any | null> {
  if (!msg || typeof msg !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  // Notificaciones MCP (ej. notifications/initialized, notifications/cancelled)
  if (isNotification && typeof method === 'string' && method.startsWith('notifications/')) {
    return null;
  }

  try {
    switch (method) {
      case 'initialize': {
        const clientProtocol = params?.protocolVersion;
        const supportedVersions = ['2025-03-26', '2024-11-05'];
        const negotiatedProtocol =
          clientProtocol && supportedVersions.includes(clientProtocol)
            ? clientProtocol
            : '2024-11-05';

        return {
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            protocolVersion: negotiatedProtocol,
            capabilities: {
              tools: {
                listChanged: false,
              },
            },
            serverInfo: {
              name: 'tidyhome-mcp',
              version: '1.0.0',
            },
            instructions:
              'Servidor MCP de TidyHome para gestionar tareas del hogar, lista de la compra del supermercado y mantenimiento de vehículos por voz.',
          },
        };
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          result: {},
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id: id ?? 1,
          result: {
            tools: MCP_TOOLS,
          },
        };
      }

      case 'tools/call': {
        const toolName = params?.name;
        const toolArgs = params?.arguments || {};

        if (!toolName) {
          return {
            jsonrpc: '2.0',
            id: id ?? null,
            error: { code: -32602, message: 'Falta el nombre de la herramienta (params.name)' },
          };
        }

        try {
          const textResult = await executeMcpTool(toolName, toolArgs, context);
          return {
            jsonrpc: '2.0',
            id: id ?? 1,
            result: {
              content: [
                {
                  type: 'text',
                  text: textResult,
                },
              ],
              isError: false,
            },
          };
        } catch (toolErr: any) {
          return {
            jsonrpc: '2.0',
            id: id ?? 1,
            result: {
              content: [
                {
                  type: 'text',
                  text: `❌ Error al ejecutar ${toolName}: ${toolErr?.message || String(toolErr)}`,
                },
              ],
              isError: true,
            },
          };
        }
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id: id ?? 1,
          result: { resources: [] },
        };
      }

      case 'prompts/list': {
        return {
          jsonrpc: '2.0',
          id: id ?? 1,
          result: { prompts: [] },
        };
      }

      default: {
        if (isNotification) return null;
        return {
          jsonrpc: '2.0',
          id: id ?? null,
          error: {
            code: -32601,
            message: `Método MCP no soportado: ${method}`,
          },
        };
      }
    }
  } catch (err: any) {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32603,
        message: err?.message || 'Internal MCP server error',
      },
    };
  }
}

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS,
  });
};

export const GET: APIRoute = async ({ request, url }) => {
  if (!isAuthorized(request, url)) {
    return new Response(
      JSON.stringify({
        error: 'No autorizado. Proporciona la API Key en la cabecera (x-api-key / Authorization: Bearer) o en la URL (?key=...).',
      }),
      {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }

  const accept = request.headers.get('accept') || '';

  // Compatibilidad con clientes MCP que inician handshake SSE por GET
  if (accept.includes('text/event-stream')) {
    const postEndpoint = `${url.pathname}${url.search}`;
    const stream = new ReadableStream({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`event: endpoint\ndata: ${postEndpoint}\n\n`));
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    });
  }

  return new Response(
    JSON.stringify({
      status: 'ok',
      server: 'tidyhome-mcp',
      version: '1.0.0',
      transport: 'streamable-http',
      toolsCount: MCP_TOOLS.length,
      tools: MCP_TOOLS.map((t) => t.name),
    }),
    {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    }
  );
};

export const POST: APIRoute = async ({ request, url }) => {
  if (!isAuthorized(request, url)) {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: -32001,
          message: 'No autorizado: API Key inválida o ausente.',
        },
      }),
      {
        status: 401,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: JSON inválido' },
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      }
    );
  }

  const context = {
    defaultUserName: getDefaultUser(request, url),
  };

  if (Array.isArray(body)) {
    const responses = [];
    for (const item of body) {
      const res = await handleJsonRpcMessage(item, context);
      if (res !== null) responses.push(res);
    }

    if (responses.length === 0) {
      return new Response(null, { status: 202, headers: CORS_HEADERS });
    }

    return new Response(JSON.stringify(responses), {
      status: 200,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const responseObj = await handleJsonRpcMessage(body, context);
  if (responseObj === null) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  return new Response(JSON.stringify(responseObj), {
    status: 200,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
};

export const DELETE: APIRoute = async () => {
  return new Response(null, {
    status: 200,
    headers: CORS_HEADERS,
  });
};
