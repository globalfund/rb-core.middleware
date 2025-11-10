import { injectable, Component, config, ContextTags } from "@loopback/core";
import { LOGGER_KEY, RbCoreMiddlewareComponentBindings } from "./keys";
import {
  DEFAULT_RB_CORE_MIDDLEWARE_OPTIONS,
  RbCoreMiddlewareComponentOptions,
} from "./types";
import { ChartModel, DatasetModel, ReportModel } from "./models";
import {
  ChartRepository,
  DatasetRepository,
  ReportRepository,
} from "./repositories";
import { createClient } from "redis";
import { LoggerProvider } from "./providers/logger.provider";
import { ChartService, DatasetService, ReportService } from "./services";

export let redisClient: ReturnType<typeof createClient>;

const redisConnection = async (options: RbCoreMiddlewareComponentOptions) => {
  const url = `redis://${options.REDIS_USERNAME}:${options.REDIS_PASSWORD}@${options.REDIS_HOST}:${options.REDIS_PORT}`;

  redisClient = createClient({ url });

  redisClient.on("error", (error) => console.error(`RedisError : ${error}`));

  await redisClient.connect();
};

@injectable({
  tags: { [ContextTags.KEY]: RbCoreMiddlewareComponentBindings.COMPONENT },
})
export class RbCoreMiddlewareComponent implements Component {
  constructor(
    @config()
    private options: RbCoreMiddlewareComponentOptions = DEFAULT_RB_CORE_MIDDLEWARE_OPTIONS
  ) {
    redisConnection(this.options).catch((error) => {
      console.error("Redis Connection Error: ", error);
    });
    this.datasources = {
      "datasources.db": this.options.datasourceDB,
    };
  }

  datasources;

  providers = {
    [LOGGER_KEY.key]: LoggerProvider,
  };

  models = [ChartModel, DatasetModel, ReportModel];
  services = [ChartService, ReportService, DatasetService];
  repositories = [ChartRepository, DatasetRepository, ReportRepository];
}
