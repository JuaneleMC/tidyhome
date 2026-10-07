import type { APIRoute } from 'astro';
import { syncAndGenerateWeekChores } from '../../../lib/choreService';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    let date: Date | undefined;
    try {
      const body = await request.json();
      if (body.date) {
        date = new Date(body.date);
      }
    } catch {
      // Body es opcional
    }

    const result = await syncAndGenerateWeekChores(date);
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error generating week chores:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Error al sincronizar tareas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const GET: APIRoute = async () => {
  try {
    const result = await syncAndGenerateWeekChores();
    return new Response(JSON.stringify({ success: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
