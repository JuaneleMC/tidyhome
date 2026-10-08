import { db, rawClient, initializeDatabase } from '../db/client';
import { users, choreCatalog, choreLog, type ChoreStatusType } from '../db/schema';
import { eq, and, or, inArray, gte, lte, desc, asc } from 'drizzle-orm';
import { getDaysOfWeek, getTodayYMD, getWeekNumber, formatDateYMD, getMondayOfWeek } from './dates';

export interface ChoreWithDetails {
  id: number;
  choreId: number;
  choreName: string;
  icon: string;
  category: string;
  frequency: string;
  assignmentMode: 'fixed' | 'rotating';
  targetDate: string;
  originalTargetDate: string | null; // Fecha programada original si se movió al ejecutarse
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

  // Obtenemos los logs ya existentes para toda la semana (incluyendo aquellos movidos que tengan su fecha original en esta semana)
  const weekDateStrings = days.map((d) => d.dateStr);
  const existingLogs = await db
    .select({
      id: choreLog.id,
      choreId: choreLog.choreId,
      targetDate: choreLog.targetDate,
      originalTargetDate: choreLog.originalTargetDate,
      status: choreLog.status,
      assignedTo: choreLog.assignedTo,
    })
    .from(choreLog)
    .where(
      or(
        inArray(choreLog.targetDate, weekDateStrings),
        inArray(choreLog.originalTargetDate, weekDateStrings)
      )
    );

  const existingMap = new Map<string, typeof existingLogs[0]>();
  for (const log of existingLogs) {
    existingMap.set(`${log.choreId}_${log.targetDate}`, log);
    if (log.originalTargetDate) {
      existingMap.set(`${log.choreId}_${log.originalTargetDate}`, log);
    }
  }

  const logsToInsert: Array<{
    choreId: number;
    targetDate: string;
    status: 'pending';
    assignedTo: number;
  }> = [];

  const logsToUpdateAssignee: Array<{ id: number; assignedTo: number }> = [];

  for (const chore of catalogList) {
    // Determinar el asignado de la semana:
    // Si es asignación fija: usa chore.defaultAssigneeId
    // Si es rotativa semanal: el responsable seleccionado es el punto de partida (semana 0).
    // Cada semana siguiente va rotando al siguiente conviviente de la lista.
    let weekAssigneeId = chore.defaultAssigneeId;
    if (chore.assignmentMode === 'rotating' && allUsers.length > 0) {
      const defaultIndex = allUsers.findIndex((u) => u.id === chore.defaultAssigneeId);
      const baseIndex = defaultIndex >= 0 ? defaultIndex : 0;

      let weeksDiff = 0;
      if (chore.createdAt) {
        const createdDate = new Date(chore.createdAt);
        const createdMonday = getMondayOfWeek(createdDate);
        const targetMonday = getMondayOfWeek(referenceDate);
        const diffMs = targetMonday.getTime() - createdMonday.getTime();
        weeksDiff = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
      }

      const rotatedIndex = ((baseIndex + weeksDiff) % allUsers.length + allUsers.length) % allUsers.length;
      weekAssigneeId = allUsers[rotatedIndex].id;
    }

    const choreDayOfWeek = chore.dayOfWeek ?? 1; // 1 = Lunes

    const checkAndSchedule = (dateStr: string) => {
      const key = `${chore.id}_${dateStr}`;
      const existing = existingMap.get(key);
      if (!existing) {
        logsToInsert.push({
          choreId: chore.id,
          targetDate: dateStr,
          status: 'pending',
          assignedTo: weekAssigneeId,
        });
      } else if (existing.status === 'pending' && existing.assignedTo !== weekAssigneeId) {
        logsToUpdateAssignee.push({
          id: existing.id,
          assignedTo: weekAssigneeId,
        });
      }
    };

    switch (chore.frequency) {
      case 'daily':
        // Todos los días de la semana
        for (const day of days) {
          checkAndSchedule(day.dateStr);
        }
        break;

      case 'twice_weekly': {
        // 2 veces a la semana: se programa en el primer día y en el segundo día
        const firstDayNum = chore.dayOfWeek ?? 1; // Ej: Lunes o Martes
        const secondDayNum = chore.secondDayOfWeek ?? ((firstDayNum + 3) % 7 === 0 ? 0 : (firstDayNum + 3) % 7); // Ej: Jueves o Viernes

        const targetDay1 = days.find((d) => d.dayOfWeek === firstDayNum) || days[0];
        const targetDay2 = days.find((d) => d.dayOfWeek === secondDayNum) || days[3];

        for (const targetDay of [targetDay1, targetDay2]) {
          checkAndSchedule(targetDay.dateStr);
        }
        break;
      }

      case 'weekly': {
        // Un día específico de la semana según dayOfWeek del catálogo
        const targetDay = days.find((d) => d.dayOfWeek === choreDayOfWeek) || days[0];
        checkAndSchedule(targetDay.dateStr);
        break;
      }

      case 'biweekly': {
        // Cada dos semanas (calculado según paridad de semana y ID de la tarea)
        const isBiweeklyMatch = (weekNumber % 2) === (chore.id % 2);
        if (isBiweeklyMatch) {
          const targetDay = days.find((d) => d.dayOfWeek === choreDayOfWeek) || days[0];
          checkAndSchedule(targetDay.dateStr);
        }
        break;
      }

      case 'monthly': {
        // Mensual: se programa en la primera semana del mes que contenga ese día
        const targetDay = days.find((d) => d.dayOfWeek === choreDayOfWeek) || days[0];
        if (targetDay.dayNumber <= 7) {
          checkAndSchedule(targetDay.dateStr);
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

  for (const item of logsToUpdateAssignee) {
    await db
      .update(choreLog)
      .set({ assignedTo: item.assignedTo })
      .where(eq(choreLog.id, item.id));
  }

  return {
    createdCount,
    updatedCount: logsToUpdateAssignee.length,
    weekStartDate: days[0].dateStr,
    weekEndDate: days[6].dateStr,
    message: `Sincronización completada: se generaron ${createdCount} nuevas tareas y se actualizaron ${logsToUpdateAssignee.length} asignaciones.`,
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
  await initializeDatabase();

  const existingLog = await db
    .select({
      id: choreLog.id,
      choreId: choreLog.choreId,
      targetDate: choreLog.targetDate,
      originalTargetDate: choreLog.originalTargetDate,
      status: choreLog.status,
      assignedTo: choreLog.assignedTo,
      executedBy: choreLog.executedBy,
      executionDate: choreLog.executionDate,
      frequency: choreCatalog.frequency,
      choreName: choreCatalog.name,
    })
    .from(choreLog)
    .innerJoin(choreCatalog, eq(choreLog.choreId, choreCatalog.id))
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

  // Semanal, quincenal o mensual (las diarias no) se mueven al día ejecutado
  const isMovableFrequency = current.frequency !== 'daily';

  if (nextStatus === 'completed') {
    const now = new Date();
    const nowIso = now.toISOString();
    const todayYmd = formatDateYMD(now);

    let newTargetDate = current.targetDate;
    let originalTargetDate = current.originalTargetDate;

    if (isMovableFrequency) {
      // Guardar la fecha original si aún no la tenía
      originalTargetDate = current.originalTargetDate || current.targetDate;
      // Mover al día que se ejecutó
      newTargetDate = todayYmd;
    }

    await db
      .update(choreLog)
      .set({
        status: 'completed',
        executedBy: userId,
        executionDate: nowIso,
        targetDate: newTargetDate,
        originalTargetDate: originalTargetDate,
      })
      .where(eq(choreLog.id, choreLogId));

    const wasMoved = Boolean(isMovableFrequency && newTargetDate !== (current.originalTargetDate || current.targetDate));

    return {
      success: true,
      status: 'completed',
      executedBy: userId,
      executedByName: user[0].name,
      executionDate: nowIso,
      targetDate: newTargetDate,
      originalTargetDate: originalTargetDate,
      wasMoved,
      wasStolen: current.assignedTo !== userId,
      message:
        current.assignedTo !== userId
          ? `¡Genial! Has completado la tarea de otro conviviente.`
          : `¡Tarea completada con éxito!`,
    };
  } else {
    // Revertir a pendiente:
    // Si era semanal/quincenal/mensual y se había movido, devolverla a su fecha programada original
    const restoredTargetDate =
      isMovableFrequency && current.originalTargetDate
        ? current.originalTargetDate
        : current.targetDate;

    await db
      .update(choreLog)
      .set({
        status: 'pending',
        executedBy: null,
        executionDate: null,
        targetDate: restoredTargetDate,
        originalTargetDate: null,
      })
      .where(eq(choreLog.id, choreLogId));

    return {
      success: true,
      status: 'pending',
      executedBy: null,
      executedByName: null,
      executionDate: null,
      targetDate: restoredTargetDate,
      originalTargetDate: null,
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
      originalTargetDate: choreLog.originalTargetDate,
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
      originalTargetDate: log.originalTargetDate || null,
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
      originalTargetDate: choreLog.originalTargetDate,
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
      originalTargetDate: log.originalTargetDate || null,
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
