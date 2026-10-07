import type { APIRoute } from 'astro';
import { seedInitialData } from '../../../db/seed';
import { syncAndGenerateWeekChores } from '../../../lib/choreService';

export const prerender = false;

export const ALL: APIRoute = async () => {
  try {
    await seedInitialData();
    const syncResult = await syncAndGenerateWeekChores();

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Base de datos en la nube inicializada y tareas sincronizadas correctamente.',
        syncResult,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
