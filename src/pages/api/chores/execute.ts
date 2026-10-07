import type { APIRoute } from 'astro';
import { executeChore } from '../../../lib/choreService';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const { choreLogId, userId, desiredStatus } = body;

    if (!choreLogId || !userId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Se requieren los campos "choreLogId" y "userId"',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await executeChore(
      Number(choreLogId),
      Number(userId),
      desiredStatus
    );

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error executing chore:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Error al ejecutar tarea' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
