import { Entity, model, property, belongsTo } from "@loopback/repository";
import { FolderModel } from "./folder.model";

@model({ settings: { strict: false, forceId: true } })
export class ReportModel extends Entity {
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
    type: "string",
    required: false,
  })
  description: string;

  @property({
    type: "array",
    itemType: "any",
  })
  items: {
    id: string; // string: chart id, object: formatted text
    type: string;
    open: boolean;
    focus?: boolean;
    key?: string;
    options?: Record<string, any>;
    data?: any;
  }[];

  @property({
    type: "boolean",
    default: false,
  })
  public: boolean;

  @property({
    type: "boolean",
    default: false,
  })
  baseline: boolean;

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

  @property({
    type: "object",
    required: false,
  })
  settings: object;

  @belongsTo(() => FolderModel)
  folderId?: string;

  constructor(data?: Partial<ReportModel>) {
    super(data);
  }
}

export interface ReportModelRelations {
  // describe navigational properties here
  folder?: FolderModel;
}

export type ReportModelWithRelations = ReportModel & ReportModelRelations;
