import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../../db/client';
import { choreLog, choreCatalog, users } from '../../../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { extractExecutionDateYMD } from '../../../../lib/choreService';

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

    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const history = await db
      .select({
        id: choreLog.id,
        targetDate: choreLog.targetDate,
        originalTargetDate: choreLog.originalTargetDate,
        status: choreLog.status,
        assignedToId: choreLog.assignedTo,
        executedById: choreLog.executedBy,
        executionDate: choreLog.executionDate,
        notes: choreLog.notes,
      })
      .from(choreLog)
      .where(eq(choreLog.choreId, choreId))
      .orderBy(desc(choreLog.targetDate), desc(choreLog.id));

    // Filtrar solo las completadas y enriquecer con datos de asignado y ejecutor
    const completedHistory = history
      .filter((h) => h.status === 'completed' || h.executionDate || h.executedById)
      .map((h) => {
        const scheduledDate = h.originalTargetDate || h.targetDate;
        const executedDateYmd = extractExecutionDateYMD(h.executionDate) || h.targetDate;
        const assignedUser = userMap.get(h.assignedToId);
        const executedUser = h.executedById ? userMap.get(h.executedById) : assignedUser;

        return {
          id: h.id,
          targetDate: scheduledDate,
          executionDate: h.executionDate,
          executedDateYmd,
          isDifferentExecutionDay: Boolean(executedDateYmd && executedDateYmd !== scheduledDate),
          assignedToId: h.assignedToId,
          assignedToName: assignedUser?.name || 'Conviviente',
          assignedToAvatar: assignedUser?.avatar || '👤',
          assignedToColor: assignedUser?.color || '#6366f1',
          executedById: h.executedById,
          executedByName: executedUser?.name || assignedUser?.name || 'Conviviente',
          executedByAvatar: executedUser?.avatar || assignedUser?.avatar || '👤',
          executedByColor: executedUser?.color || assignedUser?.color || '#6366f1',
          isStolen: Boolean(h.executedById && h.assignedToId && h.executedById !== h.assignedToId),
          notes: h.notes,
        };
      });

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
