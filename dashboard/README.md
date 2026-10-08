# FayFort dashboard

This is the permanent Layer 7 dashboard foundation. Its navigation follows the official Layer 7 module map; pages stay visibly in progress until their FastAPI control workflows are implemented.

From this directory, once npm dependencies install:

- npm run dev starts the dashboard.
- npm run test:ui runs the component checks.
- npm run test:e2e runs browser checks.
- npm run build checks TypeScript and builds the production assets.

The dashboard is not yet connected to operational APIs. Do not treat placeholder module screens as working controls.