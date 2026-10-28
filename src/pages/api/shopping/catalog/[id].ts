import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../../db/client';
import { shoppingCatalog, shoppingItems } from '../../../../db/schema';
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

    if (body.name !== undefined) updateData.name = String(body.name).trim();
    if (body.category !== undefined) updateData.category = String(body.category).trim();
    if (body.defaultUnit !== undefined) updateData.defaultUnit = String(body.defaultUnit).trim();
    if (body.defaultQty !== undefined) updateData.defaultQty = Number(body.defaultQty) || 1;

    const updated = await db
      .update(shoppingCatalog)
      .set(updateData)
      .where(eq(shoppingCatalog.id, id))
      .returning();

    if (!updated.length) {
      return new Response(JSON.stringify({ success: false, error: 'Artículo no encontrado en el catálogo' }), {
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

    // Al eliminar del catálogo, también podemos desvincular o eliminar de shopping_items si no está comprado
    await db.delete(shoppingCatalog).where(eq(shoppingCatalog.id, id));

    return new Response(JSON.stringify({ success: true, message: 'Artículo eliminado del catálogo' }), {
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
