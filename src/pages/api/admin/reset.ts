import type { APIRoute } from 'astro';
import { db, rawClient, initializeDatabase } from '../../../db/client';
import { choreLog, choreCatalog, users } from '../../../db/schema';

export const prerender = false;

export const ALL: APIRoute = async () => {
  try {
    await initializeDatabase();

    // Eliminar todos los registros en cascada
    await rawClient.execute('DELETE FROM chore_log;');
    await rawClient.execute('DELETE FROM chore_catalog;');
    await rawClient.execute('DELETE FROM users;');
    
    // Resetear secuencias autoincrementales si existen
    try {
      await rawClient.execute("DELETE FROM sqlite_sequence WHERE name IN ('chore_log', 'chore_catalog', 'users');");
    } catch {}

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Todos los datos de prueba han sido eliminados correctamente. La casa está lista para empezar de cero.',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
