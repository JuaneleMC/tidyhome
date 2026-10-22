import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { vehicleIncidents, vehicleMaintenanceLogs } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { action } = body;

    if (action === 'resolve') {
      const { incidentId, resolvedDate, resolvedKm, workshop, resolutionNotes, performedBy } = body;
      if (!incidentId) return new Response(JSON.stringify({ success: false, error: 'incidentId es obligatorio' }), { status: 400 });

      const todayStr = resolvedDate || new Date().toISOString().split('T')[0];
      const kmNum = resolvedKm !== undefined && resolvedKm !== '' ? Number(resolvedKm) : null;

      const incident = await db
        .select()
        .from(vehicleIncidents)
        .where(eq(vehicleIncidents.id, Number(incidentId)))
        .limit(1);

      if (!incident.length) {
        return new Response(JSON.stringify({ success: false, error: 'Incidencia no encontrada' }), { status: 404 });
      }

      await db
        .update(vehicleIncidents)
        .set({
          status: 'resolved',
          resolvedDate: todayStr,
          resolvedKm: kmNum,
          workshop: workshop?.trim() || null,
          resolutionNotes: resolutionNotes?.trim() || null,
        })
        .where(eq(vehicleIncidents.id, Number(incidentId)));

      // También registrar en el libro de revisiones
      await db.insert(vehicleMaintenanceLogs).values({
        vehicleId: incident[0].vehicleId,
        title: `Incidencia resuelta: ${incident[0].title}`,
        performedDate: todayStr,
        performedKm: kmNum,
        performedBy: performedBy ? Number(performedBy) : null,
        workshop: workshop?.trim() || null,
        notes: resolutionNotes?.trim() || null,
      });

      return new Response(JSON.stringify({ success: true, message: 'Incidencia resuelta y archivada en historial' }), { status: 200 });
    } else {
      // Report new incident
      const { vehicleId, title, description, reportedBy, reportedDate } = body;
      if (!vehicleId || !title?.trim()) {
        return new Response(JSON.stringify({ success: false, error: 'vehicleId y título son obligatorios' }), { status: 400 });
      }

      const todayStr = reportedDate || new Date().toISOString().split('T')[0];

      const created = await db
        .insert(vehicleIncidents)
        .values({
          vehicleId: Number(vehicleId),
          title: title.trim(),
          description: description?.trim() || null,
          status: 'open',
          reportedBy: reportedBy ? Number(reportedBy) : null,
          reportedDate: todayStr,
        })
        .returning();

      return new Response(JSON.stringify({ success: true, incident: created[0] }), { status: 201 });
    }
  } catch (err: any) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400 });
  }
};
