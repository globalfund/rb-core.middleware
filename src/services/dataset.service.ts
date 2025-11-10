import { inject } from "@loopback/core";
import { Filter, repository } from "@loopback/repository";
import axios from "axios";
import { DatasetModel } from "../models";
import {
  ChartRepository,
  ReportRepository,
  DatasetRepository,
} from "../repositories";
import { handleDeleteCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";

export class DatasetService {
  constructor(
    @repository(DatasetRepository)
    public datasetRepository: DatasetRepository,

    @repository(ChartRepository)
    public chartRepository: ChartRepository,

    @repository(ReportRepository)
    public reportRepository: ReportRepository,

    @inject(LOGGER_KEY) private logger: Logger
  ) {}

  async create(
    userId: string,
    dataset: Omit<DatasetModel, "id">
  ): Promise<DatasetModel | { error: string; errorType: string }> {
    dataset.owner = userId;
    this.logger.info(`DatasetService - create - Creating dataset`);
    await handleDeleteCache({ userId, asset: "dataset" });
    return await this.datasetRepository.create(dataset);
  }

  async find(filter?: Filter<DatasetModel>): Promise<DatasetModel[]> {
    this.logger.info(`DatasetService - find - Fetching datasets`);
    return this.datasetRepository.find(filter);
  }

  async datasetContent(
    id: string,
    page: string,
    pageSize: string,
    backendApiBaseUrl: string
  ): Promise<any> {
    this.logger.info(
      `DatasetService - datasetContent - get dataset content by id: ${id}`
    );
    return axios
      .get(
        `${backendApiBaseUrl}/dataset/${id}?page=${page}&page_size=${pageSize}`
      )
      .then((res) => {
        this.logger.info(
          `DatasetService - datasetContent - Data fetched for dataset ${id}`
        );
        return res.data;
      })
      .catch((error) => {
        console.log(error);
        this.logger.error(
          `DatasetService - datasetContent - Error fetching data for dataset ${id}; ${error}`
        );
        return { data: [], error };
      });
  }

  async getChartAndReportCount(
    id: string
  ): Promise<{ chartCount: number; reportCount: number } | { error: string }> {
    this.logger.info(
      `DatasetService - getChartAndReportCount - get chart & report count by dataset id: ${id}`
    );

    const chartIds = (
      await this.chartRepository.find({ where: { datasetId: id } })
    ).map((c) => c.id);
    return {
      chartCount: (await this.chartRepository.count({ datasetId: id })).count,
      reportCount: (await this.reportRepository.execute?.(
        "ReportModel",
        "countDocuments",
        { "rows.items": { $in: chartIds } }
      )) as unknown as number,
    };
  }
}
