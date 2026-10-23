import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Frequency enum type
export const FREQUENCIES = ['daily', 'twice_weekly', 'weekly', 'biweekly', 'monthly', 'once'] as const;
export type FrequencyType = typeof FREQUENCIES[number];

// Assignment mode enum type (Fija o Rotativa semanal)
export const ASSIGNMENT_MODES = ['fixed', 'rotating'] as const;
export type AssignmentModeType = typeof ASSIGNMENT_MODES[number];

// Status enum type
export const CHORE_STATUSES = ['pending', 'completed'] as const;
export type ChoreStatusType = typeof CHORE_STATUSES[number];

// Entidad users: id, name, email
export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  avatar: text('avatar').default('👤'),
  color: text('color').default('#6366f1'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Entidad chore_catalog: id, name, frequency, default_assignee_id (opcional para puntuales), assignment_mode
export const choreCatalog = sqliteTable('chore_catalog', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  frequency: text('frequency', { enum: FREQUENCIES }).notNull(),
  assignmentMode: text('assignment_mode', { enum: ASSIGNMENT_MODES }).notNull().default('fixed'),
  defaultAssigneeId: integer('default_assignee_id')
    .references(() => users.id, { onDelete: 'set null' }), // Nullable para tareas puntuales
  icon: text('icon').default('🧹'),
  category: text('category').default('Hogar'),
  dayOfWeek: integer('day_of_week').default(1), // 1 = Lunes, 2 = Martes... 0 = Domingo
  secondDayOfWeek: integer('second_day_of_week').default(4), // Para tareas de 2 veces/semana (ej. Jueves)
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Entidad chore_log: id, chore_id, target_date, status, assigned_to, executed_by, execution_date
export const choreLog = sqliteTable('chore_log', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  choreId: integer('chore_id')
    .references(() => choreCatalog.id, { onDelete: 'cascade' })
    .notNull(),
  targetDate: text('target_date').notNull(), // Formato YYYY-MM-DD
  originalTargetDate: text('original_target_date'), // Formato YYYY-MM-DD (fecha programada original si se movió al ejecutarse)
  status: text('status', { enum: CHORE_STATUSES }).notNull().default('pending'),
  assignedTo: integer('assigned_to')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  executedBy: integer('executed_by')
    .references(() => users.id, { onDelete: 'set null' }), // Nullable
  executionDate: text('execution_date'), // ISO string cuando se completa
  notes: text('notes'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// ==========================================
// MÓDULO GARAJE / VEHÍCULOS
// ==========================================

// Entidad vehicles: id, name, plate, icon, color, has_mileage, current_km, last_km_date
export const vehicles = sqliteTable('vehicles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(), // Ej: "Peugeot 5008"
  plate: text('plate'), // Ej: "5116HLK"
  icon: text('icon').default('🚗'),
  color: text('color').default('#3b82f6'),
  hasMileage: integer('has_mileage').default(1), // 1 = tiene cuentakilómetros, 0 = caravana / remolque
  currentKm: integer('current_km').default(0),
  lastKmDate: text('last_km_date'), // YYYY-MM-DD de la última actualización de km
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Entidad vehicle_maintenance: tareas de mantenimiento por km y/o meses configuradas por vehículo
export const vehicleMaintenance = sqliteTable('vehicle_maintenance', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vehicleId: integer('vehicle_id')
    .references(() => vehicles.id, { onDelete: 'cascade' })
    .notNull(),
  name: text('name').notNull(), // Ej: "Cambio de aceite y filtro", "ITV"
  intervalKm: integer('interval_km'), // Ej: 15000 (null si es solo por tiempo)
  intervalMonths: integer('interval_months'), // Ej: 12 o 24 (null si es solo por km)
  lastDoneKm: integer('last_done_km'), // Km a los que se hizo por última vez
  lastDoneDate: text('last_done_date'), // YYYY-MM-DD de la última vez que se hizo
  notes: text('notes'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Entidad vehicle_maintenance_logs: libro de revisiones e historial de ejecuciones
export const vehicleMaintenanceLogs = sqliteTable('vehicle_maintenance_logs', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vehicleId: integer('vehicle_id')
    .references(() => vehicles.id, { onDelete: 'cascade' })
    .notNull(),
  maintenanceId: integer('maintenance_id')
    .references(() => vehicleMaintenance.id, { onDelete: 'set null' }),
  title: text('title').notNull(), // Ej: "Cambio de aceite y filtro"
  performedDate: text('performed_date').notNull(), // YYYY-MM-DD
  performedKm: integer('performed_km'),
  performedBy: integer('performed_by')
    .references(() => users.id, { onDelete: 'set null' }),
  workshop: text('workshop'), // Nombre del taller o "En casa"
  cost: text('cost'), // Ej: "180€"
  notes: text('notes'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Entidad vehicle_incidents: averías y síntomas anómalos
export const vehicleIncidents = sqliteTable('vehicle_incidents', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  vehicleId: integer('vehicle_id')
    .references(() => vehicles.id, { onDelete: 'cascade' })
    .notNull(),
  title: text('title').notNull(), // Ej: "Ruido en freno trasero derecho"
  description: text('description'),
  status: text('status').notNull().default('open'), // 'open' | 'resolved'
  reportedBy: integer('reported_by')
    .references(() => users.id, { onDelete: 'set null' }),
  reportedDate: text('reported_date').notNull(), // YYYY-MM-DD
  resolvedDate: text('resolved_date'), // YYYY-MM-DD
  resolvedKm: integer('resolved_km'),
  workshop: text('workshop'),
  resolutionNotes: text('resolution_notes'),
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

// Drizzle Relations
export const usersRelations = relations(users, ({ many }) => ({
  defaultChores: many(choreCatalog, { relationName: 'defaultAssignee' }),
  assignedLogs: many(choreLog, { relationName: 'assignedTo' }),
  executedLogs: many(choreLog, { relationName: 'executedBy' }),
  vehicleLogs: many(vehicleMaintenanceLogs),
  vehicleIncidents: many(vehicleIncidents),
}));

export const choreCatalogRelations = relations(choreCatalog, ({ one, many }) => ({
  defaultAssignee: one(users, {
    fields: [choreCatalog.defaultAssigneeId],
    references: [users.id],
    relationName: 'defaultAssignee',
  }),
  logs: many(choreLog),
}));

export const choreLogRelations = relations(choreLog, ({ one }) => ({
  chore: one(choreCatalog, {
    fields: [choreLog.choreId],
    references: [choreCatalog.id],
  }),
  assignedUser: one(users, {
    fields: [choreLog.assignedTo],
    references: [users.id],
    relationName: 'assignedTo',
  }),
  executedUser: one(users, {
    fields: [choreLog.executedBy],
    references: [users.id],
    relationName: 'executedBy',
  }),
}));

export const vehiclesRelations = relations(vehicles, ({ many }) => ({
  maintenanceItems: many(vehicleMaintenance),
  logs: many(vehicleMaintenanceLogs),
  incidents: many(vehicleIncidents),
}));

export const vehicleMaintenanceRelations = relations(vehicleMaintenance, ({ one, many }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleMaintenance.vehicleId],
    references: [vehicles.id],
  }),
  logs: many(vehicleMaintenanceLogs),
}));

export const vehicleMaintenanceLogsRelations = relations(vehicleMaintenanceLogs, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleMaintenanceLogs.vehicleId],
    references: [vehicles.id],
  }),
  maintenance: one(vehicleMaintenance, {
    fields: [vehicleMaintenanceLogs.maintenanceId],
    references: [vehicleMaintenance.id],
  }),
  user: one(users, {
    fields: [vehicleMaintenanceLogs.performedBy],
    references: [users.id],
  }),
}));

// ==========================================
// MÓDULO LISTA DE LA COMPRA (SUPERMERCADO)
// ==========================================

export const SHOPPING_CATEGORIES = [
  'Frutas y Verduras',
  'Lácteos y Huevos',
  'Carnicería y Charcutería',
  'Pescadería',
  'Panadería y Cereales',
  'Despensa y Conservas',
  'Bebidas',
  'Limpieza y Hogar',
  'Higiene y Cuidado',
  'Congelados',
  'Snacks y Dulces',
  'Otros',
] as const;

export type ShoppingCategoryType = typeof SHOPPING_CATEGORIES[number];

export const shoppingItems = sqliteTable('shopping_items', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  category: text('category').default('Otros'),
  quantity: text('quantity'), // Ej: "2 packs", "1 kg"
  notes: text('notes'), // Ej: "De la marca blanca, semi"
  addedBy: integer('added_by')
    .references(() => users.id, { onDelete: 'set null' }),
  isBought: integer('is_bought').default(0), // 0 = pendiente, 1 = comprado
  boughtBy: integer('bought_by')
    .references(() => users.id, { onDelete: 'set null' }),
  boughtAt: text('bought_at'), // ISO string cuando se tacha
  createdAt: text('created_at').$defaultFn(() => new Date().toISOString()),
});

export const shoppingItemsRelations = relations(shoppingItems, ({ one }) => ({
  addedByUser: one(users, {
    fields: [shoppingItems.addedBy],
    references: [users.id],
    relationName: 'addedByUser',
  }),
  boughtByUser: one(users, {
    fields: [shoppingItems.boughtBy],
    references: [users.id],
    relationName: 'boughtByUser',
  }),
}));

export const vehicleIncidentsRelations = relations(vehicleIncidents, ({ one }) => ({
  vehicle: one(vehicles, {
    fields: [vehicleIncidents.vehicleId],
    references: [vehicles.id],
  }),
  user: one(users, {
    fields: [vehicleIncidents.reportedBy],
    references: [users.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChoreCatalogItem = typeof choreCatalog.$inferSelect;
export type NewChoreCatalogItem = typeof choreCatalog.$inferInsert;
export type ChoreLogItem = typeof choreLog.$inferSelect;
export type NewChoreLogItem = typeof choreLog.$inferInsert;
export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;
export type VehicleMaintenanceItem = typeof vehicleMaintenance.$inferSelect;
export type NewVehicleMaintenanceItem = typeof vehicleMaintenance.$inferInsert;
export type VehicleMaintenanceLog = typeof vehicleMaintenanceLogs.$inferSelect;
export type VehicleIncident = typeof vehicleIncidents.$inferSelect;
export type ShoppingItem = typeof shoppingItems.$inferSelect;
export type NewShoppingItem = typeof shoppingItems.$inferInsert;

