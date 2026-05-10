import { Entity, model, property, belongsTo } from "@loopback/repository";
import { FolderModel } from "./folder.model";
import { ReportModel } from "./report.model";

@model({ settings: { strict: false, forceId: true } })
export class FolderReportModel extends Entity {
  @property({
    type: "string",
    id: true,
    generated: true,
  })
  id: string;

  @property({
    type: "string",
    required: true,
  })
  folderId: string;

  @property({
    type: "string",
    required: true,
  })
  reportId: string;

  @property({
    type: "date",
    default: () => new Date(),
  })
  createdDate: string;

  constructor(data?: Partial<FolderReportModel>) {
    super(data);
  }
}

export interface FolderReportModelRelations {}

export type FolderReportModelWithRelations = FolderReportModel &
  FolderReportModelRelations;
