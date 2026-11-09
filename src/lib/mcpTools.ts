import { db, initializeDatabase } from '../db/client';
import {
  users,
  choreCatalog,
  choreLog,
  shoppingItems,
  shoppingCatalog,
  vehicles,
  vehicleMaintenance,
  vehicleMaintenanceLogs,
  vehicleIncidents,
  type FrequencyType,
  type ShoppingCategoryType,
} from '../db/schema';
import { eq, and, asc, desc } from 'drizzle-orm';
import {
  getHouseholdDashboard,
  executeChore,
  logChoreForDate,
  syncAndGenerateWeekChores,
} from './choreService';
import { detectShoppingCategory, detectDefaultUnit } from './shoppingCategories';
import { getTodayYMD, getDaysOfWeek, formatDateYMD } from './dates';

/**
 * Normaliza cadenas en español (minúsculas y sin tildes) para búsquedas flexibles por voz.
 */
function normalizeText(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Puntuación de coincidencia flexible entre una consulta hablada y un nombre en base de datos.
 */
function scoreMatch(targetName: string, query: string): number {
  const normTarget = normalizeText(targetName);
  const normQuery = normalizeText(query);
  if (!normTarget || !normQuery) return 0;
  if (normTarget === normQuery) return 100;
  if (normTarget.includes(normQuery)) return 85;
  if (normQuery.includes(normTarget)) return 75;

  const stopWords = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'al', 'un', 'una', 'unos', 'unas', 'en', 'por', 'para', 'con', 'coche', 'tarea', 'hacer', 'limpiar']);
  const queryWords = normQuery.split(/\s+/).filter((w) => w.length > 2 && !stopWords.has(w));
  if (queryWords.length === 0) return 0;

  let matched = 0;
  for (const w of queryWords) {
    const stem = w.endsWith('es') && w.length > 4 ? w.slice(0, -2) : w.endsWith('s') && w.length > 3 ? w.slice(0, -1) : w;
    if (normTarget.includes(stem)) {
      matched++;
    }
  }
  if (matched === 0) return 0;
  return Math.round((matched / queryWords.length) * 65);
}

/**
 * Resuelve fechas naturales en español ("hoy", "ayer", "lunes", "sábado", o "YYYY-MM-DD").
 */
function resolveSpanishDate(dateInput?: string | null): string {
  const todayStr = getTodayYMD();
  if (!dateInput) return todayStr;
  const trimmed = dateInput.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  const norm = normalizeText(trimmed);
  if (norm === 'hoy' || norm === 'ahora') return todayStr;

  const now = new Date();
  if (norm === 'ayer') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return formatDateYMD(d);
  }
  if (norm === 'anteayer' || norm === 'antes de ayer') {
    const d = new Date(now);
    d.setDate(d.getDate() - 2);
    return formatDateYMD(d);
  }
  if (norm === 'manana') {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    return formatDateYMD(d);
  }

  const dayMap: Record<string, number> = {
    domingo: 0,
    lunes: 1,
    martes: 2,
    miercoles: 3,
    jueves: 4,
    viernes: 5,
    sabado: 6,
  };

  for (const [dayName, dayNum] of Object.entries(dayMap)) {
    if (norm.includes(dayName)) {
      const weekDays = getDaysOfWeek(now);
      const found = weekDays.find((wd) => wd.dayOfWeek === dayNum);
      if (found) return found.dateStr;
    }
  }

  return todayStr;
}

/**
 * Busca un conviviente por nombre aproximado sin hacer fallback silencioso a otro usuario si no coincide.
 */
export async function findUserStrict(nameQuery: string) {
  const allUsers = await db.select().from(users).orderBy(asc(users.id));
  const normQuery = normalizeText(nameQuery);
  if (!normQuery || allUsers.length === 0) return { user: null, allUsers };

  let bestUser = null;
  let bestScore = 0;

  for (const u of allUsers) {
    const normU = normalizeText(u.name);
    let s = scoreMatch(u.name, nameQuery);
    // Coincidencia por prefijo (ej. "Juan" <-> "Juane" / "Juanma")
    if (normU.startsWith(normQuery) || normQuery.startsWith(normU)) {
      s = Math.max(s, 88);
    }
    if (s > bestScore) {
      bestScore = s;
      bestUser = u;
    }
  }

  if (bestUser && bestScore >= 50) {
    return { user: bestUser, allUsers };
  }

  return { user: null, allUsers };
}

/**
 * Detecta si en una frase hablada se menciona explícitamente a algún conviviente de la base de datos
 * o si el usuario dice "soy [Nombre]" / "a [Nombre]" / "de [Nombre]".
 */
export async function detectUserInSpeech(rawText: string) {
  const allUsers = await db.select().from(users).orderBy(asc(users.id));
  const norm = normalizeText(rawText);

  // 1. ¿Dice explícitamente "soy X" o "habla X"?
  const selfIntroMatch = norm.match(/\b(?:soy|habla|aqui)\s+([a-z0-9]+)\b/);
  if (selfIntroMatch) {
    const spokenName = selfIntroMatch[1];
    const { user } = await findUserStrict(spokenName);
    return {
      matchedUser: user,
      spokenName,
      isSelfIntro: true,
      allUsers,
    };
  }

  // 2. ¿Menciona directamente el nombre de algún conviviente de la base de datos en la frase?
  for (const u of allUsers) {
    const normName = normalizeText(u.name);
    const firstWord = normName.split(/\s+/)[0];
    if (firstWord.length >= 3) {
      const regex = new RegExp(`\\b${firstWord}\\b`, 'i');
      if (regex.test(norm)) {
        return {
          matchedUser: u,
          spokenName: u.name,
          isSelfIntro: false,
          allUsers,
        };
      }
    }
  }

  // 3. ¿Dice "le toca(n) a X" / "tareas de X" / "pendientes de X" con un nombre que quizá sea diminutivo o no exista?
  const thirdPersonMatch = norm.match(
    /\b(?:toca(?:n)?\s+a|tareas?\s+de|pendientes?\s+de|tiene\s+pendiente(?:s)?)\s+([a-z0-9]+)\b/
  );
  if (thirdPersonMatch) {
    const spokenName = thirdPersonMatch[1];
    const stopWords = new Set(['hoy', 'manana', 'ayer', 'esta', 'este', 'la', 'el', 'todos', 'casa', 'hacer', 'semana']);
    if (!stopWords.has(spokenName)) {
      const { user } = await findUserStrict(spokenName);
      return {
        matchedUser: user,
        spokenName,
        isSelfIntro: false,
        allUsers,
      };
    }
  }

  return {
    matchedUser: null,
    spokenName: null,
    isSelfIntro: false,
    allUsers,
  };
}

/**
 * Busca un conviviente por nombre aproximado, o usa el usuario activo por ID/nombre si no se especifica.
 */
async function resolveUser(
  nameOrHint?: string | null,
  defaultUserName?: string | null,
  defaultUserId?: number | null
) {
  const allUsers = await db.select().from(users).orderBy(asc(users.id));
  if (allUsers.length === 0) return null;

  if (nameOrHint) {
    const { user } = await findUserStrict(nameOrHint);
    if (user) return user;
  }

  if (defaultUserId) {
    const byId = allUsers.find((u) => u.id === Number(defaultUserId));
    if (byId) return byId;
  }

  if (defaultUserName) {
    const { user } = await findUserStrict(defaultUserName);
    if (user) return user;
  }

  return allUsers[0];
}

/**
 * Busca un vehículo por nombre o matrícula aproximada. Si solo hay un vehículo o dicen "el coche", lo selecciona.
 */
async function resolveVehicle(vehicleQuery?: string | null) {
  const allVehicles = await db.select().from(vehicles).orderBy(asc(vehicles.id));
  if (allVehicles.length === 0) return null;
  if (!vehicleQuery || normalizeText(vehicleQuery) === 'coche' || normalizeText(vehicleQuery) === 'el coche') {
    return allVehicles[0];
  }

  let bestVehicle = null;
  let bestScore = 0;
  for (const v of allVehicles) {
    const sName = scoreMatch(v.name, vehicleQuery);
    const sPlate = v.plate ? scoreMatch(v.plate, vehicleQuery) : 0;
    const score = Math.max(sName, sPlate);
    if (score > bestScore) {
      bestScore = score;
      bestVehicle = v;
    }
  }

  return bestScore >= 30 ? bestVehicle : allVehicles[0];
}

function computeMaintenanceStatus(item: any, currentKm: number, hasMileage: boolean) {
  const today = new Date();
  let kmStatus: 'ok' | 'soon' | 'overdue' | null = null;
  let remainingKm: number | null = null;
  let nextDueKm: number | null = null;

  if (hasMileage && item.intervalKm) {
    const baseKm = item.lastDoneKm ?? 0;
    nextDueKm = baseKm + item.intervalKm;
    remainingKm = nextDueKm - currentKm;

    if (remainingKm <= 0) kmStatus = 'overdue';
    else if (remainingKm <= 1500) kmStatus = 'soon';
    else kmStatus = 'ok';
  }

  let dateStatus: 'ok' | 'soon' | 'overdue' | null = null;
  let remainingDays: number | null = null;
  let nextDueDate: string | null = null;

  if (item.intervalMonths && item.lastDoneDate) {
    const lastDate = new Date(item.lastDoneDate);
    const dueDate = new Date(lastDate);
    dueDate.setMonth(dueDate.getMonth() + item.intervalMonths);
    nextDueDate = dueDate.toISOString().split('T')[0];

    const diffMs = dueDate.getTime() - today.getTime();
    remainingDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (remainingDays <= 0) dateStatus = 'overdue';
    else if (remainingDays <= 30) dateStatus = 'soon';
    else dateStatus = 'ok';
  }

  let finalStatus: 'ok' | 'soon' | 'overdue' = 'ok';
  if (kmStatus === 'overdue' || dateStatus === 'overdue') finalStatus = 'overdue';
  else if (kmStatus === 'soon' || dateStatus === 'soon') finalStatus = 'soon';

  return {
    ...item,
    status: finalStatus,
    remainingKm,
    nextDueKm,
    remainingDays,
    nextDueDate,
  };
}

// ============================================================================
// DEFINICIÓN DE HERRAMIENTAS MCP (JSON Schema para Gemini)
// ============================================================================

export const MCP_TOOLS = [
  // 1. HOGAR: LISTAR TAREAS
  {
    name: 'listar_tareas_hogar',
    description:
      'Lista las tareas del hogar programadas para hoy o para toda la semana actual en TidyHome. Permite filtrar por miembro de la casa (conviviente), por estado (pendientes o completadas) o solo las de hoy. Devuelve a quién le toca cada tarea, qué día está programada y quién la hizo.',
    inputSchema: {
      type: 'object',
      properties: {
        miembro: {
          type: 'string',
          description: 'Nombre del conviviente por el que filtrar (opcional). Si preguntan "¿qué me toca hoy?", pasa su nombre si se conoce.',
        },
        estado: {
          type: 'string',
          enum: ['pending', 'completed', 'all'],
          description: 'Filtrar por tareas pendientes ("pending"), completadas ("completed") o todas ("all"). Por defecto "all".',
        },
        solo_hoy: {
          type: 'boolean',
          description: 'Si es true, muestra únicamente las tareas programadas para hoy. Si es false o se omite, muestra toda la semana actual.',
        },
        solo_usuario_activo: {
          type: 'boolean',
          description: 'Si es true (cuando el usuario pregunta en primera persona: "¿qué me toca?", "¿qué tengo pendiente?"), filtra solo las tareas del conviviente en uso actualmente.',
        },
      },
    },
  },

  // 2. HOGAR: COMPLETAR TAREA
  {
    name: 'completar_tarea_hogar',
    description:
      'Marca una tarea del hogar como hecha/completada. Si la tarea estaba programada para otro día de la semana (por ejemplo el sábado y se hace el lunes), la mantiene en su día programado y registra qué día real se ejecutó. Si la hace una persona distinta a quien le tocaba, registra tanto a quién le tocaba como quién la hizo realmente.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: {
          type: 'string',
          description: 'Nombre o descripción de la tarea realizada (ej. "limpiar baños", "lavadora", "basura", "cristales").',
        },
        ejecutado_por: {
          type: 'string',
          description: 'Nombre del conviviente que ha realizado la tarea (opcional si ya viene configurado en el conector del teléfono).',
        },
        fecha_ejecucion: {
          type: 'string',
          description: 'Fecha en la que se hizo ("hoy", "ayer", "lunes", o formato YYYY-MM-DD). Por defecto "hoy".',
        },
      },
      required: ['titulo'],
    },
  },

  // 3. HOGAR: CREAR TAREA
  {
    name: 'crear_tarea_hogar',
    description:
      'Crea una nueva tarea del hogar en TidyHome (puede ser una tarea puntual para una fecha concreta o una tarea periódica fija/rotativa) y la asigna a un conviviente.',
    inputSchema: {
      type: 'object',
      properties: {
        titulo: {
          type: 'string',
          description: 'Nombre de la tarea a crear (ej. "Limpiar terraza", "Ordenar trastero").',
        },
        miembro_asignado: {
          type: 'string',
          description: 'Nombre del conviviente al que se asigna la tarea.',
        },
        fecha: {
          type: 'string',
          description: 'Día para el que se programa ("hoy", "mañana", "viernes", "sábado" o YYYY-MM-DD).',
        },
        frecuencia: {
          type: 'string',
          enum: ['once', 'daily', 'twice_weekly', 'weekly', 'biweekly', 'monthly'],
          description: 'Periodicidad de la tarea: "once" (puntual una vez, por defecto), "daily" (diaria), "weekly" (semanal), "biweekly" (quincenal), "monthly" (mensual).',
        },
        categoria: {
          type: 'string',
          description: 'Categoría opcional (ej. "Hogar", "Cocina", "Baño", "Jardín").',
        },
      },
      required: ['titulo'],
    },
  },

  // 4. COMPRA: AÑADIR A LISTA DE LA COMPRA
  {
    name: 'anadir_a_lista_compra',
    description:
      'Añade uno o varios productos de una sola vez a la lista de la compra del supermercado. Clasifica automáticamente cada producto en su pasillo/categoría (Lácteos, Frutas, Carnicería, Limpieza, etc.) y evita duplicados si ya estaban apuntados.',
    inputSchema: {
      type: 'object',
      properties: {
        productos: {
          type: 'array',
          description: 'Lista de productos a añadir a la compra.',
          items: {
            type: 'object',
            properties: {
              nombre: {
                type: 'string',
                description: 'Nombre del producto (ej. "Leche semidesnatada", "Huevos", "Papel de cocina").',
              },
              cantidad: {
                type: 'string',
                description: 'Cantidad numérica (ej. "1", "2", "500"). Por defecto "1".',
              },
              unidad: {
                type: 'string',
                description: 'Unidad opcional (ej. "ud", "pack 6L", "1 kg", "botella", "paquete").',
              },
              notas: {
                type: 'string',
                description: 'Notas opcionales (ej. "sin lactosa", "marca blanca").',
              },
            },
            required: ['nombre'],
          },
        },
      },
      required: ['productos'],
    },
  },

  // 5. COMPRA: LEER LISTA DE LA COMPRA
  {
    name: 'leer_lista_compra',
    description:
      'Consulta y lee los productos apuntados en la lista de la compra del supermercado, agrupados por categoría/pasillo.',
    inputSchema: {
      type: 'object',
      properties: {
        incluir_comprados: {
          type: 'boolean',
          description: 'Si es true, incluye también los artículos ya tachados/comprados. Por defecto false (solo pendientes de comprar).',
        },
        categoria: {
          type: 'string',
          description: 'Filtrar opcionalmente por una categoría concreta (ej. "Carnicería", "Lácteos", "Frutas").',
        },
      },
    },
  },

  // 6. COMPRA: MARCAR COMPRADO
  {
    name: 'marcar_comprado_lista_compra',
    description:
      'Tacha o marca como ya comprados uno o varios productos de la lista de la compra del supermercado.',
    inputSchema: {
      type: 'object',
      properties: {
        nombres: {
          type: 'array',
          items: { type: 'string' },
          description: 'Lista de nombres de productos que ya se han comprado (ej. ["leche", "huevos", "pan"]).',
        },
      },
      required: ['nombres'],
    },
  },

  // 7. COCHES: CONSULTAR MANTENIMIENTO
  {
    name: 'consultar_mantenimiento_coche',
    description:
      'Consulta el estado de los vehículos del garaje: kilómetros actuales, próximas revisiones programadas (cambio de aceite, ITV, filtros, neumáticos, con alerta de cuántos km o días faltan), averías abiertas e historial reciente.',
    inputSchema: {
      type: 'object',
      properties: {
        vehiculo: {
          type: 'string',
          description: 'Nombre o matrícula del vehículo a consultar (opcional; si se omite devuelve todos los vehículos de casa).',
        },
      },
    },
  },

  // 8. COCHES: ACTUALIZAR KILOMETRAJE
  {
    name: 'actualizar_kilometros_coche',
    description:
      'Actualiza la lectura actual del cuentakilómetros de un vehículo y comprueba si hay alguna revisión o mantenimiento próximo o vencido.',
    inputSchema: {
      type: 'object',
      properties: {
        vehiculo: {
          type: 'string',
          description: 'Nombre o descripción del vehículo (ej. "Peugeot", "5008", "coche").',
        },
        kilometros: {
          type: 'number',
          description: 'Kilómetros actuales totales del marcador (ej. 145200).',
        },
      },
      required: ['kilometros'],
    },
  },

  // 9. COCHES: REGISTRAR MANTENIMIENTO
  {
    name: 'registrar_mantenimiento_coche',
    description:
      'Registra un mantenimiento, revisión, cambio de aceite, cambio de ruedas, ITV o reparación realizada en un vehículo. Actualiza automáticamente el libro de revisiones, el kilometraje del vehículo y resetea la alerta del mantenimiento correspondiente.',
    inputSchema: {
      type: 'object',
      properties: {
        vehiculo: {
          type: 'string',
          description: 'Nombre o matrícula del vehículo (ej. "Peugeot", "coche gris").',
        },
        concepto: {
          type: 'string',
          description: 'Qué mantenimiento o arreglo se le ha hecho (ej. "Cambio de ruedas delanteras", "Cambio de aceite y filtro", "ITV").',
        },
        kilometros: {
          type: 'number',
          description: 'Kilómetros a los que se ha realizado el mantenimiento (ej. 85000).',
        },
        fecha: {
          type: 'string',
          description: 'Fecha en la que se realizó ("hoy", "ayer" o YYYY-MM-DD). Por defecto "hoy".',
        },
        taller: {
          type: 'string',
          description: 'Nombre del taller o lugar donde se hizo (opcional).',
        },
        coste: {
          type: 'string',
          description: 'Coste o precio de la intervención (ej. "180€", opcional).',
        },
        notas: {
          type: 'string',
          description: 'Observaciones adicionales para el libro de revisiones (opcional).',
        },
      },
      required: ['concepto'],
    },
  },

  // 10. COCHES: REPORTAR AVERÍA
  {
    name: 'reportar_averia_coche',
    description:
      'Apunta una avería, fallo o síntoma anómalo detectado en un vehículo (por ejemplo un ruido al frenar, un testigo encendido, etc.).',
    inputSchema: {
      type: 'object',
      properties: {
        vehiculo: {
          type: 'string',
          description: 'Nombre del vehículo (opcional si solo hay uno).',
        },
        titulo: {
          type: 'string',
          description: 'Resumen del problema o avería (ej. "Ruido metálico en freno derecho").',
        },
        descripcion: {
          type: 'string',
          description: 'Detalles adicionales de cuándo ocurre el problema (opcional).',
        },
      },
      required: ['titulo'],
    },
  },
];

// ============================================================================
// EJECUTOR DE HERRAMIENTAS MCP
// ============================================================================

export async function executeMcpTool(
  toolName: string,
  args: Record<string, any> = {},
  context: { defaultUserName?: string | null; defaultUserId?: number | null } = {}
): Promise<string> {
  await initializeDatabase();

  switch (toolName) {
    // ------------------------------------------------------------------------
    // 1. LISTAR TAREAS DEL HOGAR
    // ------------------------------------------------------------------------
    case 'listar_tareas_hogar': {
      const dashboard = await getHouseholdDashboard(new Date());
      const todayStr = getTodayYMD();
      const filterState = args.estado || 'all';
      const onlyToday = Boolean(args.solo_hoy);
      const memberHint = args.miembro || null;
      const useActiveUser = Boolean(args.solo_usuario_activo);

      let targetUser = null;
      if (memberHint) {
        const { user, allUsers } = await findUserStrict(String(memberHint));
        if (!user) {
          return `⚠️ No he encontrado ningún conviviente llamado "${memberHint}". Los convivientes registrados son: ${allUsers.map((u) => u.name).join(', ')}.`;
        }
        targetUser = user;
      } else if (useActiveUser) {
        targetUser = await resolveUser(null, context.defaultUserName, context.defaultUserId);
      }

      let chores = dashboard.allChores;
      if (onlyToday) {
        chores = chores.filter((c) => c.targetDate === todayStr);
      }
      if (filterState === 'pending' || filterState === 'completed') {
        chores = chores.filter((c) => c.status === filterState);
      }
      if (targetUser) {
        chores = chores.filter((c) => c.assignedToId === targetUser.id);
      }

      if (chores.length === 0) {
        if (targetUser) {
          return `🎉 ${targetUser.name} no tiene tareas ${filterState === 'pending' ? 'pendientes ' : ''}para ${onlyToday ? 'hoy' : 'esta semana'}.`;
        }
        return `No hay tareas que coincidan con el filtro solicitado (${onlyToday ? 'hoy' : 'esta semana'}${filterState !== 'all' ? `, estado: ${filterState}` : ''}).`;
      }

      const dayMap = new Map(dashboard.days.map((d) => [d.dateStr, `${d.dayName} ${d.dayNumber}`]));

      const lines = chores.map((c) => {
        const dayLabel = dayMap.get(c.targetDate) || c.targetDate;
        if (c.status === 'completed') {
          const execDiff = c.isDifferentExecutionDay && c.executedDateYmd
            ? ` (hecha el ${dayMap.get(c.executedDateYmd) || c.executedDateYmd})`
            : '';
          const authorInfo = c.isStolen
            ? `Tocaba a ${c.assignedToName}, hecha por ${c.executedByName}`
            : `Hecha por ${c.executedByName || c.assignedToName}`;
          return `✅ [${dayLabel}] ${c.icon} ${c.choreName} — ${authorInfo}${execDiff}`;
        } else {
          const overdueTag = c.isOverdue ? ' ⚠️ (Atrasada)' : c.isToday ? ' 📍 (Hoy)' : '';
          return targetUser
            ? `⏳ [${dayLabel}] ${c.icon} ${c.choreName}${overdueTag}`
            : `⏳ [${dayLabel}] ${c.icon} ${c.choreName} — Asignada a: ${c.assignedToName}${overdueTag}`;
        }
      });

      if (targetUser) {
        return [
          `📋 Tareas de ${targetUser.name} (${onlyToday ? 'hoy' : dashboard.summary.weekRange}) — ${chores.length} ${filterState === 'pending' ? 'pendiente(s)' : 'tarea(s)'}:`,
          ...lines,
        ].join('\n');
      }

      return [
        `📋 Resumen de toda la casa (${dashboard.summary.weekRange}) — Progreso global: ${dashboard.summary.totalCompleted}/${dashboard.summary.totalTasks} (${dashboard.summary.overallProgress}%):`,
        ...lines,
      ].join('\n');
    }

    // ------------------------------------------------------------------------
    // 2. COMPLETAR TAREA DEL HOGAR
    // ------------------------------------------------------------------------
    case 'completar_tarea_hogar': {
      const titleQuery = String(args.titulo || '').trim();
      if (!titleQuery) {
        throw new Error('Debes indicar el nombre o título de la tarea a completar.');
      }

      const actor = await resolveUser(args.ejecutado_por, context.defaultUserName, context.defaultUserId);
      if (!actor) {
        throw new Error('No hay convivientes registrados en TidyHome.');
      }

      const execDateYmd = resolveSpanishDate(args.fecha_ejecucion);
      const todayStr = getTodayYMD();
      const dashboard = await getHouseholdDashboard(new Date());

      // 1) Buscar entre las tareas pendientes de esta semana (priorizando hoy o atrasadas, o asignadas al usuario)
      const pendingLogs = dashboard.allChores.filter((c) => c.status === 'pending');
      let bestPending: (typeof pendingLogs)[number] | null = null;
      let bestPendingScore = 0;

      for (const item of pendingLogs) {
        let s = scoreMatch(item.choreName, titleQuery);
        if (s > 0) {
          if (item.targetDate === todayStr) s += 8;
          if (item.assignedToId === actor.id) s += 5;
          if (s > bestPendingScore) {
            bestPendingScore = s;
            bestPending = item;
          }
        }
      }

      if (bestPending && bestPendingScore >= 45 && execDateYmd === todayStr) {
        const res = await executeChore(bestPending.id, actor.id, 'completed');
        const stolenNote = bestPending.assignedToId !== actor.id
          ? ` (le tocaba a ${bestPending.assignedToName}, marcada como hecha por ${actor.name})`
          : ` (hecha por ${actor.name})`;
        const diffDayNote = res.wasDifferentDay
          ? ` Se mantiene en su día programado (${bestPending.targetDate}) indicando que se hizo hoy (${res.executedDateYmd}).`
          : '';
        return `✅ Tarea completada: "${bestPending.choreName}"${stolenNote}.${diffDayNote}`;
      }

      // 2) Si no se ejecutó hoy o no había instancia pendiente directa, buscar en el catálogo general
      const allCatalog = await db.select().from(choreCatalog);
      let bestCatalog: (typeof allCatalog)[number] | null = null;
      let bestCatalogScore = 0;

      for (const cat of allCatalog) {
        const s = scoreMatch(cat.name, titleQuery);
        if (s > bestCatalogScore) {
          bestCatalogScore = s;
          bestCatalog = cat;
        }
      }

      if (bestCatalog && bestCatalogScore >= 45) {
        const logged = await logChoreForDate({
          choreId: bestCatalog.id,
          date: execDateYmd,
          userId: actor.id,
        });
        return `✅ Tarea registrada como hecha: "${bestCatalog.name}" por ${actor.name} con fecha de ejecución ${execDateYmd}${logged.scheduledDate ? ` (mantenida en su día programado ${logged.scheduledDate})` : ''}.`;
      }

      // 3) Si no existe en el catálogo, crear y registrar como tarea puntual hecha
      await logChoreForDate({
        newChore: { name: titleQuery, icon: '✅', category: 'Hogar' },
        date: execDateYmd,
        userId: actor.id,
      });

      return `✅ Se ha registrado y completado la tarea puntual "${titleQuery}" hecha por ${actor.name} el día ${execDateYmd}.`;
    }

    // ------------------------------------------------------------------------
    // 3. CREAR TAREA DEL HOGAR
    // ------------------------------------------------------------------------
    case 'crear_tarea_hogar': {
      const title = String(args.titulo || '').trim();
      if (!title) throw new Error('El título de la tarea es obligatorio.');

      const assignee = await resolveUser(args.miembro_asignado, context.defaultUserName, context.defaultUserId);
      if (!assignee) throw new Error('No se encontró ningún conviviente al que asignar la tarea.');

      const targetDate = resolveSpanishDate(args.fecha);
      const [y, m, d] = targetDate.split('-').map(Number);
      const targetDayOfWeek = new Date(y, m - 1, d).getDay();
      const frequency = (args.frecuencia as FrequencyType) || 'once';

      const createdCat = await db
        .insert(choreCatalog)
        .values({
          name: title,
          frequency,
          assignmentMode: 'fixed',
          defaultAssigneeId: assignee.id,
          icon: '🧹',
          category: args.categoria || 'Hogar',
          dayOfWeek: targetDayOfWeek,
          secondDayOfWeek: (targetDayOfWeek + 3) % 7,
        })
        .returning();

      const chore = createdCat[0];

      if (frequency === 'once') {
        await db.insert(choreLog).values({
          choreId: chore.id,
          targetDate,
          status: 'pending',
          assignedTo: assignee.id,
        });
      } else {
        await syncAndGenerateWeekChores(new Date(y, m - 1, d));
      }

      return `✅ Tarea creada: "${chore.name}" (${frequency === 'once' ? `puntual para el ${targetDate}` : `periódica: ${frequency}`}), asignada a ${assignee.name}.`;
    }

    // ------------------------------------------------------------------------
    // 4. AÑADIR A LA LISTA DE LA COMPRA
    // ------------------------------------------------------------------------
    case 'anadir_a_lista_compra': {
      const rawProducts = Array.isArray(args.productos) ? args.productos : [];
      if (rawProducts.length === 0) {
        throw new Error('Debes indicar al menos un producto para añadir a la lista de la compra.');
      }

      const actor = await resolveUser(null, context.defaultUserName, context.defaultUserId);
      const addedSummaries: string[] = [];

      for (const item of rawProducts) {
        const rawName = typeof item === 'string' ? item : item?.nombre || item?.name;
        if (!rawName || !String(rawName).trim()) continue;

        const trimmedName = String(rawName).trim();
        const finalCategory: ShoppingCategoryType = detectShoppingCategory(trimmedName);
        const finalUnit: string =
          item?.unidad && String(item.unidad).trim()
            ? String(item.unidad).trim()
            : detectDefaultUnit(trimmedName);
        const finalQty: string =
          item?.cantidad && String(item.cantidad).trim() ? String(item.cantidad).trim() : '1';
        const finalNotes: string | null =
          item?.notas && String(item.notas).trim() ? String(item.notas).trim() : null;

        // Sincronizar con shoppingCatalog
        let targetCatalogId: number | null = null;
        const allCat = await db.select().from(shoppingCatalog);
        const existingCat = allCat.find(
          (c) => normalizeText(c.name) === normalizeText(trimmedName)
        );

        if (existingCat) {
          targetCatalogId = existingCat.id;
        } else {
          const insertedCat = await db
            .insert(shoppingCatalog)
            .values({
              name: trimmedName,
              category: finalCategory,
              defaultUnit: finalUnit,
              defaultQty: 1,
            })
            .returning();
          if (insertedCat.length > 0) targetCatalogId = insertedCat[0].id;
        }

        // Comprobar si ya está pendiente en shoppingItems
        const pendingItems = await db
          .select()
          .from(shoppingItems)
          .where(eq(shoppingItems.isBought, 0));

        const alreadyPending = pendingItems.find(
          (p) =>
            (targetCatalogId && p.catalogId === targetCatalogId) ||
            normalizeText(p.name) === normalizeText(trimmedName)
        );

        if (alreadyPending) {
          await db
            .update(shoppingItems)
            .set({
              quantity: finalQty !== '1' ? finalQty : alreadyPending.quantity,
              unit: finalUnit || alreadyPending.unit,
              notes: finalNotes || alreadyPending.notes,
            })
            .where(eq(shoppingItems.id, alreadyPending.id));
          addedSummaries.push(`• ${trimmedName} (ya estaba en la lista, actualizado en ${finalCategory})`);
        } else {
          await db.insert(shoppingItems).values({
            catalogId: targetCatalogId,
            name: trimmedName,
            category: finalCategory,
            quantity: finalQty,
            unit: finalUnit,
            notes: finalNotes,
            addedBy: actor?.id ?? null,
            isBought: 0,
          });
          addedSummaries.push(
            `• ${trimmedName} (${finalQty} ${finalUnit}) → ${finalCategory}${finalNotes ? ` [${finalNotes}]` : ''}`
          );
        }
      }

      return `🛒 Productos añadidos a la lista de la compra:\n${addedSummaries.join('\n')}`;
    }

    // ------------------------------------------------------------------------
    // 5. LEER LISTA DE LA COMPRA
    // ------------------------------------------------------------------------
    case 'leer_lista_compra': {
      const includeBought = Boolean(args.incluir_comprados);
      const categoryFilter = args.categoria ? normalizeText(String(args.categoria)) : null;

      let items = await db
        .select()
        .from(shoppingItems)
        .orderBy(asc(shoppingItems.isBought), desc(shoppingItems.id));

      if (!includeBought) {
        items = items.filter((i) => !i.isBought);
      }
      if (categoryFilter) {
        items = items.filter((i) => normalizeText(i.category).includes(categoryFilter));
      }

      if (items.length === 0) {
        return '🛒 La lista de la compra está vacía (no hay productos pendientes).';
      }

      const byCat = new Map<string, typeof items>();
      for (const item of items) {
        const cat = item.category || 'Otros';
        if (!byCat.has(cat)) byCat.set(cat, []);
        byCat.get(cat)!.push(item);
      }

      const sections: string[] = [];
      for (const [cat, catItems] of byCat.entries()) {
        const listStr = catItems
          .map(
            (i) =>
              `  ${i.isBought ? '☑️' : '▫️'} ${i.name} (${i.quantity || '1'} ${i.unit || 'ud'})${i.notes ? ` — ${i.notes}` : ''}`
          )
          .join('\n');
        sections.push(`📦 ${cat}:\n${listStr}`);
      }

      return `🛒 Lista de la compra (${items.length} artículos):\n${sections.join('\n\n')}`;
    }

    // ------------------------------------------------------------------------
    // 6. MARCAR COMPRADO EN LA LISTA DE LA COMPRA
    // ------------------------------------------------------------------------
    case 'marcar_comprado_lista_compra': {
      const names: string[] = Array.isArray(args.nombres) ? args.nombres : [];
      if (names.length === 0) {
        throw new Error('Indica qué productos quieres marcar como comprados.');
      }

      const actor = await resolveUser(null, context.defaultUserName, context.defaultUserId);
      const pendingItems = await db
        .select()
        .from(shoppingItems)
        .where(eq(shoppingItems.isBought, 0));

      const marked: string[] = [];
      const notFound: string[] = [];

      for (const queryName of names) {
        let bestItem = null;
        let bestScore = 0;
        for (const item of pendingItems) {
          const s = scoreMatch(item.name, queryName);
          if (s > bestScore) {
            bestScore = s;
            bestItem = item;
          }
        }

        if (bestItem && bestScore >= 45) {
          await db
            .update(shoppingItems)
            .set({
              isBought: 1,
              boughtAt: new Date().toISOString(),
              boughtBy: actor?.id ?? null,
            })
            .where(eq(shoppingItems.id, bestItem.id));
          marked.push(bestItem.name);
        } else {
          notFound.push(queryName);
        }
      }

      const parts: string[] = [];
      if (marked.length > 0) parts.push(`✅ Marcados como comprados: ${marked.join(', ')}.`);
      if (notFound.length > 0) parts.push(`ℹ️ No se encontraron pendientes en la lista: ${notFound.join(', ')}.`);
      return parts.join('\n');
    }

    // ------------------------------------------------------------------------
    // 7. CONSULTAR MANTENIMIENTO DE COCHE
    // ------------------------------------------------------------------------
    case 'consultar_mantenimiento_coche': {
      const allVehicles = await db.select().from(vehicles).orderBy(asc(vehicles.id));
      if (allVehicles.length === 0) {
        return '🚗 No hay vehículos registrados en el garaje de TidyHome.';
      }

      let filteredVehicles = allVehicles;
      if (args.vehiculo) {
        const matched = await resolveVehicle(String(args.vehiculo));
        if (matched) filteredVehicles = [matched];
      }

      const blocks: string[] = [];
      for (const v of filteredVehicles) {
        const rules = await db
          .select()
          .from(vehicleMaintenance)
          .where(eq(vehicleMaintenance.vehicleId, v.id));

        const incidents = await db
          .select()
          .from(vehicleIncidents)
          .where(and(eq(vehicleIncidents.vehicleId, v.id), eq(vehicleIncidents.status, 'open')));

        const computed = rules.map((r) =>
          computeMaintenanceStatus(r, v.currentKm || 0, Boolean(v.hasMileage))
        );

        const maintLines = computed.length
          ? computed.map((m) => {
              const badge =
                m.status === 'overdue' ? '🔴 VENCIDO' : m.status === 'soon' ? '🟡 PRÓXIMO' : '🟢 AL DÍA';
              const kmPart =
                m.nextDueKm !== null
                  ? `próximo a los ${m.nextDueKm.toLocaleString('es-ES')} km (faltan ${m.remainingKm?.toLocaleString('es-ES')} km)`
                  : '';
              const datePart =
                m.nextDueDate !== null
                  ? `próxima fecha: ${m.nextDueDate} (${m.remainingDays} días)`
                  : '';
              const details = [kmPart, datePart].filter(Boolean).join(' | ');
              return `  - ${badge} ${m.name}: ${details || 'Sin intervalo definido'}`;
            })
          : ['  - Sin mantenimientos programados.'];

        const incidentLines = incidents.length
          ? incidents.map((inc) => `  - ⚠️ Avería abierta (${inc.reportedDate}): ${inc.title}${inc.description ? ` — ${inc.description}` : ''}`)
          : ['  - Ninguna avería abierta.'];

        blocks.push(
          [
            `🚗 ${v.name}${v.plate ? ` (${v.plate})` : ''} — ${v.hasMileage ? `${(v.currentKm || 0).toLocaleString('es-ES')} km (actualizado: ${v.lastKmDate || 'nunca'})` : 'Sin cuentakilómetros'}`,
            `🔧 Mantenimientos y revisiones:`,
            ...maintLines,
            `🚨 Averías / Incidencias:`,
            ...incidentLines,
          ].join('\n')
        );
      }

      return blocks.join('\n\n');
    }

    // ------------------------------------------------------------------------
    // 8. ACTUALIZAR KILÓMETROS DE COCHE
    // ------------------------------------------------------------------------
    case 'actualizar_kilometros_coche': {
      const v = await resolveVehicle(args.vehiculo);
      if (!v) throw new Error('No hay vehículos registrados en el garaje.');

      const newKm = Number(args.kilometros);
      if (isNaN(newKm) || newKm < 0) throw new Error('Kilometraje inválido.');

      const todayStr = getTodayYMD();
      const actor = await resolveUser(null, context.defaultUserName, context.defaultUserId);

      await db
        .update(vehicles)
        .set({ currentKm: newKm, lastKmDate: todayStr })
        .where(eq(vehicles.id, v.id));

      await db.insert(vehicleMaintenanceLogs).values({
        vehicleId: v.id,
        title: `Actualización de kilometraje: ${newKm.toLocaleString('es-ES')} km`,
        performedDate: todayStr,
        performedKm: newKm,
        performedBy: actor?.id ?? null,
        notes: 'Actualizado por voz (Gemini MCP)',
      });

      const rules = await db
        .select()
        .from(vehicleMaintenance)
        .where(eq(vehicleMaintenance.vehicleId, v.id));

      const alerts = rules
        .map((r) => computeMaintenanceStatus(r, newKm, Boolean(v.hasMileage)))
        .filter((m) => m.status === 'overdue' || m.status === 'soon')
        .map(
          (m) =>
            `⚠️ ${m.name}: ${m.status === 'overdue' ? 'VENCIDO' : 'PRÓXIMO'} (${m.remainingKm !== null ? `faltan ${m.remainingKm} km` : ''}${m.remainingDays !== null ? ` / ${m.remainingDays} días` : ''})`
        );

      return [
        `✅ Kilómetros de ${v.name} actualizados a ${newKm.toLocaleString('es-ES')} km (${todayStr}).`,
        alerts.length > 0
          ? `Atención a las próximas revisiones:\n${alerts.join('\n')}`
          : 'Todas las revisiones de este vehículo están al día.',
      ].join('\n');
    }

    // ------------------------------------------------------------------------
    // 9. REGISTRAR MANTENIMIENTO DE COCHE
    // ------------------------------------------------------------------------
    case 'registrar_mantenimiento_coche': {
      const v = await resolveVehicle(args.vehiculo);
      if (!v) throw new Error('No hay vehículos registrados en el garaje.');

      const concept = String(args.concepto || '').trim();
      if (!concept) throw new Error('Debes indicar qué mantenimiento o arreglo se ha realizado.');

      const performedDate = resolveSpanishDate(args.fecha);
      const kmNum =
        args.kilometros !== undefined && args.kilometros !== null && args.kilometros !== ''
          ? Number(args.kilometros)
          : v.currentKm || null;

      const actor = await resolveUser(null, context.defaultUserName, context.defaultUserId);

      // Buscar si coincide con algún mantenimiento programado del vehículo (ej. ITV, Aceite, Ruedas)
      const rules = await db
        .select()
        .from(vehicleMaintenance)
        .where(eq(vehicleMaintenance.vehicleId, v.id));

      let matchedRule: (typeof rules)[number] | null = null;
      let bestScore = 0;
      for (const r of rules) {
        const s = scoreMatch(r.name, concept);
        if (s > bestScore) {
          bestScore = s;
          matchedRule = r;
        }
      }

      let maintenanceId: number | null = null;
      if (matchedRule && bestScore >= 40) {
        maintenanceId = matchedRule.id;
        await db
          .update(vehicleMaintenance)
          .set({
            lastDoneKm: kmNum !== null ? kmNum : matchedRule.lastDoneKm,
            lastDoneDate: performedDate,
          })
          .where(eq(vehicleMaintenance.id, matchedRule.id));
      }

      // Si el kilometraje indicado supera al actual del vehículo, actualizar el vehículo
      if (kmNum !== null && kmNum > (v.currentKm || 0)) {
        await db
          .update(vehicles)
          .set({ currentKm: kmNum, lastKmDate: performedDate })
          .where(eq(vehicles.id, v.id));
      }

      await db.insert(vehicleMaintenanceLogs).values({
        vehicleId: v.id,
        maintenanceId,
        title: concept,
        performedDate,
        performedKm: kmNum,
        performedBy: actor?.id ?? null,
        workshop: args.taller ? String(args.taller).trim() : null,
        cost: args.coste ? String(args.coste).trim() : null,
        notes: args.notas ? String(args.notas).trim() : null,
      });

      return `✅ Registrado en ${v.name}: "${concept}" el día ${performedDate}${kmNum !== null ? ` con ${kmNum.toLocaleString('es-ES')} km` : ''}${args.coste ? ` (coste: ${args.coste})` : ''}${matchedRule && bestScore >= 40 ? `. Se ha actualizado el contador de la revisión "${matchedRule.name}".` : '.'}`;
    }

    // ------------------------------------------------------------------------
    // 10. REPORTAR AVERÍA DE COCHE
    // ------------------------------------------------------------------------
    case 'reportar_averia_coche': {
      const v = await resolveVehicle(args.vehiculo);
      if (!v) throw new Error('No hay vehículos registrados en el garaje.');

      const title = String(args.titulo || '').trim();
      if (!title) throw new Error('El título o descripción de la avería es obligatorio.');

      const actor = await resolveUser(null, context.defaultUserName, context.defaultUserId);
      const todayStr = getTodayYMD();

      await db.insert(vehicleIncidents).values({
        vehicleId: v.id,
        title,
        description: args.descripcion ? String(args.descripcion).trim() : null,
        status: 'open',
        reportedBy: actor?.id ?? null,
        reportedDate: todayStr,
      });

      return `🚨 Avería registrada en ${v.name}: "${title}" (${todayStr}).`;
    }

    default:
      throw new Error(`Herramienta MCP desconocida: ${toolName}`);
  }
}

