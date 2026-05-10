import { inject } from "@loopback/core";
import { FolderReportModel } from "../models";
import { DefaultCrudRepository, juggler } from "@loopback/repository";

export class FolderReportRepository extends DefaultCrudRepository<
  FolderReportModel,
  typeof FolderReportModel.prototype.id
> {
  constructor(@inject("datasources.db") dataSource: juggler.DataSource) {
    super(FolderReportModel, dataSource);
  }
}
