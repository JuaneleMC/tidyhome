import type { APIRoute } from 'astro';
import { logChoreForDate } from '../../../lib/choreService';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { choreId, newChore, date, userId } = await request.json();

    if (!date || !userId) {
      return new Response(
        JSON.stringify({ success: false, error: 'Se requieren los campos "date" y "userId"' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const result = await logChoreForDate({
      choreId: choreId ? Number(choreId) : undefined,
      newChore,
      date,
      userId: Number(userId),
    });

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error logging chore:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Error al registrar tarea' }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
