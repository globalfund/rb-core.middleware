import { Entity, model, property } from "@loopback/repository";

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

  constructor(data?: Partial<FolderModel>) {
    super(data);
  }
}

export interface FolderModelRelations {
  // describe navigational properties here
}

export type FolderModelWithRelations = FolderModel & FolderModelRelations;
