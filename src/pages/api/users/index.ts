import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { users } from '../../../db/schema';
import { desc } from 'drizzle-orm';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    await initializeDatabase();
    const allUsers = await db.select().from(users).orderBy(users.id);
    return new Response(JSON.stringify({ success: true, users: allUsers }), {
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
    const { name, email, avatar, color } = body;

    if (!name || !email) {
      return new Response(
        JSON.stringify({ success: false, error: 'Nombre y correo electrónico son obligatorios.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const created = await db
      .insert(users)
      .values({
        name: name.trim(),
        email: email.trim().toLowerCase(),
        avatar: avatar || '👤',
        color: color || '#6366f1',
      })
      .returning();

    return new Response(JSON.stringify({ success: true, user: created[0] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message?.includes('UNIQUE')
          ? 'Ya existe un usuario con ese correo electrónico'
          : error.message,
      }),
      { status: 400, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
