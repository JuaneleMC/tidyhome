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

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS shopping_catalog (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        category TEXT DEFAULT 'Otros',
        default_unit TEXT DEFAULT 'ud',
        default_qty INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await rawClient.execute(`
      CREATE TABLE IF NOT EXISTS shopping_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        catalog_id INTEGER REFERENCES shopping_catalog(id) ON DELETE SET NULL,
        name TEXT NOT NULL,
        category TEXT DEFAULT 'Otros',
        quantity TEXT DEFAULT '1',
        unit TEXT DEFAULT 'ud',
        notes TEXT,
        added_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        is_bought INTEGER DEFAULT 0,
        bought_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        bought_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Defensive migrations for shopping_items columns if existing db
    try {
      await rawClient.execute(`ALTER TABLE shopping_items ADD COLUMN catalog_id INTEGER;`);
    } catch {}
    try {
      await rawClient.execute(`ALTER TABLE shopping_items ADD COLUMN unit TEXT DEFAULT 'ud';`);
    } catch {}

    // ==========================================
    // 1. DEDUPLICACIÓN DEFENSIVA DE VEHÍCULOS
    // ==========================================
    try {
      const allVehiclesRes = await rawClient.execute('SELECT id, name, plate FROM vehicles ORDER BY id ASC');
      const seen = new Map<string, number>();
      for (const row of allVehiclesRes.rows) {
        const vId = Number(row.id);
        const key = (String(row.plate || '').trim() || String(row.name || '').trim()).toLowerCase();
        if (seen.has(key)) {
          const canonicalId = seen.get(key)!;
          // Reasociar logs e incidencias
          await rawClient.execute({
            sql: 'UPDATE vehicle_maintenance_logs SET vehicle_id = ? WHERE vehicle_id = ?',
            args: [canonicalId, vId],
          });
          await rawClient.execute({
            sql: 'UPDATE vehicle_incidents SET vehicle_id = ? WHERE vehicle_id = ?',
            args: [canonicalId, vId],
          });

          // Verificar si canonical tiene tareas de mantenimiento
          const canonicalMaint = await rawClient.execute({
            sql: 'SELECT COUNT(*) as count FROM vehicle_maintenance WHERE vehicle_id = ?',
            args: [canonicalId],
          });
          const dupMaint = await rawClient.execute({
            sql: 'SELECT COUNT(*) as count FROM vehicle_maintenance WHERE vehicle_id = ?',
            args: [vId],
          });

          if (Number(canonicalMaint.rows[0]?.count || 0) === 0 && Number(dupMaint.rows[0]?.count || 0) > 0) {
            await rawClient.execute({
              sql: 'UPDATE vehicle_maintenance SET vehicle_id = ? WHERE vehicle_id = ?',
              args: [canonicalId, vId],
            });
          } else {
            await rawClient.execute({
              sql: 'DELETE FROM vehicle_maintenance WHERE vehicle_id = ?',
              args: [vId],
            });
          }

          // Eliminar el vehículo duplicado
          await rawClient.execute({
            sql: 'DELETE FROM vehicles WHERE id = ?',
            args: [vId],
          });
          console.log(`🧹 Vehículo duplicado eliminado (id: ${vId}, mantenido id: ${canonicalId}).`);
        } else {
          seen.set(key, vId);
        }
      }
    } catch (dedupErr) {
      console.error('Error en deduplicación defensiva de vehículos:', dedupErr);
    }

    // ==========================================
    // 2. ASEGURAR VEHÍCULOS INICIALES Y SUS MANTENIMIENTOS
    // ==========================================
    const todayStr = new Date().toISOString().split('T')[0];

    const defaultFleet = [
      {
        name: 'Peugeot 5008',
        plate: '5116HLK',
        icon: '🚙',
        color: '#3b82f6',
        hasMileage: 1,
        currentKm: 148000,
        maintenances: [
          { name: 'Cambio de aceite y filtro', intervalKm: 15000, intervalMonths: 12, lastDoneKm: 138000, lastDoneDate: '2025-11-10' },
          { name: 'Filtro de aire y habitáculo', intervalKm: 30000, intervalMonths: 24, lastDoneKm: 125000, lastDoneDate: '2025-04-15' },
          { name: 'Filtro de combustible', intervalKm: 60000, intervalMonths: null, lastDoneKm: 125000, lastDoneDate: '2025-04-15' },
          { name: 'Líquido de frenos', intervalKm: null, intervalMonths: 24, lastDoneKm: null, lastDoneDate: '2024-10-10' },
          { name: 'ITV', intervalKm: null, intervalMonths: 12, lastDoneKm: null, lastDoneDate: '2025-09-18' },
        ],
      },
      {
        name: 'Renault Megane',
        plate: 'LU 1199 W',
        icon: '🚗',
        color: '#10b981',
        hasMileage: 1,
        currentKm: 192000,
        maintenances: [
          { name: 'Cambio de aceite y filtro', intervalKm: 15000, intervalMonths: 12, lastDoneKm: 185000, lastDoneDate: '2025-12-05' },
          { name: 'Filtro de aire', intervalKm: 30000, intervalMonths: 24, lastDoneKm: 170000, lastDoneDate: '2025-02-20' },
          { name: 'Revisión de frenos', intervalKm: 20000, intervalMonths: 12, lastDoneKm: 180000, lastDoneDate: '2025-07-15' },
          { name: 'ITV', intervalKm: null, intervalMonths: 12, lastDoneKm: null, lastDoneDate: '2025-06-12' },
        ],
      },
      {
        name: 'Caravana',
        plate: '',
        icon: '🚐',
        color: '#f59e0b',
        hasMileage: 0,
        currentKm: 0,
        maintenances: [
          { name: 'ITV', intervalKm: null, intervalMonths: 24, lastDoneKm: null, lastDoneDate: '2024-05-20' },
        ],
      },
    ];

    for (const v of defaultFleet) {
      let vehicleId: number | null = null;
      const searchRes = v.plate
        ? await rawClient.execute({
            sql: 'SELECT id FROM vehicles WHERE plate = ? LIMIT 1',
            args: [v.plate],
          })
        : await rawClient.execute({
            sql: 'SELECT id FROM vehicles WHERE name = ? LIMIT 1',
            args: [v.name],
          });

      if (searchRes.rows.length > 0) {
        vehicleId = Number(searchRes.rows[0].id);
      } else {
        const ins = await rawClient.execute({
          sql: 'INSERT INTO vehicles (name, plate, icon, color, has_mileage, current_km, last_km_date) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
          args: [v.name, v.plate, v.icon, v.color, v.hasMileage, v.currentKm, todayStr],
        });
        vehicleId = Number(ins.rows[0]?.id);
      }

      if (vehicleId) {
        // Asegurar que tenga sus tareas de mantenimiento iniciales si no tiene ninguna
        const countRes = await rawClient.execute({
          sql: 'SELECT COUNT(*) as count FROM vehicle_maintenance WHERE vehicle_id = ?',
          args: [vehicleId],
        });
        const currentMaintCount = Number(countRes.rows[0]?.count || 0);
        if (currentMaintCount === 0 && v.maintenances.length > 0) {
          for (const m of v.maintenances) {
            await rawClient.execute({
              sql: 'INSERT INTO vehicle_maintenance (vehicle_id, name, interval_km, interval_months, last_done_km, last_done_date) VALUES (?, ?, ?, ?, ?, ?)',
              args: [vehicleId, m.name, m.intervalKm, m.intervalMonths, m.lastDoneKm, m.lastDoneDate],
            });
          }
        }
      }
    }

    // Asegurar que exista la tarea puntual "Hacer la compra" en el catálogo (sin responsable asignado)
    try {
      const shoppingChore = await rawClient.execute({
        sql: "SELECT id FROM chore_catalog WHERE name = 'Hacer la compra' LIMIT 1",
      });
      if (shoppingChore.rows.length === 0) {
        await rawClient.execute({
          sql: "INSERT INTO chore_catalog (name, frequency, assignment_mode, default_assignee_id, icon, category, day_of_week) VALUES ('Hacer la compra', 'once', 'fixed', NULL, '🛒', 'Compras', 1)",
        });
      }
    } catch {}

    // Asegurar artículos iniciales en el Catálogo de la Compra (Artículos en uso)
    try {
      const countRes = await rawClient.execute('SELECT COUNT(*) as count FROM shopping_catalog');
      const catalogCount = Number(countRes.rows[0]?.count || 0);
      if (catalogCount === 0) {
        const initialCatalog = [
          { name: 'Leche', category: 'Lácteos y Huevos', defaultUnit: 'pack 6L' },
          { name: 'Agua', category: 'Bebidas', defaultUnit: 'garrafa 5L' },
          { name: 'Huevos', category: 'Lácteos y Huevos', defaultUnit: 'docena' },
          { name: 'Pan', category: 'Panadería y Cereales', defaultUnit: 'barra' },
          { name: 'Jamón Serrano', category: 'Carnicería y Charcutería', defaultUnit: '100gr' },
          { name: 'Pechuga de Pollo', category: 'Carnicería y Charcutería', defaultUnit: '500gr' },
          { name: 'Queso en lonchas', category: 'Lácteos y Huevos', defaultUnit: '100gr' },
          { name: 'Plátanos', category: 'Frutas y Verduras', defaultUnit: '1 kg' },
          { name: 'Manzanas', category: 'Frutas y Verduras', defaultUnit: '1 kg' },
          { name: 'Tomates', category: 'Frutas y Verduras', defaultUnit: '1 kg' },
          { name: 'Cebollas', category: 'Frutas y Verduras', defaultUnit: '1 kg' },
          { name: 'Patatas', category: 'Frutas y Verduras', defaultUnit: '1 kg' },
          { name: 'Aceite de Oliva', category: 'Despensa y Conservas', defaultUnit: 'botella 1L' },
          { name: 'Arroz', category: 'Despensa y Conservas', defaultUnit: 'paquete 1kg' },
          { name: 'Pasta (Macarrones)', category: 'Despensa y Conservas', defaultUnit: 'paquete 1kg' },
          { name: 'Atún en lata', category: 'Despensa y Conservas', defaultUnit: 'pack 3 latas' },
          { name: 'Café', category: 'Despensa y Conservas', defaultUnit: 'paquete' },
          { name: 'Vino Tinto', category: 'Bebidas', defaultUnit: 'botella' },
          { name: 'Cerveza', category: 'Bebidas', defaultUnit: 'pack 6 latas' },
          { name: 'Papel Higiénico', category: 'Limpieza y Hogar', defaultUnit: 'pack' },
          { name: 'Detergente Lavadora', category: 'Limpieza y Hogar', defaultUnit: 'botella' },
          { name: 'Lavavajillas (Fairy)', category: 'Limpieza y Hogar', defaultUnit: 'botella' },
          { name: 'Bolsas de Basura', category: 'Limpieza y Hogar', defaultUnit: 'rollo' },
          { name: 'Champú', category: 'Higiene y Cuidado', defaultUnit: 'bote' },
          { name: 'Gel de Ducha', category: 'Higiene y Cuidado', defaultUnit: 'bote' },
          { name: 'Pasta de Dientes', category: 'Higiene y Cuidado', defaultUnit: 'tubo' },
        ];

        for (const item of initialCatalog) {
          await rawClient.execute({
            sql: 'INSERT INTO shopping_catalog (name, category, default_unit, default_qty) VALUES (?, ?, ?, ?)',
            args: [item.name, item.category, item.defaultUnit, 1],
          });
        }
        console.log(`🛒 ${initialCatalog.length} artículos iniciales sembrados en el Catálogo de Compra.`);
      }
    } catch (seedErr) {
      console.error('Error sembrando catálogo de compra:', seedErr);
    }

    isInitialized = true;
    console.log('✅ Database tables initialized successfully.');
  } catch (err) {
    console.error('Error initializing database tables:', err);
  }
}

