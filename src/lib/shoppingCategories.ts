import type { ShoppingCategoryType } from '../db/schema';

export interface CategoryMeta {
  name: ShoppingCategoryType;
  icon: string;
  color: string;
  bgColor: string;
}

export const CATEGORY_METAS: Record<ShoppingCategoryType, CategoryMeta> = {
  'Frutas y Verduras': {
    name: 'Frutas y Verduras',
    icon: '🍎',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/15 border-emerald-500/30',
  },
  'Lácteos y Huevos': {
    name: 'Lácteos y Huevos',
    icon: '🥛',
    color: 'text-amber-300',
    bgColor: 'bg-amber-500/15 border-amber-500/30',
  },
  'Carnicería y Charcutería': {
    name: 'Carnicería y Charcutería',
    icon: '🥩',
    color: 'text-rose-400',
    bgColor: 'bg-rose-500/15 border-rose-500/30',
  },
  'Pescadería': {
    name: 'Pescadería',
    icon: '🐟',
    color: 'text-cyan-400',
    bgColor: 'bg-cyan-500/15 border-cyan-500/30',
  },
  'Panadería y Cereales': {
    name: 'Panadería y Cereales',
    icon: '🥖',
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/15 border-yellow-500/30',
  },
  'Despensa y Conservas': {
    name: 'Despensa y Conservas',
    icon: '🥫',
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/15 border-orange-500/30',
  },
  'Bebidas': {
    name: 'Bebidas',
    icon: '🥤',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/15 border-blue-500/30',
  },
  'Limpieza y Hogar': {
    name: 'Limpieza y Hogar',
    icon: '🧹',
    color: 'text-teal-400',
    bgColor: 'bg-teal-500/15 border-teal-500/30',
  },
  'Higiene y Cuidado': {
    name: 'Higiene y Cuidado',
    icon: '🧴',
    color: 'text-pink-400',
    bgColor: 'bg-pink-500/15 border-pink-500/30',
  },
  'Congelados': {
    name: 'Congelados',
    icon: '❄️',
    color: 'text-sky-300',
    bgColor: 'bg-sky-500/15 border-sky-500/30',
  },
  'Snacks y Dulces': {
    name: 'Snacks y Dulces',
    icon: '🍫',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/15 border-purple-500/30',
  },
  'Otros': {
    name: 'Otros',
    icon: '📦',
    color: 'text-slate-400',
    bgColor: 'bg-slate-500/15 border-slate-500/30',
  },
};

const KEYWORDS_MAP: Array<{ category: ShoppingCategoryType; keywords: string[] }> = [
  {
    category: 'Frutas y Verduras',
    keywords: [
      'manzana', 'platano', 'plátano', 'naranja', 'pera', 'limon', 'limón', 'fresa', 'uva',
      'tomate', 'lechuga', 'cebolla', 'ajo', 'patata', 'papa', 'zanahoria', 'calabacin',
      'calabacín', 'pimiento', 'aguacate', 'pepino', 'espinaca', 'champinon', 'champiñón',
      'seta', 'fruta', 'verdura', 'ensalada', 'kiwi', 'mandarina', 'sandia', 'sandía', 'melon', 'melón',
    ],
  },
  {
    category: 'Lácteos y Huevos',
    keywords: [
      'leche', 'queso', 'yogur', 'huevo', 'huevos', 'mantequilla', 'nata', 'cuajada',
      'parmesano', 'mozzarella', 'gouda', 'kefir', 'kéfir',
    ],
  },
  {
    category: 'Carnicería y Charcutería',
    keywords: [
      'pollo', 'carne', 'ternera', 'cerdo', 'pavo', 'jamon', 'jamón', 'lomo', 'bacon', 'beicon',
      'chorizo', 'salchicha', 'hamburguesa', 'picada', 'pechuga', 'solomillo', 'alitas', 'embutido',
    ],
  },
  {
    category: 'Pescadería',
    keywords: [
      'pescado', 'salmon', 'salmón', 'merluza', 'atun', 'atún', 'gamba', 'langostino', 'dorada',
      'lubina', 'calamar', 'sepia', 'mejillon', 'mejillón', 'bacalao', 'sardina',
    ],
  },
  {
    category: 'Panadería y Cereales',
    keywords: [
      'pan', 'barra', 'baguette', 'tostada', 'tostadas', 'cereal', 'cereales', 'avena',
      'croissant', 'bollo', 'muesli', 'galleta', 'galletas', 'harina', 'levadura',
    ],
  },
  {
    category: 'Despensa y Conservas',
    keywords: [
      'arroz', 'pasta', 'macarron', 'macarrón', 'espagueti', 'fideo', 'legumbre', 'lenteja',
      'garbanzo', 'alubia', 'aceite', 'oliva', 'girasol', 'vinagre', 'sal', 'azucar', 'azúcar',
      'tomate frito', 'conserva', 'lata', 'atun en lata', 'mayonesa', 'ketchup', 'mostaza',
      'cafe', 'café', 'te', 'té', 'infusion', 'infusión', 'caldo', 'especias',
    ],
  },
  {
    category: 'Bebidas',
    keywords: [
      'agua', 'refresco', 'coca', 'fanta', 'cerveza', 'vino', 'zumo', 'jugo', 'tonica',
      'tónica', 'gaseosa', 'aquarius', 'nestea', 'batido',
    ],
  },
  {
    category: 'Limpieza y Hogar',
    keywords: [
      'detergente', 'suavizante', 'fregasuelos', 'fregona', 'bayeta', 'estropajo', 'lavavajillas',
      'fairy', 'lejia', 'lejía', 'pastillas lavavajillas', 'papel higienico', 'papel higiénico',
      'papel de cocina', 'servilleta', 'servilletas', 'bolsa de basura', 'bolsas basura', 'albal',
      'papel aluminio', 'film', 'limpiador', 'insecticida', 'ambientador',
    ],
  },
  {
    category: 'Higiene y Cuidado',
    keywords: [
      'champu', 'champú', 'gel', 'jabon', 'jabón', 'pasta de dientes', 'dentifrico', 'dentífrico',
      'cepillo dientes', 'desodorante', 'crema', 'colonia', 'cuchilla', 'afeitado', 'toallitas',
      'tampon', 'compresa', 'protector',
    ],
  },
  {
    category: 'Congelados',
    keywords: [
      'congelado', 'congelados', 'helado', 'hielo', 'guisantes congelados', 'pizzas congeladas',
      'nuggets', 'croquetas',
    ],
  },
  {
    category: 'Snacks y Dulces',
    keywords: [
      'patatas fritas', 'chips', 'doritos', 'frutos secos', 'nueces', 'almendras', 'pistachos',
      'chocolate', 'chocolatina', 'caramelo', 'chucheria', 'chuchería', 'palomitas',
    ],
  },
];

export function detectShoppingCategory(productName: string): ShoppingCategoryType {
  const normalized = productName
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  for (const group of KEYWORDS_MAP) {
    for (const kw of group.keywords) {
      const normKw = kw
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');
      const regex = new RegExp(`\\b${normKw}`, 'i');
      if (regex.test(normalized)) {
        return group.category;
      }
    }
  }

  return 'Otros';
}
