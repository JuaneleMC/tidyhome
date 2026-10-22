import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { vehicleMaintenance } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { id, vehicleId, name, intervalKm, intervalMonths, lastDoneKm, lastDoneDate, notes } = body;

    if (!vehicleId || !name?.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'vehicleId y nombre son obligatorios' }), { status: 400 });
    }

    if (id) {
      // Update
      const updated = await db
        .update(vehicleMaintenance)
        .set({
          name: name.trim(),
          intervalKm: intervalKm ? Number(intervalKm) : null,
          intervalMonths: intervalMonths ? Number(intervalMonths) : null,
          lastDoneKm: lastDoneKm !== undefined && lastDoneKm !== '' ? Number(lastDoneKm) : null,
          lastDoneDate: lastDoneDate || null,
          notes: notes?.trim() || null,
        })
        .where(eq(vehicleMaintenance.id, Number(id)))
        .returning();

      return new Response(JSON.stringify({ success: true, item: updated[0] }), { status: 200 });
    } else {
      // Create
      const created = await db
        .insert(vehicleMaintenance)
        .values({
          vehicleId: Number(vehicleId),
          name: name.trim(),
          intervalKm: intervalKm ? Number(intervalKm) : null,
          intervalMonths: intervalMonths ? Number(intervalMonths) : null,
          lastDoneKm: lastDoneKm !== undefined && lastDoneKm !== '' ? Number(lastDoneKm) : null,
          lastDoneDate: lastDoneDate || null,
          notes: notes?.trim() || null,
        })
        .returning();

      return new Response(JSON.stringify({ success: true, item: created[0] }), { status: 201 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400 });
  }
};
