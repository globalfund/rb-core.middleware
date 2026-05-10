import { inject, Getter } from "@loopback/core";
import { AssetModel, FolderModel, FolderAssetModel } from "../models";
import { DefaultCrudRepository, juggler, repository, HasManyThroughRepositoryFactory } from "@loopback/repository";
import { FolderRepository } from "./folder.repository";
import { FolderAssetRepository } from "./folder-asset.repository";

export class AssetRepository extends DefaultCrudRepository<
  AssetModel,
  typeof AssetModel.prototype.id
> {
  public folders: HasManyThroughRepositoryFactory<
    FolderModel,
    typeof FolderModel.prototype.id,
    FolderAssetModel,
    typeof AssetModel.prototype.id
  >;

  constructor(
    @inject("datasources.db") dataSource: juggler.DataSource,
    @repository.getter("FolderRepository")
    protected folderRepositoryGetter: Getter<FolderRepository>,
    @repository.getter("FolderAssetRepository")
    protected folderAssetRepositoryGetter: Getter<FolderAssetRepository>
  ) {
    super(AssetModel, dataSource);

    this.folders = this.createHasManyThroughRepositoryFactoryFor(
      "folders",
      folderRepositoryGetter,
      folderAssetRepositoryGetter
    );

    this.registerInclusionResolver('folders', this.folders.inclusionResolver);

    this.modelClass.observe("before save", this.beforeSave);
  }
  async beforeSave(ctx: any) {
    const { instance, data } = ctx;

    if (instance && instance.name) {
      instance.nameLower = instance.name.toLowerCase().trim();
    }

    if (data && data.name) {
      data.nameLower = data.name.toLowerCase().trim();
    }
  }
}
