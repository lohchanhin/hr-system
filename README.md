# HR System


This repository contains a simple HR management system split into two main packages:

- **`client/`** – a Vue 3 application powered by Vite.
- **`server/`** – an Express backend that exposes a REST API.

The client communicates with the server through the API endpoints under `/api`. The server persists data to MongoDB and serves JSON responses consumed by the front end.

## Getting Started

Each part has its own README with full instructions. Below is a quick overview.

### Server

1. Navigate to `server/` and install dependencies:
   ```bash
   npm install
   ```
2. Copy `.env.example` to `.env` and adjust the `PORT` and `MONGODB_URI` values.
3. Start the development server with nodemon:
   ```bash
   npm run dev
   ```

For more details see [`server/README.md`](server/README.md).

### Client

1. Navigate to `client/` and install dependencies:
   ```bash
   npm install
   ```
2. Run the Vite development server:
   ```bash
   npm run dev
   ```
3. Build for production when needed:
   ```bash
   npm run build
   ```

See [`client/README.md`](client/README.md) for additional notes.

## Project Structure

```
/
├── client/  # Vue 3 front‑end
└── server/  # Express REST API
```

Both directories are independent Node.js projects. Run the above setup commands in each before development. Once both are running, the Vue app will make requests to the API server to fetch and manipulate HR data.

