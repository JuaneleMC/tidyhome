import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../../db/client';
import { shoppingCatalog, shoppingItems, type ShoppingCategoryType } from '../../../../db/schema';
import { asc, eq } from 'drizzle-orm';
import { detectShoppingCategory, detectDefaultUnit } from '../../../../lib/shoppingCategories';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    await initializeDatabase();

    // 1. Obtener todos los artículos del catálogo ordenados alfabéticamente A-Z
    const catalogItems = await db
      .select()
      .from(shoppingCatalog)
      .orderBy(asc(shoppingCatalog.name));

    // 2. Obtener los artículos pendientes actualmente en la lista de la compra (isBought = 0)
    const activeShoppingItems = await db
      .select({
        id: shoppingItems.id,
        catalogId: shoppingItems.catalogId,
        name: shoppingItems.name,
        quantity: shoppingItems.quantity,
        unit: shoppingItems.unit,
      })
      .from(shoppingItems)
      .where(eq(shoppingItems.isBought, 0));

    // Mapear por catalogId y por nombre normalizado para macheo fiable
    const activeByCatalogId = new Map<number, typeof activeShoppingItems[0]>();
    const activeByName = new Map<string, typeof activeShoppingItems[0]>();

    for (const item of activeShoppingItems) {
      if (item.catalogId) {
        activeByCatalogId.set(item.catalogId, item);
      }
      activeByName.set(item.name.toLowerCase().trim(), item);
    }

    // 3. Cruzar catálogo con estado en la lista activa
    const enrichedCatalog = catalogItems.map((cat) => {
      const activeMatch =
        activeByCatalogId.get(cat.id) ||
        activeByName.get(cat.name.toLowerCase().trim()) ||
        null;

      return {
        id: cat.id,
        name: cat.name,
        category: cat.category || 'Otros',
        defaultUnit: cat.defaultUnit || 'ud',
        defaultQty: cat.defaultQty || 1,
        createdAt: cat.createdAt,
        inShoppingList: Boolean(activeMatch),
        shoppingItemId: activeMatch ? activeMatch.id : null,
        currentQty: activeMatch ? (activeMatch.quantity || '1') : null,
        currentUnit: activeMatch ? (activeMatch.unit || cat.defaultUnit || 'ud') : null,
      };
    });

    return new Response(JSON.stringify({ success: true, items: enrichedCatalog }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

export const POST: APIRoute = async ({ request }) => {
  try {
    await initializeDatabase();
    const body = await request.json();
    const { name, category, defaultUnit, addToListImmediately, addedBy } = body;

    if (!name || !name.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'El nombre del artículo es obligatorio.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const trimmedName = name.trim();
    const finalCategory: ShoppingCategoryType =
      category && category !== 'Otros'
        ? (category as ShoppingCategoryType)
        : detectShoppingCategory(trimmedName);

    const finalUnit: string =
      defaultUnit && defaultUnit.trim()
        ? defaultUnit.trim()
        : detectDefaultUnit(trimmedName);

    // Verificar si ya existe en el catálogo
    const existing = await db
      .select()
      .from(shoppingCatalog)
      .where(eq(shoppingCatalog.name, trimmedName))
      .limit(1);

    let catalogItem;
    if (existing.length > 0) {
      catalogItem = existing[0];
    } else {
      const inserted = await db
        .insert(shoppingCatalog)
        .values({
          name: trimmedName,
          category: finalCategory,
          defaultUnit: finalUnit,
          defaultQty: 1,
        })
        .returning();
      catalogItem = inserted[0];
    }

    // Si se solicitó añadir a la lista de la compra de inmediato
    let shoppingItem = null;
    if (addToListImmediately && catalogItem) {
      // Verificar si ya está en la lista pendiente
      const activeInList = await db
        .select()
        .from(shoppingItems)
        .where(eq(shoppingItems.isBought, 0));

      const found = activeInList.find(
        (i) => i.catalogId === catalogItem.id || i.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (!found) {
        const insShopping = await db
          .insert(shoppingItems)
          .values({
            catalogId: catalogItem.id,
            name: catalogItem.name,
            category: catalogItem.category,
            quantity: '1',
            unit: catalogItem.defaultUnit || 'ud',
            addedBy: addedBy ? Number(addedBy) : null,
            isBought: 0,
          })
          .returning();
        shoppingItem = insShopping[0];
      } else {
        shoppingItem = found;
      }
    }

    return new Response(
      JSON.stringify({ success: true, item: catalogItem, shoppingItem }),
      { status: 201, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
