import { inject } from "@loopback/core";
import { FolderModel, AssetModel, ReportModel, FolderAssetModel, FolderReportModel } from "../models";
import { DefaultCrudRepository, juggler, Getter, repository, HasManyThroughRepositoryFactory, BelongsToAccessor, HasManyRepositoryFactory } from "@loopback/repository";
import { AssetRepository, ReportRepository, FolderAssetRepository, FolderReportRepository } from "./index";

export class FolderRepository extends DefaultCrudRepository<
  FolderModel,
  typeof FolderModel.prototype.id
> {
  public parent: BelongsToAccessor<FolderModel, typeof FolderModel.prototype.id>;
  public children: HasManyRepositoryFactory<FolderModel, typeof FolderModel.prototype.id>;

  public assets: HasManyThroughRepositoryFactory<
    AssetModel,
    typeof AssetModel.prototype.id,
    FolderAssetModel,
    typeof FolderModel.prototype.id
  >;

  public reports: HasManyThroughRepositoryFactory<
    ReportModel,
    typeof ReportModel.prototype.id,
    FolderReportModel,
    typeof FolderModel.prototype.id
  >;

  constructor(
    @inject("datasources.db") dataSource: juggler.DataSource,
    @repository.getter("AssetRepository")
    protected assetRepositoryGetter: Getter<AssetRepository>,
    @repository.getter("ReportRepository")
    protected reportRepositoryGetter: Getter<ReportRepository>,
    @repository.getter("FolderAssetRepository")
    protected folderAssetRepositoryGetter: Getter<FolderAssetRepository>,
    @repository.getter("FolderReportRepository")
    protected folderReportRepositoryGetter: Getter<FolderReportRepository>,
    @repository.getter('FolderRepository')
    protected folderRepositoryGetter: Getter<FolderRepository>,
  ) {
    super(FolderModel, dataSource);

    this.parent = this.createBelongsToAccessorFor('parent', folderRepositoryGetter);
    this.children = this.createHasManyRepositoryFactoryFor('children', folderRepositoryGetter);

    this.assets = this.createHasManyThroughRepositoryFactoryFor(
      "assets",
      assetRepositoryGetter,
      folderAssetRepositoryGetter
    );

    this.reports = this.createHasManyThroughRepositoryFactoryFor(
      "reports",
      reportRepositoryGetter,
      folderReportRepositoryGetter
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
