import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { shoppingItems } from '../../../db/schema';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    await initializeDatabase();
    // Vaciar por completo la lista activa de la compra (tanto pendientes como comprados)
    await db.delete(shoppingItems);

    return new Response(JSON.stringify({ success: true, message: 'Compra finalizada y lista vaciada por completo' }), {
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
