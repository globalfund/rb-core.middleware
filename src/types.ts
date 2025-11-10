import { DataSource } from "loopback-datasource-juggler";

/**
 * Interface defining the component's options object
 */
export interface RbCoreMiddlewareComponentOptions {
  REDIS_PORT?: string;
  REDIS_HOST?: string;
  REDIS_PASSWORD?: string;
  REDIS_USERNAME?: string;
  datasourceDB?: DataSource;
}

/**
 * Default options for the component
 */
export const DEFAULT_RB_CORE_MIDDLEWARE_OPTIONS: RbCoreMiddlewareComponentOptions =
  {
    REDIS_PORT: "6379",
    REDIS_HOST: "127.0.0.1",
    REDIS_PASSWORD: "",
    REDIS_USERNAME: "",
  };
