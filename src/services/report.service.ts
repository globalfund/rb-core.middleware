import { inject } from "@loopback/core";
import {
  Count,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from "@loopback/repository";
import {
  ChartRepository,
  DatasetRepository,
  FolderRepository,
  ReportRepository,
} from "../repositories";
import { getCache, handleDeleteCache, setCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";
import { ReportModel, FolderModel } from "../models";
import {
  assertCanRead,
  assertOwner,
  omitServerManagedFields,
  withStoredServerManagedFields,
} from "../utils/access";

export class ReportService {
  constructor(
    @repository(ReportRepository)
    public reportRepository: ReportRepository,

    @repository(DatasetRepository)
    public datasetRepository: DatasetRepository,

    @repository(ChartRepository)
    public chartRepository: ChartRepository,

    @repository(FolderRepository)
    public folderRepository: FolderRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  async create(
    userId: string,
    report: Omit<ReportModel, "id">,
  ): Promise<ReportModel> {
    this.logger.info(`ReportService - create - creating a new report`);
    const data = omitServerManagedFields(report);
    if (data.folderId) {
      const folder = await this.folderRepository.findById(data.folderId);
      assertOwner(folder, userId, "Forbidden: You do not own this folder");
    }
    await handleDeleteCache({ asset: "story", userId });
    return this.reportRepository.create({ ...data, owner: userId });
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

    // const cachedData = await getCache(
    //   `stories-${userId}-${JSON.stringify(filter)}`,
    // );
    // if (cachedData) {
    //   this.logger.info(`ReportService - find - Returning cached report list`);
    //   return cachedData;
    // }

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
        "folderId",
      ],
      include: [
        {
          relation: "folder",
          scope: {
            fields: ["id", "name"],
            include: [
              {
                relation: "parent",
                scope: {
                  fields: ["id", "name"],
                },
              },
            ],
          },
        },
      ],
    });
    setCache(`stories-${userId}-${JSON.stringify(filter)}`, dataToCache);
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
  ): Promise<ReportModel> {
    this.logger.info(`ReportService - findById - getting report by id ${id}`);
    const report = await this.reportRepository.findById(id, filter);
    assertCanRead(
      report,
      userIds,
      "Forbidden: You do not have access to this report",
    );
    return report;
  }

  async updateById(
    userId: string,
    id: string,
    report: ReportModel,
  ): Promise<void> {
    this.logger.info(
      `ReportService - updateById - updating report by id ${id}`,
    );
    const dbReport = await this.reportRepository.findById(id);
    assertOwner(dbReport, userId, "Forbidden: You do not own this report");
    // Folder moves go through FolderService.addReport.
    await this.reportRepository.updateById(id, {
      ...omitServerManagedFields(report, ["folderId"]),
      updatedDate: new Date().toISOString(),
    });
    await handleDeleteCache({ asset: "story", assetId: id, userId });
  }

  async replaceById(
    userId: string,
    id: string,
    report: ReportModel,
  ): Promise<void> {
    this.logger.info(
      `ReportService - replaceById - updating report by id ${id}`,
    );
    const dbReport = await this.reportRepository.findById(id);
    assertOwner(dbReport, userId, "Forbidden: You do not own this report");
    this.logger.info(
      `ReportService - replaceById - replacing report by id ${id}`,
    );
    await this.reportRepository.replaceById(
      id,
      withStoredServerManagedFields(report, dbReport, ["folderId"]),
    );
    await handleDeleteCache({ asset: "story", assetId: id, userId });
  }

  async deleteById(userId: string, id: string): Promise<void> {
    this.logger.info(
      `ReportService - deleteById - deleting report by id ${id}`,
    );
    const dbReport = await this.reportRepository.findById(id);
    assertOwner(dbReport, userId, "Forbidden: You do not own this report");
    await this.reportRepository.deleteById(id);
    await handleDeleteCache({ asset: "story", assetId: id, userId });
  }

  async duplicate(userId: string, id: string): Promise<ReportModel> {
    this.logger.info(
      `ReportService - duplicate - duplicating report by id ${id}`,
    );
    const fReport = await this.reportRepository.findById(id);
    assertCanRead(
      fReport,
      [userId],
      "Forbidden: You do not have access to this report",
    );
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
    await handleDeleteCache({ asset: "story", userId });
    return newStory;
  }

  async addToFolder(
    userId: string,
    reportId: string,
    folderId: string,
  ): Promise<void> {
    this.logger.info(
      `ReportService - addToFolder - adding report ${reportId} to folder ${folderId}`,
    );

    // Check if user owns the report
    const report = await this.reportRepository.findById(reportId);
    if (report.owner !== userId) {
      const error = new Error("Forbidden");
      (error as any).statusCode = 403;
      throw error;
    }

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      const error = new Error("Forbidden");
      (error as any).statusCode = 403;
      throw error;
    }

    // Set the report's folderId
    await this.reportRepository.updateById(reportId, {
      folderId,
      updatedDate: new Date().toISOString(),
    });

    // Invalidate cache
    await handleDeleteCache({ asset: "story", assetId: reportId, userId });
  }

  async removeFromFolder(
    userId: string,
    reportId: string,
    folderId: string,
  ): Promise<void> {
    this.logger.info(
      `ReportService - removeFromFolder - removing report ${reportId} from folder ${folderId}`,
    );

    // Check if user owns the report
    const report = await this.reportRepository.findById(reportId);
    if (report.owner !== userId) {
      const error = new Error("Forbidden");
      (error as any).statusCode = 403;
      throw error;
    }

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      const error = new Error("Forbidden");
      (error as any).statusCode = 403;
      throw error;
    }

    // Only unset if it's actually in the given folder
    if (report.folderId !== folderId) {
      return;
    }

    await this.reportRepository.updateById(reportId, {
      folderId: undefined,
      updatedDate: new Date().toISOString(),
    });

    // Invalidate cache
    await handleDeleteCache({ asset: "story", assetId: reportId, userId });
  }

  async getFolder(
    userId: string,
    reportId: string,
  ): Promise<FolderModel | null> {
    this.logger.info(
      `ReportService - getFolder - getting folder for report ${reportId}`,
    );

    // Check if user owns the report or if it's public/baseline
    const report = await this.reportRepository.findById(reportId);
    if (!report.public && !report.baseline && report.owner !== userId) {
      const error = new Error("Forbidden");
      (error as any).statusCode = 403;
      throw error;
    }

    if (!report.folderId) {
      return null;
    }

    return await this.reportRepository.folder(reportId);
  }
}
