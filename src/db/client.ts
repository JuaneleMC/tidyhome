import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

// Turso Serverless Cloud Database configuration
// Si TURSO_DATABASE_URL no está configurado, usamos local SQLite file:local.db
const url = process.env.TURSO_DATABASE_URL || 'file:local.db';
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

export const rawClient = createClient({
  url,
  authToken,
});

export const db = drizzle(rawClient, { schema });

let isInitialized = false;

export async function initializeDatabase() {
  if (isInitialized) return;
  try {
    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        avatar TEXT DEFAULT '👤',
        color TEXT DEFAULT '#6366f1',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS chore_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        frequency TEXT NOT NULL,
        assignment_mode TEXT NOT NULL DEFAULT 'fixed',
        default_assignee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        icon TEXT DEFAULT '🧹',
        category TEXT DEFAULT 'Hogar',
        day_of_week INTEGER DEFAULT 1,
        second_day_of_week INTEGER DEFAULT 4,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migración defensiva si las columnas no existen aún
    try {
      await rawClient.execute(`ALTER TABLE chore_catalog ADD COLUMN second_day_of_week INTEGER DEFAULT 4;`);
    } catch {}
    try {
      await rawClient.execute(`ALTER TABLE chore_catalog ADD COLUMN assignment_mode TEXT DEFAULT 'fixed';`);
    } catch {}

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS chore_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chore_id INTEGER NOT NULL REFERENCES chore_catalog(id) ON DELETE CASCADE,
        target_date TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_to INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        executed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        execution_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    isInitialized = true;
    console.log('✅ Database tables initialized successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}
