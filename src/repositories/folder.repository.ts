import { inject } from "@loopback/core";
import { FolderModel, AssetModel, ReportModel } from "../models";
import { DefaultCrudRepository, juggler, Getter, repository, BelongsToAccessor, HasManyRepositoryFactory } from "@loopback/repository";
import { AssetRepository, ReportRepository } from "./index";

export class FolderRepository extends DefaultCrudRepository<
  FolderModel,
  typeof FolderModel.prototype.id
> {
  public parent: BelongsToAccessor<FolderModel, typeof FolderModel.prototype.id>;
  public children: HasManyRepositoryFactory<FolderModel, typeof FolderModel.prototype.id>;

  public assets: HasManyRepositoryFactory<
    AssetModel,
    typeof FolderModel.prototype.id
  >;

  public reports: HasManyRepositoryFactory<
    ReportModel,
    typeof FolderModel.prototype.id
  >;

  constructor(
    @inject("datasources.db") dataSource: juggler.DataSource,
    @repository.getter("AssetRepository")
    protected assetRepositoryGetter: Getter<AssetRepository>,
    @repository.getter("ReportRepository")
    protected reportRepositoryGetter: Getter<ReportRepository>,
    @repository.getter('FolderRepository')
    protected folderRepositoryGetter: Getter<FolderRepository>,
  ) {
    super(FolderModel, dataSource);

    this.parent = this.createBelongsToAccessorFor('parent', folderRepositoryGetter);
    this.children = this.createHasManyRepositoryFactoryFor('children', folderRepositoryGetter);

    this.assets = this.createHasManyRepositoryFactoryFor(
      "assets",
      assetRepositoryGetter,
    );

    this.reports = this.createHasManyRepositoryFactoryFor(
      "reports",
      reportRepositoryGetter,
    );

    this.registerInclusionResolver('parent', this.parent.inclusionResolver);
    this.registerInclusionResolver('children', this.children.inclusionResolver);
    this.registerInclusionResolver('assets', this.assets.inclusionResolver);
    this.registerInclusionResolver('reports', this.reports.inclusionResolver);

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
