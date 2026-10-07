# 🏠 TidyHome - Reparto Inteligente y Flexible de Tareas del Hogar (PWA)

Aplicación web progresiva (PWA) desarrollada con **Astro**, **TypeScript**, **Tailwind CSS** y **Drizzle ORM** conectada a base de datos serverless (Turso/SQLite), diseñada para repartir las tareas del hogar entre convivientes con total flexibilidad.

---

## ✨ Características Principales

1. **📱 Enfoque Mobile-First (PWA):**
   - Interfaz táctil optimizada para teléfonos móviles y tablets.
   - Barra de navegación inferior fija (*Bottom Nav*) con 4 secciones: **Mi Panel**, **Casa**, **Catálogo** y **Convivientes**.
   - Selector inmediato de perfil activo en la cabecera (cambia de conviviente con un toque sin fricción de login).
   - Manifiesto PWA (`manifest.webmanifest`) y Service Worker (`sw.js`).

2. **⚡ Ejecución Flexible ("¡Lo hago yo!"):**
   - Si un conviviente tiene tiempo libre y hace una tarea asignada a otro, pulsa **"¡Lo hago yo! ⚡"** en la vista de Dashboard.
   - El sistema registra la tarea como `completed`, guarda la fecha exacta (`execution_date`) y asigna a la persona real que la ejecutó en el campo `executed_by`.
   - Se muestra un badge distintivo *"⚡ Hecho por [Nombre]"* y se suma al podio en la sección de *"Robos solidarios"*.

3. **📅 Sincronización y Generador Semanal Automático:**
   - Lee el catálogo de tareas y calcula las fechas objetivo basándose en su periodicidad:
     - **Diaria (`daily`):** Se programa para cada uno de los 7 días de la semana.
     - **Semanal (`weekly`):** Se programa en el día específico de la semana según la configuración de la tarea (ej. Lunes, Miércoles, Sábado).
     - **Quincenal (`biweekly`):** Se programa cada 2 semanas según la paridad de la semana.
     - **Mensual (`monthly`):** Se programa en la primera semana del mes.
   - Asigna automáticamente al responsable por defecto y evita duplicados si la tarea ya existe en esa fecha.

4. **📊 Vista "Mi Panel" (Personal):**
   - Resumen diario con barra de progreso interactiva (ej. "2 de 3 hechas hoy").
   - Filtros rápidos: **Hoy** (incluye alertas de tareas atrasadas de días previos), **Esta Semana** y **Completadas**.
   - Botón interactivo táctil para completar con animación de confeti.

5. **🏠 Vista "Casa / Dashboard" (Global):**
   - Vista agrupada por **Días de la Semana** (Lunes a Domingo con indicador destacado en el día de hoy) o por **Conviviente**.
   - Código de colores claro: pendientes en ámbar/naranja, completadas en verde esmeralda.
   - Botón de acción rápida con estados de carga (*Loading spinners*) y confirmaciones visuales (*Toast notifications*).

6. **🏆 Podio y Estadísticas de Convivientes:**
   - Ranking semanal con medallas (🥇, 🥈, 🥉), tareas asignadas, completadas y "robos solidarios".
   - Alta de nuevos convivientes con avatar emoji y color distintivo.

7. **📋 Catálogo Configurable:**
   - Alta, edición y eliminación de tareas recurrentes con selector de iconos emoji, categorías (Cocina, Salón, Baño, Colada...) y días preferidos.

---

## 🗄️ Esquema de Base de Datos (Drizzle ORM)

- **`users`:**
  - `id` (INTEGER, Primary Key autoincremental)
  - `name` (TEXT)
  - `email` (TEXT, Único)
  - `avatar` (TEXT, Emoji o icono)
  - `color` (TEXT, Código de color distintivo)
  - `created_at` (TEXT)

- **`chore_catalog`:**
  - `id` (INTEGER, Primary Key autoincremental)
  - `name` (TEXT)
  - `frequency` (TEXT: `'daily' | 'twice_weekly' | 'weekly' | 'biweekly' | 'monthly'`)
  - `assignment_mode` (TEXT: `'fixed'` para asignación fija, `'rotating'` para rotativa semanal)
  - `default_assignee_id` (INTEGER, Foreign Key -> `users.id`, responsable habitual o base de inicio)
  - `icon` (TEXT)
  - `category` (TEXT)
  - `day_of_week` (INTEGER: primer día asignado, 0 = Domingo, 1 = Lunes, ...)
  - `second_day_of_week` (INTEGER: segundo día para tareas de 2 veces/semana)
  - `created_at` (TEXT)

- **`chore_log`:**
  - `id` (INTEGER, Primary Key autoincremental)
  - `chore_id` (INTEGER, Foreign Key -> `chore_catalog.id`)
  - `target_date` (TEXT: Formato `YYYY-MM-DD`)
  - `status` (TEXT: `'pending' | 'completed'`)
  - `assigned_to` (INTEGER, Foreign Key -> `users.id`)
  - `executed_by` (INTEGER, Foreign Key -> `users.id`, Nullable)
  - `execution_date` (TEXT, Timestamp ISO de ejecución)
  - `notes` (TEXT)
  - `created_at` (TEXT)

---

## ☁️ Conexión Serverless Gratuita (Turso / SQLite)

La aplicación soporta de forma nativa la base de datos serverless gratuita de **Turso** mediante `@libsql/client`.

### Opción A: Modo Local Automático (Sin configuración)
Si no defines variables de entorno, la app creará y usará automáticamente un archivo SQLite local (`file:local.db`).

### Opción B: Conexión con Turso Cloud (Base de datos en la nube)
1. Crea una cuenta gratuita en [Turso](https://turso.tech) e instala su CLI o usa su panel web:
   ```bash
   turso db create tareas-hogar
   ```
2. Obtén la URL y el token de autenticación:
   ```bash
   turso db show tareas-hogar --url
   turso db tokens create tareas-hogar
   ```
3. Crea un archivo `.env` en la raíz del proyecto (toma como base `.env.example`):
   ```env
   TURSO_DATABASE_URL="libsql://tu-base-de-datos.turso.io"
   TURSO_AUTH_TOKEN="tu-token-aqui"
   ```
4. Aplica el esquema con Drizzle Kit:
   ```bash
   npm run db:push
   ```

---

## 🚀 Comandos de Ejecución

```bash
# Instalar dependencias
npm install

# Inicializar datos de prueba (4 convivientes y catálogo inicial)
npm run db:seed

# Iniciar servidor de desarrollo en modo background (según reglas del proyecto)
astro dev --background

# Ver estado o logs del servidor
astro dev status
astro dev logs

# Generar o subir cambios de base de datos
npm run db:generate
npm run db:push

# Construir para producción
npm run build
```

---

## 🌐 Endpoints de la API

| Método | Endpoint | Descripción |
| :--- | :--- | :--- |
| `POST` / `GET` | `/api/chores/generate` | Genera y sincroniza automáticamente las tareas de la semana desde el catálogo |
| `POST` | `/api/chores/execute` | Ejecución flexible: recibe `choreLogId`, `userId` y `desiredStatus`. Permite registrar al ejecutor real aunque no sea el asignado original |
| `GET` | `/api/chores/my-tasks?userId=X` | Obtiene tareas de hoy, atrasadas y de la semana del usuario activo |
| `GET` | `/api/chores/dashboard` | Obtiene el estado general de la casa agrupado por días y convivientes con contadores |
| `GET` / `POST` | `/api/users` | Lista o crea nuevos convivientes |
| `GET` / `POST` | `/api/catalog` | Lista o crea nuevas tareas en el catálogo |
| `DELETE` / `PUT` | `/api/catalog/:id` | Elimina o actualiza tareas en el catálogo |
