import type { APIRoute } from 'astro';
import { db, initializeDatabase } from '../../../db/client';
import { shoppingItems, users, type ShoppingCategoryType } from '../../../db/schema';
import { eq, desc, asc } from 'drizzle-orm';
import { detectShoppingCategory } from '../../../lib/shoppingCategories';

export const prerender = false;

export const GET: APIRoute = async () => {
  try {
    await initializeDatabase();

    // Query shopping items with addedBy user and boughtBy user info
    const items = await db
      .select({
        id: shoppingItems.id,
        name: shoppingItems.name,
        category: shoppingItems.category,
        quantity: shoppingItems.quantity,
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
    const { name, category, quantity, notes, addedBy } = body;

    if (!name || !name.trim()) {
      return new Response(
        JSON.stringify({ success: false, error: 'El nombre del producto es obligatorio.' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const trimmedName = name.trim();
    // If category is not provided or 'Otros', try to detect automatically
    const finalCategory: ShoppingCategoryType =
      category && category !== 'Otros'
        ? (category as ShoppingCategoryType)
        : detectShoppingCategory(trimmedName);

    const inserted = await db
      .insert(shoppingItems)
      .values({
        name: trimmedName,
        category: finalCategory,
        quantity: quantity ? String(quantity).trim() : null,
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
