# Server

This directory contains the Express backend for the HR system.

## Setup

```bash
npm install
```

Create a `.env` file based on `.env.example` and set the following variables:

- `PORT` – port for the HTTP server
- `MONGODB_URI` – MongoDB connection string
- `JWT_SECRET` – (optional) secret used to sign JSON Web Tokens

To run the unit tests:

```bash
npm test
```

## Development

```bash
npm run dev
```

This starts the server with nodemon enabled.

### Seeding example data

You can create a script under `scripts/seed.js` to insert initial users or reference data into MongoDB. Run it with:

```bash
node scripts/seed.js
```
