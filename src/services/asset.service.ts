import { inject } from "@loopback/core";
import {
  Count,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from "@loopback/repository";
import { uniqueId } from "lodash";
import { AssetRepository, FolderRepository } from "../repositories";
import { getCache, handleDeleteCache, setCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";
import { AssetModel, FolderModel } from "../models";
import {
  assertCanRead,
  assertOwner,
  forbidden,
  omitServerManagedFields,
  withStoredServerManagedFields,
} from "../utils/access";

export class AssetService {
  constructor(
    @repository(AssetRepository)
    public assetRepository: AssetRepository,

    @repository(FolderRepository)
    public folderRepository: FolderRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  async create(
    userId: string,
    asset: Omit<AssetModel, "id">,
  ): Promise<AssetModel> {
    this.logger.info(`AssetService - create - creating a new asset`);
    const data = omitServerManagedFields(asset);
    if (data.folderId) {
      const folder = await this.folderRepository.findById(data.folderId);
      assertOwner(folder, userId, "Forbidden: You do not own this folder");
    }
    await handleDeleteCache({ asset: "asset", userId });
    return this.assetRepository.create({ ...data, owner: userId });
  }

  async count(userId: string, where?: Where<AssetModel>): Promise<Count> {
    this.logger.info(`AssetService - count - getting asset count`);
    return this.assetRepository.count({
      ...where,
      or: [{ owner: userId }, { public: true }, { baseline: true }],
    });
  }

  async find(
    userId: string,
    filter?: Filter<AssetModel>,
  ): Promise<AssetModel[]> {
    if (filter?.order && filter.order.includes("name")) {
      // @ts-ignore
      filter.order = filter.order.replace("name", "nameLower");
    }

    // const cachedData = await getCache(
    //   `assets-${userId}-${JSON.stringify(filter)}`,
    // );
    // if (cachedData) {
    //   this.logger.info(`AssetService - find - Returning cached asset list`);
    //   return cachedData;
    // }

    this.logger.info(`AssetService - find - Fetching assets`);

    const dataToCache = await this.assetRepository.find({
      ...filter,
      where: {
        ...filter?.where,
        or: [{ owner: userId }, { public: true }, { baseline: true }],
      },
      fields: [
        "id",
        "name",
        "description",
        "type",
        "options",
        "data",
        "createdDate",
        "updatedDate",
        "public",
        "baseline",
        "folderId",
      ],
    });
    setCache(`assets-${userId}-${JSON.stringify(filter)}`, dataToCache);
    return dataToCache;
  }

  async updateAll(
    asset: AssetModel,
    where?: Where<AssetModel>,
  ): Promise<Count> {
    this.logger.info(`AssetService - updateAll - updating all assets`);
    return this.assetRepository.updateAll(asset, where);
  }

  async findById(
    userIds: string[],
    id: string,
    filter?: FilterExcludingWhere<AssetModel>,
  ): Promise<AssetModel> {
    this.logger.info(`AssetService - findById - getting asset by id ${id}`);
    const asset = await this.assetRepository.findById(id, filter);
    assertCanRead(
      asset,
      userIds,
      "Forbidden: You do not have access to this asset",
    );
    return asset;
  }

  async updateById(
    userId: string,
    id: string,
    asset: AssetModel,
  ): Promise<void> {
    this.logger.info(`AssetService - updateById - updating asset by id ${id}`);
    const dbAsset = await this.assetRepository.findById(id);
    assertOwner(dbAsset, userId, "Forbidden: You do not own this asset");
    // Folder moves go through FolderService.addAsset.
    await this.assetRepository.updateById(id, {
      ...omitServerManagedFields(asset, ["folderId"]),
      updatedDate: new Date().toISOString(),
    });
    await handleDeleteCache({ asset: "asset", assetId: id, userId });
  }

  async replaceById(
    userId: string,
    id: string,
    asset: AssetModel,
  ): Promise<void> {
    this.logger.info(`AssetService - replaceById - updating asset by id ${id}`);
    const dbAsset = await this.assetRepository.findById(id);
    assertOwner(dbAsset, userId, "Forbidden: You do not own this asset");
    this.logger.info(
      `AssetService - replaceById - replacing asset by id ${id}`,
    );
    await this.assetRepository.replaceById(
      id,
      withStoredServerManagedFields(asset, dbAsset, ["folderId"]),
    );
    await handleDeleteCache({ asset: "asset", assetId: id, userId });
  }

  async deleteById(userId: string, id: string): Promise<void> {
    this.logger.info(`AssetService - deleteById - deleting asset by id ${id}`);
    const dbAsset = await this.assetRepository.findById(id);
    assertOwner(dbAsset, userId, "Forbidden: You do not own this asset");
    await this.assetRepository.deleteById(id);
    await handleDeleteCache({ asset: "asset", assetId: id, userId });
  }

  async duplicate(userId: string, id: string): Promise<AssetModel> {
    this.logger.info(
      `AssetService - duplicate - duplicating asset by id ${id}`,
    );
    const fAsset = await this.assetRepository.findById(id);
    assertCanRead(
      fAsset,
      [userId],
      "Forbidden: You do not have access to this asset",
    );
    // Duplicate Asset

    let data;

    if (fAsset.type === "grid" || fAsset.type === "column") {
      data = {
        ...fAsset.data,
        items: (fAsset.data as any)?.items?.map((item: any) => ({
          ...item,
          id: uniqueId(),
        })),
      };
    } else {
      data = fAsset.data;
    }
    const newAsset = await this.assetRepository.create({
      name: `${fAsset.name} (Copy)`,
      description: fAsset.description,
      type: fAsset.type,
      options: fAsset.options,
      data: data,
      public: false,
      baseline: false,
      owner: userId,
    });
    await handleDeleteCache({ asset: "asset", userId });
    return newAsset;
  }

  async addToFolder(
    userId: string,
    assetId: string,
    folderId: string,
  ): Promise<void> {
    this.logger.info(
      `AssetService - addToFolder - adding asset ${assetId} to folder ${folderId}`,
    );

    // Check if user owns the asset
    const asset = await this.assetRepository.findById(assetId);
    if (asset.owner !== userId) {
      this.logger.info(
        `AssetService - addToFolder - user does not own asset ${assetId}`,
      );
      throw forbidden("Forbidden: You do not own this asset");
    }

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      this.logger.info(
        `AssetService - addToFolder - user does not own folder ${folderId}`,
      );
      throw forbidden("Forbidden: You do not own this folder");
    }

    // Set the asset's folderId
    await this.assetRepository.updateById(assetId, {
      folderId,
      updatedDate: new Date().toISOString(),
    });

    // Invalidate cache
    await handleDeleteCache({ asset: "asset", assetId, userId });
  }

  async removeFromFolder(
    userId: string,
    assetId: string,
    folderId: string,
  ): Promise<void> {
    this.logger.info(
      `AssetService - removeFromFolder - removing asset ${assetId} from folder ${folderId}`,
    );

    // Check if user owns the asset
    const asset = await this.assetRepository.findById(assetId);
    if (asset.owner !== userId) {
      this.logger.info(
        `AssetService - removeFromFolder - user does not own asset ${assetId}`,
      );
      throw forbidden("Forbidden: You do not own this asset");
    }

    // Check if user owns the folder
    const folder = await this.folderRepository.findById(folderId);
    if (folder.owner !== userId) {
      this.logger.info(
        `AssetService - removeFromFolder - user does not own folder ${folderId}`,
      );
      throw forbidden("Forbidden: You do not own this folder");
    }

    // Only unset if the asset is actually in the given folder
    if (asset.folderId !== folderId) {
      return;
    }

    await this.assetRepository.updateById(assetId, {
      folderId: undefined,
      updatedDate: new Date().toISOString(),
    });

    // Invalidate cache
    await handleDeleteCache({ asset: "asset", assetId, userId });
  }

  async getFolder(
    userId: string,
    assetId: string,
  ): Promise<FolderModel | null> {
    this.logger.info(
      `AssetService - getFolder - getting folder for asset ${assetId}`,
    );

    // Check if user owns the asset or if it's public/baseline
    const asset = await this.assetRepository.findById(assetId);
    if (!asset.public && !asset.baseline && asset.owner !== userId) {
      this.logger.info(
        `AssetService - getFolder - user does not have access to asset ${assetId}`,
      );
      throw forbidden("Forbidden: You do not have access to this asset");
    }

    if (!asset.folderId) {
      return null;
    }

    const folder = await this.assetRepository.folder(assetId);
    if (folder.owner !== userId) {
      return null;
    }
    return folder;
  }
}
