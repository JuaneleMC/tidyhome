import { db, rawClient, initializeDatabase } from './client';
import { users, choreCatalog, choreLog } from './schema';
import { eq } from 'drizzle-orm';

export async function seedInitialData() {
  await initializeDatabase();

  // Check if users exist
  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) {
    console.log(`Database already has ${existingUsers.length} users. Skipping seed.`);
    return;
  }

  console.log('Seeding initial users and catalog...');

  // 1. Insert initial roommates
  const createdUsers = await db
    .insert(users)
    .values([
      { name: 'Elena', email: 'elena@casa.com', avatar: '👩‍💼', color: '#ec4899' },
      { name: 'Carlos', email: 'carlos@casa.com', avatar: '👨‍🎨', color: '#3b82f6' },
      { name: 'Lucía', email: 'lucia@casa.com', avatar: '👩‍🔬', color: '#10b981' },
      { name: 'Marcos', email: 'marcos@casa.com', avatar: '🧑‍💻', color: '#f59e0b' },
    ])
    .returning();

  const elena = createdUsers.find((u) => u.name === 'Elena') || createdUsers[0];
  const carlos = createdUsers.find((u) => u.name === 'Carlos') || createdUsers[1];
  const lucia = createdUsers.find((u) => u.name === 'Lucía') || createdUsers[2];
  const marcos = createdUsers.find((u) => u.name === 'Marcos') || createdUsers[3];

  // 2. Insert initial chore catalog
  const createdCatalog = await db
    .insert(choreCatalog)
    .values([
      {
        name: 'Fregar platos y encimera',
        frequency: 'daily',
        defaultAssigneeId: carlos.id,
        icon: '🍽️',
        category: 'Cocina',
        dayOfWeek: 1,
      },
      {
        name: 'Sacar la basura y reciclaje',
        frequency: 'daily',
        defaultAssigneeId: lucia.id,
        icon: '🗑️',
        category: 'Cocina',
        dayOfWeek: 1,
      },
      {
        name: 'Aspirar salón y pasillo',
        frequency: 'weekly',
        defaultAssigneeId: elena.id,
        icon: '🧹',
        category: 'Salón',
        dayOfWeek: 2, // Martes
      },
      {
        name: 'Limpiar el baño a fondo',
        frequency: 'weekly',
        defaultAssigneeId: marcos.id,
        icon: '🚿',
        category: 'Baño',
        dayOfWeek: 6, // Sábado
      },
      {
        name: 'Poner lavadora de ropa blanca',
        frequency: 'weekly',
        defaultAssigneeId: carlos.id,
        icon: '🧺',
        category: 'Colada',
        dayOfWeek: 3, // Miércoles
      },
      {
        name: 'Fregar el suelo general',
        frequency: 'weekly',
        defaultAssigneeId: lucia.id,
        icon: '✨',
        category: 'Limpieza',
        dayOfWeek: 5, // Viernes
      },
      {
        name: 'Limpiar frigorífico y microondas',
        frequency: 'biweekly',
        defaultAssigneeId: elena.id,
        icon: '🧊',
        category: 'Cocina',
        dayOfWeek: 4, // Jueves
      },
      {
        name: 'Limpieza profunda de ventanas',
        frequency: 'monthly',
        defaultAssigneeId: marcos.id,
        icon: '🪟',
        category: 'General',
        dayOfWeek: 6, // Sábado
      },
    ])
    .returning();

  console.log(`✅ Seeded ${createdUsers.length} users and ${createdCatalog.length} catalog chores.`);
}

// Allow direct CLI execution: node src/db/seed.ts (or via tsx)
if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  seedInitialData().then(() => {
    console.log('Seed completed successfully.');
    process.exit(0);
  }).catch((err) => {
    console.error('Seed error:', err);
    process.exit(1);
  });
}
