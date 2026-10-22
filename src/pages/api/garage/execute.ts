import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { vehicleMaintenance, vehicleMaintenanceLogs, vehicles } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { vehicleId, maintenanceId, performedKm, performedDate, performedBy, workshop, cost, notes } = body;

    if (!vehicleId) {
      return new Response(JSON.stringify({ success: false, error: 'vehicleId es obligatorio' }), { status: 400 });
    }

    const todayStr = performedDate || new Date().toISOString().split('T')[0];
    const kmNum = performedKm !== undefined && performedKm !== '' ? Number(performedKm) : null;

    let title = 'Mantenimiento realizado';
    if (maintenanceId) {
      const rule = await db
        .select()
        .from(vehicleMaintenance)
        .where(eq(vehicleMaintenance.id, Number(maintenanceId)))
        .limit(1);

      if (rule.length) {
        title = rule[0].name;
        // Actualizar último hecho en la regla
        await db
          .update(vehicleMaintenance)
          .set({
            lastDoneKm: kmNum !== null ? kmNum : rule[0].lastDoneKm,
            lastDoneDate: todayStr,
          })
          .where(eq(vehicleMaintenance.id, Number(maintenanceId)));
      }
    } else if (body.title) {
      title = body.title.trim();
    }

    // Si se especificaron km y son mayores a los actuales del coche, actualizar vehículo
    if (kmNum !== null) {
      const v = await db.select().from(vehicles).where(eq(vehicles.id, Number(vehicleId))).limit(1);
      if (v.length && (v[0].currentKm || 0) < kmNum) {
        await db
          .update(vehicles)
          .set({ currentKm: kmNum, lastKmDate: todayStr })
          .where(eq(vehicles.id, Number(vehicleId)));
      }
    }

    // Insertar en el libro de revisiones (logs)
    const log = await db
      .insert(vehicleMaintenanceLogs)
      .values({
        vehicleId: Number(vehicleId),
        maintenanceId: maintenanceId ? Number(maintenanceId) : null,
        title,
        performedDate: todayStr,
        performedKm: kmNum,
        performedBy: performedBy ? Number(performedBy) : null,
        workshop: workshop?.trim() || null,
        cost: cost?.trim() || null,
        notes: notes?.trim() || null,
      })
      .returning();

    return new Response(JSON.stringify({ success: true, log: log[0] }), { status: 201 });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400 });
  }
};
