import { inject } from "@loopback/core";
import { DatasetModel } from "../models";
import { DefaultCrudRepository, juggler } from "@loopback/repository";

export class DatasetRepository extends DefaultCrudRepository<
  DatasetModel,
  typeof DatasetModel.prototype.id
> {
  constructor(@inject("datasources.db") dataSource: juggler.DataSource) {
    super(DatasetModel, dataSource);

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
