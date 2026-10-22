import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../../db/client';
import { vehicleMaintenance } from '../../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await initializeDatabase();
    const id = Number(params.id);
    if (!id) return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), { status: 400 });

    await db.delete(vehicleMaintenance).where(eq(vehicleMaintenance.id, id));
    return new Response(JSON.stringify({ success: true, message: 'Mantenimiento eliminado' }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
};
