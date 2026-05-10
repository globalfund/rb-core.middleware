import { Entity, model, property, hasMany } from "@loopback/repository";
import { FolderModel } from "./folder.model";
import { FolderAssetModel } from "./folder-asset.model";

@model({ settings: { strict: false, forceId: true } })
export class AssetModel extends Entity {
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
    type: "string",
    required: false,
  })
  type: string;

  @property({
    type: "object",
    required: false,
  })
  options: object;

  @property({
    type: "object",
    required: false,
  })
  data: object;

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

  @hasMany(() => FolderModel, {
    through: {
      model: () => FolderAssetModel,
      keyFrom: "assetId",
      keyTo: "folderId",
    },
  })
  folders: FolderModel[];

  constructor(data?: Partial<AssetModel>) {
    super(data);
  }
}

export interface AssetModelRelations {
  // describe navigational properties here
  folders?: FolderModel[];
}

export type AssetModelWithRelations = AssetModel & AssetModelRelations;
