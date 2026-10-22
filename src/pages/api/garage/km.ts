import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { vehicles, vehicleMaintenanceLogs } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { vehicleId, km, date, userId } = body;

    if (!vehicleId || km === undefined || km === null) {
      return new Response(JSON.stringify({ success: false, error: 'vehicleId y km son obligatorios' }), { status: 400 });
    }

    const todayStr = date || new Date().toISOString().split('T')[0];
    const newKm = Number(km);

    const vehicle = await db.select().from(vehicles).where(eq(vehicles.id, Number(vehicleId))).limit(1);
    if (!vehicle.length) {
      return new Response(JSON.stringify({ success: false, error: 'Vehículo no encontrado' }), { status: 404 });
    }

    await db
      .update(vehicles)
      .set({
        currentKm: newKm,
        lastKmDate: todayStr,
      })
      .where(eq(vehicles.id, Number(vehicleId)));

    // Opcional: registrar apunte en logs
    await db.insert(vehicleMaintenanceLogs).values({
      vehicleId: Number(vehicleId),
      title: `Actualización de kilometraje: ${newKm.toLocaleString('es-ES')} km`,
      performedDate: todayStr,
      performedKm: newKm,
      performedBy: userId ? Number(userId) : null,
      notes: 'Lectura periódica del cuentakilómetros',
    });

    return new Response(JSON.stringify({ success: true, currentKm: newKm, lastKmDate: todayStr }), { status: 200 });
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400 });
  }
};
