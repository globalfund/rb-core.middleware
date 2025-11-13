import { Entity, model, property } from "@loopback/repository";

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
  title: string;

  @property({
    type: "string",
    required: false,
  })
  description: string;

  @property({
    type: "array",
    itemType: "any",
  })
  rows: {
    items: any[]; // string: chart id, object: formatted text
    structure: string;
    contentWidths: {
      id: string;
      widths: number[];
    }[];
    contentHeights: {
      id: string;
      heights: number[];
    }[];
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
    required: false,
    default: "#FFFFFF",
  })
  backgroundColor: string;

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

  constructor(data?: Partial<ReportModel>) {
    super(data);
  }
}

export interface ReportModelRelations {
  // describe navigational properties here
}

export type ReportModelWithRelations = ReportModel & ReportModelRelations;
