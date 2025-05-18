# HR System

This repository contains a simple HR management application.
It is split into two parts:

- **client** – Vue.js front-end
- **server** – Express back-end

## Server Overview

The server now requires two environment variables at startup:
`PORT` and `MONGODB_URI`. If either is missing, the application
prints an error and exits. Cross-Origin Resource Sharing (CORS)
is enabled by default via the [`cors`](https://www.npmjs.com/package/cors) package.

See [server/README.md](server/README.md) for detailed setup instructions.

## Client Overview

The client is a standard Vite project. See
[client/README.md](client/README.md) for commands and usage.
