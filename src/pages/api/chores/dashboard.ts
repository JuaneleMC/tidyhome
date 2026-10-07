import type { APIRoute } from 'astro';
import { getHouseholdDashboard } from '../../../lib/choreService';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
  try {
    const dateParam = url.searchParams.get('date');
    const refDate = dateParam ? new Date(dateParam) : new Date();

    const data = await getHouseholdDashboard(refDate);
    return new Response(JSON.stringify({ success: true, ...data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching dashboard:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || 'Error al obtener dashboard' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
