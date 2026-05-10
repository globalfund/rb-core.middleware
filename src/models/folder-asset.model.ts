import { Entity, model, property, belongsTo } from "@loopback/repository";
import { FolderModel } from "./folder.model";
import { AssetModel } from "./asset.model";

@model({ settings: { strict: false, forceId: true } })
export class FolderAssetModel extends Entity {
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
  assetId: string;

  @property({
    type: "date",
    default: () => new Date(),
  })
  createdDate: string;

  constructor(data?: Partial<FolderAssetModel>) {
    super(data);
  }
}

export interface FolderAssetModelRelations {}

export type FolderAssetModelWithRelations = FolderAssetModel &
  FolderAssetModelRelations;
