import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
import { relations } from 'drizzle-orm';

// Frequency enum type
export const FREQUENCIES = ['daily', 'twice_weekly', 'weekly', 'biweekly', 'monthly'] as const;
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

// Entidad chore_catalog: id, name, frequency, default_assignee_id, assignment_mode
export const choreCatalog = sqliteTable('chore_catalog', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  name: text('name').notNull(),
  frequency: text('frequency', { enum: FREQUENCIES }).notNull(),
  assignmentMode: text('assignment_mode', { enum: ASSIGNMENT_MODES }).notNull().default('fixed'),
  defaultAssigneeId: integer('default_assignee_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
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

// Drizzle Relations
export const usersRelations = relations(users, ({ many }) => ({
  defaultChores: many(choreCatalog, { relationName: 'defaultAssignee' }),
  assignedLogs: many(choreLog, { relationName: 'assignedTo' }),
  executedLogs: many(choreLog, { relationName: 'executedBy' }),
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

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ChoreCatalogItem = typeof choreCatalog.$inferSelect;
export type NewChoreCatalogItem = typeof choreCatalog.$inferInsert;
export type ChoreLogItem = typeof choreLog.$inferSelect;
export type NewChoreLogItem = typeof choreLog.$inferInsert;
