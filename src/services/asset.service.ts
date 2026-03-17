import { inject } from "@loopback/core";
import {
  Count,
  Filter,
  FilterExcludingWhere,
  repository,
  Where,
} from "@loopback/repository";
import _ from "lodash";
import { AssetRepository } from "../repositories";
import { getCache, handleDeleteCache, setCache } from "../utils/redis";
import { Logger } from "winston";
import { LOGGER_KEY } from "../keys";
import { AssetModel } from "../models";

export class AssetService {
  constructor(
    @repository(AssetRepository)
    public assetRepository: AssetRepository,

    @inject(LOGGER_KEY) private logger: Logger,
  ) {}

  async create(
    userId: string,
    asset: Omit<AssetModel, "id">,
  ): Promise<AssetModel | { error: string; errorType: string }> {
    this.logger.info(`AssetService - create - creating a new asset`);
    asset.owner = userId;
    await handleDeleteCache({ asset: "story", userId });
    return await this.assetRepository.create(asset);
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

    const cachedData = await getCache(
      `stories-${userId}-${JSON.stringify(filter)}`,
    );
    if (cachedData) {
      this.logger.info(`AssetService - find - Returning cached asset list`);
      return cachedData;
    }

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
      ],
    });
    setCache(`stories-${userId}-${JSON.stringify(filter)}`, dataToCache);
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
  ): Promise<AssetModel | { error: string }> {
    this.logger.info(`AssetService - findById - getting asset by id ${id}`);
    const asset = await this.assetRepository.findById(id, filter);
    if (
      asset.public ||
      asset.baseline ||
      userIds.indexOf(_.get(asset, "owner", "")) !== -1
    ) {
      return asset;
    }
    this.logger.info(`AssetService - findById - unauthorized`);
    return { error: "Unauthorized", name: asset.name };
  }

  async updateById(
    userId: string,
    id: string,
    asset: AssetModel,
  ): Promise<void | { error: string }> {
    this.logger.info(`AssetService - updateById - updating asset by id ${id}`);
    const dbAsset = await this.assetRepository.findById(id);
    if (dbAsset.owner !== userId) {
      return { error: "Unauthorized" };
    }
    await this.assetRepository.updateById(id, {
      ...asset,
      updatedDate: new Date().toISOString(),
    });
    await handleDeleteCache({ asset: "story", assetId: id, userId });
  }

  async replaceById(
    userId: string,
    id: string,
    asset: AssetModel,
  ): Promise<void | { error: string }> {
    this.logger.info(`AssetService - replaceById - updating asset by id ${id}`);
    const dbAsset = await this.assetRepository.findById(id);
    if (dbAsset.owner !== userId) {
      return { error: "Unauthorized" };
    }
    this.logger.info(
      `AssetService - replaceById - replacing asset by id ${id}`,
    );
    await this.assetRepository.replaceById(id, asset);
    await handleDeleteCache({ asset: "story", assetId: id, userId });
  }

  async deleteById(
    userId: string,
    id: string,
  ): Promise<void | { error: string }> {
    this.logger.info(`AssetService - deleteById - deleting asset by id ${id}`);
    const dbAsset = await this.assetRepository.findById(id);
    if (dbAsset.owner !== userId) {
      return { error: "Unauthorized" };
    }
    await this.assetRepository.deleteById(id);
    await handleDeleteCache({ asset: "story", assetId: id, userId });
  }

  async duplicate(
    userId: string,
    id: string,
  ): Promise<AssetModel | { error: string; errorType: string }> {
    this.logger.info(
      `AssetService - duplicate - duplicating asset by id ${id}`,
    );
    const fAsset = await this.assetRepository.findById(id);
    // Duplicate Asset
    const newAsset = await this.assetRepository.create({
      name: `${fAsset.name} (Copy)`,
      description: fAsset.description,
      type: fAsset.type,
      options: fAsset.options,
      data: fAsset.data,
      public: false,
      baseline: false,
      owner: userId,
    });
    await handleDeleteCache({ asset: "story", userId });
    return newAsset;
  }
}
