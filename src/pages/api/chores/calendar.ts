import type { APIRoute } from 'astro';
import { getMonthCalendar } from '../../../lib/choreService';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const now = new Date();
    const year = Number(url.searchParams.get('year')) || now.getFullYear();
    const month = Number(url.searchParams.get('month')) || now.getMonth() + 1;

    if (month < 1 || month > 12) {
      return new Response(JSON.stringify({ success: false, error: 'Mes inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const data = await getMonthCalendar(year, month);
    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching calendar:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Error al obtener calendario' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
