# rb-core-middleware

## Overview

`rb-core-middleware` provides core middleware components for working with charts, datasets, and reports, including Redis caching and logging utilities. Built for LoopBack, it integrates with data models, repositories, and services for scalable data visualization and reporting.

## Folder Structure

- **component.ts**: Main entry point for the middleware component, handles Redis connection and component setup.
- **keys.ts**: Defines binding keys for LoopBack dependency injection, including the logger.
- **types.ts**: TypeScript interfaces and default options for component configuration.
- **models/**: Data models for charts, datasets, and reports.
- **repositories/**: CRUD repositories for models, with hooks for data normalization.
- **services/**: Business logic for charts, datasets, and reports, including rendering and cache management.
- **providers/logger.provider.ts**: Winston logger provider for structured logging.
- **utils/redis.ts**: Redis cache utility functions.
- **utils/renderChart/**: Chart rendering utilities, including integration with RAWGraphs.

## Installation

```bash
npm install rb-core-middleware
```

Or clone the repository and install dependencies:

```bash
git clone https://github.com/globalfund/rb-core-middleware.git
cd rb-core-middleware
npm install
```

## Usage

Register the middleware component in your LoopBack application:

```typescript
import { RbCoreMiddlewareComponent } from "rb-core-middleware";

// In your application constructor
this.component(RbCoreMiddlewareComponent);
```

Configure Redis and logging via environment variables or options:

```typescript
const options = {
  REDIS_PORT: "6379",
  REDIS_HOST: "127.0.0.1",
  REDIS_PASSWORD: "",
  REDIS_USERNAME: "",
  datasourceDB: myDataSource,
};
new RbCoreMiddlewareComponent(options);
```

## API Documentation

### Models

- **ChartModel**: Chart entity with properties for name, visibility, and mapping validity.
- **DatasetModel**: Dataset entity with properties for name, description, and visibility.
- **ReportModel**: Report entity with properties for name, title, and header configuration.

### Repositories

- **ChartRepository, DatasetRepository, ReportRepository**: Extend LoopBack's `DefaultCrudRepository` for model persistence and normalization.

### Services

- **ChartService**: Handles chart creation, rendering, and caching.
- **DatasetService**: Handles dataset creation and cache management.
- **ReportService**: Handles report creation, rendering, and caching.

### Utilities

- **Redis**: Functions for cache management and key deletion.
- **Logger**: Winston-based logging provider.
- **RenderChart**: Integrates with RAWGraphs for chart rendering.

## Example

```typescript
// Example: Creating a chart and caching the result
const chartService = new ChartService(/* dependencies */);
const chart = await chartService.create(userId, chartData);
const rendered = await chartService.renderChart(
  chart.id,
  renderOptions,
  [userId],
  logger
);
```

## License

See [LICENSE](LICENSE) for details.
