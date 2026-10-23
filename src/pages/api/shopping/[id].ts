import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { shoppingItems } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const PATCH: APIRoute = async ({ params, request }) => {
  try {
    await initializeDatabase();
    const id = Number(params.id);
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const body = await request.json();
    const updateData: any = {};

    if (body.isBought !== undefined) {
      const isBought = Boolean(body.isBought);
      updateData.isBought = isBought ? 1 : 0;
      updateData.boughtAt = isBought ? new Date().toISOString() : null;
      updateData.boughtBy = isBought && body.boughtBy ? Number(body.boughtBy) : null;
    }

    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.category !== undefined) updateData.category = String(body.category).trim();
    if (body.quantity !== undefined) updateData.quantity = body.quantity ? String(body.quantity).trim() : null;
    if (body.notes !== undefined) updateData.notes = body.notes ? String(body.notes).trim() : null;

    const updated = await db
      .update(shoppingItems)
      .set(updateData)
      .where(eq(shoppingItems.id, id))
      .returning();

    if (!updated.length) {
      return new Response(JSON.stringify({ success: false, error: 'Artículo no encontrado' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ success: true, item: updated[0] }), {
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

export const DELETE: APIRoute = async ({ params }) => {
  try {
    await initializeDatabase();
    const id = Number(params.id);
    if (!id) {
      return new Response(JSON.stringify({ success: false, error: 'ID inválido' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    await db.delete(shoppingItems).where(eq(shoppingItems.id, id));

    return new Response(JSON.stringify({ success: true, message: 'Artículo eliminado' }), {
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
