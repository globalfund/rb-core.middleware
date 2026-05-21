import { inject, Getter } from "@loopback/core";
import { ReportModel, FolderModel } from "../models";
import { DefaultCrudRepository, juggler, repository, BelongsToAccessor } from "@loopback/repository";
import { FolderRepository } from "./folder.repository";

export class ReportRepository extends DefaultCrudRepository<
  ReportModel,
  typeof ReportModel.prototype.id
> {
  public folder: BelongsToAccessor<FolderModel, typeof ReportModel.prototype.id>;

  constructor(
    @inject("datasources.db") dataSource: juggler.DataSource,
    @repository.getter("FolderRepository")
    protected folderRepositoryGetter: Getter<FolderRepository>,
  ) {
    super(ReportModel, dataSource);

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
