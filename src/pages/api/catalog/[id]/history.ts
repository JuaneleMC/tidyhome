import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../../db/client';
import { choreLog, choreCatalog, users } from '../../../../db/schema';
import { eq, desc } from 'drizzle-orm';

export const prerender = false;

export const GET: APIRoute = async ({ params }) => {
  try {
    await initializeDatabase();
    const choreId = Number(params.id);
    if (!choreId) {
      return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const chore = await db
      .select({
        id: choreCatalog.id,
        name: choreCatalog.name,
        icon: choreCatalog.icon,
        category: choreCatalog.category,
        frequency: choreCatalog.frequency,
      })
      .from(choreCatalog)
      .where(eq(choreCatalog.id, choreId))
      .limit(1);

    if (!chore.length) {
      return new Response(JSON.stringify({ success: false, error: 'Tarea no encontrada' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const history = await db
      .select({
        id: choreLog.id,
        targetDate: choreLog.targetDate,
        executionDate: choreLog.executionDate,
        executedById: choreLog.executedBy,
        executedByName: users.name,
        executedByAvatar: users.avatar,
        executedByColor: users.color,
        notes: choreLog.notes,
      })
      .from(choreLog)
      .leftJoin(users, eq(choreLog.executedBy, users.id))
      .where(eq(choreLog.choreId, choreId))
      .orderBy(desc(choreLog.targetDate), desc(choreLog.id));

    // Filtrar solo las completadas
    const completedHistory = history.filter((h) => h.executionDate || h.executedByName);

    return new Response(
      JSON.stringify({
        success: true,
        chore: chore[0],
        totalDone: completedHistory.length,
        lastDone: completedHistory[0] || null,
        history: completedHistory,
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
