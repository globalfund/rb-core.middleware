import { inject } from "@loopback/core";
import { ReportModel } from "../models";
import { DefaultCrudRepository, juggler } from "@loopback/repository";

export class ReportRepository extends DefaultCrudRepository<
  ReportModel,
  typeof ReportModel.prototype.id
> {
  constructor(@inject("datasources.db") dataSource: juggler.DataSource) {
    super(ReportModel, dataSource);

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
