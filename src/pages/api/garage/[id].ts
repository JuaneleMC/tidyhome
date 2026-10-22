import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { vehicles } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    await initializeDatabase();
    const id = Number(params.id);
    if (!id) return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), { status: 400 });

    const body = await request.json();
    const updateData: any = {};
    if (body.name) updateData.name = body.name.trim();
    if (body.plate !== undefined) updateData.plate = body.plate.trim().toUpperCase();
    if (body.icon) updateData.icon = body.icon;
    if (body.color) updateData.color = body.color;
    if (body.hasMileage !== undefined) updateData.hasMileage = body.hasMileage ? 1 : 0;
    if (body.currentKm !== undefined) updateData.currentKm = Number(body.currentKm);

    const updated = await db.update(vehicles).set(updateData).where(eq(vehicles.id, id)).returning();
    return new Response(JSON.stringify({ success: true, vehicle: updated[0] }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400 });
  }
};

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await initializeDatabase();
    const id = Number(params.id);
    if (!id) return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), { status: 400 });

    await db.delete(vehicles).where(eq(vehicles.id, id));
    return new Response(JSON.stringify({ success: true, message: 'Vehículo eliminado' }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 500 });
  }
};
