import { inject, Getter } from "@loopback/core";
import { ReportModel, FolderModel, FolderReportModel } from "../models";
import { DefaultCrudRepository, juggler, repository, HasManyThroughRepositoryFactory } from "@loopback/repository";
import { FolderRepository } from "./folder.repository";
import { FolderReportRepository } from "./folder-report.repository";

export class ReportRepository extends DefaultCrudRepository<
  ReportModel,
  typeof ReportModel.prototype.id
> {
  public folders: HasManyThroughRepositoryFactory<
    FolderModel,
    typeof FolderModel.prototype.id,
    FolderReportModel,
    typeof ReportModel.prototype.id
  >;

  constructor(
    @inject("datasources.db") dataSource: juggler.DataSource,
    @repository.getter("FolderRepository")
    protected folderRepositoryGetter: Getter<FolderRepository>,
    @repository.getter("FolderReportRepository")
    protected folderReportRepositoryGetter: Getter<FolderReportRepository>
  ) {
    super(ReportModel, dataSource);

    this.folders = this.createHasManyThroughRepositoryFactoryFor(
      "folders",
      folderRepositoryGetter,
      folderReportRepositoryGetter
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
