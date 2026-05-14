# Boardy

Centro de mando personal: dashboard de links, inventario de cuentas y scope-tracker.

App web local. Vos la corrés en tu máquina, los datos viven en `data/*.json` dentro del propio repo, y cuando querés respaldarlos hacés `git push`.

## Requisitos

- Node.js 18+ (probado con 24)
- npm

## Primera vez

```powershell
npm install
```

## Uso diario

```powershell
npm run dev
```

Abre dos procesos:

- **Cliente** (Vite) en `http://localhost:5173` — abrila en el browser.
- **Server** (Express) en `http://localhost:5174` — guarda los JSON al disco.

Hacé un acceso directo en el escritorio o en la barra de tareas a `http://localhost:5173` para que se sienta más como una app.

Para parar todo: `Ctrl+C` en la terminal.

## Estructura

```
data/             # tus datos — versionados en git
  links.json      # dashboard de links agrupados
  accounts.json   # inventario de cuentas y plataformas
  todos.json      # pendientes / scope-tracker

src/              # frontend (React + Tailwind)
  pages/
    Dashboard.tsx
    Accounts.tsx
    Todos.tsx

server/
  server.ts       # mini server Express que lee/escribe data/*.json
```

## Respaldo / sync

Como los datos son archivos JSON dentro del repo, basta con commitearlos:

```powershell
git add data
git commit -m "update data"
git push
```

Si trabajás desde otra máquina, cloná y `git pull` para traer los últimos datos.

## Build de producción (opcional)

Si querés correr una sola cosa en lugar de dos procesos:

```powershell
npm run build
$env:NODE_ENV = "production"
npm run start
```

Eso compila el frontend y el server lo sirve desde el mismo puerto (5174).
