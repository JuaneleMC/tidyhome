import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { users, choreCatalog, choreLog } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await initializeDatabase();
    const id = Number(params.id);

    if (isNaN(id)) {
      return new Response(
        JSON.stringify({ success: false, error: 'ID de conviviente inválido' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    // Limpiar tareas asociadas defensivamente
    await db.delete(choreLog).where(eq(choreLog.assignedTo, id));
    await db.delete(choreCatalog).where(eq(choreCatalog.defaultAssigneeId, id));
    
    // Eliminar usuario
    const deleted = await db.delete(users).where(eq(users.id, id)).returning();

    if (deleted.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: 'Conviviente no encontrado' }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, message: 'Conviviente eliminado correctamente' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
