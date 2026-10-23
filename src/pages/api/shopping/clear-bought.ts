import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { shoppingItems } from '../../../db/schema';
import { eq } from 'drizzle-orm';

export const prerender = false;

export const POST: APIRoute = async () => {
  try {
    await initializeDatabase();
    await db.delete(shoppingItems).where(eq(shoppingItems.isBought, 1));

    return new Response(JSON.stringify({ success: true, message: 'Comprados eliminados' }), {
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
