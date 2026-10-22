import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import {
  vehicles,
  vehicleMaintenance,
  vehicleMaintenanceLogs,
  vehicleIncidents,
  users,
} from '../../../db/schema';
import { eq, desc, asc } from 'drizzle-orm';

export const prerender = false;

function computeMaintenanceStatus(item: any, currentKm: number, hasMileage: boolean) {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];

  let kmStatus: 'ok' | 'soon' | 'overdue' | null = null;
  let remainingKm: number | null = null;
  let nextDueKm: number | null = null;

  if (hasMileage && item.intervalKm) {
    const baseKm = item.lastDoneKm ?? 0;
    nextDueKm = baseKm + item.intervalKm;
    remainingKm = nextDueKm - currentKm;

    if (remainingKm <= 0) {
      kmStatus = 'overdue';
    } else if (remainingKm <= 1500) {
      kmStatus = 'soon';
    } else {
      kmStatus = 'ok';
    }
  }

  let dateStatus: 'ok' | 'soon' | 'overdue' | null = null;
  let remainingDays: number | null = null;
  let nextDueDate: string | null = null;

  if (item.intervalMonths && item.lastDoneDate) {
    const lastDate = new Date(item.lastDoneDate);
    const dueDate = new Date(lastDate);
    dueDate.setMonth(dueDate.getMonth() + item.intervalMonths);
    nextDueDate = dueDate.toISOString().split('T')[0];

    const diffMs = dueDate.getTime() - today.getTime();
    remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (remainingDays <= 0) {
      dateStatus = 'overdue';
    } else if (remainingDays <= 30) {
      dateStatus = 'soon';
    } else {
      dateStatus = 'ok';
    }
  }

  // Peor estado entre Km y Tiempo
  let finalStatus: 'ok' | 'soon' | 'overdue' = 'ok';
  if (kmStatus === 'overdue' || dateStatus === 'overdue') {
    finalStatus = 'overdue';
  } else if (kmStatus === 'soon' || dateStatus === 'soon') {
    finalStatus = 'soon';
  }

  return {
    ...item,
    status: finalStatus,
    kmStatus,
    dateStatus,
    remainingKm,
    nextDueKm,
    remainingDays,
    nextDueDate,
  };
}

export const GET: APIRoute = async () => {
  try {
    await initializeDatabase();

    const allVehicles = await db.select().from(vehicles).orderBy(vehicles.id);
    const allUsers = await db.select().from(users).orderBy(users.id);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const result = [];

    for (const v of allVehicles) {
      const items = await db
        .select()
        .from(vehicleMaintenance)
        .where(eq(vehicleMaintenance.vehicleId, v.id))
        .orderBy(asc(vehicleMaintenance.id));

      const logs = await db
        .select({
          id: vehicleMaintenanceLogs.id,
          vehicleId: vehicleMaintenanceLogs.vehicleId,
          maintenanceId: vehicleMaintenanceLogs.maintenanceId,
          title: vehicleMaintenanceLogs.title,
          performedDate: vehicleMaintenanceLogs.performedDate,
          performedKm: vehicleMaintenanceLogs.performedKm,
          performedById: vehicleMaintenanceLogs.performedBy,
          workshop: vehicleMaintenanceLogs.workshop,
          cost: vehicleMaintenanceLogs.cost,
          notes: vehicleMaintenanceLogs.notes,
          createdAt: vehicleMaintenanceLogs.createdAt,
        })
        .from(vehicleMaintenanceLogs)
        .where(eq(vehicleMaintenanceLogs.vehicleId, v.id))
        .orderBy(desc(vehicleMaintenanceLogs.performedDate), desc(vehicleMaintenanceLogs.id));

      const formattedLogs = logs.map((l) => ({
        ...l,
        performedByName: l.performedById ? userMap.get(l.performedById)?.name : null,
        performedByAvatar: l.performedById ? userMap.get(l.performedById)?.avatar : null,
      }));

      const incidents = await db
        .select()
        .from(vehicleIncidents)
        .where(eq(vehicleIncidents.vehicleId, v.id))
        .orderBy(desc(vehicleIncidents.reportedDate), desc(vehicleIncidents.id));

      const formattedIncidents = incidents.map((inc) => ({
        ...inc,
        reportedByName: inc.reportedBy ? userMap.get(inc.reportedBy)?.name : null,
        reportedByAvatar: inc.reportedBy ? userMap.get(inc.reportedBy)?.avatar : null,
      }));

      const computedItems = items.map((item) =>
        computeMaintenanceStatus(item, v.currentKm || 0, Boolean(v.hasMileage))
      );

      // Calcular si toca actualizar km (> 30 días sin registrar)
      let needsKmUpdate = false;
      if (v.hasMileage) {
        if (!v.lastKmDate) {
          needsKmUpdate = true;
        } else {
          const lastDate = new Date(v.lastKmDate);
          const diffDays = Math.floor((Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24));
          if (diffDays >= 30) needsKmUpdate = true;
        }
      }

      result.push({
        ...v,
        needsKmUpdate,
        maintenance: computedItems,
        logs: formattedLogs,
        incidents: formattedIncidents,
        openIncidentsCount: formattedIncidents.filter((i) => i.status === 'open').length,
        overdueCount: computedItems.filter((i) => i.status === 'overdue').length,
        soonCount: computedItems.filter((i) => i.status === 'soon').length,
      });
    }

    return new Response(JSON.stringify({ success: true, vehicles: result, users: allUsers }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Error fetching garage:', error);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { name, plate, icon, color, hasMileage, currentKm } = body;

    if (!name?.trim()) {
      return new Response(JSON.stringify({ success: false, error: 'El nombre del vehículo es obligatorio' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const todayStr = new Date().toISOString().split('T')[0];

    const created = await db
      .insert(vehicles)
      .values({
        name: name.trim(),
        plate: plate ? plate.trim().toUpperCase() : '',
        icon: icon || '🚗',
        color: color || '#3b82f6',
        hasMileage: hasMileage === false || hasMileage === 0 ? 0 : 1,
        currentKm: currentKm ? Number(currentKm) : 0,
        lastKmDate: todayStr,
      })
      .returning();

    return new Response(JSON.stringify({ success: true, vehicle: created[0] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
