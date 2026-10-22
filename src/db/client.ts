import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import * as schema from './schema';

// Turso Serverless Cloud Database configuration
// Si TURSO_DATABASE_URL no está configurado, usamos local SQLite (en serverless /tmp/local.db)
export const isServerless = Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME);
export const isUsingTurso = Boolean(process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL);
export const isEphemeralStorage = isServerless && !isUsingTurso;
const defaultDb = isServerless ? 'file:/tmp/local.db' : 'file:local.db';
const url = process.env.TURSO_DATABASE_URL || process.env.TURSO_DB_URL || defaultDb;
const authToken = process.env.TURSO_AUTH_TOKEN || process.env.TURSO_DATABASE_AUTH_TOKEN || undefined;

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
        original_target_date TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        assigned_to INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        executed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        execution_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS vehicles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        plate TEXT,
        icon TEXT DEFAULT '🚗',
        color TEXT DEFAULT '#3b82f6',
        has_mileage INTEGER DEFAULT 1,
        current_km INTEGER DEFAULT 0,
        last_km_date TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS vehicle_maintenance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        interval_km INTEGER,
        interval_months INTEGER,
        last_done_km INTEGER,
        last_done_date TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS vehicle_maintenance_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        maintenance_id INTEGER REFERENCES vehicle_maintenance(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        performed_date TEXT NOT NULL,
        performed_km INTEGER,
        performed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        workshop TEXT,
        cost TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS vehicle_incidents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        vehicle_id INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        reported_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        reported_date TEXT NOT NULL,
        resolved_date TEXT,
        resolved_km INTEGER,
        workshop TEXT,
        resolution_notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Sembrado inicial de los 3 vehículos si la tabla está vacía
    const existingVehicles = await rawClient.execute('SELECT COUNT(*) as count FROM vehicles');
    const vCount = Number(existingVehicles.rows[0]?.count || 0);
    if (vCount === 0) {
      const todayStr = new Date().toISOString().split('T')[0];

      // 1. Peugeot 5008 5116HLK
      const res1 = await rawClient.execute({
        sql: 'INSERT INTO vehicles (name, plate, icon, color, has_mileage, current_km, last_km_date) VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING id',
        args: ['Peugeot 5008', '5116HLK', '🚙', '#3b82f6', 148000, todayStr],
      });
      const id1 = res1.rows[0]?.id;
      if (id1) {
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id1, 'Cambio de aceite y filtro', 15000, 12, 138000, '2025-11-10'],
        });
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id1, 'Filtro de aire y habitáculo', 30000, 24, 125000, '2025-04-15'],
        });
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id1, 'Filtro de combustible', 60000, null, 125000, '2025-04-15'],
        });
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id1, 'Líquido de frenos', null, 24, null, '2024-10-10'],
        });
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id1, 'ITV', null, 12, null, '2025-09-18'],
        });
      }

      // 2. Renault Megane LU 1199 W
      const res2 = await rawClient.execute({
        sql: 'INSERT INTO vehicles (name, plate, icon, color, has_mileage, current_km, last_km_date) VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING id',
        args: ['Renault Megane', 'LU 1199 W', '🚗', '#10b981', 192000, todayStr],
      });
      const id2 = res2.rows[0]?.id;
      if (id2) {
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id2, 'Cambio de aceite y filtro', 15000, 12, 185000, '2025-12-05'],
        });
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id2, 'Filtro de aire', 30000, 24, 170000, '2025-02-20'],
        });
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id2, 'Revisión de frenos', 20000, 12, 180000, '2025-07-15'],
        });
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
          args: [id2, 'ITV', null, 12, null, '2025-06-12'],
        });
      }

      // 3. Caravana (sin cuentakilómetros, solo ITV)
      const res3 = await rawClient.execute({
        sql: 'INSERT INTO vehicles (name, plate, icon, color, has_mileage, current_km, last_km_date) VALUES (?, ?, ?, ?, 0, 0, ?) RETURNING id',
        args: ['Caravana', '', '🚐', '#f59e0b', todayStr],
      });
      const id3 = res3.rows[0]?.id;
      if (id3) {
        await rawClient.execute({
          sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, null, ?, null, ?)',
          args: [id3, 'ITV', 24, '2024-05-20'],
        });
      }
      console.log('✅ 3 vehículos iniciales sembrados (Peugeot 5008, Renault Megane, Caravana).');
    }

    isInitialized = true;
    console.log('✅ Database tables initialized successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}

