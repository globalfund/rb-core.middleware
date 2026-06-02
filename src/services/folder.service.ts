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

    // const cachedData = await getCache(
    //   `folders-${userId}-${JSON.stringify(filter)}`,
    // );
    // if (cachedData) {
    //   this.logger.info(`FolderService - find - Returning cached folder list`);
    //   return cachedData;
    // }

    this.logger.info(`FolderService - find - Fetching folders`);

    const findFilter = {
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
        "parentId",
        "type",
      ],
    };
    const folders = await this.folderRepository.find(findFilter as any);
    const folderIds = folders.map((f) => f.id);

    const [assets, reports, childFolders] = await Promise.all([
      this.assetRepository.find({
        where: { folderId: { inq: folderIds } },
        fields: ["id", "name", "folderId"],
      }),
      this.reportRepository.find({
        where: { folderId: { inq: folderIds } },
        fields: ["id", "name", "folderId"],
      }),
      this.folderRepository.find({
        where: { parentId: { inq: folderIds } },
        fields: ["id", "name", "parentId"],
      }),
    ]);

    const assetsByFolder: { [key: string]: AssetModel[] } = {};
    assets.forEach((a) => {
      const fid = (a as any).folderId;
      if (!fid) return;
      if (!assetsByFolder[fid]) assetsByFolder[fid] = [];
      assetsByFolder[fid].push(a);
    });

    const reportsByFolder: { [key: string]: ReportModel[] } = {};
    reports.forEach((r) => {
      const fid = (r as any).folderId;
      if (!fid) return;
      if (!reportsByFolder[fid]) reportsByFolder[fid] = [];
      reportsByFolder[fid].push(r);
    });

    const childrenByFolder: { [key: string]: FolderModel[] } = {};
    childFolders.forEach((c) => {
      const pid = (c as any).parentId;
      if (!pid) return;
      if (!childrenByFolder[pid]) childrenByFolder[pid] = [];
      childrenByFolder[pid].push(c);
    });

    const dataToCache = folders.map((f) => {
      const obj = (f as any).toJSON ? (f as any).toJSON() : { ...f };
      obj.assets = assetsByFolder[f.id] || [];
      obj.reports = reportsByFolder[f.id] || [];
      obj.children = childrenByFolder[f.id] || [];
      return obj;
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
        "parentId",
      ],
    });
    if (
      !(folder.public || userIds.indexOf(_.get(folder, "owner", "")) !== -1)
    ) {
      this.logger.info(`FolderService - findById - unauthorized`);
      return { error: "Unauthorized", name: folder.name } as any;
    }

    const [assets, reports, children] = await Promise.all([
      this.assetRepository.find({
        where: { folderId: id },
        fields: ["id", "name"],
      }),
      this.reportRepository.find({
        where: { folderId: id },
        fields: [
          "id",
          "name",
          "description",
          "public",
          "owner",
          "createdDate",
          "updatedDate",
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
      }),
      this.find(userIds[0], { where: { parentId: id } }),
    ]);

    const obj: any = (folder as any).toJSON
      ? (folder as any).toJSON()
      : { ...folder };
    obj.assets = assets;
    obj.reports = reports;
    obj.children = children;

    // inject locationPath field to be used in frontend for breadcrumbs for assets, reports, and child folders
    const injectLocationPath = (item: any, parentPath: string = "") => {
      const currentPath = parentPath
        ? `${parentPath} > ${item.name}`
        : item.name;
      item.locationPath = currentPath;
      if (item.assets) {
        item.assets.forEach((asset: any) => {
          asset.locationPath = currentPath;
        });
      }
      if (item.reports) {
        item.reports.forEach((report: any) => {
          report.locationPath = currentPath;
        });
      }
      if (item.children) {
        item.children.forEach((child: any) => {
          child.locationPath = currentPath;
        });
      }
    };

    injectLocationPath(obj, "My Workspace");

    return obj;
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
      type: fFolder.type,
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

    // Set the asset's folderId
    await this.assetRepository.updateById(assetId, {
      folderId,
      updatedDate: new Date().toISOString(),
    });

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

    // Remove asset from folder by clearing its folderId (only if it matches)
    const asset = await this.assetRepository.findById(assetId);
    if (asset.folderId === folderId) {
      await this.assetRepository.updateById(assetId, {
        folderId: undefined,
        updatedDate: new Date().toISOString(),
      });
    }

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
    reportPrevFolderId?: string,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(
      `FolderService - addReport - adding report ${reportId} to folder ${folderId}`,
    );

    if (folderId === "__root__") {
      await this.reportRepository.updateById(reportId, {
        folderId: undefined,
        updatedDate: new Date().toISOString(),
      });
      await handleDeleteCache({ asset: "stories", userId });
      if (reportPrevFolderId) {
        await handleDeleteCache({
          userId,
          asset: "folder",
          assetId: reportPrevFolderId,
        });
      }
      return { id: "__root__", name: "My Workspace" } as FolderModel;
    }

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

    // Set the report's folderId
    await this.reportRepository.updateById(reportId, {
      folderId,
      updatedDate: new Date().toISOString(),
    });

    // Invalidate cache
    await handleDeleteCache({ asset: "folder", assetId: folderId, userId });
    if (reportPrevFolderId) {
      await handleDeleteCache({
        asset: "folder",
        assetId: reportPrevFolderId,
        userId,
      });
    }
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

    // Remove report from folder by clearing its folderId (only if it matches)
    const report = await this.reportRepository.findById(reportId);
    if (report.folderId === folderId) {
      await this.reportRepository.updateById(reportId, {
        folderId: undefined,
        updatedDate: new Date().toISOString(),
      });
    }

    // Invalidate cache
    await handleDeleteCache({ asset: "folder", assetId: folderId, userId });
    return folder;
  }

  async addFolder(
    userId: string,
    parentFolderId: string,
    folderItemId: string,
    folderPrevFolderId?: string,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(
      `FolderService - addFolder - adding folder ${folderItemId} to folder ${parentFolderId}`,
    );

    if (parentFolderId === "__root__") {
      await this.folderRepository.updateById(folderItemId, {
        parentId: undefined,
        updatedDate: new Date().toISOString(),
      });
      await handleDeleteCache({ asset: "folders", userId });
      if (folderPrevFolderId) {
        await handleDeleteCache({
          userId,
          asset: "folder",
          assetId: folderPrevFolderId,
        });
      }
      return { id: "__root__", name: "My Workspace" } as FolderModel;
    }

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(parentFolderId);
    if (folder.owner !== userId) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not own this folder",
      };
    }

    // Check if user owns the folder or if folder is public/baseline
    const folderItem = await this.folderRepository.findById(folderItemId);
    if (folderItem.owner !== userId && !folderItem.public) {
      throw {
        statusCode: 403,
        message: "Forbidden: You do not have access to this folder",
      };
    }

    // Set the folder's parentId
    await this.folderRepository.updateById(folderItemId, {
      parentId: parentFolderId,
      updatedDate: new Date().toISOString(),
    });

    // Invalidate cache
    await handleDeleteCache({
      asset: "folder",
      assetId: parentFolderId,
      userId,
    });
    if (folderPrevFolderId) {
      await handleDeleteCache({
        asset: "folder",
        assetId: folderPrevFolderId,
        userId,
      });
    }
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
