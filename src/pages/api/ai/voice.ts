import type { APIRoute } from 'astro';
import { MCP_TOOLS, executeMcpTool } from '../../../lib/mcpTools';
import { getTodayYMD } from '../../../lib/dates';

export const prerender = false;

function normalizeText(str: string): string {
  return (str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Convierte palabras numéricas habituales en español y formatos "145.000" o "145 mil" a número.
 */
function parseSpanishNumber(raw: string): number | null {
  const norm = normalizeText(raw);
  // Buscar patrón "85 mil" o "145.200"
  const milMatch = norm.match(/(\d+(?:[.,]\d+)?)\s*mil\b/);
  if (milMatch) {
    const base = parseFloat(milMatch[1].replace(',', '.'));
    if (!isNaN(base)) return Math.round(base * 1000);
  }

  const digitsMatch = norm.match(/\b(\d{1,3}(?:[.\s]\d{3})+|\d+)\b/);
  if (digitsMatch) {
    const clean = digitsMatch[1].replace(/[.\s]/g, '');
    const num = parseInt(clean, 10);
    if (!isNaN(num)) return num;
  }

  const wordNums: Record<string, number> = {
    un: 1,
    uno: 1,
    una: 1,
    dos: 2,
    tres: 3,
    cuatro: 4,
    cinco: 5,
    seis: 6,
    siete: 7,
    ocho: 8,
    nueve: 9,
    diez: 10,
    docena: 12,
  };
  for (const [w, val] of Object.entries(wordNums)) {
    if (new RegExp(`\\b${w}\\b`).test(norm)) return val;
  }
  return null;
}

/**
 * Extrae una lista de productos de una frase hablada como:
 * "añade dos de leche semidesnatada, huevos, medio kilo de pollo y papel de cocina a la lista de la compra"
 */
function parseShoppingProductsFromSpeech(text: string): Array<{
  nombre: string;
  cantidad?: string;
  unidad?: string;
}> {
  let cleaned = text
    .replace(
      /^(?:oye\s+|por\s+favor\s+)?(?:anade|añade|apunta|pon|mete|agrega|compra|comprar|anota|necesitamos|falta)\s+/i,
      ''
    )
    .replace(/\s+(?:a|en)\s+la\s+(?:lista\s+de\s+la\s+)?compra\b.*$/i, '')
    .replace(/^(?:a|en)\s+la\s+(?:lista\s+de\s+la\s+)?compra\s+/i, '')
    .replace(/\s+para\s+comprar\b.*$/i, '')
    .trim();

  // Dividir por comas y por " y " o " e "
  const rawParts = cleaned
    .split(/,|\s+y\s+|\s+e\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1);

  const wordMap: Record<string, string> = {
    un: '1',
    uno: '1',
    una: '1',
    dos: '2',
    tres: '3',
    cuatro: '4',
    cinco: '5',
    seis: '6',
  };

  const results: Array<{ nombre: string; cantidad?: string; unidad?: string }> = [];

  for (let part of rawParts) {
    part = part.replace(/^(?:también|tambien|además|ademas|un\s+poco\s+de|algo\s+de)\s+/i, '').trim();
    if (!part) continue;

    // Caso "medio kilo de X"
    const halfKg = part.match(/^medio\s+kilo\s+de\s+(.+)$/i);
    if (halfKg) {
      results.push({ nombre: capitalizeFirst(halfKg[1].trim()), cantidad: '1', unidad: '500gr' });
      continue;
    }

    // Caso "2 packs de leche" / "dos botellas de aceite" / "3 de huevos"
    const qtyUnitMatch = part.match(
      /^(?:(\d+|un|uno|una|dos|tres|cuatro|cinco|seis)\s+)?(?:(packs?|paquetes?|botellas?|garrafas?|kilos?|kg|gramos?|gr|latas?|cajas?|barras?|docenas?|bolsas?|rollos?|botes?)\s+de\s+|de\s+)?(.+)$/i
    );

    if (qtyUnitMatch) {
      const rawQty = qtyUnitMatch[1]?.toLowerCase();
      const rawUnit = qtyUnitMatch[2]?.toLowerCase();
      let prodName = qtyUnitMatch[3]?.trim() || part;
      prodName = prodName.replace(/^de\s+/i, '').trim();

      if (!prodName) continue;

      const cantidad = rawQty ? wordMap[rawQty] || rawQty : '1';
      let unidad: string | undefined = undefined;
      if (rawUnit) {
        if (rawUnit.startsWith('kilo') || rawUnit === 'kg') unidad = '1 kg';
        else if (rawUnit.startsWith('botella')) unidad = 'botella';
        else if (rawUnit.startsWith('garrafa')) unidad = 'garrafa 5L';
        else if (rawUnit.startsWith('paquete')) unidad = 'paquete';
        else if (rawUnit.startsWith('pack')) unidad = 'pack';
        else if (rawUnit.startsWith('docena')) unidad = 'docena';
        else if (rawUnit.startsWith('barra')) unidad = 'barra';
        else if (rawUnit.startsWith('caja')) unidad = 'caja';
        else if (rawUnit.startsWith('bote')) unidad = 'bote';
        else if (rawUnit.startsWith('rollo')) unidad = 'rollo';
      }

      results.push({
        nombre: capitalizeFirst(prodName),
        cantidad,
        ...(unidad ? { unidad } : {}),
      });
    } else {
      results.push({ nombre: capitalizeFirst(part), cantidad: '1' });
    }
  }

  return results;
}

function capitalizeFirst(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Motor inteligente local en español (funciona al instante sin requerir clave externa).
 * Capaz de ejecutar órdenes simples o compuestas sobre Hogar, Compra y Garaje.
 */
async function executeSmartSpanishIntent(
  rawText: string,
  defaultUserName?: string | null
): Promise<{ reply: string; toolsCalled: string[] }> {
  const toolsCalled: string[] = [];
  const outputs: string[] = [];

  // Separar si hay dos órdenes distintas unidas (ej. "ya he limpiado el baño y apunta leche en la compra")
  const subCommands = rawText
    .split(/\s+(?:y\s+adem[aá]s|y\s+tambi[eé]n|;\s*)\s+|\s+(?=y\s+(?:apunta|a[ñn]ade|pon|marca|registra|actualiza)\b)/i)
    .map((s) => s.replace(/^y\s+/i, '').trim())
    .filter(Boolean);

  for (const cmd of subCommands) {
    const norm = normalizeText(cmd);

    // ----------------------------------------------------------------------
    // A. MÓDULO COMPRA
    // ----------------------------------------------------------------------
    const isShoppingMention =
      /\b(compra|super|supermercado|lista|cesta|carro)\b/.test(norm) ||
      /^(anade|apunta|pon|mete|agrega|comprar)\b/.test(norm);

    // A1. Leer lista de la compra
    if (
      /\b(que\s+hay|que\s+falta|que\s+tenemos|lee|leer|dime|ense[ñn]a|ver|consultar)\b.*\b(compra|super|lista)\b/.test(
        norm
      ) ||
      norm === 'lista de la compra' ||
      norm === 'ver compra'
    ) {
      toolsCalled.push('leer_lista_compra');
      outputs.push(await executeMcpTool('leer_lista_compra', {}, { defaultUserName }));
      continue;
    }

    // A2. Marcar como comprado en la lista
    if (
      /\b(ya\s+he\s+comprado|he\s+comprado|hemos\s+comprado|tacha|tachar|ya\s+cogi|he\s+cogido)\b/.test(
        norm
      )
    ) {
      const cleaned = cmd
        .replace(
          /^.*?\b(?:ya\s+he\s+comprado|he\s+comprado|hemos\s+comprado|tacha|tachar|ya\s+cogi|he\s+cogido)\s+/i,
          ''
        )
        .replace(/\s+(?:de\s+la\s+(?:lista\s+de\s+la\s+)?compra|del\s+super).*$/i, '')
        .trim();
      const names = cleaned
        .split(/,|\s+y\s+/i)
        .map((n) => n.replace(/^(?:el|la|los|las|un|una|unos|unas)\s+/i, '').trim())
        .filter(Boolean);

      if (names.length > 0) {
        toolsCalled.push('marcar_comprado_lista_compra');
        outputs.push(
          await executeMcpTool('marcar_comprado_lista_compra', { nombres: names }, { defaultUserName })
        );
        continue;
      }
    }

    // A3. Añadir a la lista de la compra
    if (
      /\b(compra|lista\s+de\s+la\s+compra|supermercado)\b/.test(norm) &&
      /\b(anade|apunta|pon|mete|agrega|comprar|falta|necesitamos)\b/.test(norm)
    ) {
      const productos = parseShoppingProductsFromSpeech(cmd);
      if (productos.length > 0) {
        toolsCalled.push('anadir_a_lista_compra');
        outputs.push(
          await executeMcpTool('anadir_a_lista_compra', { productos }, { defaultUserName })
        );
        continue;
      }
    }

    // ----------------------------------------------------------------------
    // B. MÓDULO GARAJE / COCHES
    // ----------------------------------------------------------------------
    const isCarMention =
      /\b(coche|vehiculo|garaje|peugeot|5008|caravana|itv|kilometros|km|aceite|ruedas|neumaticos|frenos|taller|averia|revision)\b/.test(
        norm
      );

    if (isCarMention) {
      // B1. Consultar estado / ITV / mantenimiento del coche
      if (
        /\b(como\s+esta|cuando\s+toca|cuando\s+caduca|que\s+le\s+toca|consultar|ver|estado|proxima\s+revision)\b/.test(
          norm
        ) ||
        norm.startsWith('itv') ||
        norm.startsWith('mantenimiento')
      ) {
        toolsCalled.push('consultar_mantenimiento_coche');
        outputs.push(await executeMcpTool('consultar_mantenimiento_coche', {}, { defaultUserName }));
        continue;
      }

      // B2. Reportar avería o ruido
      if (/\b(averia|incidencia|ruido|fallo|testigo|rota|roto|problema)\b/.test(norm)) {
        const title = cmd
          .replace(/^.*?\b(?:averia|incidencia|problema)(?:\s+en\s+el\s+coche|\s*:\s*|\s+)/i, '')
          .trim() || cmd;
        toolsCalled.push('reportar_averia_coche');
        outputs.push(
          await executeMcpTool('reportar_averia_coche', { titulo: capitalizeFirst(title) }, { defaultUserName })
        );
        continue;
      }

      // B3. Registrar mantenimiento (cambio de aceite, ruedas, ITV pasada, revisión...)
      if (
        /\b(cambiado|cambio\s+de|hemos\s+cambiado|pasado\s+la\s+itv|pasar\s+la\s+itv|revision|arreglo|reparado|taller)\b/.test(
          norm
        )
      ) {
        const km = parseSpanishNumber(cmd);
        const costMatch = cmd.match(/(\d+(?:[.,]\d+)?\s*(?:€|euros?))/i);
        const cost = costMatch ? costMatch[1] : undefined;

        let concept = 'Mantenimiento realizado';
        if (norm.includes('rueda') || norm.includes('neumatico')) {
          concept = norm.includes('delantera')
            ? 'Cambio de ruedas delanteras'
            : norm.includes('trasera')
              ? 'Cambio de ruedas traseras'
              : 'Cambio de neumáticos';
        } else if (norm.includes('aceite')) {
          concept = 'Cambio de aceite y filtro';
        } else if (norm.includes('itv')) {
          concept = 'ITV';
        } else {
          concept = capitalizeFirst(
            cmd
              .replace(/\bcon\s+\d[\d.\s]*\s*(?:km|kil[oó]metros?).*$/i, '')
              .replace(/\bpor\s+\d+\s*(?:€|euros?).*$/i, '')
              .trim()
          );
        }

        toolsCalled.push('registrar_mantenimiento_coche');
        outputs.push(
          await executeMcpTool(
            'registrar_mantenimiento_coche',
            {
              concepto: concept,
              ...(km !== null ? { kilometros: km } : {}),
              ...(cost ? { coste: cost } : {}),
            },
            { defaultUserName }
          )
        );
        continue;
      }

      // B4. Actualizar kilómetros del coche
      if (/\b(kilometros|km)\b/.test(norm)) {
        const km = parseSpanishNumber(cmd);
        if (km !== null) {
          toolsCalled.push('actualizar_kilometros_coche');
          outputs.push(
            await executeMcpTool(
              'actualizar_kilometros_coche',
              { kilometros: km },
              { defaultUserName }
            )
          );
          continue;
        }
      }
    }

    // ----------------------------------------------------------------------
    // C. MÓDULO TAREAS DEL HOGAR
    // ----------------------------------------------------------------------
    // C1. Consultar tareas ("¿qué me toca hoy?", "¿qué tareas quedan pendientes?")
    if (
      /\b(que\s+tareas?|que\s+me\s+toca|que\s+toca|que\s+queda|pendientes|listar\s+tareas|resumen\s+de\s+tareas|tareas\s+de\s+hoy)\b/.test(
        norm
      )
    ) {
      const onlyToday = /\bhoy\b/.test(norm);
      const onlyPending = /\b(pendientes?|falta|quedan|toca)\b/.test(norm);
      const isAskingForMe = /\b(me\s+toca|mis\s+tareas)\b/.test(norm);

      toolsCalled.push('listar_tareas_hogar');
      outputs.push(
        await executeMcpTool(
          'listar_tareas_hogar',
          {
            solo_hoy: onlyToday,
            estado: onlyPending ? 'pending' : 'all',
            ...(isAskingForMe && defaultUserName ? { miembro: defaultUserName } : {}),
          },
          { defaultUserName }
        )
      );
      continue;
    }

    // C2. Crear tarea nueva ("crea la tarea...", "recuérdame limpiar X el sábado")
    if (/\b(crea|crear|programa|programar|recuerdame|nueva\s+tarea)\b/.test(norm)) {
      let dateHint = 'hoy';
      for (const dName of ['manana', 'lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']) {
        if (norm.includes(dName)) {
          dateHint = dName;
          break;
        }
      }
      const cleanTitle = cmd
        .replace(/^.*?\b(?:crea(?:r)?(?:\s+la)?\s+tarea|programa(?:r)?|recu[eé]rdame|nueva\s+tarea)\s+/i, '')
        .replace(/\s+(?:para\s+el|el\s+d[ií]a|el|este|esta)\s+(?:hoy|ma[ñn]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo).*$/i, '')
        .trim();

      if (cleanTitle) {
        toolsCalled.push('crear_tarea_hogar');
        outputs.push(
          await executeMcpTool(
            'crear_tarea_hogar',
            { titulo: capitalizeFirst(cleanTitle), fecha: dateHint },
            { defaultUserName }
          )
        );
        continue;
      }
    }

    // C3. Si empieza con "añade / apunta / pon" y no era tarea con fecha, asumir lista de la compra
    if (isShoppingMention && /^(anade|apunta|pon|mete|agrega)\b/.test(norm)) {
      const productos = parseShoppingProductsFromSpeech(cmd);
      if (productos.length > 0) {
        toolsCalled.push('anadir_a_lista_compra');
        outputs.push(
          await executeMcpTool('anadir_a_lista_compra', { productos }, { defaultUserName })
        );
        continue;
      }
    }

    // C4. Completar tarea del hogar ("ya he limpiado el baño", "he hecho la lavadora", "ayer fregué la cocina")
    let execDate = 'hoy';
    if (/\bayer\b/.test(norm)) execDate = 'ayer';
    else if (/\banteayer\b/.test(norm)) execDate = 'anteayer';
    else {
      for (const dName of ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']) {
        if (new RegExp(`\\bel\\s+${dName}\\b`).test(norm) && !new RegExp(`del\\s+${dName}\\b`).test(norm)) {
          execDate = dName;
          break;
        }
      }
    }

    let taskTitle = cmd
      .replace(
        /^(?:oye\s+|por\s+favor\s+)?(?:ya\s+)?(?:he\s+hecho|he\s+limpiado|he\s+fregado|he\s+barrido|he\s+pasado|he\s+puesto|he\s+sacado|he\s+tendido|he\s+recogido|he\s+ordenado|he\s+completado|marca\s+como\s+hecha(?:\s+la\s+tarea\s+de)?|completa(?:r)?(?:\s+la\s+tarea\s+de)?|apunta\s+que\s+(?:ya\s+)?(?:he\s+hecho|hice)|ayer\s+hice|ayer\s+limpie|ya\s+hice|ya\s+limpie)\s+/i,
        ''
      )
      .replace(/\s+(?:que\s+tocaba(?:n)?|del|de\s+este)\s+(?:lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo).*$/i, '')
      .replace(/\b(?:hoy|ayer|anteayer)\b/gi, '')
      .trim();

    if (!taskTitle) taskTitle = cmd.trim();

    toolsCalled.push('completar_tarea_hogar');
    outputs.push(
      await executeMcpTool(
        'completar_tarea_hogar',
        {
          titulo: taskTitle,
          fecha_ejecucion: execDate,
        },
        { defaultUserName }
      )
    );
  }

  return {
    reply: outputs.join('\n\n'),
    toolsCalled,
  };
}

/**
 * Ejecuta la orden con Gemini 2.5 Flash (Function Calling) si hay API Key disponible.
 */
async function executeWithGeminiLLM(
  text: string,
  apiKey: string,
  defaultUserName?: string | null
): Promise<{ reply: string; toolsCalled: string[]; engine: 'gemini' }> {
  const todayStr = getTodayYMD();
  const functionDeclarations = MCP_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.inputSchema,
  }));

  const systemInstruction = `Eres el asistente de voz inteligente de TidyHome (app familiar de tareas del hogar, lista de la compra del supermercado y mantenimiento de vehículos en garaje).
Fecha actual: ${todayStr}.
Conviviente que habla desde el teléfono: ${defaultUserName || 'Conviviente activo'}.
Instrucciones:
1. Usa SIEMPRE las herramientas disponibles para ejecutar las acciones que pida el usuario (incluso varias herramientas en una misma frase si pide cosas de compra, hogar y coche a la vez).
2. Cuando termines de llamar a las herramientas, responde en español de forma breve, natural, directa y amigable (máximo 2-3 frases) porque tu respuesta se leerá en voz alta por el altavoz del móvil.`;

  const contents: any[] = [{ role: 'user', parts: [{ text }] }];
  const toolsCalled: string[] = [];

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;

  for (let step = 0; step < 3; step++) {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemInstruction }] },
        contents,
        tools: [{ functionDeclarations }],
        toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API HTTP ${res.status}: ${errText}`);
    }

    const data = await res.json();
    const candidate = data?.candidates?.[0];
    const parts: any[] = candidate?.content?.parts || [];

    const functionCalls = parts.filter((p) => p.functionCall);
    if (functionCalls.length === 0) {
      const textReply = parts
        .map((p) => p.text)
        .filter(Boolean)
        .join('\n')
        .trim();
      return {
        reply: textReply || '¡Listo! Acción completada.',
        toolsCalled,
        engine: 'gemini',
      };
    }

    contents.push(candidate.content);
    const responseParts: any[] = [];

    for (const fcPart of functionCalls) {
      const { name, args } = fcPart.functionCall;
      toolsCalled.push(name);
      let toolOutput: string;
      try {
        toolOutput = await executeMcpTool(name, args || {}, { defaultUserName });
      } catch (e: any) {
        toolOutput = `Error: ${e?.message || String(e)}`;
      }
      responseParts.push({
        functionResponse: {
          name,
          response: { result: toolOutput },
        },
      });
    }

    contents.push({ role: 'user', parts: responseParts });
  }

  return {
    reply: '¡Listo! He ejecutado tus instrucciones en TidyHome.',
    toolsCalled,
    engine: 'gemini',
  };
}

export const POST: APIRoute = async ({ request }) => {
  try {
    const body = await request.json();
    const text = String(body.text || '').trim();
    const userName = body.userName ? String(body.userName).trim() : null;
    const clientGeminiKey = body.geminiApiKey ? String(body.geminiApiKey).trim() : null;

    if (!text) {
      return new Response(
        JSON.stringify({ success: false, error: 'No se ha recibido ninguna instrucción de voz o texto.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const serverGeminiKey =
      (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
      (import.meta as any).env?.GEMINI_API_KEY ||
      null;

    const activeGeminiKey = clientGeminiKey || serverGeminiKey;

    if (activeGeminiKey) {
      try {
        const geminiResult = await executeWithGeminiLLM(text, activeGeminiKey, userName);
        return new Response(
          JSON.stringify({
            success: true,
            reply: geminiResult.reply,
            toolsCalled: geminiResult.toolsCalled,
            engine: 'gemini-2.5-flash',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      } catch (geminiErr: any) {
        console.warn('Fallback a motor local por error en Gemini API:', geminiErr?.message);
      }
    }

    const localResult = await executeSmartSpanishIntent(text, userName);
    return new Response(
      JSON.stringify({
        success: true,
        reply: localResult.reply,
        toolsCalled: localResult.toolsCalled,
        engine: 'smart-local',
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({
        success: false,
        error: error?.message || 'Error al procesar el comando por voz',
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
