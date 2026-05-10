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
  FolderRepository,
  AssetRepository,
  ReportRepository,
} from "../repositories";
import { getCache, handleDeleteCache, setCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";
import { FolderModel, AssetModel, ReportModel } from "../models";

export class FolderService {
  constructor(
    @repository(FolderRepository)
    public folderRepository: FolderRepository,

    @repository(AssetRepository)
    public assetRepository: AssetRepository,

    @repository(ReportRepository)
    public reportRepository: ReportRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  async create(
    userId: string,
    folder: Omit<FolderModel, "id">,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(`FolderService - create - creating a new folder`);
    folder.owner = userId;
    await handleDeleteCache({ asset: "folder", userId });
    return await this.folderRepository.create(folder);
  }

  async count(userId: string, where?: Where<FolderModel>): Promise<Count> {
    this.logger.info(`FolderService - count - getting folder count`);
    return this.folderRepository.count({
      ...where,
      or: [{ owner: userId }, { public: true }],
    });
  }

  async find(
    userId: string,
    filter?: Filter<FolderModel>,
  ): Promise<FolderModel[]> {
    if (filter?.order && filter.order.includes("name")) {
      // @ts-ignore
      filter.order = filter.order.replace("name", "nameLower");
    }

    const cachedData = await getCache(
      `folders-${userId}-${JSON.stringify(filter)}`,
    );
    if (cachedData) {
      this.logger.info(`FolderService - find - Returning cached folder list`);
      return cachedData;
    }

    this.logger.info(`FolderService - find - Fetching folders`);

    const dataToCache = await this.folderRepository.find({
      ...filter,
      where: {
        ...filter?.where,
        or: [{ owner: userId }, { public: true }],
      },
      fields: [
        "id",
        "name",
        "createdDate",
        "updatedDate",
        "public",
        "owner",
        "assets",
        "reports",
      ],
      include: [
        {
          relation: "assets",
          scope: { fields: ["id"] },
        },
        {
          relation: "reports",
          scope: { fields: ["id"] },
        },
      ],
    });
    setCache(`folders-${userId}-${JSON.stringify(filter)}`, dataToCache);
    return dataToCache;
  }

  async updateAll(
    folder: FolderModel,
    where?: Where<FolderModel>,
  ): Promise<Count> {
    this.logger.info(`FolderService - updateAll - updating all folders`);
    return this.folderRepository.updateAll(folder, where);
  }

  async findById(
    userIds: string[],
    id: string,
    filter?: FilterExcludingWhere<FolderModel>,
  ): Promise<FolderModel | { error: string }> {
    this.logger.info(`FolderService - findById - getting folder by id ${id}`);
    const folder = await this.folderRepository.findById(id, {
      ...filter,
      fields: [
        "id",
        "name",
        "createdDate",
        "updatedDate",
        "public",
        "owner",
        "assets",
        "reports",
      ],
      include: [
        {
          relation: "assets",
          scope: { fields: ["id"] },
        },
        {
          relation: "reports",
          scope: {
            fields: [
              "id",
              "name",
              "description",
              "public",
              "owner",
              "createdDate",
              "updatedDate",
            ],
          },
        },
      ],
    });
    if (folder.public || userIds.indexOf(_.get(folder, "owner", "")) !== -1) {
      return folder;
    }
    this.logger.info(`FolderService - findById - unauthorized`);
    return { error: "Unauthorized", name: folder.name };
  }

  async updateById(
    userId: string,
    id: string,
    folder: FolderModel,
  ): Promise<void | { error: string }> {
    this.logger.info(
      `FolderService - updateById - updating folder by id ${id}`,
    );
    const dbFolder = await this.folderRepository.findById(id);
    if (dbFolder.owner !== userId) {
      return { error: "Unauthorized" };
    }
    await this.folderRepository.updateById(id, {
      ...folder,
      updatedDate: new Date().toISOString(),
    });
    await handleDeleteCache({ asset: "folder", assetId: id, userId });
  }

  async replaceById(
    userId: string,
    id: string,
    folder: FolderModel,
  ): Promise<void | { error: string }> {
    this.logger.info(
      `FolderService - replaceById - updating folder by id ${id}`,
    );
    const dbFolder = await this.folderRepository.findById(id);
    if (dbFolder.owner !== userId) {
      return { error: "Unauthorized" };
    }
    this.logger.info(
      `FolderService - replaceById - replacing folder by id ${id}`,
    );
    await this.folderRepository.replaceById(id, folder);
    await handleDeleteCache({ asset: "folder", assetId: id, userId });
  }

  async deleteById(
    userId: string,
    id: string,
  ): Promise<void | { error: string }> {
    this.logger.info(
      `FolderService - deleteById - deleting folder by id ${id}`,
    );
    const dbFolder = await this.folderRepository.findById(id);
    if (dbFolder.owner !== userId) {
      return { error: "Unauthorized" };
    }
    await this.folderRepository.deleteById(id);
    await handleDeleteCache({ asset: "folder", assetId: id, userId });
  }

  async duplicate(
    userId: string,
    id: string,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(
      `FolderService - duplicate - duplicating folder by id ${id}`,
    );
    const fFolder = await this.folderRepository.findById(id);

    const newFolder = await this.folderRepository.create({
      name: `${fFolder.name} (Copy)`,
      public: false,
      owner: userId,
    });
    await handleDeleteCache({ asset: "folder", userId });
    return newFolder;
  }

  // get all folders with subfolders
  async getAllFoldersWithSubfolders(
    userId: string,
    filter?: Filter<FolderModel>,
  ): Promise<FolderModel[]> {
    this.logger.info(
      `FolderService - getAllFoldersWithSubfolders - getting all folders with subfolders`,
    );
    const folders = await this.find(userId, filter);
    const folderMap: { [key: string]: FolderModel } = {};
    folders.forEach((folder) => {
      const folderWithChildren = new FolderModel(folder);
      (folderWithChildren as any).children = [];
      folderMap[folder.id] = folderWithChildren;
    });
    const rootFolders: FolderModel[] = [];
    folders.forEach((folder) => {
      if (folder.parentId) {
        folderMap[folder.parentId].children!.push(folderMap[folder.id]);
      } else {
        rootFolders.push(folderMap[folder.id]);
      }
    });
    return rootFolders;
  }

  // get the entire root folder tree with assets and reports
  async getFolderTree(
    userId: string,
    filter?: Filter<FolderModel>,
  ): Promise<FolderModel[]> {
    this.logger.info(
      `FolderService - getFolderTree - getting folder tree with assets and reports`,
    );
    const folders = await this.find(userId, filter);
    const folderMap: { [key: string]: FolderModel } = {};
    folders.forEach((folder) => {
      const folderWithChildren = new FolderModel(folder);
      (folderWithChildren as any).children = [];
      folderMap[folder.id] = folderWithChildren;
    });
    const rootFolders: FolderModel[] = [];
    folders.forEach((folder) => {
      if (folder.parentId) {
        folderMap[folder.parentId].children!.push(folderMap[folder.id]);
      } else {
        rootFolders.push(folderMap[folder.id]);
      }
    });
    return rootFolders;
  }

  // Asset Management Methods

  async addAsset(
    userId: string,
    folderId: string,
    assetId: string,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(
      `FolderService - addAsset - adding asset ${assetId} to folder ${folderId}`,
    );

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not own this folder",
      };
    }

    // Check if user owns the asset or if asset is public/baseline
    const asset = await this.assetRepository.findById(assetId);
    if (asset.owner !== userId && !asset.public && !asset.baseline) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this asset",
      };
    }

    // Add asset to folder using the relationship accessor
    await (await this.folderRepository.assets(folderId)).link(assetId);

    // Invalidate cache
    await handleDeleteCache({ asset: "folder", assetId: folderId, userId });
    return folder;
  }

  async removeAsset(
    userId: string,
    folderId: string,
    assetId: string,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(
      `FolderService - removeAsset - removing asset ${assetId} from folder ${folderId}`,
    );

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not own this folder",
      };
    }

    // Remove asset from folder using the relationship accessor
    await (await this.folderRepository.assets(folderId)).unlink(assetId);

    // Invalidate cache
    await handleDeleteCache({ asset: "folder", assetId: folderId, userId });
    return folder;
  }

  async getAssets(userId: string, folderId: string): Promise<AssetModel[]> {
    this.logger.info(
      `FolderService - getAssets - getting assets for folder ${folderId}`,
    );

    // Check if user has access to the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId && !folder.public) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this folder",
      };
    }

    // Get all assets in the folder using the relationship accessor
    return await (await this.folderRepository.assets(folderId)).find();
  }

  // Report Management Methods

  async addReport(
    userId: string,
    folderId: string,
    reportId: string,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(
      `FolderService - addReport - adding report ${reportId} to folder ${folderId}`,
    );

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not own this folder",
      };
    }

    // Check if user owns the report or if report is public/baseline
    const report = await this.reportRepository.findById(reportId);
    if (report.owner !== userId && !report.public && !report.baseline) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this report",
      };
    }

    // Add report to folder using the relationship accessor
    await (await this.folderRepository.reports(folderId)).link(reportId);

    // Invalidate cache
    await handleDeleteCache({ asset: "folder", assetId: folderId, userId });
    return folder;
  }

  async removeReport(
    userId: string,
    folderId: string,
    reportId: string,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(
      `FolderService - removeReport - removing report ${reportId} from folder ${folderId}`,
    );

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not own this folder",
      };
    }

    // Remove report from folder using the relationship accessor
    await (await this.folderRepository.reports(folderId)).unlink(reportId);

    // Invalidate cache
    await handleDeleteCache({ asset: "folder", assetId: folderId, userId });
    return folder;
  }

  async getReports(userId: string, folderId: string): Promise<ReportModel[]> {
    this.logger.info(
      `FolderService - getReports - getting reports for folder ${folderId}`,
    );

    // Check if user has access to the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId && !folder.public) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this folder",
      };
    }

    // Get all reports in the folder using the relationship accessor
    return await (await this.folderRepository.reports(folderId)).find();
  }

  async getChildren(userId: string, folderId: string): Promise<FolderModel[]> {
    this.logger.info(
      `FolderService - getChildren - getting child folders for folder ${folderId}`,
    );

    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId && !folder.public) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this folder",
      };
    }

    return await this.folderRepository.children(folderId).find();
  }

  async getParent(
    userId: string,
    folderId: string,
  ): Promise<FolderModel | null> {
    this.logger.info(
      `FolderService - getParent - getting parent folder for folder ${folderId}`,
    );

    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId && !folder.public) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this folder",
      };
    }

    if (!folder.parentId) {
      return null;
    }

    return await this.folderRepository.parent(folderId);
  }

  async moveFolder(
    userId: string,
    folderId: string,
    newParentId?: string,
  ): Promise<void | { error: string }> {
    this.logger.info(
      `FolderService - moveFolder - moving folder ${folderId} to parent ${newParentId}`,
    );

    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      return { error: "Forbidden: You do not own this folder" };
    }

    if (newParentId) {
      const newParent = await this.folderRepository.findById(newParentId);
      if (newParent.owner !== userId) {
        return { error: "Forbidden: You do not own the target parent folder" };
      }

      if (newParentId === folderId) {
        return { error: "Cannot move folder to itself" };
      }

      const isDescendant = await this.isDescendant(folderId, newParentId);
      if (isDescendant) {
        return { error: "Cannot move folder to its own descendant" };
      }
    }

    await this.folderRepository.updateById(folderId, {
      parentId: newParentId,
      updatedDate: new Date().toISOString(),
    });

    await handleDeleteCache({ asset: "folder", assetId: folderId, userId });
  }

  private async isDescendant(
    ancestorId: string,
    descendantId: string,
  ): Promise<boolean> {
    const descendant = await this.folderRepository.findById(descendantId);

    if (!descendant.parentId) {
      return false;
    }

    if (descendant.parentId === ancestorId) {
      return true;
    }

    return this.isDescendant(ancestorId, descendant.parentId);
  }

  async getFolderPath(
    userId: string,
    folderId: string,
  ): Promise<FolderModel[]> {
    this.logger.info(
      `FolderService - getFolderPath - getting folder path for folder ${folderId}`,
    );

    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId && !folder.public) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this folder",
      };
    }

    const path: FolderModel[] = [folder];
    let currentFolder = folder;

    while (currentFolder.parentId) {
      const parent = await this.folderRepository.findById(
        currentFolder.parentId,
      );
      path.unshift(parent);
      currentFolder = parent;
    }

    return path;
  }
}
