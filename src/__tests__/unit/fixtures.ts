import { juggler } from "@loopback/repository";
import { expect } from "@loopback/testlab";
import { Logger } from "winston";
import * as component from "../../component";
import {
  AssetRepository,
  ChartRepository,
  DatasetRepository,
  FolderRepository,
  ReportRepository,
} from "../../repositories";
import {
  AssetService,
  ChartService,
  DatasetService,
  FolderService,
  ReportService,
} from "../../services";

export const OWNER = "auth0|owner";
export const OTHER = "auth0|other";

/** In-memory stand-in for the subset of the redis client used by utils/redis. */
class FakeRedisClient {
  store = new Map<string, string>();

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.store.set(key, value);
    return "OK";
  }

  async del(keys: string | string[]) {
    const list = Array.isArray(keys) ? keys : [keys];
    return list.filter((key) => this.store.delete(key)).length;
  }

  async keys(pattern: string) {
    const regex = new RegExp(
      `^${pattern
        .split("*")
        .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
        .join(".*")}$`,
    );
    return [...this.store.keys()].filter((key) => regex.test(key));
  }
}

const silentLogger = {
  info: () => undefined,
  error: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
  verbose: () => undefined,
} as unknown as Logger;

/**
 * Wires the real repositories and services against a fresh in-memory
 * datasource and a fake redis client.
 */
export function givenServices() {
  const redisClient = new FakeRedisClient();
  Object.assign(component, { redisClient });

  const dataSource = new juggler.DataSource({
    name: "db",
    connector: "memory",
  });

  // The getters are only called lazily, after every repository exists.
  const folderRepository: FolderRepository = new FolderRepository(
    dataSource,
    async () => assetRepository,
    async () => reportRepository,
    async () => folderRepository,
  );
  const assetRepository = new AssetRepository(
    dataSource,
    async () => folderRepository,
  );
  const reportRepository = new ReportRepository(
    dataSource,
    async () => folderRepository,
  );
  const chartRepository = new ChartRepository(dataSource);
  const datasetRepository = new DatasetRepository(dataSource);

  return {
    redisClient,
    assetRepository,
    chartRepository,
    datasetRepository,
    folderRepository,
    reportRepository,
    reportService: new ReportService(
      reportRepository,
      datasetRepository,
      chartRepository,
      folderRepository,
      silentLogger,
    ),
    assetService: new AssetService(
      assetRepository,
      folderRepository,
      silentLogger,
    ),
    folderService: new FolderService(
      folderRepository,
      assetRepository,
      reportRepository,
      silentLogger,
    ),
    datasetService: new DatasetService(
      datasetRepository,
      chartRepository,
      reportRepository,
      silentLogger,
    ),
    chartService: new ChartService(
      chartRepository,
      datasetRepository,
      silentLogger,
    ),
  };
}

export async function expectStatus(promise: Promise<unknown>, status: number) {
  await expect(promise).to.be.rejectedWith({ statusCode: status });
}

export const chartData = (overrides: object = {}) => ({
  name: "Chart",
  vizType: "bar",
  datasetId: "dataset-1",
  mapping: {},
  vizOptions: {},
  ...overrides,
});
