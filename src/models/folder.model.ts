import {
  Entity,
  model,
  property,
  hasMany,
  belongsTo,
} from "@loopback/repository";
import { AssetModel } from "./asset.model";
import { ReportModel } from "./report.model";

@model({ settings: { strict: false, forceId: true } })
export class FolderModel extends Entity {
  @property({
    type: "string",
    id: true,
    generated: true,
  })
  id: string;

  @property({
    type: "string",
    required: false,
  })
  name: string;

  @property({
    type: "string",
    required: false,
  })
  nameLower: string;

  @property({
    type: "boolean",
    default: false,
  })
  public: boolean;

  @property({
    type: "string",
  })
  owner: string;

  @property({
    type: "date",
    default: () => new Date(),
  })
  createdDate: string;

  @property({
    type: "date",
    default: () => new Date(),
  })
  updatedDate: string;

  @hasMany(() => AssetModel, { keyTo: "folderId" })
  assets: AssetModel[];

  @hasMany(() => ReportModel, { keyTo: "folderId" })
  reports: ReportModel[];

  @belongsTo(() => FolderModel)
  parentId: string;

  @hasMany(() => FolderModel, { keyTo: "parentId" })
  children: FolderModel[];

  constructor(data?: Partial<FolderModel>) {
    super(data);
  }
}

export interface FolderModelRelations {
  // describe navigational properties here
  assets?: AssetModel[];
  reports?: ReportModel[];
  parent?: FolderModel;
  children?: FolderModel[];
}

export type FolderModelWithRelations = FolderModel & FolderModelRelations;
