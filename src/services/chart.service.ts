import {
  Count,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from "@loopback/repository";
import _ from "lodash";
import axios from "axios";
import fs from "fs-extra";
import { execSync } from "child_process";
import { ChartModel } from "../models";
import { ChartRepository, DatasetRepository } from "../repositories";
import { getCache, handleDeleteCache, setCache } from "../utils/redis";
import { inject } from "@loopback/core";
import { LOGGER_KEY } from "../keys";
import { Logger } from "winston";
import {
  assertCanRead,
  assertOwner,
  canRead,
  forbidden,
  omitServerManagedFields,
  withStoredServerManagedFields,
} from "../utils/access";

async function renderChart(
  chartRepository: ChartRepository,
  id: string,
  body: any,
  userIds: string[],
  logger: Logger,
  parsedDataFilesPath: string,
) {
  try {
    logger.info("fn <renderChart()> calling renderChart function");
    const chartData = id === "new" ? {} : await chartRepository.findById(id);
    if (
      id !== "new" &&
      !_.get(chartData, "public") &&
      !_.get(chartData, "baseline") &&
      userIds.indexOf(_.get(chartData, "owner", "")) === -1
    ) {
      return;
    }
    // save an object with ({...body}, chartData) with identifiers as body and chardata as json
    const ob = {
      body: { ...body },
      chartData: chartData,
    };
    logger.debug(`fn <renderChart()> Writing chart data to file- ${id}.json`);
    fs.writeFileSync(
      `./src/utils/renderChart/dist/rendering/${id}.json`,
      JSON.stringify(ob, null, 4),
    );
    // execute the ./src/utiles/renderChart/dist/index.cjs with id as the parameter
    logger.debug(`fn <renderChart()> executing renderChart for chart- ${id}`);
    execSync(
      `node ./src/utils/renderChart/dist/index.cjs ${id} ${parsedDataFilesPath}`,
      {
        timeout: 0,
        stdio: "ignore",
      },
    );
    // once the rendering is done, read the output file
    logger.debug(
      `fn <renderChart()> Reading rendered chart data from file- ${id}_rendered.json`,
    );
    const data = fs.readFileSync(
      `./src/utils/renderChart/dist/rendering/${id}_rendered.json`,
    );

    logger.debug(
      `fn <renderChart()> Reading rendered chart data from file- ${id}_rendered.json`,
    );
    logger.verbose(
      `fn <renderChart()> rendered chart data: ${data.toString()}`,
    );

    // clean temp files
    logger.debug(`fn <renderChart()> Cleaning temp files for chart- ${id}`);
    fs.removeSync(`./src/utils/renderChart/dist/rendering/${id}.json`);
    fs.removeSync(`./src/utils/renderChart/dist/rendering/${id}_rendered.json`);

    // return jsonified data
    logger.verbose(
      `fn <renderChart()> Chart with id: ${id} rendered data: ${data.toString()}`,
    );
    return JSON.parse(data.toString());
  } catch (err) {
    logger.error(
      `fn <renderChart()> Error rendering chart with id: ${id}; error:${err.toString()} `,
    );
    console.error(err);
    return { error: "Error rendering chart!" };
  }
}

export class ChartService {
  constructor(
    @repository(ChartRepository)
    public chartRepository: ChartRepository,

    @repository(DatasetRepository)
    public datasetRepository: DatasetRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  async create(
    userId: string,
    chart: Omit<ChartModel, "id">,
  ): Promise<ChartModel> {
    this.logger.info(`ChartService - create - Creating chart: ${chart.name}`);
    await handleDeleteCache({ asset: "chart", userId });
    return this.chartRepository.create({
      ...omitServerManagedFields(chart),
      owner: userId,
    });
  }

  async sampleData(
    datasetId: string,
    userIds: string[],
    backendApiBaseUrl: string,
  ) {
    const dataset = await this.datasetRepository.findById(datasetId);
    assertCanRead(
      dataset,
      userIds,
      "Forbidden: You do not have access to this dataset",
    );
    const cachedData = await getCache(`dataset-sample-data-${datasetId}`);
    if (cachedData) {
      this.logger.info(
        `ChartService - sampleData - Returning cached sample data for dataset ${datasetId}`,
      );
      return cachedData;
    }
    this.logger.info(
      `ChartService - sampleData - Fetching sample data for dataset ${datasetId}`,
    );
    return axios
      .get(`${backendApiBaseUrl}/sample-data/${datasetId}`)
      .then((res) => {
        this.logger.info(
          `ChartService - sampleData - Sample data fetched for dataset ${datasetId}`,
        );
        const dataToCache = {
          count: _.get(res, "data.result.count", []),
          sample: _.get(res, "data.result.sample", []),
          dataTypes: _.get(res, "data.result.dataTypes", []),
          filterOptionGroups: _.get(res, "data.result.filterOptionGroups", []),
          stats: _.get(res, "data.result.stats", []),
        };
        setCache(`dataset-sample-data-${datasetId}`, dataToCache);
        return dataToCache;
      })
      .catch((e) => {
        console.log(e);
        this.logger.error(
          `ChartService - sampleData - Error fetching sample data for dataset ${datasetId}; ${e.response.data.result}`,
        );
        return {
          data: [],
          error: e.response.data.result,
        };
      });
  }

  async totalCount(): Promise<Count> {
    this.logger.verbose(
      `ChartService - totalCount - Fetching total chart count`,
    );
    return this.chartRepository.count();
  }

  async count(userId: string, where?: Where<ChartModel>): Promise<Count> {
    this.logger.verbose(`ChartService - count - Fetching chart count`);
    return this.chartRepository.count({
      ...where,
      or: [{ owner: userId }, { public: true }, { baseline: true }],
    });
  }

  async find(
    userId: string,
    filter?: Filter<ChartModel>,
  ): Promise<ChartModel[]> {
    if (filter?.order && filter.order.includes("name")) {
      // @ts-ignore
      filter.order = filter.order.replace("name", "nameLower");
    }

    const cachedData = await getCache(
      `charts-${userId}-${JSON.stringify(filter)}`,
    );
    if (cachedData) {
      this.logger.info(`ChartService - find - Returning cached charts list`);
      return cachedData;
    }

    this.logger.info(`ChartService - find - Fetching charts`);
    const dataToCache = await this.chartRepository.find({
      ...filter,
      where: {
        ...filter?.where,
        or: [{ owner: userId }, { public: true }, { baseline: true }],
      },
      fields: [
        "id",
        "name",
        "vizType",
        "datasetId",
        "public",
        "createdDate",
        "updatedDate",
        "isMappingValid",
        "isAIAssisted",
        "owner",
      ],
    });
    setCache(`charts-${userId}-${JSON.stringify(filter)}`, dataToCache);
    return dataToCache;
  }

  async getChartTypes(id: string, aiApiBaseUrl: string) {
    this.logger.info(
      `ChartService - getChartTypes - Fetching AI suggestions for chart type`,
    );
    const cachedData = await getCache(`chart-types-ai-suggestions-${id}`);
    if (cachedData) {
      this.logger.info(
        `ChartService - getChartTypes - Returning cached AI suggestions`,
      );
      return cachedData;
    }
    try {
      const response = await axios.get(
        `${aiApiBaseUrl}/chart-suggest/ai-report-builder-from-existing?id=${id}`,
        {
          headers: {
            Authorization: "ZIMMERMAN",
          },
        },
      );
      this.logger.info(
        `ChartService - getChartTypes - AI suggestions fetched returning ${JSON.stringify(
          response.data,
        )}`,
      );
      const result = response.data.result;
      const parsedResult = result.map((r: string) => JSON.parse(r));
      const lowercaseParsedResult = parsedResult.map(
        (r: any, index: number) => {
          const newObject: any = {};
          Object.keys(r).forEach((key: string) => {
            newObject[key.toLowerCase()] = r[key];
          });
          return newObject;
        },
      );
      setCache(`chart-types-ai-suggestions-${id}`, lowercaseParsedResult);
      return lowercaseParsedResult;
    } catch (e) {
      console.log(e, "error");
      return { error: "Error fetching AI suggestions" };
    }
  }

  async updateAll(
    chart: ChartModel,
    where?: Where<ChartModel>,
  ): Promise<Count> {
    this.logger.info(
      `ChartService - updateAll - Updating chart - ${chart.id}; where: ${JSON.stringify(
        where,
      )}`,
    );
    return this.chartRepository.updateAll(chart, where);
  }

  async findById(
    id: string,
    userIds: string[],
    filter?: FilterExcludingWhere<ChartModel>,
  ): Promise<ChartModel> {
    this.logger.info(`ChartService - findById - Fetching chart - ${id}`);
    this.logger.debug(
      `Finding chart - ${id} with filter - ${JSON.stringify(filter)}`,
    );
    // The `chart-detail-<id>` prefix lets handleDeleteCache clear every filter
    // variant when the chart changes. The key is shared by all users, so cached
    // charts need the same access check as fresh ones.
    const cacheKey = `chart-detail-${id}-${JSON.stringify(filter)}`;
    const cachedData = await getCache(cacheKey);
    const chart: ChartModel =
      cachedData ?? (await this.chartRepository.findById(id, filter));
    if (!canRead(chart, userIds)) {
      this.logger.error(
        `ChartService - findById - Unauthorized access to chart - ${id}`,
      );
      throw forbidden("Forbidden: You do not have access to this chart");
    }
    if (cachedData) {
      this.logger.info(
        `ChartService - findById - Returning cached chart - ${id}`,
      );
    } else {
      this.logger.info(`ChartService - findById - Chart - ${id} found`);
      setCache(cacheKey, chart);
    }
    return chart;
  }

  async updateById(
    id: string,
    userId: string,
    chart: ChartModel,
  ): Promise<ChartModel> {
    const dbChart = await this.chartRepository.findById(id);
    assertOwner(dbChart, userId, "Forbidden: You do not own this chart");

    await this.chartRepository.updateById(id, {
      ...omitServerManagedFields(chart),
      updatedDate: new Date().toISOString(),
    });
    this.logger.info(`ChartService - updateById - Updating chart - ${id}`);
    await handleDeleteCache({
      asset: "chart",
      assetId: id,
      userId,
    });
    return this.chartRepository.findById(id);
  }

  async replaceById(
    id: string,
    userId: string,
    chart: ChartModel,
  ): Promise<void> {
    const dbChart = await this.chartRepository.findById(id);
    assertOwner(dbChart, userId, "Forbidden: You do not own this chart");
    this.logger.info(`ChartService - replaceById - Replacing chart - ${id}`);
    await this.chartRepository.replaceById(
      id,
      withStoredServerManagedFields(chart, dbChart),
    );
    await handleDeleteCache({
      asset: "chart",
      assetId: id,
      userId,
    });
  }

  async deleteById(id: string, userId: string): Promise<void> {
    const dbChart = await this.chartRepository.findById(id);
    assertOwner(dbChart, userId, "Forbidden: You do not own this chart");
    this.logger.info(`ChartService - deleteById - Deleting chart - ${id}`);
    await this.chartRepository.deleteById(id);
    await handleDeleteCache({
      asset: "chart",
      assetId: id,
      userId,
    });
  }

  async duplicate(id: string, userId: string): Promise<ChartModel> {
    this.logger.info(`ChartService - duplicate - Duplicating chart - ${id}`);
    const fChart = await this.chartRepository.findById(id);
    assertCanRead(
      fChart,
      [userId],
      "Forbidden: You do not have access to this chart",
    );

    const newChart = await this.chartRepository.create({
      name: `${fChart.name} (Copy)`,
      public: false,
      baseline: false,
      vizType: fChart.vizType,
      datasetId: fChart.datasetId,
      mapping: fChart.mapping,
      vizOptions: fChart.vizOptions,
      appliedFilters: fChart.appliedFilters,
      enabledFilterOptionGroups: fChart.enabledFilterOptionGroups,
      owner: userId,
      isMappingValid: fChart.isMappingValid ?? true,
      isAIAssisted: fChart.isAIAssisted ?? false,
    });
    await handleDeleteCache({ asset: "chart", userId });

    return newChart;
  }

  async renderById(
    id: string,
    userId: string,
    body: { rows: any[] },
    parsedDataFilesPath: string,
  ) {
    this.logger.info(`ChartService - renderById - Rendering chart - ${id}`);
    const chartData =
      id === "new"
        ? { datasetId: body.rows[0][0].datasetId }
        : await this.chartRepository.findById(id);
    if (id !== "new") {
      assertCanRead(
        chartData as ChartModel,
        [userId],
        "Forbidden: You do not have access to this chart",
      );
    }

    let parsed = null;

    try {
      const parsedData = fs.readFileSync(
        `${parsedDataFilesPath}${chartData.datasetId}.json`,
      );
      parsed = JSON.parse(parsedData.toString());
    } catch (err) {
      this.logger.error(
        `ChartService - renderById - Error fetching parsed data for dataset - ${chartData.datasetId}`,
      );
      console.error(err);
    }

    if (!parsed?.dataset) {
      this.logger.error(
        `ChartService - renderById - could not find parsed dataset with id - ${chartData.datasetId}`,
      );
      return {
        error: "The data for this chart is no longer available.",
      };
    }

    return renderChart(
      this.chartRepository,
      id,
      body,
      [userId],
      this.logger,
      parsedDataFilesPath,
    );
  }
}
