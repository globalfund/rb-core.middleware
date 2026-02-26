import { inject } from "@loopback/core";
import {
  Count,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from "@loopback/repository";
import _ from "lodash";
import {
  ChartRepository,
  DatasetRepository,
  ReportRepository,
} from "../repositories";
import { getCache, handleDeleteCache, setCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";
import { ReportModel } from "../models";

export class ReportService {
  constructor(
    @repository(ReportRepository)
    public reportRepository: ReportRepository,

    @repository(DatasetRepository)
    public datasetRepository: DatasetRepository,

    @repository(ChartRepository)
    public chartRepository: ChartRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  async create(
    userId: string,
    report: Omit<ReportModel, "id">,
  ): Promise<ReportModel | { error: string; errorType: string }> {
    this.logger.info(`ReportService - create - creating a new report`);
    report.owner = userId;
    await handleDeleteCache({ asset: "report", userId });
    return await this.reportRepository.create(report);
  }

  async count(userId: string, where?: Where<ReportModel>): Promise<Count> {
    this.logger.info(`ReportService - count - getting report count`);
    return this.reportRepository.count({
      ...where,
      or: [{ owner: userId }, { public: true }, { baseline: true }],
    });
  }

  async find(
    userId: string,
    filter?: Filter<ReportModel>,
  ): Promise<ReportModel[]> {
    if (filter?.order && filter.order.includes("name")) {
      // @ts-ignore
      filter.order = filter.order.replace("name", "nameLower");
    }

    const cachedData = await getCache(
      `report-list-${userId}-${JSON.stringify(filter)}`,
    );
    if (cachedData) {
      this.logger.info(`ReportService - find - Returning cached report list`);
      return cachedData;
    }

    this.logger.info(`ReportService - find - Fetching reports`);

    const dataToCache = await this.reportRepository.find({
      ...filter,
      where: {
        ...filter?.where,
        or: [{ owner: userId }, { public: true }, { baseline: true }],
      },
      fields: [
        "id",
        "name",
        "createdDate",
        "updatedDate",
        "description",
        "public",
        "baseline",
        "settings",
      ],
    });
    setCache(`report-list-${userId}-${JSON.stringify(filter)}`, dataToCache);
    return dataToCache;
  }

  async updateAll(
    report: ReportModel,
    where?: Where<ReportModel>,
  ): Promise<Count> {
    this.logger.info(`ReportService - updateAll - updating all reports`);
    return this.reportRepository.updateAll(report, where);
  }

  async findById(
    userIds: string[],
    id: string,
    filter?: FilterExcludingWhere<ReportModel>,
  ): Promise<ReportModel | { error: string }> {
    this.logger.info(`ReportService - findById - getting report by id ${id}`);
    const report = await this.reportRepository.findById(id, filter);
    if (
      report.public ||
      report.baseline ||
      userIds.indexOf(_.get(report, "owner", "")) !== -1
    ) {
      return report;
    }
    this.logger.info(`ReportService - findById - unauthorized`);
    return { error: "Unauthorized", name: report.name };
  }

  async updateById(
    userId: string,
    id: string,
    report: ReportModel,
  ): Promise<void | { error: string }> {
    this.logger.info(
      `ReportService - updateById - updating report by id ${id}`,
    );
    const dbReport = await this.reportRepository.findById(id);
    if (dbReport.owner !== userId) {
      return { error: "Unauthorized" };
    }
    await this.reportRepository.updateById(id, {
      ...report,
      updatedDate: new Date().toISOString(),
    });
    await handleDeleteCache({ asset: "report", assetId: id, userId });
  }

  async replaceById(
    userId: string,
    id: string,
    report: ReportModel,
  ): Promise<void | { error: string }> {
    this.logger.info(
      `ReportService - replaceById - updating report by id ${id}`,
    );
    const dbReport = await this.reportRepository.findById(id);
    if (dbReport.owner !== userId) {
      return { error: "Unauthorized" };
    }
    this.logger.info(
      `ReportService - replaceById - replacing report by id ${id}`,
    );
    await this.reportRepository.replaceById(id, report);
    await handleDeleteCache({ asset: "report", assetId: id, userId });
  }

  async deleteById(
    userId: string,
    id: string,
  ): Promise<void | { error: string }> {
    this.logger.info(
      `ReportService - deleteById - deleting report by id ${id}`,
    );
    this.logger.info(
      `ReportService - deleteById - updating report by id ${id}`,
    );
    const dbReport = await this.reportRepository.findById(id);
    if (dbReport.owner !== userId) {
      return { error: "Unauthorized" };
    }
    await this.reportRepository.deleteById(id);
    await handleDeleteCache({ asset: "report", assetId: id, userId });
  }

  async duplicate(
    userId: string,
    id: string,
  ): Promise<ReportModel | { error: string; errorType: string }> {
    this.logger.info(
      `ReportService - duplicate - duplicating report by id ${id}`,
    );
    const fReport = await this.reportRepository.findById(id);
    // Duplicate Story
    const newStory = await this.reportRepository.create({
      name: `${fReport.name} (Copy)`,
      description: fReport.description,
      items: fReport.items,
      public: false,
      baseline: false,
      owner: userId,
      settings: fReport.settings,
    });
    await handleDeleteCache({ asset: "report", userId });
    return newStory;
  }
}
