import { db, rawClient, initializeDatabase } from '../db/client';
import { users, choreCatalog, choreLog, type ChoreStatusType } from '../db/schema';
import { eq, and, inArray, gte, lte, desc, asc } from 'drizzle-orm';
import { getDaysOfWeek, getTodayYMD, getWeekNumber, formatDateYMD } from './dates';

export interface ChoreWithDetails {
  id: number;
  choreId: number;
  choreName: string;
  icon: string;
  category: string;
  frequency: string;
  assignmentMode: 'fixed' | 'rotating';
  targetDate: string;
  status: ChoreStatusType;
  assignedToId: number;
  assignedToName: string;
  assignedToColor: string;
  assignedToAvatar: string;
  executedById: number | null;
  executedByName: string | null;
  executedByColor: string | null;
  executedByAvatar: string | null;
  executionDate: string | null;
  isStolen: boolean; // Si fue completada por alguien distinto al asignado
  isToday: boolean;
  isOverdue: boolean;
}

/**
 * Endpoint / Servicio de Generación (Cron / Sincronización)
 * Lee chore_catalog y genera automáticamente los registros en chore_log para la semana.
 */
export async function syncAndGenerateWeekChores(referenceDate: Date = new Date()) {
  await initializeDatabase();

  const days = getDaysOfWeek(referenceDate);
  const weekNumber = getWeekNumber(referenceDate);
  const catalogList = await db.select().from(choreCatalog);
  const allUsers = await db.select().from(users).orderBy(users.id);

  if (catalogList.length === 0) {
    return { createdCount: 0, message: 'El catálogo de tareas está vacío.' };
  }

  // Obtenemos los logs ya existentes para toda la semana
  const weekDateStrings = days.map((d) => d.dateStr);
  const existingLogs = await db
    .select({
      choreId: choreLog.choreId,
      targetDate: choreLog.targetDate,
    })
    .from(choreLog)
    .where(inArray(choreLog.targetDate, weekDateStrings));

  const existingMap = new Set(
    existingLogs.map((log) => `${log.choreId}_${log.targetDate}`)
  );

  const logsToInsert: Array<{
    choreId: number;
    targetDate: string;
    status: 'pending';
    assignedTo: number;
  }> = [];

  for (const chore of catalogList) {
    // Determinar el asignado de la semana:
    // Si es asignación fija: usa chore.defaultAssigneeId
    // Si es rotativa semanal: rota automáticamente entre los convivientes según el número de semana
    let weekAssigneeId = chore.defaultAssigneeId;
    if (chore.assignmentMode === 'rotating' && allUsers.length > 0) {
      const defaultIndex = allUsers.findIndex((u) => u.id === chore.defaultAssigneeId);
      const baseIndex = defaultIndex >= 0 ? defaultIndex : (chore.id % allUsers.length);
      const rotatedIndex = (baseIndex + weekNumber) % allUsers.length;
      weekAssigneeId = allUsers[rotatedIndex].id;
    }

    const choreDayOfWeek = chore.dayOfWeek ?? 1; // 1 = Lunes

    switch (chore.frequency) {
      case 'daily':
        // Todos los días de la semana
        for (const day of days) {
          const key = `${chore.id}_${day.dateStr}`;
          if (!existingMap.has(key)) {
            logsToInsert.push({
              choreId: chore.id,
              targetDate: day.dateStr,
              status: 'pending',
              assignedTo: weekAssigneeId,
            });
            existingMap.add(key);
          }
        }
        break;

      case 'twice_weekly': {
        // 2 veces a la semana: se programa en el primer día y en el segundo día
        const firstDayNum = chore.dayOfWeek ?? 1; // Ej: Lunes o Martes
        const secondDayNum = chore.secondDayOfWeek ?? ((firstDayNum + 3) % 7 === 0 ? 0 : (firstDayNum + 3) % 7); // Ej: Jueves o Viernes

        const targetDay1 = days.find((d) => d.dayOfWeek === firstDayNum) || days[0];
        const targetDay2 = days.find((d) => d.dayOfWeek === secondDayNum) || days[3];

        for (const targetDay of [targetDay1, targetDay2]) {
          const key = `${chore.id}_${targetDay.dateStr}`;
          if (!existingMap.has(key)) {
            logsToInsert.push({
              choreId: chore.id,
              targetDate: targetDay.dateStr,
              status: 'pending',
              assignedTo: weekAssigneeId,
            });
            existingMap.add(key);
          }
        }
        break;
      }

      case 'weekly': {
        // Un día específico de la semana según dayOfWeek del catálogo
        const targetDay = days.find((d) => d.dayOfWeek === choreDayOfWeek) || days[0];
        const key = `${chore.id}_${targetDay.dateStr}`;
        if (!existingMap.has(key)) {
          logsToInsert.push({
            choreId: chore.id,
            targetDate: targetDay.dateStr,
            status: 'pending',
            assignedTo: weekAssigneeId,
          });
          existingMap.add(key);
        }
        break;
      }

      case 'biweekly': {
        // Cada dos semanas (calculado según paridad de semana y ID de la tarea)
        const isBiweeklyMatch = (weekNumber % 2) === (chore.id % 2);
        if (isBiweeklyMatch) {
          const targetDay = days.find((d) => d.dayOfWeek === choreDayOfWeek) || days[0];
          const key = `${chore.id}_${targetDay.dateStr}`;
          if (!existingMap.has(key)) {
            logsToInsert.push({
              choreId: chore.id,
              targetDate: targetDay.dateStr,
              status: 'pending',
              assignedTo: weekAssigneeId,
            });
            existingMap.add(key);
          }
        }
        break;
      }

      case 'monthly': {
        // Mensual: se programa en la primera semana del mes que contenga ese día
        const targetDay = days.find((d) => d.dayOfWeek === choreDayOfWeek) || days[0];
        // Si el día del mes es <= 7 (primera semana del mes)
        if (targetDay.dayNumber <= 7) {
          const key = `${chore.id}_${targetDay.dateStr}`;
          if (!existingMap.has(key)) {
            logsToInsert.push({
              choreId: chore.id,
              targetDate: targetDay.dateStr,
              status: 'pending',
              assignedTo: weekAssigneeId,
            });
            existingMap.add(key);
          }
        }
        break;
      }
    }
  }

  let createdCount = 0;
  if (logsToInsert.length > 0) {
    for (const item of logsToInsert) {
      await db.insert(choreLog).values(item);
      createdCount++;
    }
  }

  return {
    createdCount,
    weekStartDate: days[0].dateStr,
    weekEndDate: days[6].dateStr,
    message: `Sincronización completada: se generaron ${createdCount} nuevas tareas para esta semana.`,
  };
}

/**
 * Endpoint de Ejecución Flexible:
 * Marca una tarea como completada o revierte.
 * Permite que cualquiera asuma la tarea de otro (quedando como executed_by).
 */
export async function executeChore(
  choreLogId: number,
  userId: number,
  desiredStatus?: 'completed' | 'pending'
) {
  const existingLog = await db
    .select()
    .from(choreLog)
    .where(eq(choreLog.id, choreLogId))
    .limit(1);

  if (!existingLog.length) {
    throw new Error(`Tarea con ID ${choreLogId} no encontrada`);
  }

  const current = existingLog[0];
  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user.length) {
    throw new Error(`Usuario con ID ${userId} no encontrado`);
  }

  // Determinar nuevo estado
  let nextStatus: 'completed' | 'pending';
  if (desiredStatus) {
    nextStatus = desiredStatus;
  } else {
    // Toggle si no se especifica
    nextStatus = current.status === 'completed' ? 'pending' : 'completed';
  }

  if (nextStatus === 'completed') {
    const nowIso = new Date().toISOString();
    await db
      .update(choreLog)
      .set({
        status: 'completed',
        executedBy: userId,
        executionDate: nowIso,
      })
      .where(eq(choreLog.id, choreLogId));

    return {
      success: true,
      status: 'completed',
      executedBy: userId,
      executedByName: user[0].name,
      executionDate: nowIso,
      wasStolen: current.assignedTo !== userId,
      message:
        current.assignedTo !== userId
          ? `¡Genial! Has completado la tarea de otro conviviente.`
          : `¡Tarea completada con éxito!`,
    };
  } else {
    // Revertir a pendiente
    await db
      .update(choreLog)
      .set({
        status: 'pending',
        executedBy: null,
        executionDate: null,
      })
      .where(eq(choreLog.id, choreLogId));

    return {
      success: true,
      status: 'pending',
      executedBy: null,
      executedByName: null,
      executionDate: null,
      wasStolen: false,
      message: 'La tarea ha vuelto a estado pendiente.',
    };
  }
}

/**
 * Consulta optimizada: Mis tareas de esta semana
 * Obtiene las tareas asignadas al usuario activo para hoy y el resto de la semana.
 */
export async function getMyTasks(userId: number, referenceDate: Date = new Date()) {
  await syncAndGenerateWeekChores(referenceDate);

  const days = getDaysOfWeek(referenceDate);
  const todayStr = getTodayYMD();
  const startDate = days[0].dateStr;
  const endDate = days[6].dateStr;

  // Consultamos los chore_logs de la semana asignados a este usuario
  const allLogs = await db
    .select({
      id: choreLog.id,
      choreId: choreLog.choreId,
      choreName: choreCatalog.name,
      icon: choreCatalog.icon,
      category: choreCatalog.category,
      frequency: choreCatalog.frequency,
      assignmentMode: choreCatalog.assignmentMode,
      targetDate: choreLog.targetDate,
      status: choreLog.status,
      assignedToId: choreLog.assignedTo,
      executedById: choreLog.executedBy,
      executionDate: choreLog.executionDate,
    })
    .from(choreLog)
    .innerJoin(choreCatalog, eq(choreLog.choreId, choreCatalog.id))
    .where(
      and(
        eq(choreLog.assignedTo, userId),
        gte(choreLog.targetDate, startDate),
        lte(choreLog.targetDate, endDate)
      )
    )
    .orderBy(asc(choreLog.targetDate), asc(choreLog.status));

  // Traer usuarios para resolver nombres
  const allUsers = await db.select().from(users);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));

  const formatted: ChoreWithDetails[] = allLogs.map((log) => {
    const assignedUser = userMap.get(log.assignedToId);
    const executedUser = log.executedById ? userMap.get(log.executedById) : null;
    const isCompleted = log.status === 'completed';

    return {
      id: log.id,
      choreId: log.choreId,
      choreName: log.choreName,
      icon: log.icon || '🧹',
      category: log.category || 'Hogar',
      frequency: log.frequency,
      assignmentMode: (log.assignmentMode || 'fixed') as 'fixed' | 'rotating',
      targetDate: log.targetDate,
      status: log.status as ChoreStatusType,
      assignedToId: log.assignedToId,
      assignedToName: assignedUser?.name || 'Usuario',
      assignedToColor: assignedUser?.color || '#6366f1',
      assignedToAvatar: assignedUser?.avatar || '👤',
      executedById: log.executedById,
      executedByName: executedUser?.name || null,
      executedByColor: executedUser?.color || null,
      executedByAvatar: executedUser?.avatar || null,
      executionDate: log.executionDate,
      isStolen: Boolean(isCompleted && log.executedById && log.executedById !== log.assignedToId),
      isToday: log.targetDate === todayStr,
      isOverdue: !isCompleted && log.targetDate < todayStr,
    };
  });

  // Tareas para hoy
  const todayTasks = formatted.filter((t) => t.isToday);
  // Tareas para el resto de la semana
  const upcomingTasks = formatted.filter((t) => !t.isToday && t.targetDate > todayStr);
  // Tareas retrasadas
  const overdueTasks = formatted.filter((t) => t.isOverdue);
  // Tareas completadas
  const completedTasks = formatted.filter((t) => t.status === 'completed');

  return {
    todayTasks,
    upcomingTasks,
    overdueTasks,
    completedTasks,
    allTasks: formatted,
    stats: {
      total: formatted.length,
      completed: completedTasks.length,
      pending: formatted.filter((t) => t.status === 'pending').length,
      progressPct: formatted.length ? Math.round((completedTasks.length / formatted.length) * 100) : 0,
    },
  };
}

/**
 * Consulta optimizada: Estado general de la casa
 * Todas las tareas de la semana agrupadas por días y por usuarios, con métricas globales.
 */
export async function getHouseholdDashboard(referenceDate: Date = new Date()) {
  await syncAndGenerateWeekChores(referenceDate);

  const days = getDaysOfWeek(referenceDate);
  const todayStr = getTodayYMD();
  const startDate = days[0].dateStr;
  const endDate = days[6].dateStr;

  const allLogs = await db
    .select({
      id: choreLog.id,
      choreId: choreLog.choreId,
      choreName: choreCatalog.name,
      icon: choreCatalog.icon,
      category: choreCatalog.category,
      frequency: choreCatalog.frequency,
      assignmentMode: choreCatalog.assignmentMode,
      targetDate: choreLog.targetDate,
      status: choreLog.status,
      assignedToId: choreLog.assignedTo,
      executedById: choreLog.executedBy,
      executionDate: choreLog.executionDate,
    })
    .from(choreLog)
    .innerJoin(choreCatalog, eq(choreLog.choreId, choreCatalog.id))
    .where(
      and(
        gte(choreLog.targetDate, startDate),
        lte(choreLog.targetDate, endDate)
      )
    )
    .orderBy(asc(choreLog.targetDate), asc(choreLog.choreId));

  const allUsers = await db.select().from(users);
  const userMap = new Map(allUsers.map((u) => [u.id, u]));

  const formattedChores: ChoreWithDetails[] = allLogs.map((log) => {
    const assignedUser = userMap.get(log.assignedToId);
    const executedUser = log.executedById ? userMap.get(log.executedById) : null;
    const isCompleted = log.status === 'completed';

    return {
      id: log.id,
      choreId: log.choreId,
      choreName: log.choreName,
      icon: log.icon || '🧹',
      category: log.category || 'Hogar',
      frequency: log.frequency,
      assignmentMode: (log.assignmentMode || 'fixed') as 'fixed' | 'rotating',
      targetDate: log.targetDate,
      status: log.status as ChoreStatusType,
      assignedToId: log.assignedToId,
      assignedToName: assignedUser?.name || 'Desconocido',
      assignedToColor: assignedUser?.color || '#6366f1',
      assignedToAvatar: assignedUser?.avatar || '👤',
      executedById: log.executedById,
      executedByName: executedUser?.name || null,
      executedByColor: executedUser?.color || null,
      executedByAvatar: executedUser?.avatar || null,
      executionDate: log.executionDate,
      isStolen: Boolean(isCompleted && log.executedById && log.executedById !== log.assignedToId),
      isToday: log.targetDate === todayStr,
      isOverdue: !isCompleted && log.targetDate < todayStr,
    };
  });

  // Agrupación por días de la semana
  const choresByDay = days.map((day) => {
    const dayChores = formattedChores.filter((c) => c.targetDate === day.dateStr);
    const completedCount = dayChores.filter((c) => c.status === 'completed').length;
    return {
      day,
      chores: dayChores,
      totalCount: dayChores.length,
      completedCount,
      pendingCount: dayChores.length - completedCount,
      isComplete: dayChores.length > 0 && completedCount === dayChores.length,
    };
  });

  // Estadísticas globales y por usuario
  const totalTasks = formattedChores.length;
  const totalCompleted = formattedChores.filter((c) => c.status === 'completed').length;
  const totalPending = totalTasks - totalCompleted;
  const overallProgress = totalTasks ? Math.round((totalCompleted / totalTasks) * 100) : 0;

  // Leaderboard / Desempeño por usuario
  const userStats = allUsers.map((user) => {
    const assignedToUser = formattedChores.filter((c) => c.assignedToId === user.id);
    const completedByOriginal = assignedToUser.filter((c) => c.status === 'completed' && c.executedById === user.id);
    const executedByOther = assignedToUser.filter((c) => c.status === 'completed' && c.executedById !== user.id);
    const pendingAssigned = assignedToUser.filter((c) => c.status === 'pending');
    
    // Tareas que este usuario ejecutó pero que pertenecían a otro ("robos solidarios")
    const stolenAndDone = formattedChores.filter(
      (c) => c.status === 'completed' && c.executedById === user.id && c.assignedToId !== user.id
    );

    const totalExecutedByUser = formattedChores.filter(
      (c) => c.status === 'completed' && c.executedById === user.id
    ).length;

    return {
      user,
      assignedCount: assignedToUser.length,
      completedOriginalCount: completedByOriginal.length,
      stolenAndDoneCount: stolenAndDone.length,
      totalDone: totalExecutedByUser,
      pendingCount: pendingAssigned.length,
    };
  }).sort((a, b) => b.totalDone - a.totalDone);

  return {
    days,
    choresByDay,
    allChores: formattedChores,
    users: allUsers,
    userStats,
    summary: {
      totalTasks,
      totalCompleted,
      totalPending,
      overallProgress,
      weekRange: `${days[0].dayNumber} ${days[0].monthName} - ${days[6].dayNumber} ${days[6].monthName}`,
    },
  };
}
