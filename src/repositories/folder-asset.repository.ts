import { inject } from "@loopback/core";
import { FolderAssetModel } from "../models";
import { DefaultCrudRepository, juggler } from "@loopback/repository";

export class FolderAssetRepository extends DefaultCrudRepository<
  FolderAssetModel,
  typeof FolderAssetModel.prototype.id
> {
  constructor(@inject("datasources.db") dataSource: juggler.DataSource) {
    super(FolderAssetModel, dataSource);
  }
}
