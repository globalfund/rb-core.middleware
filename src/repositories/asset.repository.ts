import { inject, Getter } from "@loopback/core";
import { AssetModel, FolderModel } from "../models";
import { DefaultCrudRepository, juggler, repository, BelongsToAccessor } from "@loopback/repository";
import { FolderRepository } from "./folder.repository";

export class AssetRepository extends DefaultCrudRepository<
  AssetModel,
  typeof AssetModel.prototype.id
> {
  public folder: BelongsToAccessor<FolderModel, typeof AssetModel.prototype.id>;

  constructor(
    @inject("datasources.db") dataSource: juggler.DataSource,
    @repository.getter("FolderRepository")
    protected folderRepositoryGetter: Getter<FolderRepository>,
  ) {
    super(AssetModel, dataSource);

    this.folder = this.createBelongsToAccessorFor(
      "folder",
      folderRepositoryGetter,
    );

    this.registerInclusionResolver('folder', this.folder.inclusionResolver);

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
