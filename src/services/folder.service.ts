import { inject } from "@loopback/core";
import {
  Count,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from "@loopback/repository";
import _, { uniqueId } from "lodash";
import { FolderRepository } from "../repositories";
import { getCache, handleDeleteCache, setCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";
import { FolderModel } from "../models";

export class FolderService {
  constructor(
    @repository(FolderRepository)
    public folderRepository: FolderRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  async create(
    userId: string,
    folder: Omit<FolderModel, "id">,
  ): Promise<FolderModel | { error: string; errorType: string }> {
    this.logger.info(`FolderService - create - creating a new folder`);
    folder.owner = userId;
    await handleDeleteCache({ asset: "asset", userId });
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
      fields: ["id", "name", "createdDate", "updatedDate", "public"],
    });
    setCache(`folders-${userId}-${JSON.stringify(filter)}`, dataToCache);
    return dataToCache;
  }

  async updateAll(
    asset: FolderModel,
    where?: Where<FolderModel>,
  ): Promise<Count> {
    this.logger.info(`FolderService - updateAll - updating all folders`);
    return this.folderRepository.updateAll(asset, where);
  }

  async findById(
    userIds: string[],
    id: string,
    filter?: FilterExcludingWhere<FolderModel>,
  ): Promise<FolderModel | { error: string }> {
    this.logger.info(`FolderService - findById - getting folder by id ${id}`);
    const folder = await this.folderRepository.findById(id, filter);
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
    await handleDeleteCache({ asset: "asset", assetId: id, userId });
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
    await handleDeleteCache({ asset: "asset", assetId: id, userId });
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
    await handleDeleteCache({ asset: "asset", assetId: id, userId });
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
}
