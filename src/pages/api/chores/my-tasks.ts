import type { APIRoute } from 'astro';
import { getMyTasks } from '../../../lib/choreService';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const userIdParam = url.searchParams.get('userId');
    if (!userIdParam) {
      return new Response(
        JSON.stringify({ success: false, error: 'Parámetro "userId" es requerido' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const userId = parseInt(userIdParam, 10);
    if (isNaN(userId)) {
      return new Response(
        JSON.stringify({ success: false, error: '"userId" inválido' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const dateParam = url.searchParams.get('date');
    const refDate = dateParam ? new Date(dateParam) : new Date();

    const data = await getMyTasks(userId, refDate);
    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching my-tasks:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Error al obtener tareas' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
