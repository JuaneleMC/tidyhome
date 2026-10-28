import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { shoppingItems, shoppingCatalog, users, type ShoppingCategoryType } from '../../../db/schema';
import { eq, desc, asc, and } from 'drizzle-orm';
import { detectShoppingCategory, detectDefaultUnit } from '../../../lib/shoppingCategories';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    await initializeDatabase();

    // Query shopping items with addedBy user and boughtBy user info
    const items = await db
      .select({
        id: shoppingItems.id,
        catalogId: shoppingItems.catalogId,
        name: shoppingItems.name,
        category: shoppingItems.category,
        quantity: shoppingItems.quantity,
        unit: shoppingItems.unit,
        notes: shoppingItems.notes,
        addedById: shoppingItems.addedBy,
        isBought: shoppingItems.isBought,
        boughtById: shoppingItems.boughtBy,
        boughtAt: shoppingItems.boughtAt,
        createdAt: shoppingItems.createdAt,
        addedByName: users.name,
        addedByAvatar: users.avatar,
        addedByColor: users.color,
      })
      .from(shoppingItems)
      .leftJoin(users, eq(shoppingItems.addedBy, users.id))
      .orderBy(asc(shoppingItems.isBought), desc(shoppingItems.id));

    // Also get users to map boughtBy names if needed
    const allUsers = await db.select().from(users);
    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const formattedItems = items.map((item) => {
      const boughtUser = item.boughtById ? userMap.get(item.boughtById) : null;
      return {
        ...item,
        isBought: Boolean(item.isBought),
        quantity: item.quantity || '1',
        unit: item.unit || 'ud',
        boughtByName: boughtUser?.name || null,
        boughtByAvatar: boughtUser?.avatar || null,
        boughtByColor: boughtUser?.color || null,
      };
    });

    return new Response(JSON.stringify({ success: true, items: formattedItems }), {
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
    let { catalogId, name, category, quantity, unit, notes, addedBy } = body;

    let targetCatalogId: number | null = catalogId ? Number(catalogId) : null;

    // Si viene catalogId, buscar el artículo del catálogo para autocompletar si falta algo
    if (targetCatalogId) {
      const catRes = await db
        .select()
        .from(shoppingCatalog)
        .where(eq(shoppingCatalog.id, targetCatalogId))
        .limit(1);

      if (catRes.length > 0) {
        const cat = catRes[0];
        if (!name) name = cat.name;
        if (!category || category === 'Otros') category = cat.category;
        if (!unit) unit = cat.defaultUnit;
      }
    }

    if (!name || !name.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'El nombre del producto es obligatorio.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const trimmedName = name.trim();
    const finalCategory: ShoppingCategoryType =
      category && category !== 'Otros'
        ? (category as ShoppingCategoryType)
        : detectShoppingCategory(trimmedName);

    const finalUnit: string =
      unit && unit.trim()
        ? unit.trim()
        : detectDefaultUnit(trimmedName);

    const finalQty: string = quantity && String(quantity).trim() ? String(quantity).trim() : '1';

    // Si no teníamos targetCatalogId, buscar o crear en shoppingCatalog para guardarlo en "Artículos en uso"
    if (!targetCatalogId) {
      const catExisting = await db
        .select()
        .from(shoppingCatalog)
        .where(eq(shoppingCatalog.name, trimmedName))
        .limit(1);

      if (catExisting.length > 0) {
        targetCatalogId = catExisting[0].id;
      } else {
        const newCat = await db
          .insert(shoppingCatalog)
          .values({
            name: trimmedName,
            category: finalCategory,
            defaultUnit: finalUnit,
            defaultQty: 1,
          })
          .returning();
        if (newCat.length > 0) {
          targetCatalogId = newCat[0].id;
        }
      }
    }

    // Comprobar si ya existe en la lista de la compra pendiente (isBought = 0)
    const existingShopping = await db
      .select()
      .from(shoppingItems)
      .where(
        targetCatalogId
          ? and(eq(shoppingItems.catalogId, targetCatalogId), eq(shoppingItems.isBought, 0))
          : and(eq(shoppingItems.name, trimmedName), eq(shoppingItems.isBought, 0))
      )
      .limit(1);

    if (existingShopping.length > 0) {
      // Si ya está pendiente, aumentamos la cantidad en 1 si fue un tap simple
      const current = existingShopping[0];
      const parsedNum = parseInt(current.quantity || '1', 10);
      const newQty = !isNaN(parsedNum) ? String(parsedNum + 1) : '2';

      const updated = await db
        .update(shoppingItems)
        .set({
          quantity: newQty,
          unit: finalUnit || current.unit || 'ud',
          notes: notes !== undefined ? (notes ? String(notes).trim() : null) : current.notes,
        })
        .where(eq(shoppingItems.id, current.id))
        .returning();

      return new Response(JSON.stringify({ success: true, item: updated[0], updatedQty: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const inserted = await db
      .insert(shoppingItems)
      .values({
        catalogId: targetCatalogId,
        name: trimmedName,
        category: finalCategory,
        quantity: finalQty,
        unit: finalUnit,
        notes: notes ? String(notes).trim() : null,
        addedBy: addedBy ? Number(addedBy) : null,
        isBought: 0,
      })
      .returning();

    return new Response(JSON.stringify({ success: true, item: inserted[0] }), {
      status: 201,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
