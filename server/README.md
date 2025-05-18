# Server

This directory contains the Express backend for the HR system.

## Setup

```bash
npm install
```

Create a `.env` file based on `.env.example` and set the `PORT` and MongoDB connection string `MONGODB_URI`.

## Development

```bash
npm run dev
```

This starts the server with nodemon enabled.

## API Documentation

After starting the server, Swagger UI is available at:

```
http://localhost:3000/api-docs
```
