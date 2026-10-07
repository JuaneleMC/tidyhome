import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { choreCatalog, users, type FrequencyType } from '../../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { syncAndGenerateWeekChores } from '../../../lib/choreService';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    await initializeDatabase();
    const catalog = await db
      .select({
        id: choreCatalog.id,
        name: choreCatalog.name,
        frequency: choreCatalog.frequency,
        assignmentMode: choreCatalog.assignmentMode,
        defaultAssigneeId: choreCatalog.defaultAssigneeId,
        icon: choreCatalog.icon,
        category: choreCatalog.category,
        dayOfWeek: choreCatalog.dayOfWeek,
        secondDayOfWeek: choreCatalog.secondDayOfWeek,
        assigneeName: users.name,
        assigneeColor: users.color,
        assigneeAvatar: users.avatar,
      })
      .from(choreCatalog)
      .innerJoin(users, eq(choreCatalog.defaultAssigneeId, users.id))
      .orderBy(choreCatalog.id);

    return new Response(JSON.stringify({ success: true, catalog }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { name, frequency, assignmentMode, defaultAssigneeId, icon, category, dayOfWeek, secondDayOfWeek } = body;

    if (!name || !frequency || !defaultAssigneeId) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Nombre, periodicidad y responsable por defecto son obligatorios.',
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const firstDay = dayOfWeek !== undefined ? Number(dayOfWeek) : 1;
    const secondDay = secondDayOfWeek !== undefined ? Number(secondDayOfWeek) : ((firstDay + 3) % 7 || 4);

    const created = await db
      .insert(choreCatalog)
      .values({
        name: name.trim(),
        frequency: frequency as FrequencyType,
        assignmentMode: assignmentMode || 'fixed',
        defaultAssigneeId: Number(defaultAssigneeId),
        icon: icon || '🧹',
        category: category || 'Hogar',
        dayOfWeek: firstDay,
        secondDayOfWeek: secondDay,
      })
      .returning();

    // Sincronizar automáticamente para la semana actual
    await syncAndGenerateWeekChores();

    return new Response(JSON.stringify({ success: true, chore: created[0] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
