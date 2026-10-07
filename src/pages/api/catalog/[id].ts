import type { APIRoute } from 'astro';
import { db } from '../../../db/client';
import { choreCatalog } from '../../../db/schema';
import { eq } from 'drizzle-orm';
import { syncAndGenerateWeekChores } from '../../../lib/choreService';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  try {
    const id = Number(params.id);
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.delete(choreCatalog).where(eq(choreCatalog.id, id));

    return new Response(JSON.stringify({ success: true, message: 'Tarea eliminada del catálogo' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const PUT: APIRoute = async ({ params, request }) => {
  try {
    const id = Number(params.id);
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const updateData: any = {};
    if (body.name) updateData.name = body.name.trim();
    if (body.frequency) updateData.frequency = body.frequency;
    if (body.defaultAssigneeId) updateData.defaultAssigneeId = Number(body.defaultAssigneeId);
    if (body.icon) updateData.icon = body.icon;
    if (body.category) updateData.category = body.category;
    if (body.dayOfWeek !== undefined) updateData.dayOfWeek = Number(body.dayOfWeek);
    if (body.secondDayOfWeek !== undefined) updateData.secondDayOfWeek = Number(body.secondDayOfWeek);
    if (body.assignmentMode) updateData.assignmentMode = body.assignmentMode;

    const updated = await db
      .update(choreCatalog)
      .set(updateData)
      .where(eq(choreCatalog.id, id))
      .returning();

    await syncAndGenerateWeekChores();

    return new Response(JSON.stringify({ success: true, chore: updated[0] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
